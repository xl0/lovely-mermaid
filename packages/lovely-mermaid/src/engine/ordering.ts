/**
 * Phase 3: crossing minimization — the order of nodes within each layer,
 * the order of ports on each node side, and the border cell of every port.
 *
 * ELK's layer sweep (docs/elk-layered.md ch. 3) without its randomness:
 * a free layer is sorted by the barycenter of the *port ranks* it connects
 * to in the fixed neighbour, then the free side's ports are sorted by the
 * ranks they connect to and the fixed side's ports by the positions they
 * reach — node order and port order refine each other in one step. Sweeps
 * alternate direction while the exact crossing count improves; a few
 * deterministic restart variants (first direction, reversed input order)
 * replace ELK's random restarts, and the declaration order is always
 * variant one so an already-minimal input stays as written. A two-sided
 * greedy switch polishes the result. Barycenters are integer ratios.
 *
 * Compounds stay contiguous: a layer is sorted as a tree of blocks, a
 * block's barycenter being the weighted mean of its members' (dagre's
 * `sortSubgraph`), its left and right border dummies pinned at its ends,
 * sibling blocks kept in the order of the layer just sorted so their side
 * columns never cross, and the greedy switch only swaps siblings.
 */

import type { LGraph, LNode, LPort } from './graph.ts'
import { ancestors, cloneGraph } from './graph.ts'
import type { OrderingOptions } from './types.ts'

/** Sub-step reporting: the graph with the current order written in. */
export type OrderTrace = (g: LGraph, note: string) => void

/** The mutable sweep state: node order per layer, port order per side. */
interface State {
  layers: LNode[][]
  north: Map<LNode, LPort[]>
  south: Map<LNode, LPort[]>
  /** each node's compounds, outermost first; shared, never changes */
  chains: Map<LNode, string[]>
}

const isSide = (n: LNode): boolean => n.border === 'left' || n.border === 'right'

type Ratio = [number, number]
const cmp = (a: Ratio, b: Ratio): number => a[0] * b[1] - b[0] * a[1]
const mid = (a: Ratio, b: Ratio): Ratio => [a[0] * b[1] + b[0] * a[1], 2 * a[1] * b[1]]

export function orderNodes(g0: LGraph, opts: OrderingOptions, trace?: OrderTrace): LGraph {
  const g = cloneGraph(g0)
  for (const n of g.nodes) for (const p of n.ports) p.side = p.out.length > 0 ? 'S' : 'N'
  if (g.layers.length === 0) return g
  const chains = new Map(g.nodes.map((n) => [n, ancestors(g, n)]))
  // gathered into blocks, in an order consistent from layer to layer,
  // otherwise as declared
  const initial = (): State => {
    const layers: LNode[][] = []
    for (const row of g.layers) {
      const above = layers[layers.length - 1]
      const fixed = above === undefined ? new Map<string, number>() : blockStarts(above, chains)
      layers.push(sortBlock(row, new Map(), chains, 0, fixed))
    }
    return {
      layers,
      north: new Map(g.nodes.map((n) => [n, n.ports.filter((p) => p.side === 'N')])),
      south: new Map(g.nodes.map((n) => [n, n.ports.filter((p) => p.side === 'S')])),
      chains,
    }
  }
  let best = initial()
  if ((opts.strategy ?? 'sweep') === 'sweep') {
    let bestCount = countCrossings(best)
    const variants = [
      { reverse: false, down: true },
      { reverse: false, down: false },
      { reverse: true, down: true },
      { reverse: true, down: false },
    ].slice(0, Math.max(1, Math.min(4, opts.thoroughness ?? 4)))
    variants.forEach((v, k) => {
      const s = initial()
      if (v.reverse) for (const row of s.layers) row.reverse()
      let count = countCrossings(s)
      let down = v.down
      for (let sweepNo = 1; ; sweepNo++) {
        const saved = copyState(s)
        sweep(s, down)
        const c = countCrossings(s)
        if (trace !== undefined) {
          apply(g, s)
          trace(g, `sweep ${k + 1}.${sweepNo} ${down ? '↓' : '↑'} · ${c} crossings`)
        }
        // the first sweep may keep the count (it still sorts the ports);
        // later ones must improve, else they are undone
        if (c > count || (sweepNo > 1 && c === count)) {
          restore(s, saved)
          break
        }
        count = c
        down = !down
        if (c === 0) break
      }
      if (count < bestCount) {
        best = s
        bestCount = count
      }
    })
    if (opts.greedySwitch ?? true) {
      greedySwitch(best)
      sortAllPorts(best)
    }
  }
  apply(g, best)
  return g
}

