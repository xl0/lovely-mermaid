/**
 * `gantt`: proportional task bars on a ruled time axis. Gantt source is
 * lenient: bad task lines drop with a warning while the rest still render.
 */

import { Canvas, drawText } from '../canvas.ts'
import { MAX_NODES } from '../graph.ts'
import { cleanLabel, fitLabel } from '../labels.ts'
import type { Diagram } from '../registry.ts'
import { headerKind, statementsOf, words } from '../statements.ts'
import { stringWidth } from '../width.ts'

const TRACK_W = 48
const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const DURATION = /^(\d+(?:\.\d+)?)(ms|min|s|h|d|w)$/
const DUR_MS: Record<string, number> = { ms: 1, s: 1_000, min: MINUTE, h: HOUR, d: DAY, w: 7 * DAY }
const TAGS = new Set(['done', 'active', 'crit', 'milestone'])
const TICK_STEPS = [
  MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
  91 * DAY,
  365 * DAY,
]

type TaskState = 'normal' | 'done' | 'active' | 'crit' | 'milestone'

interface RawTask {
  name: string
  section: string
  tags: string[]
  id?: string
  startDate?: number
  after?: string[]
  endDate?: number
  duration?: number
  order: number
  source: string
}

interface Task {
  name: string
  start: number
  end: number
  state: TaskState
  tags: string[]
}

interface Section {
  name: string
  tasks: Task[]
}

interface Gantt {
  title: string | null
  sections: Section[]
  timeOnly: boolean
  warnings: string[]
}

export const gantt: Diagram = {
  kind: 'gantt',
  headers: ['gantt'],
  render(src) {
    const parsed = parseGantt(src)
    if (parsed === null) return null
    const { title, sections, timeOnly, warnings } = parsed
    const tasks = sections.flatMap((section) => section.tasks)
    const min = Math.min(...tasks.map((task) => task.start))
    let max = Math.max(...tasks.map((task) => task.end))
    if (max <= min) max = min + MINUTE
    const span = max - min
    const labelW = Math.min(Math.max(8, ...tasks.map((task) => stringWidth(task.name))), 28)
    const trackX = labelW + 1
    const width = Math.max(
      trackX + TRACK_W,
      title === null ? 0 : stringWidth(title),
      ...sections.map((section) => stringWidth(section.name)),
    )
    const top = title === null ? 0 : 1
    const rows = sections.reduce(
      (sum, section) => sum + (section.name === '' ? 0 : 1) + section.tasks.length,
      2,
    )
    const canvas = new Canvas(width, top + rows)
    const col = (time: number): number => Math.round(((time - min) / span) * (TRACK_W - 1))

    if (title !== null) {
      drawText(canvas, title, Math.max(0, Math.floor((width - stringWidth(title)) / 2)), 0, 'title')
    }

    const ticks = tickColumns(min, max, span, col, timeOnly)
    const labels = new Array(TRACK_W).fill(' ')
    const rule = new Array(TRACK_W).fill('─')
    for (const { column, label } of ticks) {
      rule[column] = '┬'
      const start = Math.min(column, TRACK_W - stringWidth(label))
      if (start < 0 || labels.slice(start, start + label.length).some((cell) => cell !== ' '))
        continue
      for (let i = 0; i < label.length; i++) labels[start + i] = label[i]
    }
    drawText(canvas, labels.join('').replace(/ +$/, ''), trackX, top, 'text')
    drawText(canvas, rule.join(''), trackX, top + 1, 'border')

    let y = top + 2
    for (const section of sections) {
      if (section.name !== '') {
        drawText(canvas, section.name, 0, y, 'title')
        y++
      }
      for (const task of section.tasks) {
        drawText(canvas, '·'.repeat(TRACK_W), trackX, y, 'border')
        canvas.curTag = task.tags.length === 0 ? undefined : task.tags.join(' ')
        if (task.state === 'milestone') {
          drawText(canvas, '◆', trackX + col(task.start), y, 'edge')
        } else {
          const from = col(task.start)
          const to = Math.max(col(task.end) - 1, from)
          drawText(
            canvas,
            (task.state === 'active' || task.state === 'crit' ? '━' : '─').repeat(to - from + 1),
            trackX + from,
            y,
            'edge',
          )
        }
        drawText(canvas, task.name, 0, y, 'text')
        canvas.curTag = undefined
        y++
      }
    }
    return { canvas, warnings, classDefs: {} }
  },
}

