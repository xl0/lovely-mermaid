/**
 * Phase 4: cross-axis coordinates. Skeleton: pack each layer from the left
 * with the pair-typed gap between neighbours (node–node, node–dummy,
 * dummy–dummy), which is the spacing rule Brandes–Köpf will keep.
 */
import type { LGraph, LNode } from './graph.ts'
import type { Spacing } from './types.ts'

export function placeNodes(g: LGraph): void {
  for (const row of g.layers) {
    let x = 0
    row.forEach((n, i) => {
      if (i > 0) x += gap(g.spacing, row[i - 1], n)
      n.x = x
      x += n.w
    })
  }
}

export function gap(sp: Spacing, a: LNode, b: LNode): number {
  if (a.kind === 'node' && b.kind === 'node') return sp.nodeNode
  if (a.kind === 'dummy' && b.kind === 'dummy') return sp.edgeEdge
  return sp.nodeEdge
}
