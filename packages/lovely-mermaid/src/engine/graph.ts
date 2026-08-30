/**
 * The engine's working model — one mutable graph the phases transform in
 * sequence, ELK's LGraph in spirit. Every edge end is a port; long-edge
 * dummies are real nodes with real ports; a reversed edge is stored in
 * layout direction with a flag. `-1` means "not assigned yet" for layer,
 * order and coordinates, so a snapshot can leave the field out.
 *
 * Compounds (subgraphs) are not nodes. Each one is a set of *border* nodes
 * in the same flat graph: a top and a bottom row created here, which
 * layering pins around the members with nesting edges, and left / right
 * columns per spanned layer that placement adds and keeps straight. Every
 * node knows its `parent` compound; ordering keeps a compound's nodes
 * contiguous in each layer. The frame is the box of its border nodes.
 */
import type { SEdge, SNode, Snapshot, SPort } from './snapshot.ts'
import type { InputLabel, LayoutInput, PlacedLabel, Pt, Rect, Spacing } from './types.ts'

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
  /** `border`: one of a frame's four sides, see the module comment */
  kind: 'node' | 'dummy' | 'border'
  /** dummy: the input edge it stands in for; border: its compound */
  origin?: string
  border?: 'top' | 'bottom' | 'left' | 'right'
  /** the compound this node lies in (a border node: its own compound) */
  parent?: string
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
  /** a frame-border chain edge: aligns border dummies in placement, never routed */
  border?: boolean
  /** carried by the first segment only */
  labels: InputLabel[]
  route: Pt[] | null
  /** where the labels ended up, on the first segment, once placed */
  placed: PlacedLabel[]
}

export interface Compound {
  id: string
  label?: string
  parent?: string
  /** cross-axis units the top and bottom rows offer between the corners */
  titleW: number
  /** least flow-axis extent of the frame, border rows included */
  minSpan: number
}

export interface LGraph {
  nodes: LNode[]
  edges: LEdge[]
  /** nodes per layer, in order; built by layering */
  layers: LNode[][]
  compounds: Compound[]
  spacing: Spacing
  warnings: string[]
}

/** The compounds a node lies in, outermost first. */
export function ancestors(g: LGraph, n: LNode): string[] {
  return compoundChain(g, n.parent)
}

/** A compound and the compounds around it, outermost first. */
export function compoundChain(g: LGraph, id: string | undefined): string[] {
  const chain: string[] = []
  for (let p = id; p !== undefined; p = g.compounds.find((c) => c.id === p)?.parent) {
    chain.unshift(p)
  }
  return chain
}

/** A compound's top / bottom border node. */
export const borderNode = (g: LGraph, id: string, side: 'top' | 'bottom'): LNode =>
  g.nodes.find((n) => n.kind === 'border' && n.origin === id && n.border === side) as LNode

/**
 * A compound's frame once its borders are placed: rows from its top to its
 * bottom row, columns from its leftmost left border to its rightmost right
 * border (they are straight unless placement had to bend a chain).
 */
export function frameOf(g: LGraph, id: string): Rect | null {
  const top = borderNode(g, id, 'top')
  const bottom = borderNode(g, id, 'bottom')
  const sides = g.nodes.filter((n) => n.kind === 'border' && n.origin === id && n.x >= 0)
  const lefts = sides.filter((n) => n.border === 'left').map((n) => n.x)
  const rights = sides.filter((n) => n.border === 'right').map((n) => n.x)
  if (top === undefined || top.y < 0 || lefts.length === 0 || rights.length === 0) return null
  const left = Math.min(...lefts)
  const right = Math.max(...rights)
  return { x: left, y: top.y, w: right - left + 1, h: bottom.y - top.y + 1 }
}

