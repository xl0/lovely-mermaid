/**
 * Hybrid flow: a chain of nodes that would each cost a band of flow
 * extent folds into one *stack* — the members run along the cross axis
 * inside a single band (top to bottom on an LR page, side by side in a
 * down flow). Under a width-capped sideways layout it is the fit
 * mechanism; everywhere else the candidate loop probes it and adopts
 * it only when the cross axis does not pay.
 *
 * Implemented as contraction: after cycle breaking each maximal chain
 * (every middle node has exactly one in and one out edge; no compounds
 * or rim ports; a self-loop node only as the tail, where the wrap has
 * the stack's free far side) collapses into one super-node sized to
 * hold the members side by side. External edges keep their
 * layout-direction sides — they attach to the stack's flow borders
 * through ports *pinned over their member's slot* — so layering,
 * ordering, placement and routing see one ordinary node with fixed
 * ports and need no new machinery. At export the stack expands back:
 * member boxes at their slots, the chain edges as straight cross-axis
 * runs between neighbours (their labels drop — the labels phase is
 * still pending), and a stub where a shorter member's border stops
 * short of the stack's far flow border.
 */
import type { LEdge, LGraph, LNode, LPort } from './graph.ts'
import type { PlacedLabel, Pt, Rect } from './types.ts'

export interface StackMember {
  id: string
  /** cross offset of the member inside the stack */
  off: number
  w: number
  h: number
}

export interface Stack {
  id: string
  members: StackMember[]
  /** edges[i] joins members[i] → members[i+1], in layout direction */
  edges: { id: string; reversed: boolean }[]
}

/** A plain box (a title line or two): chains of these stack without
 * limit — a run of small boxes reads like a list. In units of the
 * cross `nodeNode` gap, the caller's own measure of axis density —
 * terminal rows and columns differ ~3× (an LR stack spends rows, a
 * TB stack spends columns), and so do the gaps. */
const SIMPLE = 5
/** Larger members join a stack only while its total cross size stays
 * within this budget (same units as `SIMPLE`): a short stack of
 * medium blocks reads fine, a run of large compartment boxes does
 * not (they split into singleton segments and stay flat). */
const BULK = 20

/**
 * Contract every foldable chain of `g` in place (the caller owns the
 * clone). `gap` is the cross gap drawn between stacked members,
 * `edgeEdge` the port pitch the member widening uses, and `exclude`
 * names the nodes that may never join a chain (child compounds).
 * Returns the stacks for `expandStacks`.
 */
