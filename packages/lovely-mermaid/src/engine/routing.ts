/**
 * Phase 5: edge routing. Routing owns the flow-axis coordinates: a channel
 * between two layers is as tall as the tracks it needs, so band positions
 * follow from the track counts (docs/elk-layered.md ch. 5).
 *
 * Per channel, ELK's orthogonal router in integer cells: every edge is a
 * vertical stub from its source cell down to a horizontal *trunk* on a
 * track row, along the trunk to its target column, and a stub down into
 * the target cell. Edges leaving one cell share a trunk (a fan-out bus
 * with junctions); edges entering one cell merge in its column. Two trunks
 * with overlapping column extents
 * depend on each other: the order with fewer stub/trunk crossings is
 * preferred, and an order where a stub of one would run down the same
 * column as a stub of the other is forbidden (they would merge into one
 * line). A pair forbidden both ways — the X between neighbours — is
 * resolved as ELK does, by splitting one trunk in two joined by a jog
 * through a free column. Remaining cycles are broken greedily, tracks are
 * longest paths over the dependencies, straight edges take no track.
 *
 * Before any of that, the long-edge chains are *relaxed*: placement's
 * dummy coordinates fix which gap an edge crosses in each layer, not the
 * exact column, so each chain slides within the slack its neighbours
 * leave and takes the fewest columns its gaps allow. Port dummies join
 * in as one-cell chains anchored on their single inner endpoint, so a
 * frame's ports spread out over what they connect to instead of bunching
 * at the border's left — their pinned order is slack's boundary.
 *
 * Phase 6, labels, is still a pass-through. `joinRoutes` is plumbing.
 */
import type { LEdge, LGraph, LNode, LPort } from './graph.ts'
import { cloneGraph } from './graph.ts'
import { gap } from './placement.ts'
import type { LabelOptions, Pt, RoutingOptions } from './types.ts'

export function routeEdges(g0: LGraph, _opts: RoutingOptions): LGraph {
  const g = cloneGraph(g0)
  const L = g.layers.length
  if (L === 0) return g
  relaxChains(g)
  const gapRows = Math.max(1, g.spacing.channelGap)
  const bandH = g.layers.map((row) => Math.max(1, ...row.map((n) => n.h)))
  const col = (p: LPort): number => p.node.x + p.pos

  // Pass 1: per channel, the trunks and their tracks.
  const channels: Channel[] = []
  for (let l = 0; l + 1 < L; l++) {
    const segs: LEdge[] = []
    for (const n of g.layers[l]) {
      for (const p of n.ports) for (const e of p.out) if (e.dst.node !== n) segs.push(e)
    }
    channels.push(routeChannel(segs, col, g.warnings))
  }
  // Band tops from the track counts; nodes sit at the top of their band.
  const top: number[] = []
  let y = 0
  for (let l = 0; l < L; l++) {
    top.push(y)
    for (const n of g.layers[l]) n.y = y
    y += bandH[l]
    if (l + 1 < L) {
      const ch = channels[l]
      ch.first = y + gapRows
      y += ch.tracks === 0 ? 1 : ch.tracks + 2 * gapRows
    }
  }
  // Pass 2: routes. A dummy or port is one cell at the top of its band, so
  // the segment leaving it starts there and runs down through the band.
  const portRow = (p: LPort): number =>
    p.side === 'N' || p.node.kind !== 'node' ? p.node.y : p.node.y + p.node.h - 1
  for (let l = 0; l + 1 < L; l++) {
    const ch = channels[l]
    for (const [e, path] of ch.paths) {
      const cs = col(e.src)
      const cd = col(e.dst)
      const pts: Pt[] = [[cs, portRow(e.src)]]
      let c = cs
      for (const { trunk, exitCol } of path) {
        const row = ch.first + trunk.track
        pts.push([c, row], [exitCol, row])
        c = exitCol
      }
      pts.push([cd, portRow(e.dst)])
      e.route = dedupe(pts)
    }
  }
  // Self-loops: out of the east border, around, back in — the k-th loop of
  // a node two columns further out, one row higher, on the space `gap`
  // reserved for it. The arrow lands on the upper row.
  for (const n of g.nodes) {
    let k = 0
    for (const p of n.ports) {
      for (const e of p.out) {
        if (e.dst.node !== n) continue
        const r1 = n.y + n.h - 1 - k
        const r2 = r1 - 1
        if (r2 < n.y) {
          g.warnings.push(`edge "${e.id}": no room for another self-loop on "${n.id}"`)
          k++
          continue
        }
        const border = n.x + n.w - 1
        const out = border + 2 * (k + 1)
        e.src.pos = r1 - n.y
        e.dst.pos = r2 - n.y
        e.route = [
          [border, r1],
          [out, r1],
          [out, r2],
          [border, r2],
        ]
        k++
      }
    }
  }
  return g
}

