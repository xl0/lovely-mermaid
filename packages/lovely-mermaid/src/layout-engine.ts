/**
 * The bridge between the mermaid parsers and the layout engine: `Graph` in,
 * `LayoutInput` out (sizes in cells, labels measured), and the engine's
 * geometry painted onto a `Canvas` with the existing box / edge drawing.
 * Direction is finished by the engine, so nothing here flips a canvas.
 *
 * Subgraphs become compounds: group `i` is `g<i>`, a node standing in for
 * a subgraph (same id) is dropped and its edges attach to the compound.
 * The engine hands back each frame; the title goes on its top row.
 *
 * Status: styles are not applied. Not exported from the package index.
 */
import { Canvas, D, drawTextOverEdges, L, R, STY_DOT, STY_SOLID, STY_THICK, U } from './canvas.ts'
import { parseClass } from './diagrams/class.ts'
import { parseEr } from './diagrams/er.ts'
import { parseGraph } from './diagrams/flowchart.ts'
import { parseState } from './diagrams/state.ts'
import { layout, layoutBest, layoutFast } from './engine/index.ts'
import type { Snapshot } from './engine/snapshot.ts'
import type {
  Candidate,
  FitOptions,
  InputCompound,
  InputLabel,
  InputNode,
  LayoutInput,
  LayoutOptions,
  LayoutResult,
  Pt,
  Spacing,
  Trace,
} from './engine/types.ts'
import type { Graph } from './graph.ts'
import {
  EDGE_WRAP,
  EDGE_WRAP_NARROW,
  fitLabel,
  MAX_LABEL,
  MAX_LINES,
  stripControls,
  WRAP_WIDTH,
  wrapLabel,
} from './labels.ts'
import { drawBox, drawClassBox, half, headGlyph, MAX_CANVAS_CELLS, sat } from './layout.ts'
import type { MermaidArt } from './types.ts'
import { stringWidth } from './width.ts'

export { layout, layoutBest, layoutFast } from './engine/index.ts'
export type { Pt, SEdge, SNode, Snapshot, SPort } from './engine/snapshot.ts'
export type {
  Candidate,
  FitOptions,
  LayoutInput,
  LayoutOptions,
  Phase,
} from './engine/types.ts'
export { PHASES } from './engine/types.ts'

/**
 * Cell gaps in the engine's cross axis: columns between boxes in a row for
 * a vertical flow, rows between boxes in a column for a horizontal one
 * (cells are about 1:2, so half as many).
 */
const SPACING: Record<Graph['dir'], Spacing> = {
  down: { nodeNode: 3, nodeEdge: 1, edgeEdge: 1, channelGap: 1, framePad: 1 },
  up: { nodeNode: 3, nodeEdge: 1, edgeEdge: 1, channelGap: 1, framePad: 1 },
  right: { nodeNode: 1, nodeEdge: 0, edgeEdge: 0, channelGap: 1, framePad: 0 },
  left: { nodeNode: 1, nodeEdge: 0, edgeEdge: 0, channelGap: 1, framePad: 0 },
}

/** The frame title as painted, with its padding spaces. */
const frameTitle = (label: string, width: number): string => ` ${fitLabel(label, sat(width, 4))} `

/** Node `i` is `n<i>`, edge `i` is `e<i>`, group `i` is `g<i>`; `lines`
 * are the wrapped node labels. */
