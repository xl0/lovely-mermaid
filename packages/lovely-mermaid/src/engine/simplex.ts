/**
 * Gansner's network simplex as ELK runs it (docs/elk-layered.md ch. 2
 * §2.2), on plain index arrays so both the layering and the placement can
 * use it: minimize Σ weight·(value[t] − value[s]) subject to
 * value[t] − value[s] ≥ delta for every edge. Integer throughout.
 *
 * Feasible start (longest path unless given), tight spanning tree grown by
 * min-slack pulls, cut values by leaf peeling, first negative tree edge
 * leaves, min-slack head→tail edge enters, pivots capped at `28·√n`, then
 * each component normalized to start at 0 and, optionally, balanced into a
 * running count of nodes per value (Gansner's balancing).
 */
export interface NsEdge {
  s: number
  t: number
  w: number
  delta: number
}

interface Edge extends NsEdge {
  tree: boolean
  cut: number
}

export function nsSolve(
  n: number,
  input: NsEdge[],
  initial: Int32Array | null,
  balanceValues: boolean,
): Int32Array {
  const inc: number[][] = Array.from({ length: n }, () => [])
  const edges: Edge[] = input.map((e, i) => {
    inc[e.s].push(i)
    inc[e.t].push(i)
    return { ...e, tree: false, cut: 0 }
  })
  const value = initial === null ? longestPath(n, edges, inc) : Int32Array.from(initial)
  // connected components, undirected
  const comp = new Int32Array(n).fill(-1)
  const components: number[][] = []
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0) continue
    const members = [i]
    comp[i] = components.length
    for (let q = 0; q < members.length; q++) {
      for (const ei of inc[members[q]]) {
        const e = edges[ei]
        const u = e.s === members[q] ? e.t : e.s
        if (comp[u] < 0) {
          comp[u] = components.length
          members.push(u)
        }
      }
    }
    components.push(members)
  }
  const scratch: Scratch = {
    parent: new Int32Array(n),
    lim: new Int32Array(n),
    low: new Int32Array(n),
    unknown: new Int32Array(n),
    inTree: new Uint8Array(n),
    knownGen: new Int32Array(edges.length),
    kgen: 0,
  }
  const filling: number[] = []
  for (const members of components) {
    solveComponent(members, edges, inc, value, scratch)
    const min = Math.min(...members.map((v) => value[v]))
    for (const v of members) value[v] -= min
    if (balanceValues) balance(members, edges, inc, value, filling)
  }
  return value
}

/**
 * Reusable index-space working arrays for `solveComponent`. The pivot
 * loop renumbers the tree and recomputes every cut value on each pivot;
 * with Maps and Sets rebuilt each time that dominated the placement's
 * solve (the aux graph has a node per edge, so n is large). Plain
 * arrays allocated once cut NS placement time by roughly a third —
 * `knownGen` is a generation stamp so `cutValues` needs no clearing.
 */
interface Scratch {
  parent: Int32Array
  lim: Int32Array
  low: Int32Array
  unknown: Int32Array
  inTree: Uint8Array
  knownGen: Int32Array
  kgen: number
}

/** Kahn's pass: each node one delta below its lowest predecessor. */
function longestPath(n: number, edges: Edge[], inc: number[][]): Int32Array {
  const value = new Int32Array(n)
  const indeg = new Int32Array(n)
  for (const e of edges) indeg[e.t]++
  const queue: number[] = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i)
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q]
    for (const ei of inc[v]) {
      const e = edges[ei]
      if (e.s !== v) continue
      value[e.t] = Math.max(value[e.t], value[v] + e.delta)
      if (--indeg[e.t] === 0) queue.push(e.t)
    }
  }
  return value
}

