/**
 * Phase 5: flow-axis coordinates and routes. Routing owns the layer
 * positions because only it knows how many tracks each channel needs
 * (docs/elk-layered.md ch. 5). Skeleton: every segment that changes column
 * gets its own track; a channel is `tracks + 2·channelGap` rows, or one row
 * when everything is straight (arrowheads need a cell).
 */
import type { LEdge, LGraph, LPort } from './graph.ts'
import type { InputLabel, PlacedLabel, Pt } from './types.ts'

export function routeEdges(g: LGraph): { width: number; height: number } {
  const L = g.layers.length
  const bandH = g.layers.map((row) => Math.max(1, ...row.map((n) => n.h)))
  const col = (p: LPort): number => p.node.x + p.pos
  // Pass 1: tracks per channel, band tops.
  const track = new Map<LEdge, number>()
  const tracks: number[] = []
  const top: number[] = []
  let y = 0
  for (let l = 0; l < L; l++) {
    top.push(y)
    y += bandH[l]
    if (l + 1 === L) break
    let t = 0
    for (const n of g.layers[l]) {
      for (const p of n.ports) {
        for (const e of p.out) if (col(e.src) !== col(e.dst)) track.set(e, t++)
      }
    }
    tracks.push(t)
    y += t === 0 ? 1 : t + 2 * g.spacing.channelGap
  }
  const height = y
  // Pass 2: node rows and routes. A dummy spans its whole band.
  g.layers.forEach((row, l) => {
    for (const n of row) n.y = top[l]
  })
  const portRow = (p: LPort): number => {
    const n = p.node
    const h = n.kind === 'dummy' ? bandH[n.layer] : n.h
    return p.side === 'N' ? n.y : n.y + h - 1
  }
  for (const e of g.edges) {
    const cs = col(e.src)
    const cd = col(e.dst)
    const rs = portRow(e.src)
    const rd = portRow(e.dst)
    const t = track.get(e)
    if (t === undefined)
      e.route = [
        [cs, rs],
        [cs, rd],
      ]
    else {
      const l = e.src.node.layer
      const r = top[l] + bandH[l] + g.spacing.channelGap + t
      e.route = [
        [cs, rs],
        [cs, r],
        [cd, r],
        [cd, rd],
      ]
    }
  }
  const width = Math.max(1, ...g.nodes.map((n) => n.x + n.w))
  return { width, height }
}

/**
 * The polyline of each input edge: its segments concatenated in flow order
 * and, for a reversed edge, read backwards so it runs from the original
 * source to the original target.
 */
export function joinRoutes(g: LGraph): Map<string, Pt[]> {
  const chains = new Map<string, LEdge[]>()
  for (const e of g.edges) {
    const list = chains.get(e.origin)
    if (list === undefined) chains.set(e.origin, [e])
    else list.push(e)
  }
  const out = new Map<string, Pt[]>()
  for (const [origin, segs] of chains) {
    segs.sort((a, b) => a.src.node.layer - b.src.node.layer)
    const pts: Pt[] = []
    for (const s of segs) {
      for (const p of s.route ?? []) {
        const last = pts[pts.length - 1]
        if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) pts.push(p)
      }
    }
    if (segs[0].reversed) pts.reverse()
    out.set(origin, pts)
  }
  return out
}

/**
 * Center labels on their own route: over the longest horizontal run when it
 * fits, else beside the longest vertical run. Placeholder for the label
 * phase; it never checks what else is there.
 */
export function placeLabels(g: LGraph, routes: Map<string, Pt[]>): Map<string, PlacedLabel[]> {
  const out = new Map<string, PlacedLabel[]>()
  for (const e of g.edges) {
    const label = e.labels.find((l): l is InputLabel => l.at === 'center')
    const route = routes.get(e.origin)
    if (label === undefined || route === undefined || route.length < 2) continue
    let best: { len: number; horizontal: boolean; a: Pt; b: Pt } | null = null
    for (let i = 0; i + 1 < route.length; i++) {
      const a = route[i]
      const b = route[i + 1]
      const horizontal = a[1] === b[1]
      const len = horizontal ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1])
      const fits = horizontal ? len >= label.w + 2 : len >= label.h + 2
      const score = len + (fits ? 1000 : 0) + (horizontal ? 1 : 0)
      if (best === null || score > best.len) best = { len: score, horizontal, a, b }
    }
    if (best === null) continue
    const mid: Pt = [
      Math.floor((best.a[0] + best.b[0]) / 2),
      Math.floor((best.a[1] + best.b[1]) / 2),
    ]
    const rect = best.horizontal
      ? { x: mid[0] - Math.floor(label.w / 2), y: mid[1], w: label.w, h: label.h }
      : { x: mid[0] + 1, y: mid[1], w: label.w, h: label.h }
    out.set(e.origin, [{ ...rect, text: label.text }])
  }
  return out
}