export function buildGraph(input: LayoutInput): LGraph {
  // Copy what is taken from the input: the graph must not alias caller
  // objects (a reactive proxy, say — structuredClone refuses those).
  const g: LGraph = {
    nodes: [],
    edges: [],
    layers: [],
    compounds: (input.compounds ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      parent: c.parent,
      titleW: c.titleW ?? 0,
      minSpan: c.minSpan ?? 0,
    })),
    spacing: { ...input.spacing },
    warnings: [],
  }
  const compoundIds = new Set(g.compounds.map((c) => c.id))
  const byId = new Map<string, LNode>()
  const add = (node: LNode): void => {
    byId.set(node.id, node)
    g.nodes.push(node)
  }
  for (const c of g.compounds) {
    if (c.parent !== undefined && !compoundIds.has(c.parent)) {
      g.warnings.push(`compound "${c.id}" has an unknown parent "${c.parent}"`)
      c.parent = undefined
    }
    for (const side of ['top', 'bottom'] as const) {
      add({
        id: `${c.id}/${side}`,
        kind: 'border',
        origin: c.id,
        border: side,
        parent: c.id,
        w: c.titleW + 2,
        h: 1,
        layer: -1,
        order: -1,
        x: -1,
        y: -1,
        ports: [],
      })
    }
  }
  for (const n of input.nodes) {
    if (byId.has(n.id) || compoundIds.has(n.id)) {
      g.warnings.push(`duplicate id "${n.id}" ignored`)
      continue
    }
    if (n.parent !== undefined && !compoundIds.has(n.parent)) {
      g.warnings.push(`node "${n.id}" has an unknown parent "${n.parent}"`)
    }
    add({
      id: n.id,
      label: n.label,
      kind: 'node',
      parent: n.parent !== undefined && compoundIds.has(n.parent) ? n.parent : undefined,
      w: n.w,
      h: n.h,
      layer: -1,
      order: -1,
      x: -1,
      y: -1,
      ports: [],
    })
  }
  for (const e of input.edges) {
    const from = byId.get(compoundIds.has(e.from) ? `${e.from}/bottom` : e.from)
    const to = byId.get(compoundIds.has(e.to) ? `${e.to}/top` : e.to)
    if (from === undefined || to === undefined) {
      g.warnings.push(`edge "${e.id}" refers to an unknown node`)
      continue
    }
    if (from === to || (from.origin !== undefined && from.origin === to.origin)) {
      g.warnings.push(`edge "${e.id}": self-loops are not routed yet`)
      continue
    }
    // One port per edge end, facing the declared direction for now; the
    // ordering phase settles sides, order and cells after cycle breaking.
    linkNodes(g, e.id, from, to, { labels: (e.labels ?? []).map((l) => ({ ...l })) })
  }
  return g
}

/** A fresh port on `node`. */
export function makePort(node: LNode, id: string, side: 'N' | 'S'): LPort {
  const p: LPort = { id, node, side, order: -1, pos: -1, in: [], out: [] }
  node.ports.push(p)
  return p
}

/** A fresh edge on fresh ports, `from` south to `to` north. */
export function linkNodes(
  g: LGraph,
  id: string,
  from: LNode,
  to: LNode,
  extra: Partial<LEdge> = {},
): LEdge {
  const src = makePort(from, `${id}.s`, 'S')
  const dst = makePort(to, `${id}.t`, 'N')
  const e: LEdge = {
    id,
    origin: id,
    src,
    dst,
    reversed: false,
    weight: 1,
    minLen: 1,
    labels: [],
    route: null,
    placed: [],
    ...extra,
  }
  src.out.push(e)
  dst.in.push(e)
  g.edges.push(e)
  return e
}

/** Remove an edge, and its ports when nothing else uses them. */
export function unlinkEdge(g: LGraph, e: LEdge): void {
  g.edges.splice(g.edges.indexOf(e), 1)
  e.src.out.splice(e.src.out.indexOf(e), 1)
  e.dst.in.splice(e.dst.in.indexOf(e), 1)
  for (const p of [e.src, e.dst]) {
    if (p.in.length + p.out.length === 0) p.node.ports.splice(p.node.ports.indexOf(p), 1)
  }
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

/** The graph as the lab draws it; fields still at `-1` are left out.
 * Border nodes show as dummies inside their compound's hull. */
export function toSnapshot(g: LGraph, title: string): Snapshot {
  const nodes: SNode[] = g.nodes.map((n) => {
    const s: SNode = { id: n.id }
    if (n.parent !== undefined) s.parent = n.parent
    if (n.kind !== 'node') s.kind = 'dummy'
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
  for (const c of g.compounds) {
    const s: SNode = { id: c.id, kind: 'compound' }
    if (c.label !== undefined) s.label = c.label
    if (c.parent !== undefined) s.parent = c.parent
    const frame = frameOf(g, c.id)
    if (frame !== null) Object.assign(s, frame)
    nodes.push(s)
  }
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