/** One pass over all layers, each sorted against the neighbour already passed. */
function sweep(s: State, down: boolean): void {
  const L = s.layers.length
  if (down) for (let i = 1; i < L; i++) step(s, i, i - 1)
  else for (let i = L - 2; i >= 0; i--) step(s, i, i + 1)
}

/** Sort layer `free` (nodes, then its facing ports) against layer `fixed`,
 * then re-sort the fixed layer's facing ports by where they now land. */
function step(s: State, free: number, fixed: number): void {
  const down = fixed < free
  const facingFixed = (n: LNode): LPort[] => (down ? s.south : s.north).get(n) as LPort[]
  const facingFree = (n: LNode): LPort[] => (down ? s.north : s.south).get(n) as LPort[]
  const partner = (p: LPort): LPort | undefined => (down ? p.in[0]?.src : p.out[0]?.dst)
  const rank = new Map<LPort, number>()
  let r = 0
  for (const n of s.layers[fixed]) for (const p of facingFixed(n)) rank.set(p, ++r)
  const bary = new Map<LNode, Ratio>()
  for (const n of s.layers[free]) {
    let sum = 0
    let count = 0
    for (const p of facingFree(n)) {
      const q = partner(p)
      const rk = q === undefined ? undefined : rank.get(q)
      if (rk !== undefined) {
        sum += rk
        count++
      }
    }
    if (count > 0) bary.set(n, [sum, count])
  }
  s.layers[free] = sortBlock(
    s.layers[free],
    bary,
    s.chains,
    0,
    blockStarts(s.layers[fixed], s.chains),
  )
  sortPorts(s, free, fixed)
}

/** Ports of `free` facing `fixed` by the rank they connect to, then the
 * fixed side's facing ports by the position they reach. */
function sortPorts(s: State, free: number, fixed: number): void {
  const down = fixed < free
  const facingFixed = (n: LNode): LPort[] => (down ? s.south : s.north).get(n) as LPort[]
  const facingFree = (n: LNode): LPort[] => (down ? s.north : s.south).get(n) as LPort[]
  const partner = (p: LPort): LPort | undefined => (down ? p.in[0]?.src : p.out[0]?.dst)
  const partnerBack = (p: LPort): LPort | undefined => (down ? p.out[0]?.dst : p.in[0]?.src)
  const rank = new Map<LPort, number>()
  let r = 0
  for (const n of s.layers[fixed]) for (const p of facingFixed(n)) rank.set(p, ++r)
  const key = (p: LPort): number => {
    const q = partner(p)
    return q === undefined ? 0 : (rank.get(q) ?? 0)
  }
  for (const n of s.layers[free]) facingFree(n).sort((a, b) => key(a) - key(b))
  const pos = new Map<LPort, number>()
  let q = 0
  for (const n of s.layers[free]) for (const p of facingFree(n)) pos.set(p, ++q)
  const back = (p: LPort): number => {
    const t = partnerBack(p)
    return t === undefined ? 0 : (pos.get(t) ?? 0)
  }
  for (const n of s.layers[fixed]) facingFixed(n).sort((a, b) => back(a) - back(b))
}

/** Every layer's ports against both neighbours, node order unchanged. */
function sortAllPorts(s: State): void {
  const L = s.layers.length
  for (let i = 1; i < L; i++) sortPorts(s, i, i - 1)
  for (let i = L - 2; i >= 0; i--) sortPorts(s, i, i + 1)
}

/** Where each compound's block starts in a row, by first occurrence. */
function blockStarts(row: LNode[], chains: Map<LNode, string[]>): Map<string, number> {
  const pos = new Map<string, number>()
  row.forEach((n, i) => {
    for (const c of chains.get(n) as string[]) if (!pos.has(c)) pos.set(c, i)
  })
  return pos
}

