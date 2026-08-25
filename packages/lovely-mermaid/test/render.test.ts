import { expect, test } from 'bun:test'
import { CONT } from '../src/canvas.ts'
import { diagramKind, render, sourceBox, toAnsi } from '../src/index.ts'
import { stringWidth } from '../src/width.ts'
import { lines, plain } from './helpers.ts'

// Rendering shape is pinned by the golden files in test/cases/. What lives
// here are the invariants that never land in the plain text: spans, classDefs,
// widths, caps on generated sources, streaming stability, control characters.

// ------------------------------------------------------- classes and classDefs

test('author classes reach the spans and classDefs the art', () => {
  const art = render(
    'flowchart TD\n A[Hot node]:::hot --> B\n class B cold\n classDef hot fill:#f96,stroke:#333\n classDef cold fill:#69f',
  )
  if (art === null) throw new Error('render drew nothing')
  expect(art.classDefs).toEqual({
    hot: { fill: '#f96', stroke: '#333' },
    cold: { fill: '#69f' },
  })
  const classed = art.styled.flat().filter((s) => s.classes !== undefined)
  expect(classed.some((s) => s.text.includes('Hot node') && s.classes?.[0] === 'hot')).toBe(true)
  expect(classed.some((s) => s.text.includes('B') && s.classes?.[0] === 'cold')).toBe(true)
  // Cells the node did not paint carry no classes.
  expect(art.styled.flat().some((s) => s.role === 'edge' && s.classes !== undefined)).toBe(false)
})

test('state classDefs and class assignments are surfaced', () => {
  const art = render('stateDiagram-v2\n A --> B\n class A warning\n classDef warning fill:#f00')
  if (art === null) throw new Error('render drew nothing')
  expect(art.classDefs).toEqual({ warning: { fill: '#f00' } })
  expect(
    art.styled.flat().some((s) => s.text.includes('A') && s.classes?.includes('warning')),
  ).toBe(true)
})

test('`:::` classes are captured in state and class diagrams', () => {
  const st = render(
    'stateDiagram-v2\n [*] --> Still:::quiet\n Still --> Moving\n classDef quiet fill:#eee',
  )
  if (st === null) throw new Error('render drew nothing')
  expect(st.classDefs).toEqual({ quiet: { fill: '#eee' } })
  expect(
    st.styled.flat().some((s) => s.text.includes('Still') && s.classes?.includes('quiet')),
  ).toBe(true)

  const cls = render('classDiagram\n class Animal:::hot\n Animal <|-- Dog')
  if (cls === null) throw new Error('render drew nothing')
  expect(
    cls.styled.flat().some((s) => s.text.includes('Animal') && s.classes?.includes('hot')),
  ).toBe(true)
})

test('gantt task tags reach task label and bar spans', () => {
  const art = render('gantt\n dateFormat HH:mm\n Build : active, build, 09:00, 1h')
  if (art === null) throw new Error('render drew nothing')
  expect(
    art.styled
      .flat()
      .some((span) => span.text.includes('Build') && span.classes?.includes('active')),
  ).toBe(true)
  expect(
    art.styled.flat().some((span) => span.role === 'edge' && span.classes?.includes('active')),
  ).toBe(true)
})

test('the source box carries no classDefs', () => {
  expect(sourceBox('gantt\n title Plan', 80).classDefs).toEqual({})
})

// ------------------------------------------------------------- kind and refusal

test('blank source returns null', () => {
  expect(render('   \n  ')).toBeNull()
})

test('diagramKind separates an unsupported type from a malformed one', () => {
  // Both render to null; only one is worth telling the author to fix.
  const malformed = 'gantt\n bad task'
  expect(render(malformed)).toBeNull()
  expect(diagramKind(malformed)).toBe('gantt')

  const unsupported = 'journey\n title Plan'
  expect(render(unsupported)).toBeNull()
  expect(diagramKind(unsupported)).toBeNull()
})