function parseGantt(src: string): Gantt | null {
  const statements = statementsOf(src)
  if (headerKind(statements) !== 'gantt') return null

  let title: string | null = null
  let dateFormat = 'YYYY-MM-DD'
  let section = ''
  const raw: RawTask[] = []
  const warnings: string[] = []
  let truncated = false

  for (const statement of statements.slice(1)) {
    const [first] = words(statement)
    switch (first?.toLowerCase()) {
      case 'title':
        title = statement.slice(first.length).trim() || null
        continue
      case 'dateformat': {
        const next = statement.slice(first.length).trim()
        // one timestamp domain per chart: once a task has parsed, the format
        // is locked; later changes would mix clock and calendar scales
        if (raw.length > 0 && next !== '' && next !== dateFormat) {
          warnings.push(`ignored, mid-chart dateFormat change: "${statement}"`)
        } else if (next !== '') dateFormat = next
        continue
      }
      case 'axisformat':
      case 'excludes':
      case 'includes':
      case 'todaymarker':
      case 'displaymode':
      case 'tickinterval':
      case 'weekday':
      case 'weekend':
      case 'inclusiveenddates':
      case 'topaxis':
        continue
      case 'section':
        section = statement.slice(first.length).trim()
        continue
    }
    const task = parseTask(statement, section, dateFormat, raw.length)
    if (task === null) {
      warnings.push(`dropped, unreadable statement: "${statement}"`)
      continue
    }
    if (raw.length >= MAX_NODES) {
      truncated = true
      break
    }
    raw.push(task)
  }
  if (truncated) warnings.push(`diagram truncated: task cap (${MAX_NODES}) reached`)
  if (raw.length === 0) return null

  const byId = new Map<string, RawTask>()
  for (const task of raw) if (task.id !== undefined) byId.set(task.id, task)
  const starts = new Array<number>(raw.length).fill(Number.NaN)
  const ends = new Array<number>(raw.length).fill(Number.NaN)
  for (let pass = 0; pass < raw.length; pass++) {
    let changed = false
    for (const task of raw) {
      const i = task.order
      if (Number.isNaN(starts[i])) {
        if (task.startDate !== undefined) starts[i] = task.startDate
        else if (task.after !== undefined) {
          const dependencies = task.after.map((id) => byId.get(id))
          if (dependencies.every((dependency): dependency is RawTask => dependency !== undefined)) {
            const dependencyEnds = dependencies.map((dependency) => ends[dependency.order])
            if (dependencyEnds.every((end) => !Number.isNaN(end)))
              starts[i] = Math.max(...dependencyEnds)
          }
        } else if (i === 0 || !Number.isNaN(ends[i - 1])) {
          starts[i] = i === 0 ? 0 : ends[i - 1]
        }
      }
      if (!Number.isNaN(starts[i]) && Number.isNaN(ends[i])) {
        // milestones occupy their start instant; dependents chain from it
        ends[i] = task.tags.includes('milestone')
          ? starts[i]
          : (task.endDate ?? starts[i] + (task.duration ?? 0))
        changed = true
      }
    }
    if (!changed) break
  }

  const sections: Section[] = []
  for (const task of raw) {
    const start = starts[task.order]
    const end = ends[task.order]
    if (Number.isNaN(start) || Number.isNaN(end)) {
      warnings.push(`dropped, unresolved task: "${task.source}"`)
      continue
    }
    if (end < start) {
      warnings.push(`dropped, end before start: "${task.source}"`)
      continue
    }
    // a re-declared section starts a new block, keeping authored order
    let target = sections[sections.length - 1]
    if (target === undefined || target.name !== task.section) {
      target = { name: task.section, tasks: [] }
      sections.push(target)
    }
    const state = task.tags.includes('milestone')
      ? 'milestone'
      : task.tags.includes('crit')
        ? 'crit'
        : task.tags.includes('active')
          ? 'active'
          : task.tags.includes('done')
            ? 'done'
            : 'normal'
    target.tasks.push({
      name: task.name,
      start,
      end,
      state,
      tags: task.tags,
    })
  }
  if (sections.length === 0) return null
  return { title, sections, timeOnly: /^h/i.test(dateFormat), warnings }
}

