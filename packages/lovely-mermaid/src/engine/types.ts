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
  w: number
  h: number
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
}

export interface LayoutInput {
  dir: Dir
  nodes: InputNode[]
  edges: InputEdge[]
  spacing: Spacing
}

export interface PlacedLabel extends Rect {
  text: string
}

export interface LayoutResult {
  width: number
  height: number
  /** Node rectangles, absolute, in the requested direction. */
  nodes: Record<string, Rect>
  /** Per input edge: the polyline from source to target, port cell to port
   * cell, plus every label the engine found room for. */
  edges: Record<string, { route: Pt[]; labels: PlacedLabel[] }>
  warnings: string[]
}

/** Receives one snapshot after each phase, in the engine's internal frame. */
export type Trace = (snapshot: Snapshot) => void