function solveComponent(
  nodes: number[],
  edges: Edge[],
  inc: number[][],
  value: Int32Array,
  scr: Scratch,
): void {
  const slack = (e: Edge): number => value[e.t] - value[e.s] - e.delta
  const { parent, lim, low, unknown, inTree, knownGen } = scr
  const treeList: number[] = [] // tree members in insertion order
  const root = nodes[0]

  // --- feasible tight tree: grow along tight edges, pull the tree toward the
  // closest non-tree edge until every node is in.
  const enter_ = (v: number): void => {
    inTree[v] = 1
    treeList.push(v)
  }
  const grow = (): void => {
    const visited = new Set<number>()
    const stack = [root]
    if (inTree[root] === 0) enter_(root)
    while (stack.length > 0) {
      const v = stack.pop() as number
      if (visited.has(v)) continue
      visited.add(v)
      for (const ei of inc[v]) {
        const e = edges[ei]
        const u = e.s === v ? e.t : e.s
        if (visited.has(u)) continue
        if (e.tree) stack.push(u)
        else if (inTree[u] === 0 && slack(e) === 0) {
          e.tree = true
          enter_(u)
          stack.push(u)
        }
      }
    }
  }
  grow()
  while (treeList.length < nodes.length) {
    let best: Edge | null = null
    for (const v of treeList) {
      for (const ei of inc[v]) {
        const e = edges[ei]
        if (inTree[e.s] === inTree[e.t]) continue
        if (best === null || slack(e) < slack(best)) best = e
      }
    }
    const e = best as Edge
    const d = inTree[e.t] === 1 ? -slack(e) : slack(e)
    for (const v of treeList) value[v] += d
    grow()
  }

  // --- rooted tree numbering for the component test: subtree(c) = nodes with
  // low[c] <= lim <= lim[c]
  const number = (): void => {
    let counter = 0
    const visit = (v: number, from: number): void => {
      parent[v] = from
      let lo = Number.POSITIVE_INFINITY
      for (const ei of inc[v]) {
        const e = edges[ei]
        if (!e.tree) continue
        const u = e.s === v ? e.t : e.s
        if (u === from) continue
        visit(u, v)
        lo = Math.min(lo, low[u])
      }
      counter++
      lim[v] = counter
      low[v] = Math.min(lo, counter)
    }
    visit(root, -1)
  }
  const inSubtree = (x: number, c: number): boolean => low[c] <= lim[x] && lim[x] <= lim[c]
  /** Is `x` on the target side of tree edge `e` once `e` is removed? */
  const inHead = (x: number, e: Edge): boolean =>
    parent[e.t] === e.s ? inSubtree(x, e.t) : !inSubtree(x, e.s)

  // --- cut values by leaf peeling: a node with one unknown tree edge t
  // determines cut(t) from its other incident edges.
  const cutValues = (): void => {
    const kgen = ++scr.kgen
    const queue: number[] = []
    for (const v of nodes) {
      let c = 0
      for (const ei of inc[v]) if (edges[ei].tree) c++
      unknown[v] = c
      if (c === 1) queue.push(v)
    }
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q]
      if (unknown[v] !== 1) continue
      let ti = -1
      for (const ei of inc[v]) {
        if (edges[ei].tree && knownGen[ei] !== kgen) {
          ti = ei
          break
        }
      }
      const t = edges[ti]
      const tLeaves = t.s === v
      let cut = t.w
      for (const ei of inc[v]) {
        const e = edges[ei]
        if (e === t) continue
        const aligned = (e.s === v) === tLeaves
        if (!e.tree) cut += aligned ? e.w : -e.w
        else cut += aligned ? -(e.cut - e.w) : e.cut - e.w
      }
      t.cut = cut
      knownGen[ti] = kgen
      unknown[t.s]--
      if (unknown[t.s] === 1 && t.s !== v) queue.push(t.s)
      unknown[t.t]--
      if (unknown[t.t] === 1 && t.t !== v) queue.push(t.t)
    }
  }

  number()
  cutValues()
  const maxPivots = 4 * 7 * Math.floor(Math.sqrt(nodes.length))
  for (let pivot = 0; pivot < maxPivots; pivot++) {
    const leave = edges.find((e) => e.tree && e.cut < 0)
    if (leave === undefined) break
    // the entering edge runs from the head component back to the tail with
    // the least slack; tightening it shortens the total
    let enter: Edge | null = null
    let enterSlack = 0
    for (const v of nodes) {
      for (const ei of inc[v]) {
        const e = edges[ei]
        if (e.tree || e.s !== v) continue
        if (!inHead(e.s, leave) || inHead(e.t, leave)) continue
        const sl = slack(e)
        if (enter === null || sl < enterSlack) {
          enter = e
          enterSlack = sl
        }
      }
    }
    if (enter === null) break
    const d = enterSlack
    for (const v of nodes) if (!inHead(v, leave)) value[v] -= d
    leave.tree = false
    enter.tree = true
    number()
    cutValues()
  }
}

/**
 * Gansner's balancing: a node with as many incoming as outgoing edges can
 * move within its feasible range at no cost; put it in the emptiest value
 * of that range when that is strictly emptier than its own.
 */
function balance(
  nodes: number[],
  edges: Edge[],
  inc: number[][],
  value: Int32Array,
  filling: number[],
): void {
  for (const v of nodes) filling[value[v]] = (filling[value[v]] ?? 0) + 1
  for (const v of nodes) {
    let ins = 0
    let outs = 0
    let lo = 0
    let hi = Number.POSITIVE_INFINITY
    for (const ei of inc[v]) {
      const e = edges[ei]
      if (e.t === v) {
        ins++
        lo = Math.max(lo, value[e.s] + e.delta)
      } else {
        outs++
        hi = Math.min(hi, value[e.t] - e.delta)
      }
    }
    if (ins !== outs || hi === Number.POSITIVE_INFINITY) continue
    let best = value[v]
    for (let l = lo; l <= hi; l++) if ((filling[l] ?? 0) < (filling[best] ?? 0)) best = l
    if (best !== value[v]) {
      filling[value[v]]--
      filling[best] = (filling[best] ?? 0) + 1
      value[v] = best
    }
  }
}