export function importGraph(graph: Graph): { input: LayoutInput; lines: string[][] } {
  const lines = graph.nodes.map((n) => wrapLabel(n.label, WRAP_WIDTH, MAX_LINES))
  const group = (i: number | null): string | undefined => (i === null ? undefined : `g${i}`)
  const compounds: InputCompound[] = graph.groups.map((g, i) => ({
    id: `g${i}`,
    label: g.label,
    parent: group(g.parent),
    titleW: g.label === '' ? 0 : stringWidth(frameTitle(g.label, WRAP_WIDTH + 4)),
    dir: g.dir,
  }))
  // a node whose id is a subgraph's stands in for that subgraph
  const proxy = new Map<number, string>()
  graph.groups.forEach((g, gi) => {
    const ni = graph.index.get(g.id)
    if (ni !== undefined) proxy.set(ni, `g${gi}`)
  })
  const nodes: InputNode[] = []
  graph.nodes.forEach((n, i) => {
    if (proxy.has(i)) return
    const parent = group(graph.nodeGroup[i])
    if (n.sections !== undefined) {
      const w = Math.max(1, ...n.sections.flat().map(stringWidth)) + 4
      const filled = n.sections.filter((s) => s.length > 0).length
      const h = n.sections.reduce((s, sec) => s + sec.length, 0) + sat(filled, 1) + 2
      // the compartment text as the lab label, so the box's size reads
      // as what it is (the engine never looks at labels)
      const label = n.sections
        .filter((sec) => sec.length > 0)
        .map((sec) => sec.join('\n'))
        .join('\n⎯⎯⎯\n')
      nodes.push({ id: `n${i}`, label, w, h, parent })
      return
    }
    nodes.push({
      id: `n${i}`,
      label: lines[i].join('\n'),
      w: Math.max(1, ...lines[i].map(stringWidth)) + 4,
      h: lines[i].length + 2,
      parent,
    })
  })
  /** Balanced greedy wrap: fewest rows at `max`, then the narrowest
   * width still fitting them — never below the longest word (wrapLabel
   * would slice it). Deterministic: `drawLayout` re-wraps at the placed
   * width and reproduces the lines, since every break happened because
   * the next word overflowed a cap no smaller than the widest line. */
  const balance = (t: string, max: number): { w: number; h: number } => {
    const rows = Math.ceil(stringWidth(t) / max)
    let lines = wrapLabel(t, max, rows + 1)
    const word = Math.max(...t.split(/\s+/).map(stringWidth))
    for (let wc = Math.max(word, Math.ceil(stringWidth(t) / rows)); wc < max; wc++) {
      const cand = wrapLabel(t, wc, rows + 1)
      if (cand.length <= rows) {
        lines = cand
        break
      }
    }
    return { w: Math.max(...lines.map(stringWidth)), h: lines.length }
  }
  /** Labels are bare text — no space margins; the engine keeps them off
   * foreign edges. The flat single line is the primary shape; a long
   * centre label also offers a narrow block for hanging beside a
   * vertical run and a balanced block for a floating body. */
  const measure = (text: string, at: InputLabel['at']): InputLabel => {
    if (at !== 'center') {
      const t = fitLabel(text, MAX_LABEL)
      return { text: t, w: Math.max(1, stringWidth(t)), h: 1, at }
    }
    const t = fitLabel(text, EDGE_WRAP * 3)
    const out: InputLabel = { text: t, w: Math.max(1, stringWidth(t)), h: 1, at }
    if (stringWidth(t) > EDGE_WRAP_NARROW) out.tall = balance(t, EDGE_WRAP_NARROW)
    if (stringWidth(t) > EDGE_WRAP) out.block = balance(t, EDGE_WRAP)
    return out
  }
  const edges = graph.edges.map((e, i) => {
    const labels: InputLabel[] = []
    if (e.cardFrom !== undefined) labels.push(measure(e.cardFrom, 'tail'))
    if (e.label !== null) labels.push(measure(e.label, 'center'))
    if (e.cardTo !== undefined) labels.push(measure(e.cardTo, 'head'))
    const end = (n: number): string => proxy.get(n) ?? `n${n}`
    return { id: `e${i}`, from: end(e.from), to: end(e.to), labels }
  })
  const alt = graph.dir === 'right' || graph.dir === 'left' ? SPACING.down : SPACING.right
  // a diagram with cardinalities (ER, class) carries rail annotations —
  // card, verb, card beside the line — and reserves their room in every
  // channel, a bit of size for labels that always land (user's call):
  // stacked rows flowing down, or run length for the verb to anchor
  // beside a sideways run
  const spacing = { ...SPACING[graph.dir] }
  if (graph.edges.some((e) => e.cardFrom !== undefined || e.cardTo !== undefined)) {
    const sideways = graph.dir === 'right' || graph.dir === 'left'
    let need = 0
    for (const e of edges) {
      const ls = e.labels ?? []
      const verb = ls.find((l) => l.at === 'center')
      const cards = ls.length - (verb === undefined ? 0 : 1)
      need = Math.max(
        need,
        sideways ? Math.ceil((verb?.w ?? 0) / 2) + (cards > 0 ? 2 : 0) : (verb?.h ?? 0) + cards,
      )
    }
    if (need > 0) spacing.channelMin = need
  }
  return {
    input: {
      dir: graph.dir,
      nodes,
      edges,
      compounds,
      spacing,
      altSpacing: alt,
    },
    lines,
  }
}

/** Paint the engine's geometry; `null` when there is none, or when the
 * canvas would exceed the cap. */
