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
import { buildGraph, portCard, sideWidth, toSnapshot } from './graph.ts'
import { placeEdgeLabels } from './labels.ts'
import { applyLayers, assignLayers, splitLongEdges } from './layering.ts'
import { orderNodes } from './ordering.ts'
import { placeNodes } from './placement.ts'
import { dedupe, joinRoutes, placeLabels, routeEdges } from './routing.ts'
import type { SEdge, SNode, Snapshot } from './snapshot.ts'
import type { Stack } from './stack.ts'
import { expandStacks, stackChains } from './stack.ts'
import type {
  Candidate,
  CyclesOptions,
  Dir,
  FitOptions,
  InputEdge,
  InputNode,
  LayeringOptions,
  LayoutInput,
  LayoutOptions,
  LayoutResult,
  Phase,
  PlacedLabel,
  PlacementOptions,
  Pt,
  Rect,
  Spacing as SpacingT,
  Trace,
} from './types.ts'

export type { SEdge, SNode, Snapshot, SPort } from './snapshot.ts'
export type {
  Candidate,
  CyclesOptions,
  Dir,
  FitOptions,
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
  let squeezed: number | undefined
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
    const childIdSet = new Set(children.map((c) => c.id))
    // hybrid flow: fold chains into cross-axis stacks (one band each)
    // before anything reads the graph's shape; the phases see one
    // ordinary node per stack, with its external ports pinned over the
    // member slots, and the export expands it back
    const stacks =
      opts.stackChains === true
        ? stackChains(g, sp.nodeNode, sp.edgeEdge, childIdSet)
        : new Map<string, Stack>()
    const levels = new Map<string, Level>()
    const lopts: LayeringOptions = opts.layering ?? {}
    if (opts.until !== 'cycles') {
      // A side must offer its ports the same pitch the channels give
      // parallel edges (a cell per edge plus `edgeEdge` between, corners
      // never usable): now that cycle breaking has fixed which side each
      // edge uses, widen any node too narrow for its busiest side.
      for (const n of g.nodes) {
        if (n.kind !== 'node' || childIdSet.has(n.id) || stacks.has(n.id)) continue
        // count ports per side exactly as ordering will assign them
        // (a port with an out edge goes south, everything else north) —
        // counting edges undercounted hubs whose reversed edges flipped
        // their ports' sides, and the crowded side lost its | | pitch
        const south: LPort[] = []
        const north: LPort[] = []
        for (const q of n.ports) {
          // record the card before splitting moves labels off the far
          // segments; tunePorts keeps each port's reserved pitch
          q.card = portCard(q)
          if (q.out.length > 0) south.push(q)
          else north.push(q)
        }
        n.w = Math.max(n.w, sideWidth(south, sp.edgeEdge), sideWidth(north, sp.edgeEdge))
      }
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
          for (const [e, incoming] of [
            ...p.in.map((e): [typeof e, boolean] => [e, true]),
            ...p.out.map((e): [typeof e, boolean] => [e, false]),
          ]) {
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
            // A compound↔descendant edge collapses to a self-loop on this
            // child, so the same edge shows up on both its ports. One spec:
            // the side follows the original direction (a member→frame edge
            // exits south into the wrap, a frame→member edge enters north
            // out of it), and only the wrap port on that side pins to the
            // inner column — the other stays free.
            const collapsed = e.src.node === node && e.dst.node === node
            const side = collapsed ? (fromInside ? 'S' : 'N') : e.dst.node === node ? 'N' : 'S'
            if (collapsed && (side === 'N') !== incoming) continue
            const id = `${c.id}:${e.id}`
            specs.push({ id, side, edge: e.id, inner, fromInside })
            fixed.push([p, id])
          }
        }
      }
      // The parent, not the child, owns the port order: a provisional
      // ordering with the children as free-port placeholder boxes says in
      // which order the outside wants to meet each border, the specs take
      // that order, and the child's rim rows keep it (ordering pins them).
      if (children.some((c) => (childSpecs.get(c.id) as PortSpec[]).length > 1)) {
        const pre = orderNodes(splitLongEdges(assignLayers(g, lopts)), opts.ordering ?? {})
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
      const gBase = g // pure phases: the pre-layering state stays intact
      const steps: [Phase, (g: LGraph) => LGraph][] = [
        ['layers', (g) => assignLayers(g, lopts)],
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
      // Geometry feedback: measure the finished picture's band extents,
      // re-pack the root layers against the real target budget, re-run
      // the later phases, and keep the result only when the measurement
      // itself does not regress.
      if (scope === null && opts.squeeze !== undefined && opts.until === undefined) {
        squeezed = 0
        // one row evacuation per iteration: each accepted move is
        // re-measured before the next, so its real cost (new trunk
        // columns from longer edges) informs the following decision;
        // a rejected row is remembered and not retried on the same
        // geometry
        const tried = new Set<string>()
        for (let iter = 0; iter < (opts.squeezeBudget ?? 12); iter++) {
          const room =
            opts.squeezeLoose === true ? Math.max(opts.squeeze, measure(g)[0]) : opts.squeeze
          const mv = squeezeMoves(gBase, g, room, tried)
          if (mv === null) break
          let h = applyLayers(gBase, mv.forced)
          h = splitLongEdges(h)
          h = orderNodes(h, opts.ordering ?? {})
          h = placeNodes(h, { compactTies: true, ...opts.placement })
          h = routeEdges(h, opts.routing ?? {})
          h = placeLabels(h, opts.labels ?? {})
          const [w0, h0] = measure(g)
          const [w1, h1] = measure(h)
          // homing moves shorten wiring at unchanged height — equal
          // height is a pass for them, a reject for everything else
          const ok =
            w1 <= Math.max(opts.squeeze, w0) &&
            (h1 < h0 || (h1 === h0 && mv.key.startsWith('home:')))
          if (!ok) {
            tried.add(mv.key)
            continue
          }
          g = h
          tried.clear()
          squeezed++
          emit(g, 'labels', `squeeze ${iter + 1} · ${w1}×${h1}`)
        }
      }
    }
    warnings.push(...g.warnings)

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
      // `ie` is itemAt-mapped, so an end naming a child covers both "inside
      // it" and "the frame itself" — the original edge tells them apart. An
      // end that IS the frame contributes no inner piece (and for a
      // compound↔descendant edge both mapped ends name the same child, so
      // keying on `ie` alone would attach the one piece to both sides).
      const oe = edgeById.get(id)
      const fromPiece =
        oe === undefined || oe.from !== ie.from ? pieces.get(ie.from)?.get(id) : undefined
      const toPiece = oe === undefined || oe.to !== ie.to ? pieces.get(ie.to)?.get(id) : undefined
      const route = [...(fromPiece ?? []), ...pts, ...(toPiece ?? [])]
      level.routes.set(id, dedupe(route))
      level.labels.set(id, placed.get(id) ?? [])
    }
    if (stacks.size > 0) expandStacks(stacks, level.nodes, level.routes, level.labels)
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
    ...(squeezed === undefined ? {} : { squeezed }),
  }
  for (const [id, route] of root.routes) {
    result.edges[id] = { route, labels: root.labels.get(id) ?? [] }
  }
  const final = input.dir === 'down' ? result : transform(result, input.dir)
  // labels go on last, in the final orientation — text is horizontal in
  // the caller's frame, so "a horizontal run" only exists here
  if (opts.until === undefined) placeEdgeLabels(final, input.edges)
  if (trace !== undefined && opts.until === undefined) {
    trace(flatSnapshot(final, input))
  }
  return final
}

