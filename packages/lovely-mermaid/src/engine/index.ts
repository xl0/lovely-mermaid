/**
 * The layered layout engine: synchronous, dependency-free, integer
 * geometry in the caller's unit. Lays out flow-down internally and
 * transposes / mirrors the result for the other directions, so no phase
 * knows about direction. Each phase is a pure function `graph → graph`
 * (it clones its input), run in `PHASES` order; `opts.until` stops after
 * any of them and `trace` receives a snapshot after import, after every
 * phase that ran, and for some phases after their sub-steps.
 *
 * Compounds are laid out recursively, ELK's way: a compound's members
 * form their own graph, and the compound takes part in its parent's
 * graph as one node sized by that layout. An edge crossing a frame is cut
 * at a *port* on the border: inside, a `port` dummy pinned to the first
 * (top border) or last (bottom border) layer; outside, a fixed port on the
 * compound node. The parent's cycle breaking runs first and decides which
 * border the edge crosses (in → top, out → bottom), then the children are
 * laid out, then the parent continues with their sizes and port
 * positions. Routes are joined at the port cells on the way back up.
 *
 * docs/elk-layered.md ch. 8 is the plan for each phase.
 */
import { breakCycles, reverse } from './cycles.ts'
import type { LGraph, LNode, LPort } from './graph.ts'
import { buildGraph, toSnapshot } from './graph.ts'
import { assignLayers, splitLongEdges } from './layering.ts'
import { orderNodes } from './ordering.ts'
import { placeNodes } from './placement.ts'
import { joinRoutes, placeLabels, routeEdges } from './routing.ts'
import type { SEdge, SNode, Snapshot } from './snapshot.ts'
import type {
  Dir,
  InputEdge,
  InputNode,
  LayoutInput,
  LayoutOptions,
  LayoutResult,
  Phase,
  PlacedLabel,
  Pt,
  Rect,
  Spacing as SpacingT,
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

/** An edge's crossing of a compound's border, as the parent decided it. */
interface PortSpec {
  /** the port dummy inside the compound */
  id: string
  side: 'N' | 'S'
  edge: string
  /** the edge's end inside the compound: a node, or a compound it points at */
  inner: string
  /** the inner end is the edge's original source */
  fromInside: boolean
}

/** One level's geometry, in its own coordinates, children folded in. */
interface Level {
  width: number
  height: number
  nodes: Record<string, Rect>
  compounds: Record<string, Rect>
  /** per input edge with a route here: the polyline from source to target */
  routes: Map<string, Pt[]>
  labels: Map<string, PlacedLabel[]>
  /** cross-axis cell of each port dummy */
  portX: Map<string, number>
  /** whether the first / last layer is a port row (else the border is an extra row) */
  hasN: boolean
  hasS: boolean
}

export function layout(input: LayoutInput, opts: LayoutOptions = {}, trace?: Trace): LayoutResult {
  const sideways = input.dir === 'right' || input.dir === 'left'
  const warnings: string[] = []
  const compounds = input.compounds ?? []

  // --- the hierarchy: parent of every node and compound, unknown or
  // cyclic parents cut with a warning
  const ids = new Set([...input.nodes.map((n) => n.id), ...compounds.map((c) => c.id)])
  const compoundIds = new Set(compounds.map((c) => c.id))
  const parent = new Map<string, string | undefined>()
  for (const x of [...compounds, ...input.nodes]) {
    if (x.parent !== undefined && !compoundIds.has(x.parent)) {
      warnings.push(`"${x.id}" has an unknown parent "${x.parent}"`)
    }
    parent.set(x.id, x.parent !== undefined && compoundIds.has(x.parent) ? x.parent : undefined)
  }
  for (const c of compounds) {
    const seen = new Set<string>([c.id])
    for (let p = parent.get(c.id); p !== undefined; p = parent.get(p)) {
      if (seen.has(p)) {
        warnings.push(`compound "${c.id}" nests in itself; made top-level`)
        parent.set(c.id, undefined)
        break
      }
      seen.add(p)
    }
  }
  /** the scopes from the root (`null`) down to the one holding `id` */
  const path = (id: string): (string | null)[] => {
    const out: (string | null)[] = []
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) out.unshift(p)
    out.unshift(null)
    return out
  }
  /** the direct child of `scope` on the way to `id` (or `id` itself) */
  const itemAt = (scope: string | null, id: string): string => {
    const p = path(id)
    const i = p.indexOf(scope)
    return i === p.length - 1 ? id : (p[i + 1] as string)
  }
  const edgeById = new Map(input.edges.map((e) => [e.id, e]))
  const reversed = new Set<string>()
  const scopeEdges = new Map<string | null, InputEdge[]>()
  for (const e of input.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      warnings.push(`edge "${e.id}" refers to an unknown node`)
      continue
    }
    const a = path(e.from)
    const b = path(e.to)
    let k = 0
    while (k < a.length && k < b.length && a[k] === b[k]) k++
    const lca = a[k - 1]
    const list = scopeEdges.get(lca)
    if (list === undefined) scopeEdges.set(lca, [e])
    else list.push(e)
  }

  // --- compound `dir` overrides: honoured only for a closed frame (no
  // crossing edge) in a down/right layout. A turned scope is laid out in
  // its own frame and transposed on the way out; leaf sizes and the
  // spacing profile follow the scope's parity so everything reads right
  // once every transpose has been applied.
  const closed = new Map<string, boolean>(compounds.map((c) => [c.id, true]))
  for (const list of scopeEdges.values()) {
    for (const e of list) {
      const a = new Set(path(e.from))
      const b = new Set(path(e.to))
      for (const c of compounds) if (a.has(c.id) !== b.has(c.id)) closed.set(c.id, false)
    }
  }
  const overridable = input.dir === 'down' || input.dir === 'right'
  const flip = new Map<string, boolean>()
  const eff = new Map<string | null, 'down' | 'right'>([[null, sideways ? 'right' : 'down']])
  const flipped = new Map<string | null, boolean>([[null, sideways]])
  for (const c of [...compounds].sort((x, y) => path(x.id).length - path(y.id).length)) {
    const up = parent.get(c.id) ?? null
    const want = c.dir ?? (eff.get(up) as 'down' | 'right')
    const f = overridable && closed.get(c.id) === true && want !== eff.get(up)
    flip.set(c.id, f)
    eff.set(c.id, f ? want : (eff.get(up) as 'down' | 'right'))
    flipped.set(c.id, (flipped.get(up) as boolean) !== f)
  }
  const spacingOf = (scope: string | null): SpacingT =>
    flipped.get(scope) === sideways ? input.spacing : (input.altSpacing ?? input.spacing)
  const nodes = input.nodes.map((n) =>
    flipped.get(parent.get(n.id) ?? null) === true ? { ...n, w: n.h, h: n.w } : n,
  )

  /** Lay out one scope: its member nodes, its child compounds as nodes, its ports. */
  const layoutScope = (scope: string | null, ports: PortSpec[]): Level => {
    const sp = spacingOf(scope)
    const pad = sp.framePad
    const emit = (g: LGraph, phase: string, note?: string): void => {
      if (trace === undefined) return
      const tail = note === undefined ? phase : `${phase} · ${note}`
      trace(toSnapshot(g, scope === null ? tail : `${scope} · ${tail}`))
    }
    const children = compounds.filter((c) => (parent.get(c.id) ?? null) === scope)
    const inNodes: InputNode[] = [
      ...nodes.filter((n) => (parent.get(n.id) ?? null) === scope),
      ...children.map((c) => ({ id: c.id, label: c.label, w: 1, h: 1 })),
      ...ports.map((p) => ({ id: p.id, w: 1, h: 0 })),
    ]
    // port edges are built in the edge's original orientation, then turned
    // to match the border they cross, so `reversed` stays truthful
    const inEdges: InputEdge[] = [
      ...(scopeEdges.get(scope) ?? []).map((e) => ({
        id: e.id,
        from: itemAt(scope, e.from),
        to: itemAt(scope, e.to),
        labels: e.labels,
      })),
      ...ports.map((p) => {
        const item = itemAt(scope, p.inner)
        return p.fromInside
          ? { id: p.edge, from: item, to: p.id }
          : { id: p.edge, from: p.id, to: item }
      }),
    ]
    let g = buildGraph({ dir: 'down', nodes: inNodes, edges: inEdges, spacing: sp })
    for (const p of ports) {
      const n = g.nodes.find((x) => x.id === p.id) as LNode
      n.kind = 'port'
      n.at = p.side === 'N' ? 'first' : 'last'
      const e = g.edges.find((x) => x.id === p.edge)
      if (e !== undefined && (p.side === 'N' ? e.src.node !== n : e.dst.node !== n)) reverse(e)
    }
    emit(g, 'import')
    g = breakCycles(g, opts.cycles ?? {})
    emit(g, 'cycles')
    const levels = new Map<string, Level>()
    if (opts.until !== 'cycles') {
      // children: their ports follow from this level's edge directions
      const childSpecs = new Map<string, PortSpec[]>()
      const childFixed = new Map<string, [LPort, string][]>()
      for (const c of children) {
        const node = g.nodes.find((n) => n.id === c.id) as LNode
        const specs: PortSpec[] = []
        const fixed: [LPort, string][] = []
        childSpecs.set(c.id, specs)
        childFixed.set(c.id, fixed)
        for (const p of node.ports) {
          for (const e of [...p.in, ...p.out]) {
            const spec = ports.find((q) => q.edge === e.id)
            let inner: string
            let fromInside: boolean
            if (spec !== undefined) {
              inner = spec.inner
              fromInside = spec.fromInside
            } else {
              const ie = edgeById.get(e.id) as InputEdge
              const fromIn = ie.from !== c.id && path(ie.from).includes(c.id)
              const toIn = ie.to !== c.id && path(ie.to).includes(c.id)
              if (!fromIn && !toIn) continue
              inner = fromIn ? ie.from : ie.to
              fromInside = fromIn
            }
            if (inner === c.id) continue // ends at the frame itself: a free port
            const id = `${c.id}:${e.id}`
            specs.push({ id, side: e.dst.node === node ? 'N' : 'S', edge: e.id, inner, fromInside })
            fixed.push([p, id])
          }
        }
      }
      // The parent, not the child, owns the port order: a provisional
      // ordering with the children as free-port placeholder boxes says in
      // which order the outside wants to meet each border, the specs take
      // that order, and the child's rim rows keep it (ordering pins them).
      if (children.some((c) => (childSpecs.get(c.id) as PortSpec[]).length > 1)) {
        const pre = orderNodes(
          splitLongEdges(assignLayers(g, opts.layering ?? {})),
          opts.ordering ?? {},
        )
        for (const c of children) {
          const specs = childSpecs.get(c.id) as PortSpec[]
          if (specs.length < 2) continue
          const node = pre.nodes.find((n) => n.id === c.id) as LNode
          const rank = new Map<string, number>()
          for (const side of ['N', 'S'] as const) {
            node.ports
              .filter((p) => p.side === side)
              .sort((a, b) => a.order - b.order)
              .forEach((p, i) => {
                rank.set((p.in[0] ?? p.out[0]).origin, i)
              })
          }
          // ports that lead to the same item inside stay adjacent (their
          // chains must run parallel; scattered they force the inside
          // into contortions), the groups themselves in the outside's order
          const group = (q: PortSpec): string => `${q.side} ${itemAt(c.id, q.inner)}`
          const groupRank = new Map<string, number>()
          for (const q of specs) {
            const r = rank.get(q.edge) ?? 0
            const k = group(q)
            groupRank.set(k, Math.min(groupRank.get(k) ?? Number.POSITIVE_INFINITY, r))
          }
          specs.sort((a, b) => {
            if (a.side !== b.side) return a.side < b.side ? -1 : 1
            const byGroup =
              (groupRank.get(group(a)) as number) - (groupRank.get(group(b)) as number)
            return byGroup !== 0 ? byGroup : (rank.get(a.edge) ?? 0) - (rank.get(b.edge) ?? 0)
          })
        }
      }
      for (const c of children) {
        const node = g.nodes.find((n) => n.id === c.id) as LNode
        const specs = childSpecs.get(c.id) as PortSpec[]
        const fixed = childFixed.get(c.id) as [LPort, string][]
        const level = layoutScope(c.id, specs)
        if (flip.get(c.id) === true) transposeLevel(level)
        levels.set(c.id, level)
        node.w = level.width + 2 + 2 * pad
        node.h = level.height + (level.hasN ? 0 : 1) + (level.hasS ? 0 : 1)
        // the title sits on the frame's top row: along the cross axis, or
        // along the flow axis when the whole layout is sideways
        if (sideways) node.h = Math.max(node.h, (c.titleW ?? 0) + 2)
        else node.w = Math.max(node.w, (c.titleW ?? 0) + 2)
        for (const [p, id] of fixed) {
          const x = level.portX.get(id)
          if (x === undefined) continue
          p.pos = x + 1 + pad
          p.fixed = true
        }
      }
      const steps: [Phase, (g: LGraph) => LGraph][] = [
        ['layers', (g) => assignLayers(g, opts.layering ?? {})],
        ['split', splitLongEdges],
        ['order', (g) => orderNodes(g, opts.ordering ?? {}, (h, note) => emit(h, 'order', note))],
        [
          'place',
          (g) =>
            placeNodes(g, { compactTies: scope === null, ...opts.placement }, (h, note) =>
              emit(h, 'place', note),
            ),
        ],
        ['route', (g) => routeEdges(g, opts.routing ?? {})],
        ['labels', (g) => placeLabels(g, opts.labels ?? {})],
      ]
      for (const [name, run] of steps) {
        g = run(g)
        emit(g, name)
        if (opts.until === name) break
      }
    }
    warnings.push(...g.warnings)
    for (const e of g.edges) if (e.reversed) reversed.add(e.origin)

    // --- export this level, then fold the children in at their frames
    const level: Level = {
      width: 0,
      height: 0,
      nodes: {},
      compounds: {},
      routes: new Map(),
      labels: new Map(),
      portX: new Map(),
      hasN: ports.some((p) => p.side === 'N'),
      hasS: ports.some((p) => p.side === 'S'),
    }
    const grow = (x: number, y: number): void => {
      level.width = Math.max(level.width, x)
      level.height = Math.max(level.height, y)
    }
    const childIds = new Set(children.map((c) => c.id))
    for (const n of g.nodes) {
      if (n.x < 0 || n.y < 0) continue
      grow(n.x + Math.max(1, n.w), n.y + Math.max(1, n.h))
      if (n.kind === 'port') level.portX.set(n.id, n.x)
      else if (n.kind === 'node') {
        const into = childIds.has(n.id) ? level.compounds : level.nodes
        into[n.id] = { x: n.x, y: n.y, w: n.w, h: n.h }
      }
    }
    const own = joinRoutes(g)
    for (const pts of own.values()) for (const [x, y] of pts) grow(x + 1, y + 1)
    const placed = new Map(g.edges.map((e) => [e.id, e.placed]))
    const pieces = new Map<string, Map<string, Pt[]>>()
    for (const c of children) {
      const sub = levels.get(c.id)
      const r = level.compounds[c.id]
      if (sub === undefined || r === undefined) continue
      const dx = r.x + 1 + pad
      const dy = r.y + (sub.hasN ? 0 : 1)
      const shift = (q: Rect): Rect => ({ x: q.x + dx, y: q.y + dy, w: q.w, h: q.h })
      for (const [id, q] of Object.entries(sub.nodes)) level.nodes[id] = shift(q)
      for (const [id, q] of Object.entries(sub.compounds)) level.compounds[id] = shift(q)
      for (const [id, ls] of sub.labels) {
        level.labels.set(
          id,
          ls.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })),
        )
      }
      const mine = new Map<string, Pt[]>()
      pieces.set(c.id, mine)
      for (const [id, pts] of sub.routes) {
        const moved: Pt[] = pts.map(([x, y]) => [x + dx, y + dy])
        if (own.has(id)) mine.set(id, moved)
        else level.routes.set(id, moved)
      }
    }
    const inEdgeById = new Map(inEdges.map((e) => [e.id, e]))
    for (const [id, pts] of own) {
      const ie = inEdgeById.get(id) as InputEdge
      const route = [
        ...(pieces.get(ie.from)?.get(id) ?? []),
        ...pts,
        ...(pieces.get(ie.to)?.get(id) ?? []),
      ]
      level.routes.set(id, dedupe(route))
      level.labels.set(id, placed.get(id) ?? [])
    }
    return level
  }

  const root = layoutScope(null, [])
  const result: LayoutResult = {
    width: root.width,
    height: root.height,
    nodes: root.nodes,
    compounds: root.compounds,
    edges: {},
    warnings,
  }
  for (const [id, route] of root.routes) {
    result.edges[id] = { route, labels: root.labels.get(id) ?? [] }
  }
  const final = input.dir === 'down' ? result : transform(result, input.dir)
  if (trace !== undefined && opts.until === undefined) {
    trace(flatSnapshot(final, input, reversed))
  }
  return final
}