test('diagramKind reads the header without parsing the body', () => {
  expect(diagramKind('graph TD\n A --> B')).toBe('flowchart')
  expect(diagramKind('flowchart LR')).toBe('flowchart')
  expect(diagramKind('classDiagram')).toBe('class')
  expect(diagramKind('erDiagram')).toBe('er')
  expect(diagramKind('sequenceDiagram')).toBe('sequence')
  expect(diagramKind('pie title x')).toBe('pie')
  expect(diagramKind('mindmap')).toBe('mindmap')
  expect(diagramKind('timeline')).toBe('timeline')
  expect(diagramKind('gitGraph LR:')).toBe('gitgraph')
  expect(diagramKind('gantt')).toBe('gantt')
  expect(diagramKind('stateDiagramFoo\n A --> B')).toBeNull()
  expect(diagramKind('classDiagram-v2\n A --> B')).toBe('class')
  expect(diagramKind('')).toBeNull()
})

// --------------------------------------------------------------------- streaming

/** How many times the display would change between art and source box. */
function flips(src: string, frame: (prefix: string) => boolean): number {
  const seen: boolean[] = []
  for (let n = 4; n < src.length; n += 4) seen.push(frame(src.slice(0, n)))
  seen.push(frame(src))
  return seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length
}

const STREAMED = `flowchart TD
  A[User submits login form] --> B{Credentials valid?}
  B -->|yes| C[Issue JWT access token]
  B -->|no| D[Return 401 Unauthorized]
  C --> E[Set refresh cookie]`

test('a streaming flowchart never stops being drawable', () => {
  // One transition, box -> art, and never back: a diagram that alternates with
  // the source box as it streams is the thing warnings must not cause.
  expect(flips(STREAMED, (s) => render(s) !== null)).toBe(1)
})

test('gating on warnings is what makes a streaming diagram flicker', () => {
  // Not a recommendation — a guard on the advice in the docs. Warnings fire at
  // most intermediate states, so gating on them is unusable while streaming.
  const gated = flips(STREAMED, (s) => {
    const a = render(s)
    return a !== null && a.warnings.length === 0
  })
  expect(gated).toBeGreaterThan(5)
})

test('a streaming strict grammar never stops being drawable', () => {
  const src = `sequenceDiagram
  participant U as User
  participant W as Web App
  U->>W: Submit login
  W-->>U: Set session cookie`
  expect(flips(src, (s) => render(s) !== null)).toBe(1)
})

// -------------------------------------------------------------------------- caps

test('an adversarial chain renders truncated at the node cap', () => {
  let src = 'graph TD\n'
  for (let i = 0; i < 10_000; i++) src += ` N${i} --> N${i + 1}\n`
  const art = render(src)
  if (art === null) throw new Error('render drew nothing')
  expect(art.plain.join('\n')).toContain('N100')
  // The one truncation warning covers the cap; a parse failure the cap
  // itself caused is not the statement's fault and must not warn as one.
  expect(art.warnings).toEqual([expect.stringMatching(/^diagram truncated:/)])
})

test('a single-statement chain renders truncated at the node cap', () => {
  let src = 'graph LR\n '
  for (let i = 0; i < 10_000; i++) src += `N${i}-->`
  const art = render(`${src}N10000`)
  if (art === null) throw new Error('render drew nothing')
  expect(art.warnings.some((w) => w.startsWith('diagram truncated:'))).toBe(true)
})

test('a deep chain within the caps renders', () => {
  let src = 'graph TD\n'
  for (let i = 0; i < 100; i++) src += ` N${i} --> N${i + 1}\n`
  const out = plain(src)
  expect(out).toContain('N0')
  expect(out).toContain('N100')
  expect(out).toContain('▼')
})

test('a state diagram renders truncated at the node cap', () => {
  let src = 'stateDiagram-v2\n'
  for (let i = 0; i < 600; i++) src += ` S${i} --> S${i + 1}\n`
  const art = render(src)
  if (art === null) throw new Error('render drew nothing')
  expect(art.warnings.some((w) => w.startsWith('diagram truncated:'))).toBe(true)
})