export function drawLayout(graph: Graph, res: LayoutResult, lines: string[][]): Canvas | null {
  if (res.width === 0 || res.height === 0 || res.width * res.height > MAX_CANVAS_CELLS) return null
  const canvas = new Canvas(res.width, res.height)
  // Frames first: a perimeter of bits (edges tee into it, boxes and edges
  // lie inside) and the nesting depth over the whole rect (see Span.frame);
  // the title is painted last, over whatever pierces the top row.
  graph.groups.forEach((_, i) => {
    const r = res.compounds[`g${i}`]
    if (r === undefined) return
    const right = r.x + r.w - 1
    const bottom = r.y + r.h - 1
    canvas.set(r.x, r.y, '┌', 'border')
    canvas.set(right, r.y, '┐', 'border')
    canvas.set(r.x, bottom, '└', 'border')
    canvas.set(right, bottom, '┘', 'border')
    for (let cx = r.x + 1; cx < right; cx++) {
      canvas.addBits(cx, r.y, L | R, 'border')
      canvas.addBits(cx, bottom, L | R, 'border')
    }
    for (let cy = r.y + 1; cy < bottom; cy++) {
      canvas.addBits(r.x, cy, U | D, 'border')
      canvas.addBits(right, cy, U | D, 'border')
    }
    for (let cy = r.y; cy < r.y + r.h; cy++) {
      for (let cx = r.x; cx < r.x + r.w; cx++) canvas.frame[canvas.idx(cx, cy)]++
    }
  })
  graph.nodes.forEach((n, i) => {
    const r = res.nodes[`n${i}`]
    if (r === undefined) return
    const p = { ...r, cx: r.x + half(r.w), cy: r.y + half(r.h), rank: 0 }
    canvas.curTag = n.classes?.join(' ')
    canvas.curHref = n.href
    if (n.sections !== undefined) drawClassBox(canvas, p, n.sections)
    else drawBox(canvas, p, lines[i], n.shape)
    canvas.curTag = undefined
    canvas.curHref = undefined
  })
  graph.edges.forEach((e, i) => {
    const r = res.edges[`e${i}`]
    if (r === undefined || r.route.length < 2) return
    canvas.curStyle = e.line === 'dotted' ? STY_DOT : e.line === 'thick' ? STY_THICK : STY_SOLID
    const pts = r.route
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]
      const b = pts[k + 1]
      if (a[1] === b[1]) canvas.segH(a[1], a[0], b[0])
      else canvas.segV(a[0], a[1], b[1])
    }
    // The port cells are border cells: merge the outgoing direction into the
    // border glyph so the box shows a tee where the edge leaves or enters.
    const tee = (port: Pt, next: Pt): void => {
      const dx = Math.sign(next[0] - port[0])
      const dy = Math.sign(next[1] - port[1])
      canvas.junction(port[0], port[1], dy > 0 ? D : dy < 0 ? U : dx > 0 ? R : L)
    }
    tee(pts[0], pts[1])
    tee(pts[pts.length - 1], pts[pts.length - 2])
    // Heads sit in the cell before the port cell, pointing along the last
    // (first) segment.
    const head = (from: Pt, to: Pt, glyph: (arrow: string) => string): void => {
      const dx = Math.sign(to[0] - from[0])
      const dy = Math.sign(to[1] - from[1])
      const arrow = dy > 0 ? '▼' : dy < 0 ? '▲' : dx > 0 ? '▶' : '◄'
      canvas.set(to[0] - dx, to[1] - dy, glyph(arrow), 'edge')
    }
    if (e.headTo !== 'none')
      head(pts[pts.length - 2], pts[pts.length - 1], (a) => headGlyph(e.headTo, a))
    if (e.headFrom !== 'none') head(pts[1], pts[0], (a) => headGlyph(e.headFrom, a))
  })
  canvas.curStyle = STY_SOLID
  for (const r of Object.values(res.edges)) {
    for (const l of r.labels) {
      if (l.h <= 1) {
        drawTextOverEdges(canvas, l.text, l.x, l.y, 'edgeLabel')
        continue
      }
      // a wrapped block (only ever beside its run — it covers no line):
      // re-wrap at the placed width, rows left-aligned, hanging off the
      // column like the sketch (`│this label` / `│wraps like`)
      const lines = wrapLabel(l.text, l.w, l.h)
      lines.forEach((ln, i) => {
        drawTextOverEdges(canvas, ln, l.x, l.y + i, 'edgeLabel')
      })
    }
  }
  // floating bodies: the `[n]` prefix, then the wrapped text hanging off it
  for (const f of res.floats ?? []) {
    const pre = `[${f.n}] `
    drawTextOverEdges(canvas, pre, f.x, f.y, 'edgeLabel')
    wrapLabel(f.text, f.w - pre.length, f.h).forEach((ln, i) => {
      drawTextOverEdges(canvas, ln, f.x + pre.length, f.y + i, 'edgeLabel')
    })
  }
  graph.groups.forEach((g, i) => {
    const r = res.compounds[`g${i}`]
    if (r === undefined || g.label === '') return
    drawTextOverEdges(canvas, frameTitle(g.label, r.w), r.x + 1, r.y, 'text')
  })
  canvas.finalizeMask()
  return canvas
}

function parse(src: string): Graph | null {
  const s = stripControls(src)
  return parseGraph(s) ?? parseState(s) ?? parseClass(s) ?? parseEr(s)
}

