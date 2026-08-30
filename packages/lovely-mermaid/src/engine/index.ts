/**
 * The layered layout engine: synchronous, dependency-free, integer
 * geometry in the caller's unit. Lays out flow-down internally and
 * transposes / mirrors the result for the other directions, so no phase
 * knows about direction. Each phase is a plain function over the working
 * graph; `trace` receives a snapshot after every one.
 *
 * Skeleton status: every phase is the simplest thing that produces a
 * complete drawing. See docs/elk-layered.md ch. 8 for what each becomes.
 */
import { breakCycles } from './cycles.ts'
import { buildGraph, toSnapshot } from './graph.ts'
import { assignLayers, splitLongEdges } from './layering.ts'
import { assignPorts, orderNodes } from './ordering.ts'
import { placeNodes } from './placement.ts'
import { joinRoutes, placeLabels, routeEdges } from './routing.ts'
import type { Dir, LayoutInput, LayoutResult, PlacedLabel, Pt, Rect, Trace } from './types.ts'

export type { SEdge, SNode, Snapshot, SPort } from './snapshot.ts'
export type {
  Dir,
  InputEdge,
  InputLabel,
  InputNode,
  LayoutInput,
  LayoutResult,
  PlacedLabel,
  Rect,
  Spacing,
  Trace,
} from './types.ts'

export function layout(input: LayoutInput, trace?: Trace): LayoutResult {
  const sideways = input.dir === 'right' || input.dir === 'left'
  const g = buildGraph(
    sideways ? { ...input, nodes: input.nodes.map((n) => ({ ...n, w: n.h, h: n.w })) } : input,
  )
  const snap = (title: string, ports = false): void => {
    if (trace !== undefined) trace(toSnapshot(g, title, ports))
  }
  snap('import')
  breakCycles(g)
  snap('cycles')
  assignLayers(g)
  snap('layers')
  splitLongEdges(g)
  snap('split')
  orderNodes(g)
  assignPorts(g)
  snap('order', true)
  placeNodes(g)
  snap('place', true)
  const { width, height } = routeEdges(g)
  const routes = joinRoutes(g)
  const labels = placeLabels(g, routes)
  snap('route', true)

  const result: LayoutResult = { width, height, nodes: {}, edges: {}, warnings: g.warnings }
  for (const n of g.nodes)
    if (n.kind === 'node') result.nodes[n.id] = { x: n.x, y: n.y, w: n.w, h: n.h }
  for (const [id, route] of routes) result.edges[id] = { route, labels: labels.get(id) ?? [] }
  return input.dir === 'down' ? result : transform(result, input.dir)
}

/**
 * Map a flow-down result into another direction. Rects and points are
 * transposed for left/right and mirrored along the flow axis for up/left;
 * a label keeps its text extent (it stays readable) and only its anchor
 * moves.
 */
function transform(res: LayoutResult, dir: Dir): LayoutResult {
  const flip = dir === 'right' || dir === 'left'
  const W = flip ? res.height : res.width
  const H = flip ? res.width : res.height
  const mirror = dir === 'up' || dir === 'left'
  const rect = (r: Rect): Rect => {
    const t = flip ? { x: r.y, y: r.x, w: r.h, h: r.w } : { ...r }
    if (mirror) {
      if (flip) t.x = W - t.x - t.w
      else t.y = H - t.y - t.h
    }
    return t
  }
  const pt = (p: Pt): Pt => {
    const t: Pt = flip ? [p[1], p[0]] : [p[0], p[1]]
    if (mirror) {
      if (flip) t[0] = W - 1 - t[0]
      else t[1] = H - 1 - t[1]
    }
    return t
  }
  const label = (l: PlacedLabel): PlacedLabel => {
    const [x, y] = pt([l.x, l.y])
    return { ...l, x, y }
  }
  const out: LayoutResult = { width: W, height: H, nodes: {}, edges: {}, warnings: res.warnings }
  for (const [id, r] of Object.entries(res.nodes)) out.nodes[id] = rect(r)
  for (const [id, e] of Object.entries(res.edges)) {
    out.edges[id] = { route: e.route.map(pt), labels: e.labels.map(label) }
  }
  return out
}