export function stackChains(
  g: LGraph,
  gap: number,
  edgeEdge: number,
  exclude: Set<string>,
): Map<string, Stack> {
  const stacks = new Map<string, Stack>()
  const outs = (n: LNode): LEdge[] => n.ports.flatMap((p) => p.out).filter((e) => e.dst.node !== n)
  const ins = (n: LNode): LEdge[] => n.ports.flatMap((p) => p.in).filter((e) => e.src.node !== n)
  const eligible = (n: LNode): boolean => n.kind === 'node' && !exclude.has(n.id)
  // chainable link: u's one out is v's one in. A contracted chain
  // edge loses its labels (the labels phase is still pending — ER
  // cardinalities land here too). A node with self-loops can never be
  // a `u`, which makes loops tail-only: the stack's last member has
  // free space past the far border, exactly where a loop wraps anyway.
  const next = new Map<LNode, LNode>()
  const hasPrev = new Set<LNode>()
  for (const u of g.nodes) {
    if (!eligible(u) || (u.loops ?? 0) > 0) continue
    const uo = outs(u)
    if (uo.length !== 1) continue
    const v = uo[0].dst.node
    if (v === u || !eligible(v) || ins(v).length !== 1) continue
    next.set(u, v)
    hasPrev.add(v)
  }
  const gone = new Set<LEdge>()
  const drop = new Set<LNode>()
  const chains: LNode[][] = []
  for (const head of g.nodes) {
    if (!next.has(head) || hasPrev.has(head)) continue
    const all: LNode[] = [head]
    for (let m = next.get(head); m !== undefined; m = next.get(m)) all.push(m)
    // segment the chain: an all-small segment extends without limit (a
    // column of plain boxes reads like a list), but once a larger
    // member is aboard every extension pays against the budget
    const simple = SIMPLE * Math.max(1, gap)
    const bulk = BULK * Math.max(1, gap)
    let seg: LNode[] = [all[0]]
    let total = all[0].w
    let allSmall = all[0].w <= simple
    for (let i = 1; i < all.length; i++) {
      const m = all[i]
      if ((m.w <= simple && allSmall) || total + gap + m.w <= bulk) {
        seg.push(m)
        total += gap + m.w
        allSmall = allSmall && m.w <= simple
      } else {
        chains.push(seg)
        seg = [m]
        total = m.w
        allSmall = m.w <= simple
      }
    }
    chains.push(seg)
  }
  for (const members of chains) {
    if (members.length < 2) continue
    const chain = members.slice(0, -1).map((m) => outs(m)[0])
    /** the member's external ports on one side, chain edges excluded,
     * self-loop ends sorted last so the wrap crosses no other stub */
    const sidePorts = (m: LNode, side: 'S' | 'N'): LPort[] =>
      m.ports
        .filter((p) => {
          const e = p.in[0] ?? p.out[0]
          return e !== undefined && !chain.includes(e) && (side === 'S') === p.out.length > 0
        })
        .sort((p, q) => {
          const loop = (x: LPort): number => {
            const e = x.in[0] ?? x.out[0]
            return e.src.node === e.dst.node ? 1 : 0
          }
          return loop(p) - loop(q)
        })
    // members widen for their busiest external side, same pitch rule
    // as the main widening pass (which skips stacks)
    let off = 0
    const sm: StackMember[] = []
    for (const m of members) {
      const k = Math.max(sidePorts(m, 'S').length, sidePorts(m, 'N').length)
      const w = Math.max(m.w, k > 0 ? (k - 1) * (1 + edgeEdge) + 3 : 0)
      sm.push({ id: m.id, off, w, h: m.h })
      off += w + gap
    }
    const tail = members[members.length - 1]
    const id = `stk:${members[0].id}`
    const sup: LNode = {
      id,
      label: members.map((m) => m.label ?? m.id).join(' ⤵ '),
      kind: 'node',
      ...((tail.loops ?? 0) > 0 ? { loops: tail.loops } : {}),
      w: off - gap,
      h: Math.max(...members.map((m) => m.h)),
      layer: -1,
      order: -1,
      x: -1,
      y: -1,
      ports: [],
    }
    // external ports move onto the stack, pinned over their member's
    // slot (corners excluded)
    for (let i = 0; i < members.length; i++) {
      const m = members[i]
      const slotLo = sm[i].off + 1
      const slotHi = sm[i].off + sm[i].w - 2
      for (const side of ['S', 'N'] as const) {
        const ps = sidePorts(m, side)
        for (let j = 0; j < ps.length; j++) {
          const p: LPort = ps[j]
          p.pos =
            ps.length === 1 || slotHi <= slotLo
              ? sm[i].off + (sm[i].w >> 1)
              : slotLo + Math.round((j * (slotHi - slotLo)) / (ps.length - 1))
          p.fixed = true
          p.node = sup
          sup.ports.push(p)
        }
      }
      drop.add(m)
    }
    for (const e of chain) gone.add(e)
    g.nodes.push(sup)
    stacks.set(id, {
      id,
      members: sm,
      edges: chain.map((e) => ({ id: e.id, reversed: e.reversed })),
    })
  }
  if (stacks.size > 0) {
    g.nodes = g.nodes.filter((n) => !drop.has(n))
    g.edges = g.edges.filter((e) => !gone.has(e))
  }
  return stacks
}

/**
 * Put the members back into a finished level: the stack's rect becomes
 * member rects at their slots, the chain edges straight runs between
 * neighbours, and an external route ending on the stack's far flow
 * border grows a stub to its member's nearer one. Mutates the maps.
 */
export function expandStacks(
  stacks: Map<string, Stack>,
  nodes: Record<string, Rect>,
  routes: Map<string, Pt[]>,
  labels: Map<string, PlacedLabel[]>,
): void {
  for (const st of stacks.values()) {
    const r = nodes[st.id]
    if (r === undefined) continue
    delete nodes[st.id]
    for (const m of st.members) nodes[m.id] = { x: r.x + m.off, y: r.y, w: m.w, h: m.h }
    for (let i = 0; i < st.edges.length; i++) {
      const a = st.members[i]
      const b = st.members[i + 1]
      const y = r.y + (Math.min(a.h, b.h) >> 1)
      const run: Pt[] = [
        [r.x + a.off + a.w - 1, y],
        [r.x + b.off, y],
      ]
      if (st.edges[i].reversed) run.reverse()
      routes.set(st.edges[i].id, run)
      labels.set(st.edges[i].id, [])
    }
    // stubs: a route reaching the stack's far border over a member
    // shorter than the stack continues to that member's own border
    // (tail first — a stub at the head shifts every index)
    const far = r.y + r.h - 1
    for (const pts of routes.values()) {
      const stubAt = (at: number): Pt | null => {
        const [x, y] = pts[at]
        if (y !== far || x < r.x || x >= r.x + r.w) return null
        const m = st.members.find((q) => x >= r.x + q.off && x < r.x + q.off + q.w)
        return m === undefined || m.h === r.h ? null : [x, r.y + m.h - 1]
      }
      const tail = stubAt(pts.length - 1)
      if (tail !== null) pts.push(tail)
      const head = stubAt(0)
      if (head !== null) pts.unshift(head)
    }
  }
}
