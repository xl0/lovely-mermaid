/**
 * The engine's working model — one mutable graph the phases transform in
 * sequence, ELK's LGraph in spirit. Every edge end is a port; long-edge
 * dummies are real nodes with real ports; a reversed edge is stored in
 * layout direction with a flag. `-1` means "not assigned yet" for layer,
 * order and coordinates, so a snapshot can leave the field out.
 */
import type { SEdge, SNode, Snapshot, SPort } from './snapshot.ts'
import type { InputLabel, LayoutInput, Pt, Spacing } from './types.ts'

export type Side = 'N' | 'S' | 'E' | 'W'

export interface LPort {
  id: string
  node: LNode
  side: Side
  /** position among the ports of its side */
  order: number
  /** border cell offset along the side */
  pos: number
  in: LEdge[]
  out: LEdge[]
}

export interface LNode {
  id: string
  kind: 'node' | 'dummy'
  /** dummy: the input edge it stands in for */
  origin?: string
  w: number
  h: number
  layer: number
  order: number
  /** cross-axis top-left */
  x: number
  /** flow-axis top-left */
  y: number
  ports: LPort[]
}

export interface LEdge {
  id: string
  /** the input edge this is (a segment of) */
  origin: string
  src: LPort
  dst: LPort
  reversed: boolean
  /** carried by the first segment only */
  labels: InputLabel[]
  route: Pt[] | null
}

export interface LGraph {
  nodes: LNode[]
  edges: LEdge[]
  /** nodes per layer, in order; built by layering */
  layers: LNode[][]
  spacing: Spacing
  warnings: string[]
}

export function buildGraph(input: LayoutInput): LGraph {
  const g: LGraph = { nodes: [], edges: [], layers: [], spacing: input.spacing, warnings: [] }
  const byId = new Map<string, LNode>()
  for (const n of input.nodes) {
    if (byId.has(n.id)) {
      g.warnings.push(`duplicate node id "${n.id}" ignored`)
      continue
    }
    const node: LNode = {
      id: n.id,
      kind: 'node',
      w: n.w,
      h: n.h,
      layer: -1,
      order: -1,
      x: -1,
      y: -1,
      ports: [],
    }
    byId.set(n.id, node)
    g.nodes.push(node)
  }
  for (const e of input.edges) {
    const from = byId.get(e.from)
    const to = byId.get(e.to)
    if (from === undefined || to === undefined) {
      g.warnings.push(`edge "${e.id}" refers to an unknown node`)
      continue
    }
    if (from === to) {
      g.warnings.push(`edge "${e.id}": self-loops are not routed yet`)
      continue
    }
    // One port per edge end; sides are decided after cycle breaking.
    const src: LPort = { id: `${e.id}.s`, node: from, side: 'S', order: 0, pos: 0, in: [], out: [] }
    const dst: LPort = { id: `${e.id}.t`, node: to, side: 'N', order: 0, pos: 0, in: [], out: [] }
    from.ports.push(src)
    to.ports.push(dst)
    const edge: LEdge = {
      id: e.id,
      origin: e.id,
      src,
      dst,
      reversed: false,
      labels: e.labels ?? [],
      route: null,
    }
    src.out.push(edge)
    dst.in.push(edge)
    g.edges.push(edge)
  }
  return g
}

/** The graph as the lab draws it; fields still at `-1` are left out. */
export function toSnapshot(g: LGraph, title: string, withPorts: boolean): Snapshot {
  const nodes: SNode[] = g.nodes.map((n) => {
    const s: SNode = { id: n.id }
    if (n.kind === 'dummy') s.kind = 'dummy'
    else {
      s.w = n.w
      s.h = n.h
    }
    if (n.layer >= 0) s.layer = n.layer
    if (n.order >= 0) s.order = n.order
    if (n.x >= 0) s.x = n.x
    if (n.y >= 0) s.y = n.y
    if (withPorts) {
      s.ports = n.ports.map((p): SPort => ({ id: p.id, side: p.side, pos: p.pos, order: p.order }))
    }
    return s
  })
  const edges: SEdge[] = g.edges.map((e) => {
    const s: SEdge = { from: e.src.node.id, to: e.dst.node.id }
    if (withPorts) {
      s.fromPort = e.src.id
      s.toPort = e.dst.id
    }
    if (e.reversed) s.reversed = true
    if (e.route !== null) s.route = e.route
    const label = e.labels.find((l) => l.at === 'center')
    if (label !== undefined) s.label = { text: label.text }
    return s
  })
  return { title, nodes, edges }
}