function parseTask(
  statement: string,
  section: string,
  dateFormat: string,
  order: number,
): RawTask | null {
  const colon = statement.indexOf(':')
  if (colon === -1) return null
  const name = fitLabel(cleanLabel(statement.slice(0, colon).trim()), 28)
  if (name === '') return null
  const task: RawTask = { name, section, tags: [], order, source: statement }
  for (const part of statement.slice(colon + 1).split(',')) {
    const token = part.trim()
    if (token === '') continue
    const tag = token.toLowerCase()
    if (TAGS.has(tag)) {
      task.tags.push(tag)
      continue
    }
    if (/^after\b/i.test(token)) {
      const ids = token
        .replace(/^after\s+/i, '')
        .trim()
        .split(/\s+/)
        .filter((id) => id !== '')
      if (ids.length === 0 || task.after !== undefined) return null
      task.after = ids
      continue
    }
    const duration = DURATION.exec(token)
    if (duration !== null) {
      if (task.duration !== undefined || task.endDate !== undefined) return null
      const value = Number(duration[1]) * DUR_MS[duration[2]]
      if (!Number.isFinite(value)) return null
      task.duration = value
      continue
    }
    const date = parseDate(token, dateFormat)
    if (date !== null) {
      if (task.startDate === undefined) task.startDate = date
      else if (task.endDate === undefined && task.duration === undefined) task.endDate = date
      else return null
      continue
    }
    // a date we cannot read (unsupported dateFormat, invalid values) must not
    // fall through to id and silently render at time zero
    if (/\d[-/:.,]\d/.test(token)) return null
    if (task.id === undefined) task.id = token
    else return null
  }
  return task.duration === undefined &&
    task.endDate === undefined &&
    !task.tags.includes('milestone')
    ? null
    : task
}

function parseDate(token: string, dateFormat: string): number | null {
  // parse strictly inside the declared format's domain: clock and calendar
  // timestamps are incompatible and must never mix within one chart
  if (dateFormat === 'X' || dateFormat === 'x') {
    if (!/^\d+$/.test(token)) return null
    const value = Number(token)
    if (!Number.isFinite(value)) return null
    return dateFormat === 'X' ? value * 1000 : value
  }
  if (/^h/i.test(dateFormat)) {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(token)
    if (match === null) return null
    const hours = +match[1]
    const minutes = +match[2]
    const seconds = +(match[3] ?? 0)
    if (hours > 23 || minutes > 59 || seconds > 59) return null
    return (hours * 60 + minutes) * MINUTE + seconds * 1000
  }
  if (!/^y/i.test(dateFormat)) return null
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(token)
  if (match === null) return null
  const year = +match[1]
  const month = +match[2]
  const day = +match[3]
  const hours = +(match[4] ?? 0)
  const minutes = +(match[5] ?? 0)
  const seconds = +(match[6] ?? 0)
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  const date = new Date(year, month - 1, day, hours, minutes, seconds)
  // reject overflow-normalized dates like 2026-02-31
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null
  return date.getTime()
}

function tickColumns(
  min: number,
  max: number,
  span: number,
  col: (time: number) => number,
  timeOnly: boolean,
): { column: number; label: string }[] {
  const step = TICK_STEPS.find(
    (candidate) =>
      (candidate / span) * (TRACK_W - 1) >= 12 && Math.floor(span / candidate) + 1 <= 10,
  )
  if (step === undefined) {
    // spans beyond the coarsest step (≈4+ years) still get labelled endpoints
    return [
      { column: 0, label: formatTick(min, span, timeOnly) },
      { column: TRACK_W - 1, label: formatTick(max, span, timeOnly) },
    ]
  }
  let first = Math.ceil(min / step) * step
  if (step >= DAY) {
    const day = new Date(min)
    day.setHours(0, 0, 0, 0)
    first = day.getTime()
    if (first < min) first += step
  }
  const ticks: { column: number; label: string }[] = []
  for (let time = first; time <= max; time += step) {
    ticks.push({ column: col(time), label: formatTick(time, span, timeOnly) })
  }
  return ticks
}

function formatTick(time: number, span: number, timeOnly: boolean): string {
  if (timeOnly) {
    // clock labels wrap past midnight; the timeline itself stays monotonic
    const minutes = Math.floor(time / MINUTE) % (24 * 60)
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }
  const date = new Date(time)
  if (span <= 2 * DAY) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  if (span <= 91 * DAY) return `${MONTHS[date.getMonth()]} ${date.getDate()}`
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