test('a sequence diagram renders truncated at the item cap', () => {
  let src = 'sequenceDiagram\n'
  for (let i = 0; i < 600; i++) src += ` A->>B: msg ${i}\n`
  const art = render(src)
  if (art === null) throw new Error('render drew nothing')
  expect(art.warnings.some((w) => w.startsWith('diagram truncated:'))).toBe(true)
})

// ------------------------------------------------------------------------- width

test('an over-wide diagram still renders and reports its width', () => {
  const src =
    'flowchart LR\n A[aaaaaaaaaaaaaaaaaaaa] --> B[bbbbbbbbbbbbbbbbbbbb] --> C[cccccccccccccccccccc]'
  const art = render(src)
  if (art === null) throw new Error('render drew nothing')
  expect(art.width).toBeGreaterThan(40)
  expect(art.plain.join('\n')).toContain('▶')
  // The caller's escape hatch, bounded by the source it frames.
  const box = sourceBox(src, 40)
  expect(box.plain.join('\n')).toContain('mermaid: flowchart')
  expect(box.width).toBeLessThanOrEqual(src.length)
})

test('reported width is the widest painted row', () => {
  const art = render('flowchart LR\n A[Start] --> B[End]')
  if (art === null) throw new Error('render drew nothing')
  expect(art.width).toBe(Math.max(...art.plain.map(stringWidth)))
})

test('a wide sequence diagram renders and reports its width', () => {
  const art = render('sequenceDiagram\n A->>B: this label is far wider than the available pane')
  if (art === null) throw new Error('render drew nothing')
  expect(art.width).toBeGreaterThan(30)
})

// -------------------------------------------------------------------- source box

test('the source box carries no warnings', () => {
  expect(sourceBox('gantt\n title Plan', 80).warnings).toEqual([])
})

test('source box styled and plain widths match', () => {
  const art = sourceBox('gantt\n title Plan\n a\n', 120)
  expect(art.styled.length).toBe(art.plain.length)
  art.plain.forEach((row, i) => {
    const styledW = art.styled[i].reduce((s, span) => s + stringWidth(span.text), 0)
    expect(styledW).toBe(stringWidth(row))
    expect(stringWidth(row)).toBe(art.width)
  })
})

test('the source box frames the source under a titled header', () => {
  const art = sourceBox('gantt\n title Plan\n section A', 120)
  expect(art.plain[0]).toContain('mermaid: gantt')
  expect(art.plain.join('\n')).toContain('Plan')
  expect(art.plain[art.plain.length - 1]).toStartWith('╰')
})

test('the source box wraps long lines to maxWidth', () => {
  const out = sourceBox(
    'gantt\n title a very long line that should wrap inside the source box nicely',
    40,
  ).plain
  expect(out.every((l) => stringWidth(l) <= 40)).toBe(true)
  for (const line of out.slice(1, -1)) {
    expect(line.startsWith('│') && line.endsWith('│')).toBe(true)
  }
  expect(out.join('\n')).toContain('nicely')
})

// ------------------------------------------------------------ control characters

const ESC = String.fromCharCode(27)

test('control characters never reach the output', () => {
  for (const src of [`graph TD\n A[x${CONT}y] --> B`, `graph TD\n A[${ESC}[31mRED] --> B`]) {
    const out = plain(src)
    expect(out).not.toContain(CONT)
    expect(out).not.toContain(ESC)
  }
})

// `sourceBox` echoes whatever it is handed, so it is the second door untrusted
// source arrives by and has to strip the same characters `render` does.
test('the source box strips control characters', () => {
  const src = `gantt\n title ${ESC}]8;;http://example${String.fromCharCode(7)}link`
  const out = sourceBox(src, 80).plain.join('\n')
  expect(out).not.toContain(ESC)
  expect(out).not.toContain(String.fromCharCode(7))
  expect(out).toContain('link')
})

