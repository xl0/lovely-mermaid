import { describe, expect, test } from 'bun:test'
import { layout } from '../src/engine/index.ts'
import type { InputCompound, InputEdge, InputNode, LayoutInput, Pt } from '../src/engine/types.ts'
import { spacing } from './engine-helpers.ts'

// Seeded geometric lint sweep: random graphs — cycles, self-loops,
// multi-edges, nested compounds, compound↔descendant edges — through
// several strategy combos and directions. Every layout must come out
// geometrically sound; these are the invariants the unit tests cannot
// cover shape by shape.

const rng = (seed: number) => {
  let x = seed >>> 0
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

function randomInput(seed: number): LayoutInput {
  const r = rng(seed)
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1))
  const n = int(3, 12)
  const nodes: InputNode[] = []
  for (let i = 0; i < n; i++) nodes.push({ id: `n${i}`, w: int(3, 12), h: int(3, 5) })
  const compounds: InputCompound[] = []
  const parentOf = new Map<string, string>()
  if (n >= 5 && r() < 0.8) {
    compounds.push({ id: 'G' })
    for (let i = 0; i < n; i++)
      if (r() < 0.4) {
        nodes[i].parent = 'G'
        parentOf.set(nodes[i].id, 'G')
      }
    if (r() < 0.5) {
      compounds.push({ id: 'H', parent: 'G' })
      for (let i = 0; i < n; i++)
        if (nodes[i].parent === 'G' && r() < 0.4) {
          nodes[i].parent = 'H'
          parentOf.set(nodes[i].id, 'H')
        }
    }
  }
  const items = [...nodes.map((x) => x.id), ...compounds.map((c) => c.id)]
  const edges: InputEdge[] = []
  const m = int(2, 16)
  for (let i = 0; i < m; i++) {
    const from = items[int(0, items.length - 1)]
    const to = items[int(0, items.length - 1)]
    edges.push({ id: `e${i}`, from, to })
  }
  for (const e of edges) {
    if (r() < 0.2) e.labels = [{ text: 'lbl', w: int(3, 9), h: int(1, 2), at: 'center' }]
    if (r() < 0.1)
      e.labels = [...(e.labels ?? []), { text: 'c', w: 3, h: 1, at: r() < 0.5 ? 'tail' : 'head' }]
  }
  const dirs = ['down', 'up', 'right', 'left'] as const
  return { dir: dirs[seed % 4], nodes, edges, compounds, spacing: { ...spacing } }
}

/** cells covered by a route, keyed by orientation */
function cover(route: Pt[]): Map<string, true> {
  const out = new Map<string, true>()
  for (let i = 1; i < route.length; i++) {
    const [ax, ay] = route[i - 1]
    const [bx, by] = route[i]
    const o = ax === bx ? 'v' : 'h'
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++)
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) out.set(`${o}:${x},${y}`, true)
  }
  return out
}