/**
 * Slide every long-edge chain within the slack its row neighbours leave —
 * order and width never change — so it runs straight under its source
 * port where the gaps allow, bends only where an interval runs out
 * (greedy stabbing is bend-minimal), and heads for its target port after
 * a bend. Chains block each other, so the sweep repeats until nothing
 * moves (a few passes; capped).
 */
function relaxChains(g: LGraph): void {
  const W = Math.max(...g.nodes.map((n) => n.x + Math.max(1, n.w)))
  const chains = new Map<string, LNode[]>()
  for (const n of g.nodes) {
    if (n.kind === 'port') chains.set(n.id, [n])
    if (n.kind !== 'dummy') continue
    const list = chains.get(n.origin as string)
    if (list === undefined) chains.set(n.origin as string, [n])
    else list.push(n)
  }
  const keys = [...chains.keys()].sort()
  for (const ds of chains.values()) ds.sort((a, b) => a.layer - b.layer)
  /** `primary` if the window allows it, else `secondary`, else the near edge. */
  const pick = (lo: number, hi: number, primary: number, secondary: number): number => {
    if (primary >= lo && primary <= hi) return primary
    if (secondary >= lo && secondary <= hi) return secondary
    return Math.max(lo, Math.min(hi, primary))
  }
  for (let pass = 0; pass < 10; pass++) {
    let moved = false
    for (const key of keys) {
      const ds = chains.get(key) as LNode[]
      const head = ds[0].ports.find((p) => p.side === 'N')?.in[0]
      const tail = ds[ds.length - 1].ports.find((p) => p.side === 'S')?.out[0]
      const headCol = head === undefined ? undefined : head.src.node.x + head.src.pos
      const tailCol = tail === undefined ? undefined : tail.dst.node.x + tail.dst.pos
      const srcCol = headCol ?? tailCol ?? ds[0].x
      const dstCol = tailCol ?? headCol ?? ds[ds.length - 1].x
      const iv = ds.map((d): [number, number] => {
        const row = g.layers[d.layer]
        const a = row[d.order - 1]
        const b = row[d.order + 1]
        const lo = a === undefined ? 0 : a.x + a.w + gap(g.spacing, a, d)
        const hi = b === undefined ? W - 1 : b.x - gap(g.spacing, d, b) - 1
        return lo > hi ? [d.x, d.x] : [lo, hi]
      })
      let k = 0
      let target = srcCol
      while (k < ds.length) {
        let [lo, hi] = iv[k]
        let end = k + 1
        while (end < ds.length && Math.max(lo, iv[end][0]) <= Math.min(hi, iv[end][1])) {
          lo = Math.max(lo, iv[end][0])
          hi = Math.min(hi, iv[end][1])
          end++
        }
        const x = pick(lo, hi, target, end === ds.length ? dstCol : srcCol)
        for (let j = k; j < end; j++) {
          if (ds[j].x !== x) moved = true
          ds[j].x = x
        }
        target = dstCol
        k = end
      }
    }
    if (!moved) break
  }
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  return out
}

// ------------------------------------------------------------------ channel

/** A horizontal run on one track: the columns its stubs come from and go to. */
interface Trunk {
  ins: number[]
  outs: number[]
  lo: number
  hi: number
  track: number
}
interface Channel {
  tracks: number
  /** row of track 0, set once band positions are known */
  first: number
  /** per edge, the trunks it follows and the column it leaves each on */
  paths: Map<LEdge, { trunk: Trunk; exitCol: number }[]>
}

