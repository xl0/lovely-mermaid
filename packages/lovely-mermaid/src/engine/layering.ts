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
  packLayers(g, layer, Math.max(opts.maxWidth ?? 0, opts.packWidth ?? 0) || undefined)
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
    const est = estimator(g, layer, index)
    let bad = 0
    let badRow: LNode[] | null = null
    let badW = maxWidth
    for (const [l, row] of rows) {
      if (row.length < 2 || row.some((n) => n.at !== undefined)) continue
      const w = est(l, row)
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

/**
 * The estimated rendered width of a row: its nodes (with self-loop
 * margins and gaps) plus a column per edge passing the layer — chains do
 * not exist yet, but each spanning edge will take `1 + edgeEdge` cells
 * beside the nodes. Both the stagger and the packing reason in this
 * estimate, so a cap approximates the final width, not just the boxes.
 */
function estimator(
  g: LGraph,
  layer: Int32Array,
  index: Map<LNode, number>,
): (l: number, row: LNode[]) => number {
  return (l, row) => {
    const nodes =
      row.reduce((t, n) => t + n.w + 2 * (n.loops ?? 0), 0) +
      g.spacing.nodeNode * Math.max(0, row.length - 1)
    let pass = 0
    for (const e of g.edges) {
      if (e.src.node === e.dst.node) continue
      const a = layer[index.get(e.src.node) as number]
      const b = layer[index.get(e.dst.node) as number]
      if (a < l && l < b) pass++
    }
    return (
      nodes +
      pass * (1 + g.spacing.edgeEdge) +
      (row.length > 0 && pass > 0 ? g.spacing.nodeEdge : 0)
    )
  }
}

/**
 * Width-aware packing: never-worse moves over the solved layering. One
 * primitive — *disperse a row*: every node of a layer goes to its own
 * nearest feasible other row, and the layer dies (total edge length can
 * only drop). Each target must stay within the budget: the cap, or the
 * currently widest row estimate, whichever is larger — so packing fills
 * real slack but never widens the picture. Rim rows (`at`-pinned ports)
 * neither move nor receive; emptied layer values are dropped when every
 * spanning edge has slack.
 */
function packLayers(g: LGraph, layer: Int32Array, maxWidth: number | undefined): void {
  const index = new Map<LNode, number>(g.nodes.map((n, i) => [n, i]))
  const est = estimator(g, layer, index)
  const feasible = (v: LNode, l2: number): boolean => {
    for (const q of v.ports) {
      for (const e of q.in) {
        if (e.src.node === v) continue
        if (layer[index.get(e.src.node) as number] + e.minLen > l2) return false
      }
      for (const e of q.out) {
        if (e.dst.node === v) continue
        if (l2 + e.minLen > layer[index.get(e.dst.node) as number]) return false
      }
    }
    return true
  }
  for (let guard = 0; guard < g.nodes.length + 8; guard++) {
    const rows = new Map<number, LNode[]>()
    for (const n of g.nodes) {
      const l = layer[index.get(n) as number]
      const row = rows.get(l)
      if (row === undefined) rows.set(l, [n])
      else row.push(n)
    }
    const keys = [...rows.keys()].sort((a, b) => a - b)
    const movable = (row: LNode[]): boolean => row.every((n) => n.at === undefined)
    const limit = Math.max(maxWidth ?? 0, ...keys.map((k) => est(k, rows.get(k) as LNode[])))
    let moved = false
    for (const l of keys) {
      const row = rows.get(l) as LNode[]
      if (!movable(row)) continue
      // tentative dispersal: each node to its nearest feasible row with room
      const assign: [LNode, number][] = []
      const extra = new Map<number, number>()
      let ok = true
      for (const v of row) {
        let placed: number | null = null
        const targets = keys
          .filter((k) => k !== l)
          .sort((a, b) => Math.abs(a - l) - Math.abs(b - l) || a - b)
        for (const t of targets) {
          const target = rows.get(t) as LNode[]
          if (!movable(target) || !feasible(v, t)) continue
          const add = extra.get(t) ?? 0
          const vw = v.w + 2 * (v.loops ?? 0) + g.spacing.nodeNode
          if (est(t, target) + add + vw > limit) continue
          placed = t
          extra.set(t, add + vw)
          break
        }
        if (placed === null) {
          ok = false
          break
        }
        assign.push([v, placed])
      }
      if (ok && assign.length > 0) {
        for (const [v, t] of assign) layer[index.get(v) as number] = t
        moved = true
        break
      }
    }
    if (!moved) break
  }
  // drop layer values nothing uses, where every spanning edge has slack
  for (let v = Math.max(...layer); v >= Math.min(...layer); v--) {
    if (layer.includes(v)) continue
    let safe = true
    for (const e of g.edges) {
      if (e.src.node === e.dst.node) continue
      const a = layer[index.get(e.src.node) as number]
      const b = layer[index.get(e.dst.node) as number]
      if (a < v && v < b && b - a - 1 < e.minLen) {
        safe = false
        break
      }
    }
    if (!safe) continue
    for (let i = 0; i < layer.length; i++) if (layer[i] > v) layer[i]--
  }
}

/** The given layers, verbatim: the geometry-feedback re-run's entry. */
export function applyLayers(g0: LGraph, forced: Map<string, number>): LGraph {
  const g = cloneGraph(g0)
  const min = Math.min(...g.nodes.map((n) => forced.get(n.id) ?? 0))
  g.layers = []
  for (const n of g.nodes) {
    n.layer = (forced.get(n.id) ?? 0) - min
    while (g.layers.length <= n.layer) g.layers.push([])
    g.layers[n.layer].push(n)
  }
  return g
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
