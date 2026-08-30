/**
 * Phase 1: cycle breaking. Skeleton: DFS in declaration order, an edge to a
 * node on the current path is a back edge and gets reversed — the same
 * pre-breaking the ELK prototype used. (See docs/elk-layered.md ch. 2 for
 * the greedy breaker this will become.)
 */
import type { LEdge, LGraph, LNode } from './graph.ts'

export function breakCycles(g: LGraph): void {
  // 0 unvisited, 1 on the path, 2 finished
  const mark = new Map<LNode, 0 | 1 | 2>()
  const visit = (n: LNode): void => {
    mark.set(n, 1)
    for (const p of n.ports) {
      // reversing moves the edge out of `p.out`, so iterate a copy
      for (const e of [...p.out]) {
        const m = e.dst.node
        const s = mark.get(m) ?? 0
        if (s === 1) reverse(e)
        else if (s === 0) visit(m)
      }
    }
    mark.set(n, 2)
  }
  for (const n of g.nodes) if ((mark.get(n) ?? 0) === 0) visit(n)
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
