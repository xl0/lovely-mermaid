/**
 * Post-export label placement: runs once on the finished result, in its
 * final orientation — text is horizontal, so "a horizontal run" is a
 * property of the rendered picture, not of the engine's internal
 * flow-down frame. Labels never move geometry: they go into whitespace
 * the layout already pays for — reserved ahead of time for diagrams
 * that carry end labels, opportunistic everywhere else.
 *
 * The ladder for a centre label — lowest score wins, score = tier base
 * + distance from the edge's source along the route (a run is scanned
 * from its source end, sliding to the first clear spot):
 *   1. embedded in a horizontal run — the text interrupts its own line;
 *   2. beside a horizontal run — above, or below at a whisker more,
 *      overhanging an end only where the bend turns away;
 *   3. beside a vertical run, touching its column (the rail look);
 *   4. a block interrupting a vertical run, centred on its column or
 *      flush with it when the centre is crowded.
 * Text is bare (the caller measures no padding) and may sit tight
 * against its own line, nodes, kinks and arrowheads (soft nudges keep
 * a cell of line before mid-route kinks and crossings); what it must
 * never do is TOUCH a foreign edge — that is ambiguous. Exceptions,
 * where its own line or uniformity disambiguates: a horizontal-run
 * interrupt and a card at its port pay a penalty anywhere ('all');
 * text beside or interrupting its own run may sit between bus rows
 * but never against a line at its text ends ('band'). Floating
 * bodies stay strict in all directions ('none') — anything they
 * could touch, the label itself could have touched from its run.
 *
 * Head/tail labels (ER cardinalities) sit beside the line right at
 * their port — port proximity dominates their cost — else embed on
 * the end run; their misses warn and drop. One edge's labels form a
 * rail that may stack touching vertically; a horizontal moat keeps
 * text from concatenating. Diagrams whose edges carry end labels
 * have their room RESERVED up front (per-port pitch and channelMin —
 * see graph.ts and the caller).
 *
 * A centre label the ladder cannot seat falls through, never to a
 * warning: a `[n]` marker embeds on the edge (the small shape fits
 * where the label did not) and the body floats in dead space within
 * FLOAT_R of it (`res.floats`); with no space even for that, the label
 * joins `res.legend` — still `[n]`-keyed while the marker stands, or
 * endpoint-keyed when not even a marker fits (tight sideways layouts).
 */
import type { InputEdge, LayoutResult, Pt } from './types.ts'

/** tier bases: larger than any route distance, so the tier dominates */
const TIER = 10_000
/** embedded text touching a foreign edge (1-cell gap instead of 2) */
const TOUCH = 200
/** soft nudges: text hugging a kink of its own run, or sitting right
 * against a crossing — when spacing allows, keep a cell of line */
const HUG = 2
const CROSS = 4
/** wide text bodies (centre labels, markers, floats) keep their
 * horizontal distance from each other: 2 cells hard, 4 preferred —
 * two texts on one row with less between them read as one */
const NEAR = 8
/** route cells kept clear at each end: the port cell and the arrowhead */
const RESERVE = 2
/** how far from its marker a floating body may sit; beyond it the
 * label reads better in the legend than in some distant corner */
const FLOAT_R = 12

/** A maximal straight piece of a route, collinear joints merged. */
interface Run {
  sx: number
  sy: number
  tx: number
  ty: number
  /** route cells between the edge's source and this run's source end */
  cum: number
}

const short = (t: string): string => (t.length > 24 ? `${t.slice(0, 23)}…` : t)

/** Place every edge label of `edges` into `res` (mutating `edges[].labels`
 * and `warnings`). Geometry is untouched: nodes, borders, other edges and
 * earlier labels are obstacles, spacing per the rules above. */