interface Item {
  /** a compound at this depth, or `null` for a single node */
  key: string | null
  nodes: LNode[]
}
/** A sortable unit: items merged by constraints, their combined barycenter. */
interface Entry {
  items: Item[]
  b: Ratio | null
  /** block start in the fixed layer of the first constrained compound, else -1 */
  pos: number
}

/**
 * Stable sort of a layer's items at one nesting depth — nodes not in a
 * deeper compound, and one block per compound at that depth, gathered in
 * first-occurrence order and sorted recursively. A block's barycenter is
 * the sum over its members'; an item without one takes the midpoint of its
 * known neighbours in the current order, so it keeps its place (ELK's
 * fill-in rule). Nothing known → nothing moves.
 *
 * Two compounds that both continue into the fixed layer keep the order
 * they have there (`fixed`, dagre's subgraph constraints), so their side
 * columns never cross: a pair whose barycenters disagree is merged into one
 * unit in the constrained order (dagre's `resolveConflicts`).
 */
function sortBlock(
  nodes: LNode[],
  bary: Map<LNode, Ratio>,
  chains: Map<LNode, string[]>,
  depth: number,
  fixed: Map<string, number>,
): LNode[] {
  const items: Item[] = []
  const at = new Map<string, number>()
  for (const n of nodes) {
    const c = (chains.get(n) as string[])[depth]
    if (c === undefined) items.push({ key: null, nodes: [n] })
    else {
      const i = at.get(c)
      if (i === undefined) {
        at.set(c, items.length)
        items.push({ key: c, nodes: [n] })
      } else items[i].nodes.push(n)
    }
  }
  const entries: Entry[] = items.map((it) => {
    let sum = 0
    let count = 0
    for (const n of it.nodes) {
      const b = bary.get(n)
      if (b === undefined) continue
      sum += b[0]
      count += b[1]
    }
    return { items: [it], b: count > 0 ? [sum, count] : null, pos: fixed.get(it.key ?? '') ?? -1 }
  })
  // constraints: any two constrained entries whose barycenters would put
  // them the other way round (or say nothing) become one unit
  for (let merged = true; merged; ) {
    merged = false
    for (let i = 0; i < entries.length && !merged; i++) {
      for (let j = 0; j < entries.length && !merged; j++) {
        const u = entries[i]
        const v = entries[j]
        if (u.pos < 0 || v.pos < 0 || u.pos >= v.pos) continue
        if (u.b !== null && v.b !== null && cmp(u.b, v.b) < 0) continue
        const b: Ratio | null =
          u.b === null ? v.b : v.b === null ? u.b : [u.b[0] + v.b[0], u.b[1] + v.b[1]]
        entries.splice(Math.max(i, j), 1)
        entries.splice(Math.min(i, j), 1, { items: [...u.items, ...v.items], b, pos: u.pos })
        merged = true
      }
    }
  }
  const keys = new Map<Entry, Ratio>()
  let prev: Ratio | null = null
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].b !== null) {
      keys.set(entries[i], entries[i].b as Ratio)
      prev = entries[i].b
      continue
    }
    let next: Ratio | null = null
    for (let j = i + 1; j < entries.length && next === null; j++) next = entries[j].b
    const k = prev !== null && next !== null ? mid(prev, next) : (prev ?? next)
    if (k !== null) keys.set(entries[i], k)
  }
  if (keys.size === entries.length) {
    entries.sort((a, b) => cmp(keys.get(a) as Ratio, keys.get(b) as Ratio))
  }
  return entries.flatMap((e) =>
    e.items.flatMap((it) => {
      if (it.key === null) return it.nodes
      const sides = it.nodes.filter((n) => isSide(n) && n.origin === it.key)
      const inner = sortBlock(
        it.nodes.filter((n) => !sides.includes(n)),
        bary,
        chains,
        depth + 1,
        fixed,
      )
      return [
        ...sides.filter((n) => n.border === 'left'),
        ...inner,
        ...sides.filter((n) => n.border === 'right'),
      ]
    }),
  )
}

