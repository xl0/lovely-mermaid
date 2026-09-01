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
 * A side with fixed ports (a compound's, set by its own layout) keeps
 * them in position order; only free ports get cells. A row of nothing
 * but rim-pinned nodes (a frame's ports, in the order the parent asked
 * for) is never permuted; everything else sorts against it.
 */

import type { LGraph, LNode, LPort } from './graph.ts'
import { cloneGraph } from './graph.ts'
import type { OrderingOptions } from './types.ts'

/** Sub-step reporting: the graph with the current order written in. */
export type OrderTrace = (g: LGraph, note: string) => void

/** The mutable sweep state: node order per layer, port order per side. */
interface State {
  layers: LNode[][]
  north: Map<LNode, LPort[]>
  south: Map<LNode, LPort[]>
}

type Ratio = [number, number]
const cmp = (a: Ratio, b: Ratio): number => a[0] * b[1] - b[0] * a[1]
const mid = (a: Ratio, b: Ratio): Ratio => [a[0] * b[1] + b[0] * a[1], 2 * a[1] * b[1]]

export function orderNodes(g0: LGraph, opts: OrderingOptions, trace?: OrderTrace): LGraph {
  const g = cloneGraph(g0)
  for (const n of g.nodes) for (const p of n.ports) p.side = p.out.length > 0 ? 'S' : 'N'
  if (g.layers.length === 0) return g
  const initial = (): State => ({
    layers: g.layers.map((row) => [...row]),
    north: new Map(g.nodes.map((n) => [n, byPos(n.ports.filter((p) => p.side === 'N'))])),
    south: new Map(g.nodes.map((n) => [n, byPos(n.ports.filter((p) => p.side === 'S'))])),
  })
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
      if (v.reverse) for (const row of s.layers) if (!pinnedRow(row)) row.reverse()
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
      shoveDummiesOut(best)
      sortAllPorts(best)
    }
  }
  apply(g, best)
  return g
}

/** A row that keeps its given order: nothing in it but rim-pinned ports. */
const pinnedRow = (row: LNode[]): boolean => row.length > 0 && row.every((n) => n.at !== undefined)

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
  if (pinnedRow(s.layers[free])) {
    sortPorts(s, free, fixed)
    return
  }
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
  sortByBarycenter(s.layers[free], bary)
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
  for (const n of s.layers[free]) sortSide(facingFree(n), key)
  const pos = new Map<LPort, number>()
  let q = 0
  for (const n of s.layers[free]) for (const p of facingFree(n)) pos.set(p, ++q)
  const back = (p: LPort): number => {
    const t = partnerBack(p)
    return t === undefined ? 0 : (pos.get(t) ?? 0)
  }
  for (const n of s.layers[fixed]) sortSide(facingFixed(n), back)
}

/** A self-loop's end: it wraps around the east side, so it sorts last. */
const loopEnd = (p: LPort): boolean => {
  const e = p.in[0] ?? p.out[0]
  return e !== undefined && e.src.node === e.dst.node
}

/** Sort a side's ports by `key`, unless any is fixed: then by position.
 * Self-loop ends go last either way, nearest their east-side wrap. */
function sortSide(ps: LPort[], key: (p: LPort) => number): void {
  if (ps.some((p) => p.fixed === true)) byPos(ps)
  else {
    const k = (p: LPort): number => (loopEnd(p) ? Number.POSITIVE_INFINITY : key(p))
    ps.sort((a, b) => k(a) - k(b))
  }
}
function byPos(ps: LPort[]): LPort[] {
  if (ps.some((p) => p.fixed === true)) ps.sort((a, b) => a.pos - b.pos)
  return ps
}

/** Every layer's ports against both neighbours, node order unchanged. */
function sortAllPorts(s: State): void {
  const L = s.layers.length
  for (let i = 1; i < L; i++) sortPorts(s, i, i - 1)
  for (let i = L - 2; i >= 0; i--) sortPorts(s, i, i + 1)
}