// A control character measures one column and paints none, so a box sized around
// one comes out a column short. NUL is worst: it is the CONT sentinel, so the row
// builder drops it after layout has already reserved its cell.
test('a control character in a label does not shrink its box', () => {
  const ls = lines(`graph TD\n A[x${CONT}y] --> B`)
  expect(ls[0]).toBe('┌────┐')
  expect(stringWidth(ls[1])).toBe(stringWidth(ls[0]))
})

// A tab survives stripControls (it is meaningful in mindmap indentation) but a
// painted tab measures one cell and jumps to the terminal's tab stop, desyncing
// every column after it. The canvas paints it as a space instead.
test('a label tab paints as a space', () => {
  for (const src of [
    'pie\n"a\tb" : 1',
    'timeline\n2020 : ev\tent',
    'mindmap\nroot\n  a\tb',
    'gitGraph\ncommit id: "a\tb"',
    'flowchart LR\n A["a\tb"] --> B',
  ]) {
    expect(plain(src)).not.toContain('\t')
  }
})

test('a source of only control characters is blank', () => {
  expect(render(`${CONT}${ESC}`)).toBeNull()
})

test('diagramKind strips control characters the way render does', () => {
  const src = '\x01flowchart TD\n A --> B'
  expect(render(src)).not.toBeNull()
  expect(diagramKind(src)).toBe('flowchart')
})

test('tabs in the source box expand to spaces', () => {
  const box = sourceBox('flowchart TD\n\tA --> B')
  for (const row of box.plain) expect(row).not.toContain('\t')
  expect(new Set(box.plain.slice(1, -1).map((r) => r.length)).size).toBe(1)
})

test('a frontmatter title carries the title role', () => {
  // The placement is pinned by cases/flowchart/frontmatter.md; the role is not.
  const out = render('---\ntitle: Order flow\n---\nflowchart TD\n A --> B')
  if (out === null) throw new Error('render returned null')
  expect(out.styled[0].at(-1)).toEqual({ text: 'Order flow', role: 'title' })
})

test('click and link statements land on the spans as href', () => {
  const fc = render('flowchart TD\n A[Docs] --> B\n click A "https://example.com/docs" "open"')
  if (fc === null) throw new Error('render returned null')
  expect(
    fc.styled.flat().some((s) => s.text.includes('Docs') && s.href === 'https://example.com/docs'),
  ).toBe(true)
  // The whole box is the link, blank interior included; B carries none.
  expect(fc.styled.flat().some((s) => s.href !== undefined && s.role === 'border')).toBe(true)
  expect(fc.styled.flat().some((s) => s.text.includes('B') && s.href !== undefined)).toBe(false)

  const cls = render('classDiagram\n class Agent {\n +run()\n }\n link Agent "https://example.com"')
  if (cls === null) throw new Error('render returned null')
  expect(
    cls.styled.flat().some((s) => s.text.includes('Agent') && s.href === 'https://example.com'),
  ).toBe(true)

  // Callback forms carry nothing a terminal can open.
  const cb = render('flowchart TD\n A --> B\n click A call doIt() "tip"')
  expect(cb?.styled.flat().every((s) => s.href === undefined)).toBe(true)
})

test('toAnsi wraps linked spans in OSC 8, stripping back to plain', () => {
  const art = render('flowchart TD\n A[Docs] --> B\n click A "https://example.com"')
  if (art === null) throw new Error('render returned null')
  const out = toAnsi(art).join('\n')
  const esc = String.fromCharCode(27)
  expect(out).toContain(`${esc}]8;;https://example.com${esc}\\`)
  const stripped = out
    .replaceAll(`${esc}]8;;https://example.com${esc}\\`, '')
    .replaceAll(`${esc}]8;;${esc}\\`, '')
    .replace(new RegExp(`${esc}\\[[0-9;]*m`, 'g'), '')
  expect(stripped).toBe(art.plain.join('\n'))
})