function routeChannel(segs: LEdge[], col: (p: LPort) => number, warnings: string[]): Channel {
  const paths = new Map<LEdge, { trunk: Trunk; exitCol: number }[]>()
  const bent = segs.filter((e) => col(e.src) !== col(e.dst))
  for (const e of segs) if (col(e.src) === col(e.dst)) paths.set(e, [])
  if (bent.length === 0) return { tracks: 0, first: 0, paths }

  // Trunks: one per source cell. Edges leaving one cell share a bus with
  // junctions — always one node's edges, so never ambiguous. Edges entering
  // one cell keep their own trunks and merge in the target column instead;
  // fusing them (ELK's port components) would join unrelated sources.
  const groups = new Map<string, LEdge[]>()
  for (const e of bent) {
    const k = `${e.src.node.id}:${col(e.src)}`
    const list = groups.get(k)
    if (list === undefined) groups.set(k, [e])
    else list.push(e)
  }
  const trunks: Trunk[] = []
  const members = new Map<Trunk, LEdge[]>()
  for (const list of groups.values()) {
    const ins = [...new Set(list.map((e) => col(e.src)))].sort((a, b) => a - b)
    const outs = [...new Set(list.map((e) => col(e.dst)))].sort((a, b) => a - b)
    const t: Trunk = {
      ins,
      outs,
      lo: Math.min(ins[0], outs[0]),
      hi: Math.max(ins[ins.length - 1], outs[outs.length - 1]),
      track: 0,
    }
    trunks.push(t)
    members.set(t, list)
    for (const e of list) paths.set(e, [{ trunk: t, exitCol: col(e.dst) }])
  }

  // Splitting: a pair whose stubs would merge in both orders gets one of
  // them broken into two trunks joined by a jog through a free column.
  const forced: [Trunk, Trunk][] = []
  const used = new Set<number>()
  for (const t of trunks) for (const c of [...t.ins, ...t.outs]) used.add(c)
  const critical = (a: Trunk, b: Trunk): boolean => a.outs.some((c) => b.ins.includes(c))
  for (let guard = 0; guard < trunks.length; guard++) {
    let split: [Trunk, Trunk] | null = null
    for (let i = 0; i < trunks.length && split === null; i++) {
      for (let j = i + 1; j < trunks.length; j++) {
        if (critical(trunks[i], trunks[j]) && critical(trunks[j], trunks[i])) {
          split = [trunks[i], trunks[j]]
          break
        }
      }
    }
    if (split === null) break
    const [a, b] = split
    const victim = a.ins.length + a.outs.length <= b.ins.length + b.outs.length ? a : b
    const mid = freeColumn(victim, used)
    if (mid === null) {
      warnings.push('routing: no free column to separate two edges; they overlap')
      break
    }
    used.add(mid)
    const first: Trunk = {
      ins: victim.ins,
      outs: [mid],
      lo: Math.min(...victim.ins, mid),
      hi: Math.max(...victim.ins, mid),
      track: 0,
    }
    const second: Trunk = {
      ins: [mid],
      outs: victim.outs,
      lo: Math.min(...victim.outs, mid),
      hi: Math.max(...victim.outs, mid),
      track: 0,
    }
    trunks.splice(trunks.indexOf(victim), 1, first, second)
    forced.push([first, second])
    for (const e of members.get(victim) as LEdge[]) {
      paths.set(e, [
        { trunk: first, exitCol: mid },
        { trunk: second, exitCol: col(e.dst) },
      ])
    }
    members.set(first, members.get(victim) as LEdge[])
    members.set(second, members.get(victim) as LEdge[])
  }

  // Dependencies: A → B means A takes an upper track than B.
  const deps = new Map<Trunk, Map<Trunk, number>>()
  const dep = (a: Trunk, b: Trunk, w: number): void => {
    const m = deps.get(a) ?? new Map<Trunk, number>()
    m.set(b, Math.max(m.get(b) ?? 0, w))
    deps.set(a, m)
  }
  const MANDATORY = 1 << 20
  for (const [a, b] of forced) dep(a, b, MANDATORY)
  const within = (c: number, t: Trunk): boolean => c >= t.lo && c <= t.hi
  for (let i = 0; i < trunks.length; i++) {
    for (let j = i + 1; j < trunks.length; j++) {
      const a = trunks[i]
      const b = trunks[j]
      if (a.hi < b.lo || b.hi < a.lo) continue
      const critAB = critical(a, b)
      const critBA = critical(b, a)
      if (critAB && critBA) {
        warnings.push('routing: two edges overlap in a channel')
        continue
      }
      if (critAB) {
        dep(b, a, MANDATORY)
        continue
      }
      if (critBA) {
        dep(a, b, MANDATORY)
        continue
      }
      // crossings if a is above b: a's out-stubs through b's run, b's in-stubs through a's run
      const cAB =
        a.outs.filter((c) => within(c, b)).length + b.ins.filter((c) => within(c, a)).length
      const cBA =
        b.outs.filter((c) => within(c, a)).length + a.ins.filter((c) => within(c, b)).length
      if (cAB < cBA) dep(a, b, cBA - cAB)
      else if (cBA < cAB) dep(b, a, cAB - cBA)
      else if (cAB > 0) {
        dep(a, b, 0)
        dep(b, a, 0)
      }
    }
  }

  // Greedy feedback arc set over the trunks (sinks right, sources left,
  // else max weighted out − in), then tracks = longest path over the
  // dependencies that survive.
  const order = linearOrder(trunks, deps)
  const rank = new Map(order.map((t, i) => [t, i]))
  const indeg = new Map<Trunk, number>(trunks.map((t) => [t, 0]))
  const fwd = new Map<Trunk, Trunk[]>(trunks.map((t) => [t, []]))
  for (const [a, m] of deps) {
    for (const b of m.keys()) {
      if ((rank.get(a) as number) < (rank.get(b) as number)) {
        ;(fwd.get(a) as Trunk[]).push(b)
        indeg.set(b, (indeg.get(b) as number) + 1)
      }
    }
  }
  const queue = trunks.filter((t) => indeg.get(t) === 0)
  let tracks = 0
  for (let q = 0; q < queue.length; q++) {
    const t = queue[q]
    tracks = Math.max(tracks, t.track + 1)
    for (const u of fwd.get(t) as Trunk[]) {
      u.track = Math.max(u.track, t.track + 1)
      const d = (indeg.get(u) as number) - 1
      indeg.set(u, d)
      if (d === 0) queue.push(u)
    }
  }
  return { tracks, first: 0, paths }
}

