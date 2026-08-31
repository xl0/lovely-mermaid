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
    opts.strategy === 'networkSimplex' || opts.strategy === 'ns2'
      ? networkSimplexPlace(g, opts.strategy === 'ns2')
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
  // Everything below runs in index space — ix numbers the nodes in
  // g.nodes order, block links are Int32Arrays — because the 8-variant
  // loop walks every node several times per variant and Map lookups
  // were a measurable share of loop time. Same algorithm, same orders.
  const N = g.nodes.length
  const ix = new Map<LNode, number>(g.nodes.map((n, i) => [n, i]))
  // neighbours per node, sorted by their position in the adjacent layer
  const upper: Neighbour[][] = new Array(N)
  const lower: Neighbour[][] = new Array(N)
  for (let i = 0; i < N; i++) {
    const n = g.nodes[i]
    const ups: Neighbour[] = []
    const downs: Neighbour[] = []
    for (const p of n.ports) {
      for (const e of p.in) if (e.src.node !== n) ups.push({ node: e.src.node, edge: e })
      for (const e of p.out) if (e.dst.node !== n) downs.push({ node: e.dst.node, edge: e })
    }
    ups.sort((a, b) => a.node.order - b.node.order)
    downs.sort((a, b) => a.node.order - b.node.order)
    upper[i] = ups
    lower[i] = downs
  }
  const marked = markConflicts(layers, upper, ix)

  let best: { x: Float64Array; width: number; span: number } | null = null
  for (const [k, v] of VARIANTS.entries()) {
    const x = alignAndCompact(g, ix, v.up ? upper : lower, v, marked)
    let width = 0
    {
      let min = Number.POSITIVE_INFINITY
      let max = Number.NEGATIVE_INFINITY
      for (let i = 0; i < N; i++) {
        min = Math.min(min, x[i])
        max = Math.max(max, x[i] + g.nodes[i].w)
      }
      width = max - min
    }
    // equal widths are broken by the rows' summed extents: a row stretched
    // across the whole width by blocks pinned apart loses to a packed one
    let span = 0
    for (const row of layers) {
      if (row.length === 0) continue
      let lo = Number.POSITIVE_INFINITY
      let hi = Number.NEGATIVE_INFINITY
      for (const n of row) {
        const xi = x[ix.get(n) as number]
        lo = Math.min(lo, xi)
        hi = Math.max(hi, xi + n.w)
      }
      span += hi - lo
    }
    const valid = ordered(g, layers, x, ix)
    if (trace !== undefined) {
      let min = Number.POSITIVE_INFINITY
      for (let i = 0; i < N; i++) min = Math.min(min, x[i])
      for (const n of g.nodes) n.x = x[ix.get(n) as number] - min
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
  const out = new Map<LNode, number>()
  if (best !== null) for (let i = 0; i < N; i++) out.set(g.nodes[i], best.x[i])
  return out
}

/**
 * Type-1 conflicts: an edge between two dummies (an inner segment) must
 * stay straight, so any ordinary edge crossing it is marked and never used
 * for alignment. The paper's Alg. 1 with 0-based indices.
 */
function markConflicts(
  layers: LNode[][],
  upper: Neighbour[][],
  ix: Map<LNode, number>,
): Set<LEdge> {
  const marked = new Set<LEdge>()
  const inner = (v: LNode): Neighbour | undefined => {
    if (v.kind === 'node') return undefined
    const u = upper[ix.get(v) as number][0]
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
            for (const nb of upper[ix.get(w) as number]) {
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
  ix: Map<LNode, number>,
  neighbours: Neighbour[][],
  v: Variant,
  marked: Set<LEdge>,
): Float64Array {
  const N = g.nodes.length
  const nodes = g.nodes
  const layers = g.layers
  const root = new Int32Array(N)
  const align = new Int32Array(N)
  const via: (LEdge | null)[] = new Array(N).fill(null) // edge aligning a node to its block predecessor
  for (let i = 0; i < N; i++) {
    root[i] = i
    align[i] = i
  }
  // --- vertical alignment: walk layers in the variant's direction, align
  // each node with a median neighbour if that keeps blocks from crossing
  const rows = v.up ? layers : [...layers].reverse()
  for (const row of rows) {
    let r = v.left ? -1 : Number.POSITIVE_INFINITY
    const list = v.left ? row : [...row].reverse()
    for (const n of list) {
      const i = ix.get(n) as number
      const nb = neighbours[i]
      const d = nb.length
      if (d === 0) continue
      const lo = Math.floor((d + 1) / 2) - 1
      const hi = Math.ceil((d + 1) / 2) - 1
      const medians = v.left ? [lo, hi] : [hi, lo]
      for (const m of medians) {
        if (align[i] !== i) break
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
        const j = ix.get(u) as number
        align[j] = i
        root[i] = root[j]
        align[i] = root[i]
        via[i] = edge
        r = u.order
      }
    }
  }
  // --- inside-block shift: every block is straight at its port cells; the
  // block root's x is the block's left edge
  const inner = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    if (root[i] !== i) continue
    inner[i] = 0
    let min = 0
    for (let cur = i, next = align[i]; next !== i; cur = next, next = align[next]) {
      const e = via[next] as LEdge
      const shift = inner[cur] + portOffset(nodes[cur], e) - portOffset(nodes[next], e)
      inner[next] = shift
      min = Math.min(min, shift)
    }
    for (let cur = i; ; ) {
      inner[cur] -= min
      cur = align[cur]
      if (cur === i) break
    }
  }
  // --- horizontal compaction with class shifts (ELK's BKCompactor)
  const sink = new Int32Array(N)
  const placed = new Uint8Array(N)
  const x = new Float64Array(N)
  for (let i = 0; i < N; i++) sink[i] = i
  const classEdges: { to: number; slack: number }[][] = new Array(N)
  const placeBlock = (b: number): void => {
    if (placed[b] === 1) return
    placed[b] = 1
    x[b] = 0
    let initial = true
    for (let cur = b; ; ) {
      const node = nodes[cur]
      const row = layers[node.layer]
      const idx = node.order
      const hasNb = v.left ? idx > 0 : idx < row.length - 1
      if (hasNb) {
        const nb = row[v.left ? idx - 1 : idx + 1]
        const nbi = ix.get(nb) as number
        const nbRoot = root[nbi]
        placeBlock(nbRoot)
        if (sink[b] === b) sink[b] = sink[nbRoot]
        const s = gap(g.spacing, nb, node)
        const nbLeft = x[nbRoot] + inner[nbi]
        const curInner = inner[cur]
        if (sink[b] === sink[nbRoot]) {
          const pos = v.left ? nbLeft + nb.w + s - curInner : nbLeft - s - node.w - curInner
          const old = x[b]
          x[b] = initial ? pos : v.left ? Math.max(old, pos) : Math.min(old, pos)
          initial = false
        } else {
          const curLeft = x[b] + curInner
          const slack = v.left ? curLeft - (nbLeft + nb.w) - s : curLeft + node.w + s - nbLeft
          const from = sink[b]
          const entry = { to: sink[nbRoot], slack }
          if (classEdges[from] === undefined) classEdges[from] = [entry]
          else classEdges[from].push(entry)
        }
      }
      cur = align[cur]
      if (cur === b) break
    }
  }
  for (const row of rows)
    for (const n of v.left ? row : [...row].reverse()) {
      const i = ix.get(n) as number
      if (root[i] === i) placeBlock(i)
    }
  // class shifts: propagate from classes nothing depends on, taking the
  // tightest slack (min when packing left, max when packing right)
  const shift = new Float64Array(N)
  const hasShift = new Uint8Array(N)
  const indeg = new Int32Array(N)
  const queue: number[] = []
  for (const list of classEdges) if (list !== undefined) for (const { to } of list) indeg[to]++
  for (let i = 0; i < N; i++) {
    if (sink[i] === i && root[i] === i && indeg[i] === 0) {
      queue.push(i)
      hasShift[i] = 1
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q]
    const list = classEdges[c]
    if (list === undefined) continue
    for (const { to, slack } of list) {
      const cand = shift[c] + slack
      if (hasShift[to] === 0) {
        shift[to] = cand
        hasShift[to] = 1
      } else shift[to] = v.left ? Math.min(shift[to], cand) : Math.max(shift[to], cand)
      if (--indeg[to] === 0) queue.push(to)
    }
  }
  const out = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const r = root[i]
    const sk = sink[r]
    out[i] = x[r] + inner[i] + (hasShift[sk] === 1 ? shift[sk] : 0)
  }
  return out
}

/** Order kept and gaps respected in every layer. */
function ordered(g: LGraph, layers: LNode[][], x: Float64Array, ix: Map<LNode, number>): boolean {
  for (const row of layers) {
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1]
      const b = row[i]
      if (x[ix.get(b) as number] < x[ix.get(a) as number] + a.w + gap(g.spacing, a, b)) return false
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
function networkSimplexPlace(g: LGraph, flat = false): Map<LNode, number> {
  const index = new Map<LNode, number>(g.nodes.map((n, i) => [n, i]))
  const edges: NsEdge[] = []
  let count = g.nodes.length
  for (const e of g.edges) {
    if (e.src.node === e.dst.node) continue
    const s = index.get(e.src.node) as number
    const t = index.get(e.dst.node) as number
    const d = count++
    const hi = flat ? 4 : 32
    const mid = flat ? 2 : 8
    const lo = flat ? 1 : 4
    const w =
      e.src.node.kind !== 'node' && e.dst.node.kind !== 'node'
        ? hi
        : e.src.node.kind !== 'node' || e.dst.node.kind !== 'node'
          ? mid
          : lo
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