/**
 * The streaming mode: one deterministic greedy+bk pass, staggered
 * toward the target when one is given — the strongest single
 * configuration on the corpus, a few tens of ms where the loop spends
 * hundreds. Best-effort: the cap is an estimate, so the result may
 * exceed the width. Re-run per streamed update; run `layoutBest` once
 * the source has settled.
 */
export function layoutFast(input: LayoutInput, fit: FitOptions = {}, trace?: Trace): LayoutResult {
  const sideways = input.dir === 'right' || input.dir === 'left'
  const base: LayoutOptions = { cycles: { strategy: 'greedy' }, placement: { strategy: 'bk' } }
  if (fit.width === undefined) return layout(input, base, trace)
  if (sideways) {
    // the flow axis cannot be staggered narrower — stacking chains
    // is the one lever, best-effort
    let chosen = base
    let res = layout(input, base)
    if (res.width > fit.width) {
      const st = layout(input, { ...base, stackChains: true })
      if (st.width < res.width) {
        chosen = { ...base, stackChains: true }
        res = st
      }
    }
    if (trace !== undefined) res = layout(input, chosen, trace)
    return res
  }
  const capped = (cap: number): LayoutOptions => ({ ...base, layering: { maxWidth: cap } })
  const first = layout(input, capped(fit.width))
  if (first.width <= fit.width)
    return trace === undefined ? first : layout(input, capped(fit.width), trace)
  // the cap is an estimate and compound-heavy graphs overshoot it badly;
  // one calibration pass by the observed overshoot, floored at 0.7× the
  // target (the naive formula over-tightens and buys height for nothing)
  const cap = Math.max(Math.round(fit.width * 0.7), fit.width - (first.width - fit.width))
  const second = layout(input, capped(cap), trace)
  if (second.width < first.width) return second
  return trace === undefined ? first : layout(input, capped(fit.width), trace)
}