/** A column no stub in the channel uses, nearest the trunk's middle; never negative. */
function freeColumn(t: Trunk, used: Set<number>): number | null {
  const mid = Math.floor((t.lo + t.hi) / 2)
  const span = Math.max(t.hi - t.lo, 1) + 2
  for (let d = 0; d <= span; d++) {
    for (const c of [mid - d, mid + d]) if (c >= 0 && !used.has(c)) return c
  }
  return null
}

/** Eades–Lin–Smyth over the dependency graph; earlier = upper track. */
function linearOrder(trunks: Trunk[], deps: Map<Trunk, Map<Trunk, number>>): Trunk[] {
  const outW = new Map<Trunk, number>(trunks.map((t) => [t, 0]))
  const inW = new Map<Trunk, number>(trunks.map((t) => [t, 0]))
  const preds = new Map<Trunk, [Trunk, number][]>(trunks.map((t) => [t, []]))
  for (const [a, m] of deps) {
    for (const [b, w] of m) {
      outW.set(a, (outW.get(a) as number) + w)
      inW.set(b, (inW.get(b) as number) + w)
      ;(preds.get(b) as [Trunk, number][]).push([a, w])
    }
  }
  const left: Trunk[] = []
  const right: Trunk[] = []
  const done = new Set<Trunk>()
  const place = (t: Trunk, atLeft: boolean): void => {
    done.add(t)
    if (atLeft) left.push(t)
    else right.unshift(t)
    for (const [b, w] of deps.get(t) ?? []) if (!done.has(b)) inW.set(b, (inW.get(b) as number) - w)
    for (const [a, w] of preds.get(t) as [Trunk, number][])
      if (!done.has(a)) outW.set(a, (outW.get(a) as number) - w)
  }
  while (done.size < trunks.length) {
    let moved = true
    while (moved) {
      moved = false
      for (const t of trunks) {
        if (done.has(t)) continue
        if ((outW.get(t) as number) <= 0) {
          place(t, false)
          moved = true
        } else if ((inW.get(t) as number) <= 0) {
          place(t, true)
          moved = true
        }
      }
    }
    if (done.size === trunks.length) break
    let best: Trunk | null = null
    for (const t of trunks) {
      if (done.has(t)) continue
      const score = (outW.get(t) as number) - (inW.get(t) as number)
      if (best === null || score > (outW.get(best) as number) - (inW.get(best) as number)) best = t
    }
    place(best as Trunk, true)
  }
  return [...left, ...right]
}

// ------------------------------------------------------------------ labels

export function placeLabels(g: LGraph, _opts: LabelOptions): LGraph {
  return cloneGraph(g)
}

/**
 * The polyline of each input edge whose segments are all routed: the
 * segments concatenated in flow order and, for a reversed edge, read
 * backwards so it runs from the original source to the original target.
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
    if (segs.some((s) => s.route === null)) continue
    segs.sort((a, b) => a.src.node.layer - b.src.node.layer)
    const pts: Pt[] = []
    for (const s of segs) {
      for (const p of s.route as Pt[]) {
        const last = pts[pts.length - 1]
        if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) pts.push(p)
      }
    }
    if (segs[0].reversed) pts.reverse()
    out.set(origin, pts)
  }
  return out
}

export type { LNode }
