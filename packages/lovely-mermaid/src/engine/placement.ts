/**
 * Phase 4: node placement — the cross-axis coordinate (`x`) of every node,
 * keeping each layer's order and the pair-typed gaps (`g.spacing`).
 *
 * Default is Brandes–Köpf as ELK runs it (docs/elk-layered.md ch. 4):
 * type-1 conflicts marked, four alignments (with upper or lower median
 * neighbours, blocks packed left or right), blocks made straight at the
 * **port cells** (`insideBlockShift`), compaction with ELK's class-graph
 * shift propagation instead of the paper's `min` recurrence, and the
 * smallest-width candidate kept — ELK's actual default, no balancing, so
 * every coordinate stays an integer. `networkSimplex` is the second
 * strategy: the auxiliary graph of ch. 4 §3 solved by `nsSolve`, weights
 * 4/8/32 favouring straight long edges.
 */
import type { LEdge, LGraph, LNode } from './graph.ts'
import { cloneGraph } from './graph.ts'
import type { NsEdge } from './simplex.ts'
import { nsSolve } from './simplex.ts'
import type { PlacementOptions, Spacing } from './types.ts'

export type PlaceTrace = (g: LGraph, note: string) => void

export function placeNodes(g0: LGraph, opts: PlacementOptions, trace?: PlaceTrace): LGraph {
  const g = cloneGraph(g0)
  if (g.layers.length === 0) return g
  const x =
    opts.strategy === 'networkSimplex'
      ? networkSimplexPlace(g)
      : brandesKoepf(g, opts.compactTies === true, trace)
  const min = Math.min(...x.values())
  for (const n of g.nodes) n.x = (x.get(n) as number) - min
  return g
}

/** Cross-axis gap between two neighbours in a layer, by what they are;
 * a self-loop reserves two extra columns east of its node. */
export function gap(sp: Spacing, a: LNode, b: LNode): number {
  const loops = 2 * (a.loops ?? 0)
  if (a.kind === 'node' && b.kind === 'node') return sp.nodeNode + loops
  if (a.kind !== 'node' && b.kind !== 'node') return sp.edgeEdge + loops
  return sp.nodeEdge + loops
}

// ---------------------------------------------------------------- Brandes–Köpf

interface Neighbour {
  node: LNode
  edge: LEdge
}
/** Which neighbours a block follows (above = predecessors), which way
 * blocks pack, and whether an edge chain may align across kinds — a chain
 * hanging on to its port keeps the source's width below it (a fan out of a
 * wide node reserves the whole width); `free` cuts those links, so chains
 * still run straight but float and pack at `edgeEdge`, bending in the
 * channels instead. */
interface Variant {
  up: boolean
  left: boolean
  free: boolean
}
const VARIANTS: Variant[] = [false, true].flatMap((free) =>
  [
    { up: true, left: true },
    { up: true, left: false },
    { up: false, left: true },
    { up: false, left: false },
  ].map((v) => ({ ...v, free })),
)

function brandesKoepf(g: LGraph, compactTies: boolean, trace?: PlaceTrace): Map<LNode, number> {
  const layers = g.layers
  // neighbours per node, sorted by their position in the adjacent layer
  const upper = new Map<LNode, Neighbour[]>()
  const lower = new Map<LNode, Neighbour[]>()
  for (const n of g.nodes) {
    const ups: Neighbour[] = []
    const downs: Neighbour[] = []
    for (const p of n.ports) {
      for (const e of p.in) if (e.src.node !== n) ups.push({ node: e.src.node, edge: e })
      for (const e of p.out) if (e.dst.node !== n) downs.push({ node: e.dst.node, edge: e })
    }
    ups.sort((a, b) => a.node.order - b.node.order)
    downs.sort((a, b) => a.node.order - b.node.order)
    upper.set(n, ups)
    lower.set(n, downs)
  }
  const marked = markConflicts(layers, upper)

  let best: { x: Map<LNode, number>; width: number; span: number } | null = null
  for (const [k, v] of VARIANTS.entries()) {
    const x = alignAndCompact(g, layers, v.up ? upper : lower, v, marked)
    const width = extent(layers, x)
    // equal widths are broken by the rows' summed extents: a row stretched
    // across the whole width by blocks pinned apart loses to a packed one
    let span = 0
    for (const row of layers) {
      if (row.length === 0) continue
      let lo = Number.POSITIVE_INFINITY
      let hi = Number.NEGATIVE_INFINITY
      for (const n of row) {
        lo = Math.min(lo, x.get(n) as number)
        hi = Math.max(hi, (x.get(n) as number) + n.w)
      }
      span += hi - lo
    }
    const valid = ordered(g, layers, x)
    if (trace !== undefined) {
      const min = Math.min(...x.values())
      for (const n of g.nodes) n.x = (x.get(n) as number) - min
      trace(
        g,
        `${v.up ? 'upper' : 'lower'} medians${v.free ? ', free chains' : ''}, packed ${v.left ? 'left' : 'right'} · width ${width}${valid ? '' : ' · overlaps'}`,
      )
    }
    // an overlapping candidate is skipped unless nothing else remains
    if (!valid && k < VARIANTS.length - 1) continue
    const tie = compactTies && best !== null && width === best.width && span < best.span
    if (best === null || (valid && (width < best.width || tie))) best = { x, width, span }
  }
  return best === null ? new Map() : best.x
}

