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
 * Status: head and tail labels (cardinalities) are measured but not placed
 * yet, and styles are not applied. Not exported from the package index.
 */
import { Canvas, D, drawTextOverEdges, L, R, STY_DOT, STY_SOLID, STY_THICK, U } from './canvas.ts'
import { parseClass } from './diagrams/class.ts'
import { parseEr } from './diagrams/er.ts'
import { parseGraph } from './diagrams/flowchart.ts'
import { parseState } from './diagrams/state.ts'
import { layout } from './engine/index.ts'
import type { Snapshot } from './engine/snapshot.ts'
import type {
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
import { fitLabel, MAX_LABEL, MAX_LINES, stripControls, WRAP_WIDTH, wrapLabel } from './labels.ts'
import { drawBox, drawClassBox, half, headGlyph, MAX_CANVAS_CELLS, sat } from './layout.ts'
import type { MermaidArt } from './types.ts'
import { stringWidth } from './width.ts'

export { layout } from './engine/index.ts'
export type { Pt, SEdge, SNode, Snapshot, SPort } from './engine/snapshot.ts'
export type { LayoutInput, LayoutOptions, Phase } from './engine/types.ts'
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
      nodes.push({ id: `n${i}`, label: n.label, w, h, parent })
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
  const measure = (text: string, at: InputLabel['at']): InputLabel => {
    const t = fitLabel(text, MAX_LABEL)
    return { text: t, w: stringWidth(t) + 2, h: 1, at }
  }
  const edges = graph.edges.map((e, i) => {
    const labels: InputLabel[] = []
    if (e.cardFrom !== undefined) labels.push(measure(e.cardFrom, 'tail'))
    if (e.label !== null) labels.push(measure(e.label, 'center'))
    if (e.cardTo !== undefined) labels.push(measure(e.cardTo, 'head'))
    const end = (n: number): string => proxy.get(n) ?? `n${n}`
    return { id: `e${i}`, from: end(e.from), to: end(e.to), labels }
  })
  return {
    input: { dir: graph.dir, nodes, edges, compounds, spacing: SPACING[graph.dir] },
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
    for (const l of r.labels) drawTextOverEdges(canvas, ` ${l.text} `, l.x, l.y, 'edgeLabel')
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
  return {
    ...canvas.toLines(),
    classDefs: graph.classDefs,
    warnings: [...graph.warnings, ...res.warnings],
  }
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