describe('geometric soundness (seeded sweep)', () => {
  const combos = [
    { cycles: { strategy: 'greedy' }, placement: { strategy: 'bk' } },
    { cycles: { strategy: 'dfs' }, placement: { strategy: 'ns2' } },
    { cycles: { strategy: 'greedy2' }, placement: { strategy: 'networkSimplex' } },
  ] as const
  for (let seed = 1; seed <= 60; seed++) {
    test(`seed ${seed}`, () => {
      const input = randomInput(seed * 7919)
      const opts = combos[seed % combos.length]
      const res = layout(input, opts as never)
      const again = layout(input, opts as never)
      expect(JSON.stringify(again)).toBe(JSON.stringify(res))
      const boxes = { ...res.nodes }
      const isAncestor = (a: string, b: string): boolean => {
        // is compound `a` an ancestor of item `b`?
        let cur: string | undefined = [...input.nodes, ...(input.compounds ?? [])].find(
          (x) => x.id === b,
        )?.parent
        while (cur !== undefined) {
          if (cur === a) return true
          cur = (input.compounds ?? []).find((c) => c.id === cur)?.parent
        }
        return false
      }
      // 1. no two leaf boxes overlap; frames only contain their members
      const ids = Object.keys(boxes)
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const a = boxes[ids[i]]
          const b = boxes[ids[j]]
          const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
          expect(apart).toBe(true)
        }
      // 2 + 3. every route is orthogonal and never cuts a box interior
      for (const [id, er] of Object.entries(res.edges)) {
        const ie = input.edges.find((e) => e.id === id) as InputEdge
        const route = er.route
        if (route.length === 0) continue
        for (let i = 1; i < route.length; i++) {
          const [ax, ay] = route[i - 1]
          const [bx, by] = route[i]
          expect(ax === bx || ay === by).toBe(true)
          for (const [nid, r] of Object.entries(boxes)) {
            if (nid === ie.from || nid === ie.to) continue
            for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++)
              for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
                const interior = x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1
                if (interior) throw new Error(`route ${id} cuts ${nid} at ${x},${y} (seed ${seed})`)
              }
          }
        }
      }
      // 4. no coincident collinear runs between unrelated edges. Edges
      // whose endpoint ancestries intersect are exempt: trunks merge per
      // cell, frame ports and wraps are shared by the whole subtree.
      const closure = (id: string): Set<string> => {
        const out = new Set([id])
        let cur: string | undefined = [...input.nodes, ...(input.compounds ?? [])].find(
          (x) => x.id === id,
        )?.parent
        while (cur !== undefined) {
          out.add(cur)
          cur = (input.compounds ?? []).find((c) => c.id === cur)?.parent
        }
        return out
      }
      const ends = (e: InputEdge): Set<string> => new Set([...closure(e.from), ...closure(e.to)])
      const covers = Object.entries(res.edges).map(([id, er]) => ({ id, c: cover(er.route) }))
      for (let i = 0; i < covers.length; i++)
        for (let j = i + 1; j < covers.length; j++) {
          const a = input.edges.find((e) => e.id === covers[i].id) as InputEdge
          const b = input.edges.find((e) => e.id === covers[j].id) as InputEdge
          const ea = ends(a)
          if ([...ends(b)].some((x) => ea.has(x))) continue
          let shared = 0
          for (const k of covers[i].c.keys()) if (covers[j].c.has(k)) shared++
          if (shared > 1)
            throw new Error(
              `edges ${a.id}/${b.id} share ${shared} cells (seed ${seed})\n${JSON.stringify(a)} ${JSON.stringify(res.edges[a.id].route)}\n${JSON.stringify(b)} ${JSON.stringify(res.edges[b.id].route)}`,
            )
        }
      // 5. labels sit inside the canvas, off every box, frame border and
      // other label, and cover no cell of a foreign edge
      const plainCells = (route: Pt[]): Set<string> => {
        const out = new Set<string>()
        for (let i = 1; i < route.length; i++)
          for (
            let x = Math.min(route[i - 1][0], route[i][0]);
            x <= Math.max(route[i - 1][0], route[i][0]);
            x++
          )
            for (
              let y = Math.min(route[i - 1][1], route[i][1]);
              y <= Math.max(route[i - 1][1], route[i][1]);
              y++
            )
              out.add(`${x},${y}`)
        return out
      }
      const cellsById = new Map(
        Object.entries(res.edges).map(([id, er]) => [id, plainCells(er.route)]),
      )
      const placedRects: { x: number; y: number; w: number; h: number }[] = []
      for (const [id, er] of Object.entries(res.edges)) {
        for (const l of er.labels) {
          expect(l.x >= 0 && l.y >= 0 && l.x + l.w <= res.width && l.y + l.h <= res.height).toBe(
            true,
          )
          const apart = (r2: { x: number; y: number; w: number; h: number }): boolean =>
            l.x + l.w <= r2.x || r2.x + r2.w <= l.x || l.y + l.h <= r2.y || r2.y + r2.h <= l.y
          for (const b of Object.values(boxes)) expect(apart(b)).toBe(true)
          for (const q of placedRects) expect(apart(q)).toBe(true)
          placedRects.push(l)
          for (const [cid, cr] of Object.entries(res.compounds)) {
            for (let x = l.x; x < l.x + l.w; x++)
              for (let y = l.y; y < l.y + l.h; y++) {
                const onBorder =
                  ((x === cr.x || x === cr.x + cr.w - 1) && y >= cr.y && y < cr.y + cr.h) ||
                  ((y === cr.y || y === cr.y + cr.h - 1) && x >= cr.x && x < cr.x + cr.w)
                if (onBorder) throw new Error(`label on ${cid} border at ${x},${y} (seed ${seed})`)
              }
          }
          for (const [oid, cells] of cellsById) {
            if (oid === id) continue
            for (let x = l.x; x < l.x + l.w; x++)
              for (let y = l.y; y < l.y + l.h; y++)
                if (cells.has(`${x},${y}`))
                  throw new Error(`label of ${id} covers ${oid} at ${x},${y} (seed ${seed})`)
          }
        }
      }
      // 6. floats: in bounds, off everything — boxes, labels, every edge
      for (const f of res.floats ?? []) {
        expect(f.x >= 0 && f.y >= 0 && f.x + f.w <= res.width && f.y + f.h <= res.height).toBe(true)
        const apart = (r2: { x: number; y: number; w: number; h: number }): boolean =>
          f.x + f.w <= r2.x || r2.x + r2.w <= f.x || f.y + f.h <= r2.y || r2.y + r2.h <= f.y
        for (const b of Object.values(boxes)) expect(apart(b)).toBe(true)
        for (const q of placedRects) expect(apart(q)).toBe(true)
        placedRects.push(f)
        for (const [oid, cells] of cellsById) {
          for (let x = f.x; x < f.x + f.w; x++)
            for (let y = f.y; y < f.y + f.h; y++)
              if (cells.has(`${x},${y}`))
                throw new Error(`float of ${f.edge} covers ${oid} at ${x},${y} (seed ${seed})`)
        }
      }
      void isAncestor
    })
  }
})
