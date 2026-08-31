/**
 * Phase 1: cycle breaking — decide which edges to reverse so the graph is
 * acyclic. Default is the greedy Eades–Lin–Smyth heuristic as ELK runs it
 * (docs/elk-layered.md ch. 2 §1.2), except that ties are broken by
 * declaration order instead of at random. `dfs` reverses the back edges of
 * a depth-first search in declaration order — fewer decisions, more
 * reversals; it is the pre-breaking the ELK prototype used.
 *
 * Self-loops are never a decision: they stay as declared.
 */

import type { LEdge, LGraph, LNode } from './graph.ts'
import { cloneGraph } from './graph.ts'
import type { CyclesOptions } from './types.ts'

export function breakCycles(g0: LGraph, opts: CyclesOptions): LGraph {
  const g = cloneGraph(g0)
  if (opts.strategy === 'dfs') dfs(g)
  else greedy(g)
  return g
}

/**
 * Nodes are pulled into a linear order from both ends: sinks go to the
 * right end, sources to the left, and when neither exists the node with the
 * largest remaining out-degree minus in-degree is placed left (first such
 * node in declaration order). Edges pointing right to left in that order
 * are reversed. Each edge is discounted exactly once, when its first
 * endpoint is placed.
 */
function greedy(g: LGraph): void {
  const n = g.nodes.length
  const index = new Map<LNode, number>(g.nodes.map((v, i) => [v, i]))
  const indeg = new Int32Array(n)
  const outdeg = new Int32Array(n)
  for (const e of g.edges) {
    if (e.src.node === e.dst.node) continue
    outdeg[index.get(e.src.node) as number]++
    indeg[index.get(e.dst.node) as number]++
  }
  // 0 = unplaced; sinks count down from -1, sources and picks count up from 1
  const mark = new Int32Array(n)
  const sinks: number[] = []
  const sources: number[] = []
  for (let i = 0; i < n; i++) {
    if (outdeg[i] === 0) sinks.push(i)
    else if (indeg[i] === 0) sources.push(i)
  }
  let nextRight = -1
  let nextLeft = 1
  let remaining = n
  const place = (v: number, m: number): void => {
    mark[v] = m
    remaining--
    for (const p of g.nodes[v].ports) {
      for (const e of p.out) {
        const u = index.get(e.dst.node) as number
        if (mark[u] !== 0) continue
        if (--indeg[u] <= 0 && outdeg[u] > 0) sources.push(u)
      }
      for (const e of p.in) {
        const u = index.get(e.src.node) as number
        if (mark[u] !== 0) continue
        if (--outdeg[u] <= 0 && indeg[u] > 0) sinks.push(u)
      }
    }
  }
  while (remaining > 0) {
    // A node can be queued by both rules; the first placement wins.
    while (sinks.length > 0) {
      const v = sinks.shift() as number
      if (mark[v] === 0) place(v, nextRight--)
    }
    while (sources.length > 0) {
      const v = sources.shift() as number
      if (mark[v] === 0) place(v, nextLeft++)
    }
    if (remaining === 0 || sinks.length > 0 || sources.length > 0) continue
    let best = -1
    for (let i = 0; i < n; i++) {
      if (mark[i] !== 0) continue
      if (best < 0 || outdeg[i] - indeg[i] > outdeg[best] - indeg[best]) best = i
    }
    place(best, nextLeft++)
  }
  for (let i = 0; i < n; i++) if (mark[i] < 0) mark[i] += n + 1
  for (const e of g.edges) {
    if (mark[index.get(e.src.node) as number] > mark[index.get(e.dst.node) as number]) reverse(e)
  }
}

function dfs(g: LGraph): void {
  // 0 unvisited, 1 on the path, 2 finished
  const state = new Map<LNode, 0 | 1 | 2>()
  const visit = (v: LNode): void => {
    state.set(v, 1)
    for (const p of v.ports) {
      // reversing moves the edge out of `p.out`, so iterate a copy
      for (const e of [...p.out]) {
        const u = e.dst.node
        if (u === v) continue
        const s = state.get(u) ?? 0
        if (s === 1) reverse(e)
        else if (s === 0) visit(u)
      }
    }
    state.set(v, 2)
  }
  for (const v of g.nodes) if ((state.get(v) ?? 0) === 0) visit(v)
}

/**
 * Swap an edge's ends. The ports stay on their nodes, so the edge now leaves
 * the node it used to enter; the flag toggles, and a route (if any) is read
 * backwards — restoring is the same call.
 */
export function reverse(e: LEdge): void {
  const { src, dst } = e
  src.out.splice(src.out.indexOf(e), 1)
  dst.in.splice(dst.in.indexOf(e), 1)
  e.src = dst
  e.dst = src
  e.src.out.push(e)
  e.dst.in.push(e)
  e.reversed = !e.reversed
  if (e.route !== null) e.route.reverse()
}