/**
 * Type-1 conflicts: an edge between two dummies (an inner segment) must
 * stay straight, so any ordinary edge crossing it is marked and never used
 * for alignment. The paper's Alg. 1 with 0-based indices.
 */
function markConflicts(layers: LNode[][], upper: Map<LNode, Neighbour[]>): Set<LEdge> {
  const marked = new Set<LEdge>()
  const inner = (v: LNode): Neighbour | undefined => {
    if (v.kind === 'node') return undefined
    const u = (upper.get(v) as Neighbour[])[0]
    return u !== undefined && u.node.kind !== 'node' ? u : undefined
  }
  for (let i = 0; i + 1 < layers.length; i++) {
    const cur = layers[i + 1]
    let k0 = 0
    let l = 0
    for (let l1 = 0; l1 < cur.length; l1++) {
      const v = cur[l1]
      const seg = inner(v)
      if (l1 === cur.length - 1 || seg !== undefined) {
        const k1 = seg !== undefined ? seg.node.order : layers[i].length - 1
        while (l <= l1) {
          const w = cur[l]
          if (inner(w) === undefined) {
            for (const nb of upper.get(w) as Neighbour[]) {
              if (nb.node.order < k0 || nb.node.order > k1) marked.add(nb.edge)
            }
          }
          l++
        }
        k0 = k1
      }
    }
  }
  return marked
}

/** The cell offset at which `e` leaves / enters `n`. */
const portOffset = (n: LNode, e: LEdge): number => (e.src.node === n ? e.src.pos : e.dst.pos)

function alignAndCompact(
  g: LGraph,
  layers: LNode[][],
  neighbours: Map<LNode, Neighbour[]>,
  v: Variant,
  marked: Set<LEdge>,
): Map<LNode, number> {
  const root = new Map<LNode, LNode>()
  const align = new Map<LNode, LNode>()
  const via = new Map<LNode, LEdge>() // the edge that aligned a node to its block predecessor
  for (const n of g.nodes) {
    root.set(n, n)
    align.set(n, n)
  }
  // --- vertical alignment: walk layers in the variant's direction, align
  // each node with a median neighbour if that keeps blocks from crossing
  const rows = v.up ? layers : [...layers].reverse()
  for (const row of rows) {
    let r = v.left ? -1 : Number.POSITIVE_INFINITY
    const nodes = v.left ? row : [...row].reverse()
    for (const n of nodes) {
      const nb = neighbours.get(n) as Neighbour[]
      const d = nb.length
      if (d === 0) continue
      const lo = Math.floor((d + 1) / 2) - 1
      const hi = Math.ceil((d + 1) / 2) - 1
      const medians = v.left ? [lo, hi] : [hi, lo]
      for (const m of medians) {
        if (align.get(n) !== n) break
        const { node: u, edge } = nb[m]
        const ok = v.left ? r < u.order : r > u.order
        if (marked.has(edge) || !ok) continue
        // free: an ordinary chain lets go of its node — but a port dummy
        // sticks to its member, else the frame's ports bunch up and the
        // parent level pays for it
        if (
          v.free &&
          n.kind !== 'port' &&
          u.kind !== 'port' &&
          (n.kind === 'node') !== (u.kind === 'node')
        )
          continue
        align.set(u, n)
        root.set(n, root.get(u) as LNode)
        align.set(n, root.get(n) as LNode)
        via.set(n, edge)
        r = u.order
      }
    }
  }
  // --- inside-block shift: every block is straight at its port cells; the
  // block root's x is the block's left edge
  const inner = new Map<LNode, number>()
  for (const n of g.nodes) {
    if (root.get(n) !== n) continue
    inner.set(n, 0)
    let min = 0
    for (
      let cur = n, next = align.get(n) as LNode;
      next !== n;
      cur = next, next = align.get(next) as LNode
    ) {
      const e = via.get(next) as LEdge
      const shift = (inner.get(cur) as number) + portOffset(cur, e) - portOffset(next, e)
      inner.set(next, shift)
      min = Math.min(min, shift)
    }
    for (let cur = n; ; ) {
      inner.set(cur, (inner.get(cur) as number) - min)
      cur = align.get(cur) as LNode
      if (cur === n) break
    }
  }
  // --- horizontal compaction with class shifts (ELK's BKCompactor)
  const sink = new Map<LNode, LNode>()
  const x = new Map<LNode, number>()
  for (const n of g.nodes) sink.set(n, n)
  const classEdges = new Map<LNode, { to: LNode; slack: number }[]>()
  const placeBlock = (b: LNode): void => {
    if (x.has(b)) return
    x.set(b, 0)
    let initial = true
    for (let cur = b; ; ) {
      const row = layers[cur.layer]
      const idx = cur.order
      const hasNb = v.left ? idx > 0 : idx < row.length - 1
      if (hasNb) {
        const nb = row[v.left ? idx - 1 : idx + 1]
        const nbRoot = root.get(nb) as LNode
        placeBlock(nbRoot)
        if (sink.get(b) === b) sink.set(b, sink.get(nbRoot) as LNode)
        const s = gap(g.spacing, nb, cur)
        const nbLeft = (x.get(nbRoot) as number) + (inner.get(nb) as number)
        const curInner = inner.get(cur) as number
        if (sink.get(b) === sink.get(nbRoot)) {
          const pos = v.left ? nbLeft + nb.w + s - curInner : nbLeft - s - cur.w - curInner
          const old = x.get(b) as number
          x.set(b, initial ? pos : v.left ? Math.max(old, pos) : Math.min(old, pos))
          initial = false
        } else {
          const curLeft = (x.get(b) as number) + curInner
          const slack = v.left ? curLeft - (nbLeft + nb.w) - s : curLeft + cur.w + s - nbLeft
          const from = sink.get(b) as LNode
          const list = classEdges.get(from)
          const entry = { to: sink.get(nbRoot) as LNode, slack }
          if (list === undefined) classEdges.set(from, [entry])
          else list.push(entry)
        }
      }
      cur = align.get(cur) as LNode
      if (cur === b) break
    }
  }
  for (const row of rows)
    for (const n of v.left ? row : [...row].reverse()) if (root.get(n) === n) placeBlock(n)
  // class shifts: propagate from classes nothing depends on, taking the
  // tightest slack (min when packing left, max when packing right)
  const shift = new Map<LNode, number>()
  const indeg = new Map<LNode, number>()
  const classes = new Set<LNode>()
  for (const n of g.nodes) if (sink.get(n) === n && root.get(n) === n) classes.add(n)
  for (const c of classes) indeg.set(c, 0)
  for (const list of classEdges.values())
    for (const { to } of list) indeg.set(to, (indeg.get(to) ?? 0) + 1)
  const queue = [...classes].filter((c) => indeg.get(c) === 0)
  for (const c of queue) shift.set(c, 0)
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q]
    for (const { to, slack } of classEdges.get(c) ?? []) {
      const cand = (shift.get(c) as number) + slack
      const old = shift.get(to)
      shift.set(to, old === undefined ? cand : v.left ? Math.min(old, cand) : Math.max(old, cand))
      const left = (indeg.get(to) as number) - 1
      indeg.set(to, left)
      if (left === 0) queue.push(to)
    }
  }
  const out = new Map<LNode, number>()
  for (const n of g.nodes) {
    const r = root.get(n) as LNode
    out.set(
      n,
      (x.get(r) as number) + (inner.get(n) as number) + (shift.get(sink.get(r) as LNode) ?? 0),
    )
  }
  return out
}

