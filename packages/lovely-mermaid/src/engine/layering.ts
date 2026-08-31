/**
 * Phase 2: layering — every node gets a layer so every edge points down by
 * at least its minimum length. Default is Gansner's network simplex
 * (`simplex.ts`, as ELK runs it) from the longest-path start, balanced;
 * `longestPath` is the start alone. Both take edge weights and minimum
 * lengths. Nodes pinned `at` the first / last layer (a frame's ports) get
 * a layer of their own at the rim afterwards.
 *
 * The long-edge splitter below is plumbing, not a decision, and runs as
 * soon as layers exist.
 */

import type { LEdge, LGraph, LNode, LPort } from './graph.ts'
import { cloneGraph } from './graph.ts'
import { nsSolve } from './simplex.ts'
import type { LayeringOptions } from './types.ts'

export function assignLayers(g0: LGraph, opts: LayeringOptions): LGraph {
  const g = cloneGraph(g0)
  if (g.nodes.length === 0) return g
  const index = new Map<LNode, number>(g.nodes.map((n, i) => [n, i]))
  let layer = longestPath(g, index)
  if ((opts.strategy ?? 'networkSimplex') === 'networkSimplex') {
    const edges = g.edges
      .filter((e) => e.src.node !== e.dst.node)
      .map((e) => ({
        s: index.get(e.src.node) as number,
        t: index.get(e.dst.node) as number,
        w: e.weight,
        delta: e.minLen,
      }))
    layer = nsSolve(g.nodes.length, edges, layer, true)
  }
  for (const at of ['first', 'last'] as const) {
    const pinned = g.nodes.flatMap((n, i) => (n.at === at ? [i] : []))
    if (pinned.length === 0) continue
    const rest = g.nodes.flatMap((n, i) => (n.at === undefined ? [layer[i]] : []))
    if (rest.length === 0) rest.push(0)
    const rim = at === 'first' ? Math.min(...rest) - 1 : Math.max(...rest) + 1
    for (const i of pinned) layer[i] = rim
  }
  if (opts.maxWidth !== undefined && opts.maxWidth > 0) splitWide(g, layer, opts.maxWidth)
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
 * Stagger any row wider than `maxWidth` (node widths plus `nodeNode`
 * gaps) into two adjacent layers. Always legal: the movers drop into a
 * freshly inserted layer, so in-edges lengthen by one and out-edges keep
 * their span — no minimum length can break. Nodes with more outgoing
 * than incoming edges move (their edges stay short; each stayer's
 * out-edge grows a dummy instead). Repeats until every splittable row
 * fits; rim rows (a frame's ports) never split.
 */
function splitWide(g: LGraph, layer: Int32Array, maxWidth: number): void {
  const index = new Map<LNode, number>(g.nodes.map((n, i) => [n, i]))
  for (let guard = 0; guard < g.nodes.length; guard++) {
    const rows = new Map<number, LNode[]>()
    for (const n of g.nodes) {
      const l = layer[index.get(n) as number]
      const row = rows.get(l)
      if (row === undefined) rows.set(l, [n])
      else row.push(n)
    }
    let bad = 0
    let badRow: LNode[] | null = null
    let badW = maxWidth
    for (const [l, row] of rows) {
      if (row.length < 2 || row.some((n) => n.at !== undefined)) continue
      const w = row.reduce((t, n) => t + n.w, 0) + g.spacing.nodeNode * (row.length - 1)
      if (w > badW) {
        bad = l
        badRow = row
        badW = w
      }
    }
    if (badRow === null) return
    const score = (n: LNode): number => {
      let s = 0
      for (const p of n.ports) {
        for (const e of p.out) if (e.dst.node !== n) s++
        for (const e of p.in) if (e.src.node !== n) s--
      }
      return s
    }
    const order = [...badRow].sort((a, b) => score(b) - score(a) || b.w - a.w)
    const movers: LNode[] = []
    let width = badW
    for (const n of order) {
      if (width <= maxWidth || movers.length === badRow.length - 1) break
      movers.push(n)
      width -= n.w + g.spacing.nodeNode
    }
    if (movers.length === 0) return
    for (let i = 0; i < layer.length; i++) if (layer[i] > bad) layer[i]++
    for (const n of movers) layer[index.get(n) as number]++
  }
}

/** Kahn's topological pass: each node one minimum length below its lowest
 * predecessor. Sources start at 0. */
function longestPath(g: LGraph, index: Map<LNode, number>): Int32Array {
  const n = g.nodes.length
  const layer = new Int32Array(n)
  const indeg = new Int32Array(n)
  for (const e of g.edges) {
    if (e.src.node === e.dst.node) continue
    indeg[index.get(e.dst.node) as number]++
  }
  const queue: number[] = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i)
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q]
    for (const p of g.nodes[v].ports) {
      for (const e of p.out) {
        if (e.dst.node === g.nodes[v]) continue
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
 */
export function splitLongEdges(g0: LGraph): LGraph {
  const g = cloneGraph(g0)
  if (g.layers.length === 0) return g
  for (const e of [...g.edges]) {
    // the first split re-targets `e` itself, so read both ends up front
    const first = e.src.node.layer
    const last = e.dst.node.layer
    if (last - first <= 1) continue
    let cur = e
    for (let l = first + 1; l < last; l++) {
      const dummy: LNode = {
        id: `${e.origin}@${l}`,
        kind: 'dummy',
        origin: e.origin,
        w: 1,
        h: 0,
        layer: l,
        order: -1,
        x: -1,
        y: -1,
        ports: [],
      }
      const inPort: LPort = {
        id: `${dummy.id}.t`,
        node: dummy,
        side: 'N',
        order: -1,
        pos: -1,
        in: [],
        out: [],
      }
      const outPort: LPort = {
        id: `${dummy.id}.s`,
        node: dummy,
        side: 'S',
        order: -1,
        pos: -1,
        in: [],
        out: [],
      }
      dummy.ports.push(inPort, outPort)
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
  return g
}