/**
 * Stable sort by barycenter; a node without one takes the midpoint of its
 * known neighbours in the current order, so it keeps its place (ELK's
 * fill-in rule). Nothing known → nothing moves.
 */
function sortByBarycenter(row: LNode[], bary: Map<LNode, Ratio>): void {
  const keys = new Map<LNode, Ratio>()
  let prev: Ratio | null = null
  for (let i = 0; i < row.length; i++) {
    const b = bary.get(row[i])
    if (b !== undefined) {
      keys.set(row[i], b)
      prev = b
      continue
    }
    let next: Ratio | null = null
    for (let j = i + 1; j < row.length && next === null; j++) next = bary.get(row[j]) ?? null
    const k = prev !== null && next !== null ? mid(prev, next) : (prev ?? next)
    if (k !== null) keys.set(row[i], k)
  }
  if (keys.size < row.length) return
  row.sort((a, b) => cmp(keys.get(a) as Ratio, keys.get(b) as Ratio))
}

/**
 * Adjacent swaps within a layer while they cut the crossings against both
 * neighbouring layers. Every accepted swap strictly reduces the total, so
 * it terminates; deterministic.
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
      if (pinnedRow(row)) continue
      for (let k = 0; k + 1 < row.length; k++) {
        const before = local(i)
        ;[row[k], row[k + 1]] = [row[k + 1], row[k]]
        if (local(i) < before) improved = true
        else [row[k], row[k + 1]] = [row[k + 1], row[k]]
      }
    }
  }
}

/**
 * Crossing-neutral width polish: a long-edge dummy ordered between real
 * nodes forces a corridor through the row (the `[frame, chains, frame]`
 * mid-row holes) and pinches its own routing slack. Where an adjacent
 * swap with a real node changes no crossings, the dummy moves toward its
 * nearer row edge. Crossings never increase, and every accepted swap
 * strictly reduces the dummies' summed distance to their nearer edge,
 * so it terminates.
 */
function shoveDummiesOut(s: State): void {
  const L = s.layers.length
  const local = (i: number): number =>
    (i > 0 ? countPair(s, i - 1) : 0) + (i + 1 < L ? countPair(s, i) : 0)
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < L; i++) {
      const row = s.layers[i]
      if (pinnedRow(row)) continue
      const half = (row.length - 1) / 2
      for (let k = 0; k + 1 < row.length; k++) {
        const a = row[k]
        const b = row[k + 1]
        const dummyRight = b.kind === 'dummy' && a.kind !== 'dummy'
        const dummyLeft = a.kind === 'dummy' && b.kind !== 'dummy'
        if (!dummyLeft && !dummyRight) continue
        // only swaps that bring the dummy toward its nearer edge
        if (dummyRight ? k + 1 > half : k < half) continue
        const before = local(i)
        ;[row[k], row[k + 1]] = [row[k + 1], row[k]]
        if (local(i) <= before) improved = true
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
  for (const row of g.layers) {
    row.forEach((n, i) => {
      n.order = i
    })
  }
  for (const n of g.nodes) {
    const north = s.north.get(n) as LPort[]
    const south = s.south.get(n) as LPort[]
    for (const side of [north, south]) {
      side.forEach((p, i) => {
        p.order = i
        if (p.fixed !== true) p.pos = portCell(n, i, side.length)
      })
    }
    n.ports = [...north, ...south, ...n.ports.filter((p) => p.side === 'E' || p.side === 'W')]
  }
}

/**
 * The i-th of k ports on a side of a node: the usable border cells
 * `1..w-2` (corners excluded) are cut into k equal slices and each port
 * takes the middle cell of its slice, rounding toward the start — so a
 * single port sits on the top-biased centre and several spread evenly.
 * More ports than cells share cells; the router treats a shared cell as
 * one trunk. Dummies, ports and other one-cell nodes: their one cell.
 */
export function portCell(n: LNode, i: number, k: number): number {
  if (n.kind !== 'node' || n.w <= 1) return 0
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
  })
}