/** Turn a finished level on its side: a closed compound with its own flow. */
function transposeLevel(l: Level): void {
  const t = (r: Rect): Rect => ({ x: r.y, y: r.x, w: r.h, h: r.w })
  for (const id of Object.keys(l.nodes)) l.nodes[id] = t(l.nodes[id])
  for (const id of Object.keys(l.compounds)) l.compounds[id] = t(l.compounds[id])
  for (const [id, pts] of l.routes) {
    l.routes.set(
      id,
      pts.map(([x, y]): Pt => [y, x]),
    )
  }
  for (const [id, ls] of l.labels) {
    l.labels.set(
      id,
      ls.map((q) => ({ ...q, ...t(q) })),
    )
  }
  const w = l.width
  l.width = l.height
  l.height = w
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  return out
}

/** The whole hierarchy in one picture for the lab, in the requested
 * direction, layers ranked along the flow axis. */
function flatSnapshot(res: LayoutResult, input: LayoutInput, reversed: Set<string>): Snapshot {
  const flow = input.dir === 'right' || input.dir === 'left' ? 0 : 1
  const at = (r: Rect): number => (flow === 0 ? r.x : r.y)
  const rows = [...new Set(Object.values(res.nodes).map(at))].sort((a, b) => a - b)
  const out: SNode[] = []
  for (const n of input.nodes) {
    const r = res.nodes[n.id]
    if (r === undefined) continue
    const s: SNode = { id: n.id, ...r, layer: rows.indexOf(at(r)) }
    if (n.label !== undefined) s.label = n.label
    if (n.parent !== undefined) s.parent = n.parent
    out.push(s)
  }
  for (const c of input.compounds ?? []) {
    const r = res.compounds[c.id]
    if (r === undefined) continue
    const s: SNode = { id: c.id, kind: 'compound', ...r }
    if (c.label !== undefined) s.label = c.label
    if (c.parent !== undefined) s.parent = c.parent
    out.push(s)
  }
  const edges: SEdge[] = []
  for (const e of input.edges) {
    const r = res.edges[e.id]
    if (r === undefined) continue
    const s: SEdge = { from: e.from, to: e.to, route: r.route }
    if (reversed.has(e.id)) s.reversed = true
    const label = e.labels?.find((l) => l.at === 'center')
    if (label !== undefined) s.label = { text: label.text }
    edges.push(s)
  }
  return { title: 'labels · flat', nodes: out, edges }
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
