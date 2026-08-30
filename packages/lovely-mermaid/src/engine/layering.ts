/**
 * Phase 2: layering — every node gets a layer so every edge points down by
 * at least its minimum length. Default is Gansner's network simplex
 * (`simplex.ts`, as ELK runs it) from the longest-path start, balanced;
 * `longestPath` is the start alone. Both take edge weights and minimum
 * lengths.
 *
 * Compounds are nested by temporary *nesting edges* (dagre's scheme): a
 * compound's top row to each member and each member to its bottom row,
 * top to a child compound's top and the child's bottom to the bottom. With
 * weight they also pull the rows against the members, so a frame hugs its
 * content. They are removed once layers exist.
 *
 * The long-edge splitter below is plumbing, not a decision, and runs as
 * soon as layers exist.
 */

import { reverse } from './cycles.ts'
import type { LEdge, LGraph, LNode } from './graph.ts'
import {
  ancestors,
  borderNode,
  cloneGraph,
  compoundChain,
  linkNodes,
  makePort,
  unlinkEdge,
} from './graph.ts'
import { nsSolve } from './simplex.ts'
import type { LayeringOptions } from './types.ts'

export function assignLayers(g0: LGraph, opts: LayeringOptions): LGraph {
  const g = cloneGraph(g0)
  if (g.nodes.length === 0) return g
  const nesting = addNestingEdges(g)
  const index = new Map<LNode, number>(g.nodes.map((n, i) => [n, i]))
  let layer = longestPath(g, index)
  if ((opts.strategy ?? 'networkSimplex') === 'networkSimplex') {
    const edges = g.edges.map((e) => ({
      s: index.get(e.src.node) as number,
      t: index.get(e.dst.node) as number,
      w: e.weight,
      delta: e.minLen,
    }))
    layer = nsSolve(g.nodes.length, edges, layer, true)
  }
  for (const e of nesting) unlinkEdge(g, e)
  const min = Math.min(...layer)
  g.layers = []
  g.nodes.forEach((n, i) => {
    n.layer = layer[i] - min
    while (g.layers.length <= n.layer) g.layers.push([])
    g.layers[n.layer].push(n)
  })
  return g
}

/**
 * The nesting edges, weight 1, minimum length 1. An edge from a member to
 * its own compound's top row (or from the bottom row to a member) would
 * close a cycle with them; it is reversed here, as cycle breaking would.
 */
function addNestingEdges(g: LGraph): LEdge[] {
  const chains = new Map(g.nodes.map((n) => [n, ancestors(g, n)]))
  for (const e of g.edges) {
    const t = e.dst.node
    const s = e.src.node
    const upward =
      (t.border === 'top' && (chains.get(s) as string[]).includes(t.origin as string)) ||
      (s.border === 'bottom' && (chains.get(t) as string[]).includes(s.origin as string))
    if (upward) reverse(e)
  }
  const out: LEdge[] = []
  for (const c of g.compounds) {
    const top = borderNode(g, c.id, 'top')
    const bottom = borderNode(g, c.id, 'bottom')
    const link = (from: LNode, to: LNode): void => {
      out.push(linkNodes(g, `${c.id}~${out.length}`, from, to))
    }
    link(top, bottom) // an empty compound is still two rows
    for (const n of g.nodes) {
      if (n === top || n === bottom) continue
      if (n.kind === 'border') {
        // a child compound: its top under this top, its bottom over this bottom
        const child = g.compounds.find((d) => d.id === n.origin)
        if (child?.parent !== c.id) continue
        if (n.border === 'top') link(top, n)
        else if (n.border === 'bottom') link(n, bottom)
      } else if (n.parent === c.id) {
        link(top, n)
        link(n, bottom)
      }
    }
  }
  return out
}

/** Kahn's topological pass: each node one minimum length below its lowest
 * predecessor. Sources start at 0. */
function longestPath(g: LGraph, index: Map<LNode, number>): Int32Array {
  const n = g.nodes.length
  const layer = new Int32Array(n)
  const indeg = new Int32Array(n)
  for (const e of g.edges) indeg[index.get(e.dst.node) as number]++
  const queue: number[] = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i)
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q]
    for (const p of g.nodes[v].ports) {
      for (const e of p.out) {
        const u = index.get(e.dst.node) as number
        layer[u] = Math.max(layer[u], layer[v] + e.minLen)
        if (--indeg[u] === 0) queue.push(u)
      }
    }
  }
  return layer
}

