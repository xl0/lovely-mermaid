/**
 * The engine's public contract. Generic: no mermaid, no cells, no canvas.
 * Sizes and spacings come in as integers in whatever unit the caller uses;
 * every coordinate that comes out is an integer in the same unit.
 */
import type { Snapshot } from './snapshot.ts'

export type Dir = 'down' | 'up' | 'right' | 'left'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export type Pt = [number, number]

export interface InputNode {
  id: string
  /** shown by the lab instead of the id; layout never reads it */
  label?: string
  w: number
  h: number
  /** the compound this node belongs to */
  parent?: string
}

/**
 * A subgraph. Its frame is not a node: the engine represents it by border
 * nodes (a top and a bottom row, left and right columns) and lays out one
 * global graph, so cross-frame edges stay short and layers align. An edge
 * to a compound enters its top row, one from a compound leaves its bottom.
 */
export interface InputCompound {
  id: string
  label?: string
  parent?: string
  /** cross-axis units the top and bottom rows must offer, corners excluded
   * (the title of a vertical flow sits there) */
  titleW?: number
  /** least flow-axis extent of the frame, border rows included (a sideways
   * flow puts the title along it) */
  minSpan?: number
}

export interface InputLabel {
  text: string
  w: number
  h: number
  at: 'center' | 'tail' | 'head'
}

export interface InputEdge {
  id: string
  from: string
  to: string
  labels?: InputLabel[]
}

/**
 * Gaps in the engine's own frame (flow down): the first three are cross-axis
 * distances between boxes in one layer, by what the boxes are (a real node
 * or a long-edge dummy); `channelGap` is the number of flow-axis units kept
 * between a layer and the first / last routing track. A caller laying out
 * left-to-right passes its row gaps here, since the engine transposes.
 */
export interface Spacing {
  nodeNode: number
  nodeEdge: number
  edgeEdge: number
  channelGap: number
  /** cross-axis units between a frame's border and what is beside it */
  framePad: number
}

export interface LayoutInput {
  dir: Dir
  nodes: InputNode[]
  edges: InputEdge[]
  compounds?: InputCompound[]
  spacing: Spacing
}

/** The phases, in pipeline order; also the snapshot titles. */
export const PHASES = ['cycles', 'layers', 'split', 'order', 'place', 'route', 'labels'] as const
export type Phase = (typeof PHASES)[number]

// Per-phase knobs. The demo's lab mirrors these in its option controls
// (demo/src/lib/lab/Options.svelte) — keep the two in sync.
export interface CyclesOptions {
  strategy?: 'greedy' | 'dfs'
}
export interface LayeringOptions {
  strategy?: 'networkSimplex' | 'longestPath'
}
export interface OrderingOptions {
  /** `none` keeps declaration order (ports still get cells) */
  strategy?: 'sweep' | 'none'
  /** deterministic restart variants to keep the best of, 1..4 */
  thoroughness?: number
  /** adjacent-swap polish after the sweeps */
  greedySwitch?: boolean
}
export interface PlacementOptions {
  strategy?: 'bk' | 'networkSimplex'
}
/** no knobs yet */
export type RoutingOptions = Record<string, never>
export type LabelOptions = Record<string, never>

export interface LayoutOptions {
  /** Stop after this phase; later ones do not run and the result carries
   * whatever geometry exists (usually none). */
  until?: Phase
  cycles?: CyclesOptions
  layering?: LayeringOptions
  ordering?: OrderingOptions
  placement?: PlacementOptions
  routing?: RoutingOptions
  labels?: LabelOptions
}

export interface PlacedLabel extends Rect {
  text: string
}

export interface LayoutResult {
  width: number
  height: number
  /** Rectangles of the nodes that were placed, absolute, in the requested direction. */
  nodes: Record<string, Rect>
  /** Frames of the compounds that were placed, border cells included. */
  compounds: Record<string, Rect>
  /** Per input edge that was routed: the polyline from source to target,
   * port cell to port cell, plus every label the engine found room for. */
  edges: Record<string, { route: Pt[]; labels: PlacedLabel[] }>
  warnings: string[]
}

/** Receives one snapshot after import and after each phase, in the engine's internal frame. */
export type Trace = (snapshot: Snapshot) => void
