/**
 * The engine's working model — one mutable graph the phases transform in
 * sequence, ELK's LGraph in spirit. Every edge end is a port; long-edge
 * dummies are real nodes with real ports; a reversed edge is stored in
 * layout direction with a flag. `-1` means "not assigned yet" for layer,
 * order and coordinates, so a snapshot can leave the field out.
 */
import type { SEdge, SNode, Snapshot, SPort } from './snapshot.ts'
import type { InputLabel, LayoutInput, PlacedLabel, Pt, Spacing } from './types.ts'

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
  label?: string
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
  /** layering: cost per unit of length, and the least length allowed */
  weight: number
  minLen: number
  /** carried by the first segment only */
  labels: InputLabel[]
  route: Pt[] | null
  /** where the labels ended up, on the first segment, once placed */
  placed: PlacedLabel[]
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
  // Copy what is taken from the input: the graph must not alias caller
  // objects (a reactive proxy, say — structuredClone refuses those).
  const g: LGraph = {
    nodes: [],
    edges: [],
    layers: [],
    spacing: { ...input.spacing },
    warnings: [],
  }
  const byId = new Map<string, LNode>()
  for (const n of input.nodes) {
    if (byId.has(n.id)) {
      g.warnings.push(`duplicate node id "${n.id}" ignored`)
      continue
    }
    const node: LNode = {
      id: n.id,
      label: n.label,
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
    // One port per edge end, facing the declared direction for now; the
    // ordering phase settles sides, order and cells after cycle breaking.
    const src: LPort = {
      id: `${e.id}.s`,
      node: from,
      side: 'S',
      order: -1,
      pos: -1,
      in: [],
      out: [],
    }
    const dst: LPort = { id: `${e.id}.t`, node: to, side: 'N', order: -1, pos: -1, in: [], out: [] }
    from.ports.push(src)
    to.ports.push(dst)
    const edge: LEdge = {
      id: e.id,
      origin: e.id,
      src,
      dst,
      reversed: false,
      weight: 1,
      minLen: 1,
      labels: (e.labels ?? []).map((l) => ({ ...l })),
      route: null,
      placed: [],
    }
    src.out.push(edge)
    dst.in.push(edge)
    g.edges.push(edge)
  }
  return g
}

/**
 * Every phase takes a graph and returns a new one: it clones its input and
 * works on the clone, so callers keep what they passed in (the candidate
 * loop and the lab's edit-and-continue depend on it). `structuredClone`
 * keeps the internal references (ports ↔ nodes ↔ edges) intact.
 */
export function cloneGraph(g: LGraph): LGraph {
  return structuredClone(g)
}

/** The graph as the lab draws it; fields still at `-1` are left out. */
export function toSnapshot(g: LGraph, title: string): Snapshot {
  const nodes: SNode[] = g.nodes.map((n) => {
    const s: SNode = { id: n.id }
    if (n.kind === 'dummy') s.kind = 'dummy'
    else {
      if (n.label !== undefined) s.label = n.label
      s.w = n.w
      s.h = n.h
    }
    if (n.layer >= 0) s.layer = n.layer
    if (n.order >= 0) s.order = n.order
    if (n.x >= 0) s.x = n.x
    if (n.y >= 0) s.y = n.y
    s.ports = n.ports.map((p): SPort => {
      const q: SPort = { id: p.id, side: p.side }
      if (p.pos >= 0) q.pos = p.pos
      if (p.order >= 0) q.order = p.order
      return q
    })
    return s
  })
  const edges: SEdge[] = g.edges.map((e) => {
    const s: SEdge = { from: e.src.node.id, to: e.dst.node.id }
    s.fromPort = e.src.id
    s.toPort = e.dst.id
    if (e.reversed) s.reversed = true
    if (e.route !== null) s.route = e.route
    const label = e.labels.find((l) => l.at === 'center')
    if (label !== undefined) s.label = { text: label.text }
    return s
  })
  return { title, nodes, edges }
}