/**
 * Replace every edge spanning more than one layer by a chain through one
 * dummy per skipped layer. The original edge object survives as the first
 * segment (it keeps the labels); every segment carries the origin id and
 * the reversed flag so the chain can be joined and read back. Does nothing
 * until layers are assigned.
 *
 * A dummy lies in the innermost compound of either end whose layers cover
 * its layer, else in the ends' common compound — so an edge leaving a
 * frame runs inside it down to the bottom row and pierces that, not a side.
 *
 * Then every compound gets its left and right columns: a border dummy at
 * each end of its block in every layer between its top and bottom rows,
 * chained layer to layer by border edges. Ordering sees the chains as
 * edges (a block drifting sideways crosses them) and placement keeps them
 * straight; the frame is their box.
 */
export function splitLongEdges(g0: LGraph): LGraph {
  const g = cloneGraph(g0)
  if (g.layers.length === 0) return g
  const span = new Map(
    g.compounds.map((c) => [
      c.id,
      [borderNode(g, c.id, 'top').layer, borderNode(g, c.id, 'bottom').layer],
    ]),
  )
  const parentAt = (s: LNode, t: LNode, l: number): string | undefined => {
    const a = ancestors(g, s)
    const b = ancestors(g, t)
    let k = 0
    while (k < a.length && k < b.length && a[k] === b[k]) k++
    const covers = (id: string): boolean => {
      const [lo, hi] = span.get(id) as [number, number]
      return lo <= l && l <= hi
    }
    for (let i = a.length - 1; i >= k; i--) if (covers(a[i])) return a[i]
    for (let i = b.length - 1; i >= k; i--) if (covers(b[i])) return b[i]
    return k > 0 ? a[k - 1] : undefined
  }
  for (const e of [...g.edges]) {
    // the first split re-targets `e` itself, so read both ends up front
    const first = e.src.node.layer
    const last = e.dst.node.layer
    if (last - first <= 1) continue
    const src = e.src.node
    const dst = e.dst.node
    let cur = e
    for (let l = first + 1; l < last; l++) {
      const dummy: LNode = {
        id: `${e.origin}@${l}`,
        kind: 'dummy',
        origin: e.origin,
        parent: parentAt(src, dst, l),
        w: 1,
        h: 0,
        layer: l,
        order: -1,
        x: -1,
        y: -1,
        ports: [],
      }
      const inPort = makePort(dummy, `${dummy.id}.t`, 'N')
      const outPort = makePort(dummy, `${dummy.id}.s`, 'S')
      g.nodes.push(dummy)
      g.layers[l].push(dummy)
      const tail = cur.dst
      tail.in.splice(tail.in.indexOf(cur), 1)
      cur.dst = inPort
      inPort.in.push(cur)
      const seg: LEdge = {
        id: `${e.origin}#${l}`,
        origin: e.origin,
        src: outPort,
        dst: tail,
        reversed: e.reversed,
        weight: e.weight,
        minLen: 1,
        labels: [],
        route: null,
        placed: [],
      }
      outPort.out.push(seg)
      tail.in.push(seg)
      g.edges.push(seg)
      cur = seg
    }
  }
  addBorderColumns(g)
  return g
}

/** A layer the compound spans without a member of its own gets the pair
 * at the end of the row (rare: a member-less layer inside a frame). */
function addBorderColumns(g: LGraph): void {
  const chains = new Map(g.nodes.map((n) => [n, ancestors(g, n)]))
  for (const c of g.compounds) {
    const own = compoundChain(g, c.id)
    const first = borderNode(g, c.id, 'top').layer
    const last = borderNode(g, c.id, 'bottom').layer
    const prev: Record<'left' | 'right', LNode | null> = { left: null, right: null }
    for (let l = first; l <= last; l++) {
      const row = g.layers[l]
      const idx = row.flatMap((n, i) => ((chains.get(n) as string[]).includes(c.id) ? [i] : []))
      const at = { left: idx[0] ?? row.length, right: (idx[idx.length - 1] ?? row.length - 1) + 1 }
      for (const side of ['right', 'left'] as const) {
        const b: LNode = {
          id: `${c.id}/${side}@${l}`,
          kind: 'border',
          origin: c.id,
          border: side,
          parent: c.id,
          w: 1,
          h: 0,
          layer: l,
          order: -1,
          x: -1,
          y: -1,
          ports: [],
        }
        row.splice(at[side], 0, b)
        g.nodes.push(b)
        chains.set(b, own)
        const p = prev[side]
        if (p !== null) linkNodes(g, `${c.id}/${side}#${l}`, p, b, { border: true, weight: 0 })
        prev[side] = b
      }
    }
  }
}