/**
 * Adjacent swaps within a layer while they cut the crossings against both
 * neighbouring layers. Every accepted swap strictly reduces the total, so
 * it terminates; deterministic. Only siblings swap, so blocks stay whole.
 */
function greedySwitch(s: State): void {
  const L = s.layers.length
  const local = (i: number): number =>
    (i > 0 ? countPair(s, i - 1) : 0) + (i + 1 < L ? countPair(s, i) : 0)
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < L; i++) {
      const row = s.layers[i]
      for (let k = 0; k + 1 < row.length; k++) {
        if (row[k].parent !== row[k + 1].parent) continue
        if (isSide(row[k]) || isSide(row[k + 1])) continue
        const before = local(i)
        ;[row[k], row[k + 1]] = [row[k + 1], row[k]]
        if (local(i) < before) improved = true
        else [row[k], row[k + 1]] = [row[k + 1], row[k]]
      }
    }
  }
}

function copyState(s: State): State {
  return {
    layers: s.layers.map((row) => [...row]),
    north: new Map([...s.north].map(([n, ps]) => [n, [...ps]])),
    south: new Map([...s.south].map(([n, ps]) => [n, [...ps]])),
    chains: s.chains,
  }
}
function restore(s: State, from: State): void {
  s.layers = from.layers
  s.north = from.north
  s.south = from.south
}

/** Write the state into the graph: layer order, per-side port order and
 * the border cell of every port. */
function apply(g: LGraph, s: State): void {
  g.layers = s.layers.map((row) => [...row])
  for (const row of g.layers) row.forEach((n, i) => void (n.order = i))
  for (const n of g.nodes) {
    const north = s.north.get(n) as LPort[]
    const south = s.south.get(n) as LPort[]
    for (const side of [north, south]) {
      side.forEach((p, i) => {
        p.order = i
        p.pos = portCell(n, i, side.length)
      })
    }
    n.ports = [...north, ...south]
  }
}

/**
 * The i-th of k ports on a side of a node: the usable border cells
 * `1..w-2` (corners excluded) are cut into k equal slices and each port
 * takes the middle cell of its slice, rounding toward the start — so a
 * single port sits on the top-biased centre and several spread evenly.
 * More ports than cells share cells; the router treats a shared cell as
 * one trunk. Dummies and other one-cell nodes: their one cell.
 */
export function portCell(n: LNode, i: number, k: number): number {
  if (n.kind === 'dummy' || n.w <= 1) return 0
  const usable = Math.max(1, n.w - 2)
  return 1 + Math.floor(((2 * i + 1) * usable - 1) / (2 * k))
}

// --- crossing counting: per layer pair, the inversions of target positions
// listed in source-port order (Fenwick tree); edges sharing a port never
// count as crossing each other.

function countCrossings(s: State): number {
  let total = 0
  for (let i = 0; i + 1 < s.layers.length; i++) total += countPair(s, i)
  return total
}

function countPair(s: State, i: number): number {
  const posN = new Map<LPort, number>()
  let size = 0
  for (const n of s.layers[i + 1]) for (const p of s.north.get(n) as LPort[]) posN.set(p, size++)
  const targets: number[] = []
  for (const n of s.layers[i]) {
    for (const p of s.south.get(n) as LPort[]) {
      const ts: number[] = []
      for (const e of p.out) {
        const t = posN.get(e.dst)
        if (t !== undefined) ts.push(t)
      }
      ts.sort((a, b) => a - b)
      targets.push(...ts)
    }
  }
  const tree = new Int32Array(size + 1)
  let crossings = 0
  targets.forEach((v, k) => {
    let seenUpTo = 0
    for (let x = v + 1; x > 0; x -= x & -x) seenUpTo += tree[x]
    crossings += k - seenUpTo
    for (let x = v + 1; x <= size; x += x & -x) tree[x]++
  })
  return crossings
}

/** Crossings of a graph's current order — for tests and stats. */
export function crossingsOf(g: LGraph): number {
  return countCrossings({
    layers: g.layers,
    north: new Map(g.nodes.map((n) => [n, n.ports.filter((p) => p.side === 'N')])),
    south: new Map(g.nodes.map((n) => [n, n.ports.filter((p) => p.side === 'S')])),
    chains: new Map(),
  })
}