/**
 * Compose the final art: the painted canvas, and above it a legend box
 * for the labels that fit nowhere near their edge — `[n]` ties an entry
 * to its marker, an entry without one names its edge's endpoints.
 */
function finishArt(canvas: Canvas, graph: Graph, res: LayoutResult): MermaidArt {
  const body = canvas.toLines()
  const warnings = [...graph.warnings, ...res.warnings]
  const legend = res.legend ?? []
  if (legend.length === 0) return { ...body, classDefs: graph.classDefs, warnings }
  const name = (n: number): string => fitLabel(graph.nodes[n].label.split('\n')[0], 14)
  const entries = legend.map((e) => {
    const ge = graph.edges[Number(e.edge.slice(1))]
    const key = e.n !== undefined ? `[${e.n}]` : `${name(ge.from)} → ${name(ge.to)}:`
    return `${key} ${e.text}`
  })
  const w = Math.min(Math.max(...entries.map(stringWidth)) + 4, Math.max(res.width, 40))
  const lc = new Canvas(w, entries.length + 2)
  lc.set(0, 0, '┌', 'border')
  lc.set(w - 1, 0, '┐', 'border')
  lc.set(0, entries.length + 1, '└', 'border')
  lc.set(w - 1, entries.length + 1, '┘', 'border')
  for (let x = 1; x < w - 1; x++) {
    lc.addBits(x, 0, L | R, 'border')
    lc.addBits(x, entries.length + 1, L | R, 'border')
  }
  entries.forEach((entry, i) => {
    lc.addBits(0, i + 1, U | D, 'border')
    lc.addBits(w - 1, i + 1, U | D, 'border')
    drawTextOverEdges(lc, fitLabel(entry, w - 4), 2, i + 1, 'edgeLabel')
  })
  lc.finalizeMask()
  const head = lc.toLines()
  return {
    plain: [...head.plain, ...body.plain],
    styled: [...head.styled, ...body.styled],
    width: Math.max(head.width, body.width),
    classDefs: graph.classDefs,
    warnings,
  }
}

/** The half of `renderEngine` before layout: source → engine input. The lab
 * keeps the input and re-runs `layout` on it as options change. */
export function prepare(
  src: string,
): { graph: Graph; input: LayoutInput; lines: string[][] } | null {
  const graph = parse(src)
  if (graph === null) return null
  return { graph, ...importGraph(graph) }
}

/** Parse, lay out and paint; `trace` sees the engine's phase snapshots. */
export function renderEngine(
  src: string,
  opts: LayoutOptions = {},
  trace?: Trace,
): MermaidArt | null {
  const p = prepare(src)
  if (p === null) return null
  const { graph, input, lines } = p
  const res = layout(input, opts, trace)
  const canvas = drawLayout(graph, res, lines)
  if (canvas === null) return null
  return finishArt(canvas, graph, res)
}

/** The lab's entry point: every phase snapshot plus the finished art. */
export function traceEngine(
  src: string,
  opts: LayoutOptions = {},
): { snapshots: Snapshot[]; art: MermaidArt | null } {
  const snapshots: Snapshot[] = []
  const art = renderEngine(src, opts, (s) => snapshots.push(s))
  return { snapshots, art }
}

/** The streaming mode: `layoutFast` through the bridge — one cheap
 * deterministic pass toward the width (best-effort, may exceed it).
 * Re-run per streamed update; call `traceEngineFit` for the full
 * render once the source settles. */
export function traceEngineFast(
  src: string,
  fit: FitOptions = {},
): { snapshots: Snapshot[]; art: MermaidArt | null } | null {
  const p = prepare(src)
  if (p === null) return null
  const snapshots: Snapshot[] = []
  const result = layoutFast(p.input, fit, (s) => snapshots.push(s))
  const canvas = drawLayout(p.graph, result, p.lines)
  const art = canvas === null ? null : finishArt(canvas, p.graph, result)
  return { snapshots, art }
}

/** `traceEngine` through the candidate loop: the winner's snapshots and
 * art, plus what was tried. `null` when the source does not parse. */
export function traceEngineFit(
  src: string,
  fit: FitOptions,
  opts: LayoutOptions = {},
): {
  snapshots: Snapshot[]
  art: MermaidArt | null
  candidates: Candidate[]
  chosen: string
} | null {
  const p = prepare(src)
  if (p === null) return null
  const snapshots: Snapshot[] = []
  const { result, candidates, chosen } = layoutBest(p.input, opts, fit, (s) => snapshots.push(s))
  const canvas = drawLayout(p.graph, result, p.lines)
  const art = canvas === null ? null : finishArt(canvas, p.graph, result)
  const label =
    candidates.find((c) => c.opts === chosen)?.label ?? `${candidates.length} candidates`
  return { snapshots, art, candidates, chosen: label }
}