/**
 * The candidate loop: run `layout` under a few option combinations and
 * keep the best. Knobs the caller set explicitly are respected; the free
 * dimensions are searched — cycle breaking (greedy/dfs) × placement
 * (bk/networkSimplex), and, when a target width is given, a down-flow
 * layout nothing fits gets `layering.maxWidth` passes: first the target
 * itself as the cap, then one tightened by the observed overshoot.
 * Ranking is lexicographic and deterministic (first of equals wins):
 * with a target — fits, then height, then width (once it fits, height is
 * the scarce resource); without — width, then height. The winner is
 * re-run with `trace` when one is given, so the lab sees its phases.
 */
export function layoutBest(
  input: LayoutInput,
  opts: LayoutOptions = {},
  fit: FitOptions = {},
  trace?: Trace,
): { result: LayoutResult; chosen: LayoutOptions; candidates: Candidate[] } {
  const budget = Math.max(1, fit.budget ?? 16)
  const target = fit.width
  const sideways = input.dir === 'right' || input.dir === 'left'
  type Cy = NonNullable<CyclesOptions['strategy']>
  type Pl = NonNullable<PlacementOptions['strategy']>
  // the probe cells: of the full 3×3, only these ever won on the corpus
  // (greedy2 only pays off with networkSimplex, ns2 never with greedy2)
  // — the two slots saved go to the cap ladder instead
  const CELLS: [Cy, Pl][] = [
    ['greedy', 'bk'],
    ['greedy', 'networkSimplex'],
    ['greedy', 'ns2'],
    ['dfs', 'bk'],
    ['dfs', 'networkSimplex'],
    ['dfs', 'ns2'],
    ['greedy2', 'networkSimplex'],
  ]
  const cyPin = opts.cycles?.strategy
  const plPin = opts.placement?.strategy
  const cells: [Cy, Pl][] =
    cyPin !== undefined && plPin !== undefined
      ? [[cyPin, plPin]]
      : cyPin !== undefined
        ? (['bk', 'networkSimplex', 'ns2'] as Pl[]).map((pl) => [cyPin, pl])
        : plPin !== undefined
          ? (['greedy', 'dfs', 'greedy2'] as Cy[]).map((cy) => [cy, plPin])
          : CELLS
  const candidates: Candidate[] = []
  const results: LayoutResult[] = []
  // geometry feedback (squeeze) is the costliest step: probes get a
  // small iteration budget — enough for the cap ladder to rank
  // post-squeeze geometry — and only the winner gets the full one, in
  // a reserved budget slot
  // reserved only when the budget covers the probe cells, so a small
  // budget degrades to fewer probes instead of an empty dry loop
  const finalists =
    target !== undefined && !sideways && opts.squeeze === undefined
      ? Math.min(2, Math.max(0, budget - cells.length))
      : 0

  const run = (cy: Cy, pl: Pl, cap: number | undefined, stack = false): Candidate | null => {
    if (candidates.length >= budget - finalists) return null
    const o: LayoutOptions = {
      ...opts,
      cycles: { ...opts.cycles, strategy: cy },
      placement: { ...opts.placement, strategy: pl },
      layering: {
        ...opts.layering,
        ...(cap === undefined ? {} : { maxWidth: cap }),
      },
      ...(stack ? { stackChains: true } : {}),
      ...(target === undefined || opts.squeeze !== undefined
        ? {}
        : { squeeze: target, squeezeBudget: 2 }),
    }
    const res = layout(input, o)
    const label = `${cy}+${pl}${cap !== undefined ? `+cap${cap}` : ''}${stack ? '+stack' : ''}`
    const c: Candidate = { label, opts: o, width: res.width, height: res.height }
    if (target !== undefined) c.fits = res.width <= target
    candidates.push(c)
    results.push(res)
    return c
  }
  const better = (a: Candidate, b: Candidate): boolean => {
    if (target !== undefined) {
      if (a.fits !== b.fits) return a.fits === true
      if (a.fits === true) return a.height !== b.height ? a.height < b.height : a.width < b.width
    }
    return a.width !== b.width ? a.width < b.width : a.height < b.height
  }
  /** Opportunistic stacks must be a free lunch: without a target, a
   * sideways stack may not be taller than the best whole layout (for
   * down flow the width-first metric already guards — a stack that
   * grows the width loses on its own; with a target the fits gate is
   * the budget). A caller who pinned `stackChains` opted out. */
  const best = (): number => {
    let hCap = Number.POSITIVE_INFINITY
    if (sideways && target === undefined && opts.stackChains === undefined) {
      let u = -1
      for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].opts.stackChains === true) continue
        if (u < 0 || better(candidates[i], candidates[u])) u = i
      }
      if (u >= 0) hCap = candidates[u].height
    }
    let k = -1
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].opts.stackChains === true && candidates[i].height > hCap) continue
      if (k < 0 || better(candidates[i], candidates[k])) k = i
    }
    return Math.max(0, k)
  }
  const comboOf = (c: Candidate): [Cy, Pl] => [
    c.opts.cycles?.strategy as Cy,
    c.opts.placement?.strategy as Pl,
  ]
  const capOf = (c: Candidate): number | undefined => c.opts.layering?.maxWidth
  for (const [cy, pl] of cells) run(cy, pl, opts.layering?.maxWidth)
  // hybrid flow probes: a width-capped sideways layout can trade its
  // unconstrained cross extent for flow width by stacking chains — run
  // the same cells folded and let the metric arbitrate
  if (sideways && target !== undefined && opts.stackChains === undefined) {
    for (const [cy, pl] of cells) run(cy, pl, opts.layering?.maxWidth, true)
  }
  if (
    target !== undefined &&
    !sideways &&
    opts.layering?.maxWidth === undefined &&
    !candidates.some((c) => c.fits === true)
  ) {
    // only the two most promising uncapped probes advance to the capped
    // phase — the spared budget lets the cap ladder dig deeper, which
    // wins more fits than a broad shallow sweep does
    const ranked = [...candidates].sort((a, b) => (better(a, b) ? -1 : 1))
    for (const c of ranked.slice(0, 2)) {
      const [cy, pl] = comboOf(c)
      run(cy, pl, target)
    }
    const tried = (cy: string, pl: string, cap: number): boolean =>
      candidates.some((c) => {
        const [a, b] = comboOf(c)
        return a === cy && b === pl && capOf(c) === cap
      })
    // tighten until something fits: by the observed overshoot, but never
    // slower than a geometric descent — the cap↔width curve is
    // non-monotonic, and the first stall often hides a deeper minimum
    // (arch-system@134 fits at cap48 while cap95 renders wider than
    // cap134)
    for (let refine = 0; refine < 8; refine++) {
      const b = candidates[best()]
      if (b.fits === true) break
      const [cy, pl] = comboOf(b)
      const caps = candidates
        .filter((c) => {
          const [a, b2] = comboOf(c)
          return a === cy && b2 === pl && capOf(c) !== undefined
        })
        .map((c) => capOf(c) as number)
      const lowest = caps.length > 0 ? Math.min(...caps) : target
      const cap = Math.max(4, Math.min(target - (b.width - target), Math.round(lowest * 0.7)))
      if (tried(cy, pl, cap)) break
      if (run(cy, pl, cap) === null) break
    }
    // then loosen: bisect toward the widest cap that still fits — a
    // too-tight cap trades far more height than the target asks for
    const fitting = candidates[best()]
    if (fitting.fits === true && capOf(fitting) !== undefined) {
      const [cy, pl] = comboOf(fitting)
      let lo = capOf(fitting) as number
      const above = candidates
        .filter((c) => {
          const [a, b2] = comboOf(c)
          const cap = capOf(c)
          return a === cy && b2 === pl && c.fits === false && cap !== undefined && cap > lo
        })
        .map((c) => capOf(c) as number)
      let hi = above.length > 0 ? Math.min(...above) : lo
      while (hi - lo > 2) {
        const mid = (lo + hi) >> 1
        if (tried(cy, pl, mid)) break
        const c = run(cy, pl, mid)
        if (c === null) break
        if (c.fits === true) lo = mid
        else hi = mid
      }
    }
  }
  // opportunistic hybrid: stack the two most promising candidates and
  // adopt only when it costs nothing the metric cares about (the free
  // lunch: a chain folds into a band whose cross extent other content
  // already pays for). Skipped when nothing fits a target — stacking
  // grows the capped axis for down flow, so it cannot help there.
  if (
    !(sideways && target !== undefined) &&
    opts.stackChains === undefined &&
    (target === undefined || candidates.some((c) => c.fits === true))
  ) {
    const ranked = [...candidates].sort((a, b) => (better(a, b) ? -1 : 1))
    for (const c of ranked.slice(0, 2)) {
      if (c.opts.stackChains === true) continue
      const [cy, pl] = comboOf(c)
      run(cy, pl, capOf(c), true)
    }
  }
  if (finalists > 0) {
    const ranked = [...candidates].sort((a, b) => (better(a, b) ? -1 : 1))
    const anyFits = candidates.some((c) => c.fits === true)
    let done = 0
    for (const c of ranked) {
      if (done >= finalists || candidates.length >= budget) break
      // a probe whose cheap squeeze kept nothing will not turn around
      // with the full budget — skip it. When nothing fits the probes
      // squeezed against an unreachable target, so their silence says
      // nothing: the finalists run with the width already paid for as
      // the packing budget instead (the guard still forbids widening).
      if (anyFits && (results[candidates.indexOf(c)].squeezed ?? 0) === 0) continue
      const o: LayoutOptions = { ...c.opts, squeeze: target, squeezeBudget: 24, squeezeLoose: true }
      const res = layout(input, o)
      candidates.push({
        label: `${c.label}+sq`,
        opts: o,
        width: res.width,
        height: res.height,
        fits: res.width <= (target as number),
      })
      results.push(res)
      done++
    }
  }
  const k = best()
  const result = trace === undefined ? results[k] : layout(input, candidates[k].opts, trace)
  if (target !== undefined && sideways && result.width > target) {
    result.warnings = [
      ...result.warnings,
      `fit.width ${target} not reached for sideways flow: the narrowest layout is ${result.width} columns`,
    ]
  }
  return { result, chosen: candidates[k].opts, candidates }
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

