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
 * A subgraph. Its members are laid out on their own and the frame takes
 * part in the parent's layout as one node; an edge crossing the frame is
 * cut at a port on the border and routed on both sides. An edge to the
 * compound itself attaches to the frame.
 */
export interface InputCompound {
  id: string
  label?: string
  parent?: string
  /** units the title needs on the frame's top row, corners excluded */
  titleW?: number
  /** flow direction override, honoured only when no edge crosses the
   * frame and the whole layout flows down or right */
  dir?: 'down' | 'right'
}

export interface InputLabel {
  text: string
  /** the flat single-line shape — what most placements use */
  w: number
  h: number
  /** hard-wrapped narrow block, used beside a vertical run where the
   * lines hang off the column (`│this label` / `│wraps like` …) */
  tall?: { w: number; h: number }
  /** balanced block for a floating body */
  block?: { w: number; h: number }
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
  /** minimum flow-axis rows per channel, even when every edge is
   * straight — a caller whose edges carry rail annotations (ER
   * cardinalities + verb beside the line) reserves their room here */
  channelMin?: number
}

export interface LayoutInput {
  dir: Dir
  nodes: InputNode[]
  edges: InputEdge[]
  compounds?: InputCompound[]
  spacing: Spacing
  /** the other axis's spacing profile, used inside compounds whose `dir`
   * turns them against the main flow */
  altSpacing?: Spacing
}

/** The phases, in pipeline order; also the snapshot titles. */
export const PHASES = ['cycles', 'layers', 'split', 'order', 'place', 'route', 'labels'] as const
export type Phase = (typeof PHASES)[number]

// Per-phase knobs. The demo's lab mirrors these in its option controls
// (demo/src/lib/lab/Options.svelte) — keep the two in sync.
export interface CyclesOptions {
  /** `greedy2` is greedy with stalemate ties broken from the last
   * declared node instead of the first — a cheap diversity source the
   * loop exploits (it sole-wins some graphs) */
  strategy?: 'greedy' | 'dfs' | 'greedy2'
}
export interface LayeringOptions {
  strategy?: 'networkSimplex' | 'longestPath'
  /** stagger a row wider than this (estimated rendered row width, in
   * units) into two layers — trades height for width; off when absent */
  maxWidth?: number
  /** packing may fill rows up to this budget (a fit target); defaults to
   * never exceeding the current widest row */
  packWidth?: number
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
  /** `ns2` is networkSimplex with flat edge weights (4/2/1 instead of
   * 32/8/4): long chains bend more readily, which packs some graphs
   * tighter */
  strategy?: 'bk' | 'networkSimplex' | 'ns2'
  /** break equal-width candidate ties by the rows' summed extents (set on
   * the root level; inner levels stay stable so frame ports do not move
   * between equally narrow inner picks) */
  compactTies?: boolean
}
/** no knobs yet */
export type RoutingOptions = Record<string, never>
export type LabelOptions = Record<string, never>

export interface LayoutOptions {
  /** Stop after this phase; later ones do not run and the result carries
   * whatever geometry exists (usually none). */
  until?: Phase
  /** geometry feedback: after a full pass, re-pack the root layers
   * against the *measured* band extents toward this width and re-run the
   * later phases (kept only when the measured result does not regress) */
  squeeze?: number
  /** most squeeze iterations to attempt (default 12); the loop probes
   * with a small budget and gives the winner the full one */
  squeezeBudget?: number
  /** when the squeeze target is unreachable, keep packing toward the
   * width already paid: admission follows the measured width instead of
   * the target (the accept guard still ratchets width down) */
  squeezeLoose?: boolean
  /** hybrid flow: fold chains of single-in/single-out nodes into one
   * band, the members stacked along the cross axis — trades cross
   * extent for flow extent. In `layout` a `true` stacks unconditionally;
   * in the candidate loop it only widens the stacked probes — a stacked
   * candidate still has to win the metric, so stacking can never cost
   * the constrained axis. `false` disables the probes. */
  stackChains?: boolean
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
  /** Labels that fit nowhere on their edge but found dead space nearby:
   * a `[n]` marker sits on the edge (in its `labels`) and the body —
   * the marker prefix plus the wrapped text — floats at this rect. */
  floats?: { n: number; edge: string; text: string; x: number; y: number; w: number; h: number }[]
  /** Labels with no room even for a float: the caller renders these
   * above the diagram. `n` ties an entry to its `[n]` marker; an entry
   * without one names its edge's endpoints instead. */
  legend?: { n?: number; edge: string; text: string }[]
  warnings: string[]
  /** squeeze iterations that were kept, when geometry feedback ran */
  squeezed?: number
}

/** Receives one snapshot after import and after each phase, in the engine's internal frame. */
export type Trace = (snapshot: Snapshot) => void

/** What `layoutBest` aims for. */
export interface FitOptions {
  /** target cross-axis extent in the caller's units (a terminal's columns
   * for a vertical flow); absent = just minimize */
  width?: number
  /** most layouts to try (default 16) */
  budget?: number
}

/** One layout the candidate loop tried. */
export interface Candidate {
  label: string
  opts: LayoutOptions
  width: number
  height: number
  /** against `FitOptions.width`; absent when no target was given */
  fits?: boolean
}
