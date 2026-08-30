/**
 * Phase 3: order within layers, then port sides, port order and port cells.
 * Skeleton: declaration order stays; ports face the flow (in → N, out → S),
 * are ordered by the neighbour they connect to, and spread over the usable
 * border cells (corners excluded).
 */
import type { LGraph, LNode, LPort } from './graph.ts'

export function orderNodes(g: LGraph): void {
  for (const row of g.layers) {
    for (let i = 0; i < row.length; i++) row[i].order = i
  }
}

export function assignPorts(g: LGraph): void {
  for (const n of g.nodes) {
    for (const p of n.ports) p.side = p.out.length > 0 ? 'S' : 'N'
    for (const side of ['N', 'S'] as const) {
      const ports = n.ports.filter((p) => p.side === side)
      ports.sort((a, b) => neighbourOrder(a) - neighbourOrder(b))
      ports.forEach((p, i) => {
        p.order = i
        p.pos = n.kind === 'dummy' ? 0 : portCell(n.w, i, ports.length)
      })
    }
    n.ports.sort((a, b) => a.side.localeCompare(b.side) || a.order - b.order)
  }
}

/** Order (in its layer) of the node at the other end of the port's edge. */
function neighbourOrder(p: LPort): number {
  const e = p.in[0] ?? p.out[0]
  if (e === undefined) return 0
  const other: LNode = e.src === p ? e.dst.node : e.src.node
  return other.order
}

/** The i-th of n ports on a side of width w: evenly spread over cells
 * 1..w-2, top-biased (`(w-1)>>1` for a single port). */
export function portCell(w: number, i: number, n: number): number {
  const cell = Math.floor(((i + 1) * (w - 1)) / (n + 1))
  return Math.max(1, Math.min(Math.max(1, w - 2), cell))
}