function extent(layers: LNode[][], x: Map<LNode, number>): number {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const row of layers) {
    for (const n of row) {
      const l = x.get(n) as number
      min = Math.min(min, l)
      max = Math.max(max, l + n.w)
    }
  }
  return max - min
}

/** Order kept and gaps respected in every layer. */
function ordered(g: LGraph, layers: LNode[][], x: Map<LNode, number>): boolean {
  for (const row of layers) {
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1]
      const b = row[i]
      if ((x.get(b) as number) < (x.get(a) as number) + a.w + gap(g.spacing, a, b)) return false
    }
  }
  return true
}

// ------------------------------------------------------- network simplex placer

/**
 * ELK's NetworkSimplexPlacer (ch. 4 §3): one aux node per node, one per
 * edge; the edge's aux node hangs below both ends so that the weighted
 * length equals the port-column difference; consecutive nodes in a layer
 * are chained with their width plus gap as minimum length.
 */
function networkSimplexPlace(g: LGraph): Map<LNode, number> {
  const index = new Map<LNode, number>(g.nodes.map((n, i) => [n, i]))
  const edges: NsEdge[] = []
  let count = g.nodes.length
  for (const e of g.edges) {
    if (e.src.node === e.dst.node) continue
    const s = index.get(e.src.node) as number
    const t = index.get(e.dst.node) as number
    const d = count++
    const w =
      e.src.node.kind !== 'node' && e.dst.node.kind !== 'node'
        ? 32
        : e.src.node.kind !== 'node' || e.dst.node.kind !== 'node'
          ? 8
          : 4
    const ps = e.src.pos
    const pt = e.dst.pos
    edges.push({ s: d, t: s, w, delta: Math.max(0, pt - ps) })
    edges.push({ s: d, t, w, delta: Math.max(0, ps - pt) })
  }
  for (const row of g.layers) {
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1]
      const b = row[i]
      edges.push({
        s: index.get(a) as number,
        t: index.get(b) as number,
        w: 0,
        delta: a.w + gap(g.spacing, a, b),
      })
    }
  }
  const value = nsSolve(count, edges, null, false)
  return new Map(g.nodes.map((n) => [n, value[index.get(n) as number]]))
}
