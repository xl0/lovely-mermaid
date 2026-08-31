/**
 * A picture of a layered layout in progress: what the engine emits after
 * each phase (`Trace`), and what the demo's /lab draws. Unit-agnostic
 * integers — cells for the terminal, px for anything else.
 *
 * Every geometric field is optional so one format covers every phase:
 * missing `layer` → parked beside the picture, missing `order` →
 * declaration order, missing `x`/`y` → slot grid on that axis, missing
 * `route` → a straight line between the boxes. Snapshots are in the
 * engine's internal frame (flow down), before any direction transform.
 */
export interface Snapshot {
  /** Shown as the picture's title — the phase name. */
  title?: string
  /** flow direction of the picture; the lab bands along it (default down) */
  dir?: 'down' | 'up' | 'right' | 'left'
  nodes: SNode[]
  edges: SEdge[]
}

export interface SNode {
  id: string
  /** Default: the id. Dummies show no label. */
  label?: string
  kind?: 'node' | 'dummy' | 'compound'
  /** Enclosing compound node. */
  parent?: string
  /** Size in units; a missing size is a point (dummies). */
  w?: number
  h?: number
  layer?: number
  /** Position within the layer. */
  order?: number
  /** Top-left corner. A compound without one is drawn as its children's hull. */
  x?: number
  y?: number
  ports?: SPort[]
}

/**
 * An attachment point in layout space (flow is down): a cell of the node's
 * border on `side` — a route starts or ends there (the drawer puts the tee
 * in that cell and the head in the one before it).
 */
export interface SPort {
  id: string
  side: 'N' | 'S' | 'E' | 'W'
  /** Offset along the side from its start (left end of N/S, top end of E/W).
   * Missing → the side's ports spread evenly, in `order`. */
  pos?: number
  order?: number
}

export type Pt = [number, number]

export interface SEdge {
  from: string
  to: string
  /** Port ids on `from` / `to`; without one the edge attaches to the facing side. */
  fromPort?: string
  toPort?: string
  /** Stored in layout direction (from above to below); the arrow belongs at `from`. */
  reversed?: boolean
  /** Polyline in units, endpoints on the port cells. */
  route?: Pt[]
  label?: { text: string; x?: number; y?: number; w?: number; h?: number }
}
