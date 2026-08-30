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
  const filling: number[] = []
  for (const members of components) {
    solveComponent(members, edges, inc, value)
    const min = Math.min(...members.map((v) => value[v]))
    for (const v of members) value[v] -= min
    if (balanceValues) balance(members, edges, inc, value, filling)
  }
  return value
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

function solveComponent(nodes: number[], edges: Edge[], inc: number[][], value: Int32Array): void {
  const slack = (e: Edge): number => value[e.t] - value[e.s] - e.delta
  const inTree = new Set<number>()
  const root = nodes[0]

  // --- feasible tight tree: grow along tight edges, pull the tree toward the
  // closest non-tree edge until every node is in.
  const grow = (): void => {
    const visited = new Set<number>()
    const stack = [root]
    inTree.add(root)
    while (stack.length > 0) {
      const v = stack.pop() as number
      if (visited.has(v)) continue
      visited.add(v)
      for (const ei of inc[v]) {
        const e = edges[ei]
        const u = e.s === v ? e.t : e.s
        if (visited.has(u)) continue
        if (e.tree) stack.push(u)
        else if (!inTree.has(u) && slack(e) === 0) {
          e.tree = true
          inTree.add(u)
          stack.push(u)
        }
      }
    }
  }
  grow()
  while (inTree.size < nodes.length) {
    let best: Edge | null = null
    for (const v of inTree) {
      for (const ei of inc[v]) {
        const e = edges[ei]
        if (inTree.has(e.s) === inTree.has(e.t)) continue
        if (best === null || slack(e) < slack(best)) best = e
      }
    }
    const e = best as Edge
    const d = inTree.has(e.t) ? -slack(e) : slack(e)
    for (const v of inTree) value[v] += d
    grow()
  }

  // --- rooted tree numbering for the component test: subtree(c) = nodes with
  // low[c] <= lim <= lim[c]
  const parent = new Map<number, number>()
  const lim = new Map<number, number>()
  const low = new Map<number, number>()
  const number = (): void => {
    parent.clear()
    let counter = 0
    const visit = (v: number, from: number): void => {
      parent.set(v, from)
      let lo = Number.POSITIVE_INFINITY
      for (const ei of inc[v]) {
        const e = edges[ei]
        if (!e.tree) continue
        const u = e.s === v ? e.t : e.s
        if (u === from) continue
        visit(u, v)
        lo = Math.min(lo, low.get(u) as number)
      }
      counter++
      lim.set(v, counter)
      low.set(v, Math.min(lo, counter))
    }
    visit(root, -1)
  }
  const inSubtree = (x: number, c: number): boolean => {
    const l = lim.get(x) as number
    return (low.get(c) as number) <= l && l <= (lim.get(c) as number)
  }
  /** Is `x` on the target side of tree edge `e` once `e` is removed? */
  const inHead = (x: number, e: Edge): boolean =>
    parent.get(e.t) === e.s ? inSubtree(x, e.t) : !inSubtree(x, e.s)

  // --- cut values by leaf peeling: a node with one unknown tree edge t
  // determines cut(t) from its other incident edges.
  const cutValues = (): void => {
    const unknown = new Map<number, number>()
    for (const v of nodes) unknown.set(v, inc[v].filter((ei) => edges[ei].tree).length)
    const known = new Set<Edge>()
    const queue = nodes.filter((v) => unknown.get(v) === 1)
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q]
      if (unknown.get(v) !== 1) continue
      const ti = inc[v].find((ei) => edges[ei].tree && !known.has(edges[ei])) as number
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
      known.add(t)
      for (const x of [t.s, t.t]) {
        const left = (unknown.get(x) as number) - 1
        unknown.set(x, left)
        if (left === 1 && x !== v) queue.push(x)
      }
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
    for (const v of nodes) {
      for (const ei of inc[v]) {
        const e = edges[ei]
        if (e.tree || e.s !== v) continue
        if (!inHead(e.s, leave) || inHead(e.t, leave)) continue
        if (enter === null || slack(e) < slack(enter)) enter = e
      }
    }
    if (enter === null) break
    const d = slack(enter)
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