export function placeEdgeLabels(res: LayoutResult, edges: InputEdge[]): void {
  const todo = edges.filter((e) => (e.labels?.length ?? 0) > 0 && res.edges[e.id] !== undefined)
  const W = res.width
  const H = res.height
  if (todo.length === 0 || W <= 0 || H <= 0) return
  const at = (x: number, y: number): number => y * W + x
  // hard obstacles: node cells and compound border cells (a frame's
  // interior stays usable by the edges routed inside it); placed labels
  // join with a 1-cell moat
  const solid = new Uint8Array(W * H)
  const mark = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) solid[at(x, y)] = 1
  }
  /** rows within 4 cells left/right of a wide text body — candidates
   * here pay the NEAR nudge */
  const near = new Uint8Array(W * H)
  const markNear = (x: number, y: number, w: number, h: number): void => {
    for (let yy = Math.max(0, y); yy <= Math.min(H - 1, y + h - 1); yy++)
      for (let xx = Math.max(0, x - 4); xx <= Math.min(W - 1, x + w + 3); xx++) near[at(xx, yy)] = 1
  }
  for (const r of Object.values(res.nodes)) mark(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1)
  for (const r of Object.values(res.compounds)) {
    mark(r.x, r.y, r.x + r.w - 1, r.y)
    mark(r.x, r.y + r.h - 1, r.x + r.w - 1, r.y + r.h - 1)
    mark(r.x, r.y, r.x, r.y + r.h - 1)
    mark(r.x + r.w - 1, r.y, r.x + r.w - 1, r.y + r.h - 1)
  }
  // how many distinct edges run through each cell, and each edge's cells
  const cellsOf = (route: Pt[]): Set<number> => {
    const out = new Set<number>()
    for (let i = 1; i < route.length; i++) {
      const [ax, ay] = route[i - 1]
      const [bx, by] = route[i]
      for (let x = Math.max(0, Math.min(ax, bx)); x <= Math.min(W - 1, Math.max(ax, bx)); x++)
        for (let y = Math.max(0, Math.min(ay, by)); y <= Math.min(H - 1, Math.max(ay, by)); y++)
          out.add(at(x, y))
    }
    return out
  }
  const count = new Uint8Array(W * H)
  const own = new Map<string, Set<number>>()
  for (const [id, e] of Object.entries(res.edges)) {
    if (e.route.length < 2) continue
    const cells = cellsOf(e.route)
    own.set(id, cells)
    for (const c of cells) if (count[c] < 255) count[c]++
  }
  /** innermost frame holding a rect, `-1` for the top level */
  const frames = Object.values(res.compounds)
  const regionAt = (x: number, y: number, w: number, h: number): number => {
    let best = -1
    for (let i = 0; i < frames.length; i++) {
      const r = frames[i]
      if (x < r.x || x + w > r.x + r.w || y < r.y || y + h > r.y + r.h) continue
      if (best === -1 || r.w * r.h < frames[best].w * frames[best].h) best = i
    }
    return best
  }
  /** the next provisional `[n]` marker number; `renumber` below restarts
   * the sequence per self-contained frame once everything has landed */
  let nextN = 1
  interface Pair {
    prov: number
    marker: { text: string; w: number }
    float?: { n: number; w: number }
    legend?: { n?: number }
    /** marker's region, body's region (`-2` when the pair has no body) */
    mr: number
    br: number
  }
  const pairs: Pair[] = []

  for (const ie of todo) {
    const er = res.edges[ie.id]
    if (er.route.length < 2) continue
    const mine = own.get(ie.id) as Set<number>
    // merge collinear joints (joined routes and stack stubs leave
    // midpoints); a label may span them
    const runs: Run[] = []
    let cum = 0
    for (let i = 1; i < er.route.length; i++) {
      const [ax, ay] = er.route[i - 1]
      const [bx, by] = er.route[i]
      const len = Math.abs(bx - ax) + Math.abs(by - ay)
      if (len === 0) continue
      const p = runs[runs.length - 1]
      if (
        p !== undefined &&
        Math.sign(bx - ax) === Math.sign(p.tx - p.sx) &&
        Math.sign(by - ay) === Math.sign(p.ty - p.sy)
      ) {
        p.tx = bx
        p.ty = by
      } else runs.push({ sx: ax, sy: ay, tx: bx, ty: by, cum })
      cum += len
    }
    if (runs.length === 0) continue
    const first = runs[0]
    const last = runs[runs.length - 1]

    /** Can `w`×`h` text sit at `x,y`? `cover` holds the cells of the
     * annotated run the text may overwrite (null = off-line: it may
     * cover no edge cell at all). Text touching a foreign edge is
     * ambiguous — fatal under `'none'`; `'band'` charges a penalty for
     * a line above/below but stays fatal against the text ends (it
     * would read as part of the word); `'all'` charges the penalty
     * everywhere (a horizontal-run interrupt, a card at its port).
     * Returns the penalty, or null. */
    const probe = (
      x: number,
      y: number,
      w: number,
      h: number,
      cover: Set<number> | null,
      touch: 'none' | 'band' | 'all',
    ): number | null => {
      if (x < 0 || y < 0 || x + w > W || y + h > H) return null
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          const c = at(xx, yy)
          if (solid[c] !== 0) return null
          // count > 1 on an own cell: another edge crosses right here
          if (count[c] > 0 && (cover === null || !cover.has(c) || count[c] > 1)) return null
        }
      // the 1-ring: a foreign edge cell here means the text would touch
      // it (own edge exempt — sitting tight against your own line is
      // what embedding is); an own-run cell where another edge crosses
      // is a soft nudge to leave the crossing a cell of line
      let pay = 0
      let cross = 0
      let crowd = 0
      for (let yy = y; yy < y + h && crowd === 0; yy++)
        for (let xx = x; xx < x + w; xx++)
          if (near[at(xx, yy)] !== 0) {
            crowd = NEAR
            break
          }
      for (let yy = y - 1; yy <= y + h; yy++)
        for (let xx = x - 1; xx <= x + w; xx++) {
          if (yy >= y && yy < y + h && xx >= x && xx < x + w) continue
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
          const c = at(xx, yy)
          if (count[c] > 0 && !mine.has(c)) {
            const flank = yy >= y && yy < y + h
            if (touch === 'none' || (touch === 'band' && flank)) return null
            pay = TOUCH
          }
          if (cover?.has(c) === true && count[c] > 1) cross = CROSS
        }
      return pay + cross + crowd
    }
    /** The run's usable interior along its axis: endpoints (bends and
     * port cells) excluded, plus the route-end reserves on the first
     * and last run. */
    const spanOf = (r: Run): [number, number] | null => {
      const horiz = r.sy === r.ty
      const [a, b] = horiz ? [r.sx, r.tx] : [r.sy, r.ty]
      let lo = Math.min(a, b) + 1
      let hi = Math.max(a, b) - 1
      if (r === first) {
        if (a < b) lo += RESERVE - 1
        else hi -= RESERVE - 1
      }
      if (r === last) {
        if (a < b) hi -= RESERVE - 1
        else lo += RESERVE - 1
      }
      return lo > hi ? null : [lo, hi]
    }
    const coverOf = (r: Run): Set<number> => {
      const out = new Set<number>()
      for (let x = Math.min(r.sx, r.tx); x <= Math.max(r.sx, r.tx); x++)
        for (let y = Math.min(r.sy, r.ty); y <= Math.max(r.sy, r.ty); y++) out.add(at(x, y))
      return out
    }

    interface Spot {
      x: number
      y: number
      /** the shape that won — tier 1 may take a flat shape while the
       * other tiers place the wrapped block */
      w: number
      h: number
      cost: number
    }
    let best: Spot | null = null
    // reads go through a closure: `consider` mutates `best` behind the
    // control flow, which in-line narrowing cannot see
    const bestCost = (): number => (best === null ? Number.POSITIVE_INFINITY : best.cost)
    const consider = (
      x: number,
      y: number,
      w: number,
      h: number,
      base: number,
      cover: Set<number> | null,
      touch: 'none' | 'band' | 'all' = 'none',
    ): void => {
      if (best !== null && base >= best.cost) return
      const t = probe(x, y, w, h, cover, touch)
      if (t !== null && (best === null || base + t < best.cost))
        best = { x, y, w, h, cost: base + t }
    }
    /** where text may sit across its vertical run: centred on the
     * column, or flush against it either way when a neighbour crowds
     * the centre (the sketch: `Label` starting at the line) */
    const anchors = (col: number, w: number): number[] => [
      ...new Set([col - (w >> 1), col, col - w + 1]),
    ]

    const tryCenter = (l: {
      w: number
      h: number
      tall?: { w: number; h: number }
    }): Spot | null => {
      best = null
      const { w, h } = l
      // tier 1: embedded in a horizontal run, one line of text
      if (h === 1)
        for (const r of runs) {
          if (r.sy !== r.ty) continue
          const s = spanOf(r)
          if (s === null) continue
          const cov = coverOf(r)
          // hugging a mid-route kink is nudged a cell away (route ends
          // are exempt — text may sit close to the node)
          const srcAtLo = r.sx < r.tx
          const loKink = !(r === first && srcAtLo) && !(r === last && !srcAtLo)
          const hiKink = !(r === first && !srcAtLo) && !(r === last && srcAtLo)
          for (let off = 0; s[0] + off + w - 1 <= s[1]; off++) {
            if (r.cum + off >= bestCost()) break
            const xs = srcAtLo ? s[0] + off : s[1] - w + 1 - off
            const hug =
              (loKink && xs === s[0] ? HUG : 0) + (hiKink && xs + w - 1 === s[1] ? HUG : 0)
            consider(xs, r.sy, w, 1, r.cum + off + hug, cov, 'all')
          }
        }
      // tier 2: one line interrupting a vertical run — on the line
      // reads best, so this outranks every beside placement. The text
      // gravitates to centre over the column but may slide anywhere
      // that keeps a character on the line, nudged off-centre by
      // whatever crowds it (each cell off-centre costs one)
      if (h === 1)
        for (const r of runs) {
          if (r.sx !== r.tx) continue
          const s = spanOf(r)
          if (s === null) continue
          const cov = coverOf(r)
          const srcAtLo = r.sy < r.ty
          const loKink = !(r === first && srcAtLo) && !(r === last && !srcAtLo)
          const hiKink = !(r === first && !srcAtLo) && !(r === last && srcAtLo)
          const c = r.sx - (w >> 1)
          for (let off = 0; s[0] + off <= s[1]; off++) {
            if (TIER + r.cum + off >= bestCost()) break
            const ys = srcAtLo ? s[0] + off : s[1] - off
            const hug = (loKink && ys === s[0] ? HUG : 0) + (hiKink && ys === s[1] ? HUG : 0)
            for (let xs = r.sx - w + 1; xs <= r.sx; xs++) {
              consider(xs, ys, w, 1, TIER + r.cum + off + hug + Math.abs(xs - c), cov, 'band')
            }
          }
        }
      // tier 3: beside a horizontal run — a little overlap anchors it.
      // Strict about foreign edges: text sitting directly over/under
      // ANOTHER horizontal run reads as belonging to it
      for (const r of runs) {
        if (r.sy !== r.ty) continue
        const lo = Math.min(r.sx, r.tx)
        const hi = Math.max(r.sx, r.tx)
        const minOv = Math.min(hi - lo + 1, w, 2)
        for (const [bias, ys] of [
          [0, r.sy - h],
          [1, r.sy + 1],
        ] as const) {
          for (let xs = lo - w + minOv; xs <= hi - minOv + 1; xs++) {
            const base = 2 * TIER + r.cum + Math.abs(xs + (w >> 1) - r.sx) + bias
            consider(xs, ys, w, h, base, null)
          }
        }
      }
      // tier 4: beside a vertical run, touching its column — the
      // hard-wrapped tall shape when the label has one (`│this label`
      // down the line); over-the-line flat placements all live in
      // tier 2's centre-gravity slide
      const tw = l.tall?.w ?? w
      const th = l.tall?.h ?? h
      for (const r of runs) {
        if (r.sx !== r.tx) continue
        const s = spanOf(r)
        if (s === null) continue
        for (let off = 0; s[0] + off + th - 1 <= s[1]; off++) {
          if (3 * TIER + r.cum + off >= bestCost()) break
          const ys = r.sy < r.ty ? s[0] + off : s[1] - th + 1 - off
          consider(r.sx + 1, ys, tw, th, 3 * TIER + r.cum + off, null, 'band')
          consider(r.sx - tw, ys, tw, th, 3 * TIER + r.cum + off + 1, null, 'band')
        }
      }
      return best
    }

    const tryEnd = (which: 'tail' | 'head', w: number, h: number): Spot | null => {
      const r = which === 'tail' ? first : last
      const horiz = r.sy === r.ty
      best = null
      // beside the end run first, right at the port. Staying AT the
      // port outweighs everything — a hub's fan must read as one tidy
      // row of cards, each right of its line, so a touching port-row
      // spot (uniform placement disambiguates it) beats a clean spot
      // further in, and the right side is preferred over a clean left.
      const px = which === 'tail' ? r.sx : r.tx
      const py = which === 'tail' ? r.sy : r.ty
      if (horiz) {
        const inward = which === 'tail' ? Math.sign(r.tx - r.sx) : Math.sign(r.sx - r.tx)
        const xs = inward > 0 ? px + 1 : px - w
        consider(xs, py - h, w, h, 0, null, 'all')
        consider(xs, py + 1, w, h, 2 * TOUCH, null, 'all')
      } else {
        const len = Math.abs(r.ty - r.sy)
        const inward = which === 'tail' ? Math.sign(r.ty - r.sy) : Math.sign(r.sy - r.ty)
        for (let off = 0; off + h <= len && 5 * TOUCH * off < bestCost(); off++) {
          const ys = inward > 0 ? py + 1 + off : py - h - off
          consider(px + 1, ys, w, h, 5 * TOUCH * off, null, 'all')
          consider(px - w, ys, w, h, 5 * TOUCH * off + 2 * TOUCH, null, 'all')
        }
      }
      if (best !== null) return best
      // else embedded on the end run, nearest the node
      const s = spanOf(r)
      if (s !== null && (!horiz || h === 1)) {
        const cov = coverOf(r)
        const [a, b] = horiz ? [r.sx, r.tx] : [r.sy, r.ty]
        const endAtLo = (which === 'tail') === a < b
        const size = horiz ? w : h
        for (let off = 0; s[0] + off + size - 1 <= s[1]; off++) {
          if (off >= bestCost()) break
          const pos = endAtLo ? s[0] + off : s[1] - size + 1 - off
          if (horiz) consider(pos, r.sy, w, h, off, cov, 'all')
          else
            anchors(r.sx, w).forEach((xs, ai) => {
              consider(xs, pos, w, h, off + ai, cov, 'band')
            })
        }
      }
      return best
    }

    /** Dead space for a floating body: the nearest clear rect within
     * FLOAT_R of the marker (first of equals in y, x — deterministic).
     * A body may nestle between bus rows, touching them — the `[n]`
     * bracket keeps it unambiguous — but a clean spot always wins. */
    const spiral = (m: Spot, w: number, h: number): Pt | null => {
      // the body prefers the marker's own region: the innermost frame
      // holding it, or the top level. When that is packed, the fallback
      // climbs the ANCESTOR frames, each a step costlier; a foreign
      // frame (or one nested deeper) never takes a body — a float
      // inside it would read as part of it
      const chain = frames
        .map((_, i) => i)
        .filter((i) => {
          const r = frames[i]
          return m.x >= r.x && m.x + m.w <= r.x + r.w && m.y >= r.y && m.y + 1 <= r.y + r.h
        })
        .sort((a, b) => frames[a].w * frames[a].h - frames[b].w * frames[b].h)
      let bc = Number.POSITIVE_INFINITY
      let bx = 0
      let by = 0
      for (let y = m.y - h - 2 * FLOAT_R; y <= m.y + 1 + 2 * FLOAT_R; y++)
        for (let x = m.x - w - 2 * FLOAT_R; x <= m.x + m.w + 2 * FLOAT_R; x++) {
          // cells strictly between the body and the marker, per axis,
          // ranked by their SUM — a diagonal spot across a box reads
          // farther than the same gap straight up. The region ladder is
          // lexicographic: ANY spot in the marker's own region beats
          // any parent spot beats any escape to the top — and a framed
          // spot gets twice the leash (staying inside is worth a walk)
          const gx = x >= m.x + m.w ? x - (m.x + m.w) : x + w <= m.x ? m.x - (x + w) : 0
          const gy = y >= m.y + 1 ? y - (m.y + 1) : y + h <= m.y ? m.y - (y + h) : 0
          const d = gx + gy
          if (d < 1) continue
          const bi = regionAt(x, y, w, h)
          let step: number
          if (bi === (chain[0] ?? -1)) step = 0
          else if (bi === -1) step = chain.length
          else {
            const k = chain.indexOf(bi)
            if (k < 0) continue
            step = k
          }
          const escaped = bi === -1 && chain.length > 0
          if (Math.max(gx, gy) > (escaped ? FLOAT_R : 2 * FLOAT_R)) continue
          // reading order: right of and below the marker is the
          // natural continuation — anywhere else pays once (a corner
          // is no worse than a side; distance decides the rest)
          const side = x < m.x || y + h <= m.y ? 16 : 0
          // stacked floats read as one list — align the left edges
          let mis = 0
          for (const q of res.floats ?? []) {
            const vg = y >= q.y + q.h ? y - (q.y + q.h) : q.y >= y + h ? q.y - (y + h) : -1
            if (vg < 0 || vg > 1 || x >= q.x + q.w || q.x >= x + w) continue
            if (x === q.x) {
              mis = 0
              break
            }
            mis = 6
          }
          const out = step * 100 + side + mis
          if (d + out >= bc) continue
          const t = probe(x, y, w, h, null, 'none')
          if (t === null || d + out + t >= bc) continue
          bc = d + out + t
          bx = x
          by = y
        }
      return bc === Number.POSITIVE_INFINITY ? null : [bx, by]
    }

    // labels of ONE edge form a rail and may STACK touching (the
    // sketch: card, verb, card down the line) — while the edge is being
    // annotated its labels carry only a horizontal moat (side-by-side
    // text would read as one word: "1variant"); the full 1-cell moat
    // against other edges' labels lands once the edge is done
    const placedHere: { x: number; y: number; w: number; h: number }[] = []
    const place = (spot: Spot, text: string, spread: boolean): void => {
      er.labels.push({ text, x: spot.x, y: spot.y, w: spot.w, h: spot.h })
      const hx = spread ? 2 : 1
      mark(spot.x - hx, spot.y, spot.x + spot.w + hx - 1, spot.y + spot.h - 1)
      if (spread) markNear(spot.x, spot.y, spot.w, spot.h)
      placedHere.push({ x: spot.x, y: spot.y, w: spot.w, h: spot.h })
    }
    for (const l of ie.labels ?? []) {
      if (l.at !== 'center') {
        const spot = tryEnd(l.at, l.w, l.h)
        if (spot === null)
          res.warnings.push(`edge "${ie.id}": no room for its ${l.at} label "${short(l.text)}"`)
        else place(spot, l.text, false)
        continue
      }
      const spot = tryCenter(l)
      if (spot !== null) {
        place(spot, l.text, true)
        continue
      }
      // the ladder failed: marker + float, marker + legend, or legend
      // keyed by the edge's endpoints when not even a marker fits
      const tag = `[${nextN}]`
      const m = tryCenter({ w: tag.length, h: 1 })
      if (m === null) {
        res.legend = [...(res.legend ?? []), { edge: ie.id, text: l.text }]
        continue
      }
      const n = nextN++
      place(m, tag, true)
      const markerRef = er.labels[er.labels.length - 1]
      const mr = regionAt(m.x, m.y, m.w, 1)
      const pre = tag.length + 1
      const shape = l.block ?? { w: l.w, h: l.h }
      const body = spiral(m, pre + shape.w, shape.h)
      if (body === null) {
        const entry = { n, edge: ie.id, text: l.text }
        res.legend = [...(res.legend ?? []), entry]
        pairs.push({ prov: n, marker: markerRef, legend: entry, mr, br: -2 })
      } else {
        const f = {
          n,
          edge: ie.id,
          text: l.text,
          x: body[0],
          y: body[1],
          w: pre + shape.w,
          h: shape.h,
        }
        res.floats = [...(res.floats ?? []), f]
        pairs.push({ prov: n, marker: markerRef, float: f, mr, br: regionAt(f.x, f.y, f.w, f.h) })
        // floats keep only a horizontal moat for good: bodies of later
        // edges may stack right below (an aligned list of floats reads
        // well); the sideways gap still guards the text ends
        mark(f.x - 2, f.y, f.x + f.w + 1, f.y + f.h - 1)
        markNear(f.x, f.y, f.w, f.h)
      }
    }
    for (const q of placedHere) mark(q.x - 1, q.y - 1, q.x + q.w, q.y + q.h)
  }
  // Marker numbers restart per SELF-CONTAINED frame (user's call): a
  // frame whose float pairs all stayed inside, took no other region's
  // body and holds no legend-keyed marker shows its own 1..k; every
  // other pair shares one global sequence, which by construction never
  // appears inside such a frame. Numbers only ever shrink, so the
  // placed rects stay valid (widths adjusted along).
  if (pairs.length > 0) {
    const bad = new Set<number>()
    for (const p of pairs) {
      if (p.legend !== undefined) bad.add(p.mr)
      else if (p.br !== p.mr) {
        bad.add(p.mr)
        bad.add(p.br)
      }
    }
    const counters = new Map<number, number>()
    for (const p of pairs) {
      const local = p.float !== undefined && p.mr === p.br && p.mr >= 0 && !bad.has(p.mr)
      const scope = local ? p.mr : -1
      const n = (counters.get(scope) ?? 0) + 1
      counters.set(scope, n)
      if (n === p.prov) continue
      const tag = `[${n}]`
      const shrink = p.marker.text.length - tag.length
      p.marker.text = tag
      p.marker.w = tag.length
      if (p.float !== undefined) {
        p.float.n = n
        p.float.w -= shrink
      }
      if (p.legend !== undefined) p.legend.n = n
    }
  }
}