/** Real extent of a routed level: the caller-facing width and height. */
function measure(g: LGraph): [number, number] {
  let w = 0
  let h = 0
  for (const n of g.nodes) {
    if (n.x < 0 || n.y < 0) continue
    w = Math.max(w, n.x + Math.max(1, n.w))
    h = Math.max(h, n.y + Math.max(1, n.h))
  }
  for (const e of g.edges) {
    for (const [x, y] of e.route ?? []) {
      w = Math.max(w, x + 1)
      h = Math.max(h, y + 1)
    }
  }
  return [w, h]
}

/**
 * The geometry-feedback moves: from the routed picture, the *measured*
 * occupancy of every band (its nodes plus everything routed through its
 * rows, as merged x-intervals); then rows of real nodes disperse into
 * other rows wherever a gap under the target fits them — the holes
 * layering-time estimates cannot see. Returns a full layer assignment
 * for the base (pre-split) graph, or null when nothing moves.
 */
function squeezeMoves(
  base: LGraph,
  routed: LGraph,
  target: number,
  skip: Set<string>,
): { key: string; forced: Map<string, number> } | null {
  // band rows and measured extents
  const bandTop = new Map<number, number>()
  const bandBottom = new Map<number, number>()
  for (const n of routed.nodes) {
    if (n.layer < 0 || n.y < 0) continue
    bandTop.set(n.layer, Math.min(bandTop.get(n.layer) ?? n.y, n.y))
    bandBottom.set(n.layer, Math.max(bandBottom.get(n.layer) ?? 0, n.y + Math.max(1, n.h) - 1))
  }
  // Measured width demand per band: what its nodes need plus a column
  // per trunk passing through. Demand, not occupancy intervals, judges
  // whether a node fits — routed columns spread across the free width
  // fragment every gap, but placement re-routes them out of the way the
  // moment the node arrives, so position-specific gaps under-admit
  // (the accept guard catches the cases where placement cannot).
  const pass = new Map<number, number>()
  for (const e of routed.edges) {
    const r = e.route ?? []
    for (let i = 1; i < r.length; i++) {
      const [x0, y0] = r[i - 1] as Pt
      const [x1, y1] = r[i] as Pt
      if (x0 !== x1) continue
      // a vertical run costs a column in every band it fully crosses
      const [ya, yb] = y0 < y1 ? [y0, y1] : [y1, y0]
      for (const [l, top] of bandTop)
        if (ya <= top && yb >= (bandBottom.get(l) as number)) pass.set(l, (pass.get(l) ?? 0) + 1)
    }
  }
  // current layers of the base (pre-split) nodes
  const layerOf = new Map<string, number>()
  for (const n of routed.nodes) if (n.kind !== 'dummy') layerOf.set(n.id, n.layer)
  const byId = new Map(base.nodes.map((n) => [n.id, n]))
  const feasible = (v: string, l2: number): boolean => {
    const node = byId.get(v) as LNode
    for (const q of node.ports) {
      for (const e of q.in) {
        if (e.src.node === node) continue
        if ((layerOf.get(e.src.node.id) as number) + e.minLen > l2) return false
      }
      for (const e of q.out) {
        if (e.dst.node === node) continue
        if (l2 + e.minLen > (layerOf.get(e.dst.node.id) as number)) return false
      }
    }
    return true
  }
  const rows = new Map<number, LNode[]>()
  for (const n of base.nodes) {
    const l = layerOf.get(n.id) as number
    const row = rows.get(l)
    if (row === undefined) rows.set(l, [n])
    else row.push(n)
  }
  const keys = [...rows.keys()].sort((a, b) => a - b)
  const sp = base.spacing
  const demand = new Map<number, number>()
  for (const [l, row] of rows) {
    let d = (pass.get(l) ?? 0) * (1 + sp.edgeEdge)
    for (const n of row) d += n.w + 2 * (n.loops ?? 0) + sp.nodeNode
    demand.set(l, d)
  }
  const movable = (row: LNode[]): boolean => row.every((n) => n.at === undefined)
  let moved: string | null = null
  const order = [...keys].sort(
    (a, b) => (rows.get(a) as LNode[]).length - (rows.get(b) as LNode[]).length || a - b,
  )
  for (const l of order) {
    const row = rows.get(l) as LNode[]
    if (skip.has(`row:${l}`) || !movable(row) || row.length === 0) continue
    const assign: [LNode, number][] = []
    const tent = new Map<number, number>()
    let ok = true
    for (const v of row) {
      let placed: number | null = null
      const targets = keys
        .filter((k) => k !== l && (rows.get(k) as LNode[]).length > 0)
        .sort((a, b) => Math.abs(a - l) - Math.abs(b - l) || a - b)
      for (const t of targets) {
        if (!movable(rows.get(t) as LNode[]) || !feasible(v.id, t)) continue
        const vw = v.w + 2 * (v.loops ?? 0) + sp.nodeNode
        if ((demand.get(t) ?? 0) + (tent.get(t) ?? 0) + vw > target) continue
        placed = t
        tent.set(t, (tent.get(t) ?? 0) + vw)
        break
      }
      if (placed === null) {
        ok = false
        break
      }
      assign.push([v, placed])
    }
    if (!ok || assign.length === 0) continue
    for (const [v, t] of assign) {
      layerOf.set(v.id, t)
      demand.set(t, (demand.get(t) ?? 0) + v.w + 2 * (v.loops ?? 0) + sp.nodeNode)
    }
    moved = `row:${l}`
    break
  }
  // No whole row moved: a band is as tall as its tallest node, so try
  // moving one tall node beside another tall band — the source band
  // collapses to its shorter rest, the target grows by at most the
  // overshoot. Net row gain decides.
  if (moved === null) {
    let best: { v: LNode; to: number; net: number } | null = null
    for (const l of keys) {
      const row = rows.get(l) as LNode[]
      if (row.length < 2 || !movable(row)) continue
      const sorted = [...row].sort((a, b) => b.h - a.h)
      const v = sorted[0]
      const gain = v.h - sorted[1].h
      if (gain <= 0) continue
      for (const t of keys) {
        const trow = rows.get(t) as LNode[]
        if (t === l || trow.length === 0 || !movable(trow) || !feasible(v.id, t)) continue
        if (skip.has(`tall:${v.id}:${t}`)) continue
        const vw = v.w + 2 * (v.loops ?? 0) + sp.nodeNode
        if ((demand.get(t) ?? 0) + vw > target) continue
        const growth = Math.max(0, v.h - Math.max(...trow.map((n) => n.h)))
        const net = gain - growth
        if (net > 0 && (best === null || net > best.net)) best = { v, to: t, net }
      }
    }
    if (best !== null) {
      layerOf.set(best.v.id, best.to)
      moved = `tall:${best.v.id}:${best.to}`
    }
  }
  // Still nothing: homing. Dispersal parks nodes wherever a band has
  // room, with no edge-length term — a node can end up stranded a dozen
  // bands from every partner, its edges jailed through all of them. A
  // node shorter than its band's tallest moves toward the median of its
  // partners' layers at no height cost; the driver accepts these at
  // equal height because they strictly shorten the wiring.
  if (moved === null) {
    let best: { v: LNode; to: number; gain: number } | null = null
    for (const l of keys) {
      const row = rows.get(l) as LNode[]
      if (!movable(row)) continue
      for (const v of row) {
        if (row.length > 1 && v.h >= Math.max(...row.filter((n) => n !== v).map((n) => n.h)))
          continue
        const partners: number[] = []
        for (const q of v.ports)
          for (const e of [...q.in, ...q.out]) {
            const other = e.src.node === v ? e.dst.node : e.src.node
            if (other !== v) partners.push(layerOf.get(other.id) as number)
          }
        if (partners.length === 0) continue
        partners.sort((a, b) => a - b)
        const opt = partners[(partners.length - 1) >> 1]
        if (Math.abs(l - opt) < 3) continue
        for (const t of [...keys].sort((a, b) => Math.abs(a - opt) - Math.abs(b - opt))) {
          const trow = rows.get(t) as LNode[]
          if (t === l || trow.length === 0 || !movable(trow) || !feasible(v.id, t)) continue
          if (skip.has(`home:${v.id}:${t}`)) continue
          const vw = v.w + 2 * (v.loops ?? 0) + sp.nodeNode
          if ((demand.get(t) ?? 0) + vw > target) continue
          if (v.h > Math.max(...trow.map((n) => n.h))) continue // would grow the target band
          const gain = Math.abs(l - opt) - Math.abs(t - opt)
          if (gain > 0 && (best === null || gain > best.gain)) best = { v, to: t, gain }
          break
        }
      }
    }
    if (best !== null) {
      layerOf.set(best.v.id, best.to)
      moved = `home:${best.v.id}:${best.to}`
    }
  }
  if (moved === null) return null
  // drop layer values nothing uses, where every spanning base edge has slack
  const values = [...new Set(layerOf.values())].sort((a, b) => a - b)
  for (let v = values[values.length - 1]; v >= values[0]; v--) {
    if ([...layerOf.values()].includes(v)) continue
    let safe = true
    for (const e of base.edges) {
      if (e.src.node === e.dst.node) continue
      const a = layerOf.get(e.src.node.id) as number
      const b = layerOf.get(e.dst.node.id) as number
      if (a < v && v < b && b - a - 1 < e.minLen) {
        safe = false
        break
      }
    }
    if (!safe) continue
    for (const [id, lv] of layerOf) if (lv > v) layerOf.set(id, lv - 1)
  }
  return { key: moved, forced: layerOf }
}

/** The whole hierarchy in one picture for the lab, in the requested
 * direction, layers ranked along the flow axis. A result view: routes
 * run source → target, so no edge carries the reversed flag (that is
 * the phase views' convention, where routes are stored flow-down). */
function flatSnapshot(res: LayoutResult, input: LayoutInput): Snapshot {
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
    const floats = (res.floats ?? []).filter((f) => f.edge === e.id)
    const shown = [
      ...r.labels,
      ...floats.map((f) => ({ text: `[${f.n}] ${f.text}`, x: f.x, y: f.y, w: f.w, h: f.h })),
    ]
    if (shown.length > 0) s.labels = shown
    edges.push(s)
  }
  return { title: 'labels · flat', dir: input.dir, nodes: out, edges }
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
    ...(res.squeezed === undefined ? {} : { squeezed: res.squeezed }),
  }
  for (const [id, r] of Object.entries(res.nodes)) out.nodes[id] = rect(r)
  for (const [id, r] of Object.entries(res.compounds)) out.compounds[id] = rect(r)
  for (const [id, e] of Object.entries(res.edges)) {
    out.edges[id] = { route: e.route.map(pt), labels: e.labels.map(label) }
  }
  return out
}
