/**
 * The layered layout engine: synchronous, dependency-free, integer
 * geometry in the caller's unit. Lays out flow-down internally and
 * transposes / mirrors the result for the other directions, so no phase
 * knows about direction. Each phase is a pure function `graph → graph`
 * (it clones its input), run in `PHASES` order; `opts.until` stops after
 * any of them and `trace` receives a snapshot after import, after every
 * phase that ran, and for some phases after their sub-steps.
 *
 * docs/elk-layered.md ch. 8 is the plan for each phase.
 */
import { breakCycles } from './cycles.ts'
import type { LGraph } from './graph.ts'
import { buildGraph, frameOf, toSnapshot } from './graph.ts'
import { assignLayers, splitLongEdges } from './layering.ts'
import { orderNodes } from './ordering.ts'
import { placeNodes } from './placement.ts'
import { joinRoutes, placeLabels, routeEdges } from './routing.ts'
import type {
  Dir,
  LayoutInput,
  LayoutOptions,
  LayoutResult,
  Phase,
  PlacedLabel,
  Pt,
  Rect,
  Trace,
} from './types.ts'

export type { SEdge, SNode, Snapshot, SPort } from './snapshot.ts'
export type {
  CyclesOptions,
  Dir,
  InputCompound,
  InputEdge,
  InputLabel,
  InputNode,
  LabelOptions,
  LayeringOptions,
  LayoutInput,
  LayoutOptions,
  LayoutResult,
  OrderingOptions,
  Phase,
  PlacedLabel,
  PlacementOptions,
  Rect,
  RoutingOptions,
  Spacing,
  Trace,
} from './types.ts'
export { PHASES } from './types.ts'

export function layout(input: LayoutInput, opts: LayoutOptions = {}, trace?: Trace): LayoutResult {
  const sideways = input.dir === 'right' || input.dir === 'left'
  // Sideways, a frame's title runs along the flow axis: its width becomes
  // the least span of the frame instead of the width of its top row.
  let g = buildGraph(
    sideways
      ? {
          ...input,
          nodes: input.nodes.map((n) => ({ ...n, w: n.h, h: n.w })),
          compounds: (input.compounds ?? []).map((c) => ({
            ...c,
            titleW: 0,
            minSpan: Math.max(c.minSpan ?? 0, (c.titleW ?? 0) + 2),
          })),
        }
      : input,
  )
  const steps: [Phase, (g: LGraph) => LGraph][] = [
    ['cycles', (g) => breakCycles(g, opts.cycles ?? {})],
    ['layers', (g) => assignLayers(g, opts.layering ?? {})],
    ['split', splitLongEdges],
    [
      'order',
      (g) =>
        orderNodes(g, opts.ordering ?? {}, (h, note) => {
          if (trace !== undefined) trace(toSnapshot(h, `order · ${note}`))
        }),
    ],
    [
      'place',
      (g) =>
        placeNodes(g, opts.placement ?? {}, (h, note) => {
          if (trace !== undefined) trace(toSnapshot(h, `place · ${note}`))
        }),
    ],
    ['route', (g) => routeEdges(g, opts.routing ?? {})],
    ['labels', (g) => placeLabels(g, opts.labels ?? {})],
  ]
  if (trace !== undefined) trace(toSnapshot(g, 'import'))
  for (const [name, run] of steps) {
    g = run(g)
    if (trace !== undefined) trace(toSnapshot(g, name))
    if (opts.until === name) break
  }

  const result: LayoutResult = {
    width: 0,
    height: 0,
    nodes: {},
    compounds: {},
    edges: {},
    warnings: g.warnings,
  }
  const grow = (r: Rect): void => {
    result.width = Math.max(result.width, r.x + r.w)
    result.height = Math.max(result.height, r.y + r.h)
  }
  for (const n of g.nodes) {
    if (n.kind !== 'node' || n.x < 0 || n.y < 0) continue
    result.nodes[n.id] = { x: n.x, y: n.y, w: n.w, h: n.h }
    grow(result.nodes[n.id])
  }
  for (const c of g.compounds) {
    const frame = frameOf(g, c.id)
    if (frame === null) continue
    result.compounds[c.id] = frame
    grow(frame)
  }
  const placed = new Map(g.edges.map((e) => [e.id, e.placed]))
  for (const [id, route] of joinRoutes(g)) {
    result.edges[id] = { route, labels: placed.get(id) ?? [] }
    for (const [x, y] of route) {
      result.width = Math.max(result.width, x + 1)
      result.height = Math.max(result.height, y + 1)
    }
  }
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
  const out: LayoutResult = {
    width: W,
    height: H,
    nodes: {},
    compounds: {},
    edges: {},
    warnings: res.warnings,
  }
  for (const [id, r] of Object.entries(res.nodes)) out.nodes[id] = rect(r)
  for (const [id, r] of Object.entries(res.compounds)) out.compounds[id] = rect(r)
  for (const [id, e] of Object.entries(res.edges)) {
    out.edges[id] = { route: e.route.map(pt), labels: e.labels.map(label) }
  }
  return out
}
