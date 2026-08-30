/**
 * Phase 2: layering, plus the long-edge splitter that makes the layering
 * proper. Skeleton: longest path from the sources (Kahn), which is also the
 * feasible start network simplex will improve on later.
 */
import type { LEdge, LGraph, LNode, LPort } from './graph.ts'

export function assignLayers(g: LGraph): void {
  const indeg = new Map<LNode, number>(g.nodes.map((n) => [n, 0]))
  for (const e of g.edges) indeg.set(e.dst.node, (indeg.get(e.dst.node) as number) + 1)
  const queue = g.nodes.filter((n) => indeg.get(n) === 0)
  for (const n of queue) n.layer = 0
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i]
    for (const p of n.ports) {
      for (const e of p.out) {
        const m = e.dst.node
        m.layer = Math.max(m.layer, n.layer + 1)
        const d = (indeg.get(m) as number) - 1
        indeg.set(m, d)
        if (d === 0) queue.push(m)
      }
    }
  }
  const count = Math.max(0, ...g.nodes.map((n) => n.layer)) + 1
  g.layers = Array.from({ length: count }, () => [])
  for (const n of g.nodes) {
    n.order = g.layers[n.layer].length
    g.layers[n.layer].push(n)
  }
}

/**
 * Replace every edge spanning more than one layer by a chain through one
 * dummy per skipped layer. The original edge object survives as the first
 * segment (it keeps the labels); every segment carries the origin id and
 * the reversed flag so the chain can be joined and read back.
 */
export function splitLongEdges(g: LGraph): void {
  for (const e of [...g.edges]) {
    const span = e.dst.node.layer - e.src.node.layer
    if (span <= 1) continue
    let cur = e
    for (let l = e.src.node.layer + 1; l < e.dst.node.layer; l++) {
      const dummy: LNode = {
        id: `${e.origin}@${l}`,
        kind: 'dummy',
        origin: e.origin,
        w: 1,
        h: 0,
        layer: l,
        order: g.layers[l].length,
        x: -1,
        y: -1,
        ports: [],
      }
      const inPort: LPort = {
        id: `${dummy.id}.t`,
        node: dummy,
        side: 'N',
        order: 0,
        pos: 0,
        in: [],
        out: [],
      }
      const outPort: LPort = {
        id: `${dummy.id}.s`,
        node: dummy,
        side: 'S',
        order: 0,
        pos: 0,
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
        labels: [],
        route: null,
      }
      outPort.out.push(seg)
      tail.in.push(seg)
      g.edges.push(seg)
      cur = seg
    }
  }
}
