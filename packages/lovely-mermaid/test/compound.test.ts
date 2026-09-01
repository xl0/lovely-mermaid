import { describe, expect, test } from 'bun:test'
import { layout } from '../src/engine/index.ts'
import type { LayoutResult, Pt, Rect } from '../src/engine/types.ts'
import { inputOf, spacing } from './engine-helpers.ts'

type Groups = Record<string, string[]>
const lay = (edges: string[], groups: Groups, extra = {}): LayoutResult =>
  layout({ ...inputOf(edges, groups), ...extra })
const inside = (r: Rect, n: Rect): boolean =>
  n.x > r.x && n.x + n.w < r.x + r.w && n.y > r.y && n.y + n.h < r.y + r.h
const disjoint = (a: Rect, b: Rect): boolean =>
  a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
const onBorder = (r: Rect, [x, y]: Pt): boolean =>
  x >= r.x && x < r.x + r.w && (y === r.y || y === r.y + r.h - 1)
/** Orthogonal, no zero-length steps, ends where it should. */
const wellFormed = (route: Pt[], from: Rect, to: Rect): boolean => {
  if (route.length < 2) return false
  for (let i = 1; i < route.length; i++) {
    const [ax, ay] = route[i - 1]
    const [bx, by] = route[i]
    if ((ax !== bx) === (ay !== by)) return false
  }
  const touches = (r: Rect, [x, y]: Pt): boolean =>
    x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
  return touches(from, route[0]) && touches(to, route[route.length - 1])
}
const box = (res: LayoutResult, id: string): Rect => (res.nodes[id] ?? res.compounds[id]) as Rect

describe('compound graphs (recursive)', () => {
  test('frames hold their members, nest, and stay apart; the canvas holds the frames', () => {
    const res = lay(['A>B', 'B>C', 'C>D', 'X>A', 'D>Y', 'P>Q'], {
      G: ['A', 'B', 'H'],
      H: ['C', 'D'],
      K: ['P', 'Q'],
    })
    const { G, H, K } = res.compounds
    for (const id of ['A', 'B']) expect(inside(G, res.nodes[id])).toBe(true)
    for (const id of ['C', 'D']) expect(inside(H, res.nodes[id])).toBe(true)
    expect(inside(G, H)).toBe(true)
    expect(disjoint(G, K)).toBe(true)
    for (const id of ['X', 'Y']) expect(disjoint(G, res.nodes[id])).toBe(true)
    for (const r of [...Object.values(res.nodes), ...Object.values(res.compounds)]) {
      expect(r.x + r.w).toBeLessThanOrEqual(res.width)
      expect(r.y + r.h).toBeLessThanOrEqual(res.height)
    }
    // every edge is routed as one polyline from its source box to its target box
    for (const e of inputOf(['A>B', 'B>C', 'C>D', 'X>A', 'D>Y', 'P>Q']).edges) {
      const r = res.edges[e.id]
      expect(r).toBeDefined()
      expect(wellFormed(r.route, box(res, e.from), box(res, e.to))).toBe(true)
    }
  })

  test('a crossing edge passes a port on the frame border, straight through it', () => {
    const res = lay(['X>A', 'A>B', 'B>Y'], { G: ['A', 'B'] })
    const G = res.compounds.G
    const inRoute = res.edges.e0.route
    const outRoute = res.edges.e2.route
    // X→A enters at the top row, B→Y leaves at the bottom row
    const entry = inRoute.find((p) => onBorder(G, p)) as Pt
    expect(entry[1]).toBe(G.y)
    const exit = outRoute.find((p) => onBorder(G, p)) as Pt
    expect(exit[1]).toBe(G.y + G.h - 1)
    // the crossing is vertical: the points before and after share the column
    for (const [route, pt] of [
      [inRoute, entry],
      [outRoute, exit],
    ] as const) {
      const i = route.findIndex((p) => p[0] === pt[0] && p[1] === pt[1])
      const before = route[i - 1]
      const after = route[i + 1]
      for (const q of [before, after]) if (q !== undefined) expect(q[0]).toBe(pt[0])
    }
    // the frame is two rows taller than a bare member: the port rows
    expect(G.h).toBeGreaterThanOrEqual(res.nodes.A.h + res.nodes.B.h + 2 + 2)
  })

  test('an edge to the compound itself ends on the frame; member-to-frame becomes a frame loop', () => {
    const res = lay(['X>G', 'G>Y', 'A>G'], { G: ['A'] })
    const G = res.compounds.G
    expect(onBorder(G, res.edges.e0.route.at(-1) as Pt)).toBe(true)
    expect(onBorder(G, res.edges.e1.route[0])).toBe(true)
    // A→G maps to the frame at the top level: out of A, through the
    // bottom border, a loop wrapping the frame, in through the top
    const aa = res.edges.e2.route
    expect(wellFormed(aa, res.nodes.A, G)).toBe(true)
    expect(aa.some(([, y]) => y === G.y + G.h - 1)).toBe(true) // S border
    expect(Math.max(...aa.map(([x]) => x))).toBeGreaterThan(G.x + G.w - 1) // east wrap
    expect(aa.at(-1)?.[1]).toBe(G.y) // ends on the top border
    expect(res.warnings).toEqual([])
  })

  test('a frame→member edge wraps the frame and enters to the member', () => {
    const res = lay(['A>B', 'G>B'], { G: ['A', 'B'] })
    const G = res.compounds.G
    const gb = res.edges.e1.route
    expect(wellFormed(gb, G, res.nodes.B)).toBe(true)
    expect(Math.max(...gb.map(([x]) => x))).toBeGreaterThan(G.x + G.w - 1) // east wrap
    expect(gb.some((p) => onBorder(G, p))).toBe(true)
    expect(res.warnings).toEqual([])
    // no route runs through a box interior
    for (const e of Object.values(res.edges)) {
      for (let i = 1; i < e.route.length; i++) {
        const [ax, ay] = e.route[i - 1]
        const [bx, by] = e.route[i]
        for (const [id, r] of Object.entries(res.nodes)) {
          if (id === 'B') continue // endpoints touch their own boxes
          for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++)
            for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
              const interior = x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1
              expect(interior).toBe(false)
            }
        }
      }
    }
  })

  test('a compound↔descendant edge across two levels stays sound', () => {
    const res = lay(['C>D', 'G>C'], { G: ['H'], H: ['C', 'D'] })
    const { G, H } = res.compounds
    expect(inside(G, H)).toBe(true)
    const gc = res.edges.e1.route
    expect(wellFormed(gc, G, res.nodes.C)).toBe(true)
    expect(res.warnings).toEqual([])
  })

  test('a cycle between two frames is broken outside; the reversed edge still runs source→target', () => {
    const res = lay(['A>P', 'P>A', 'A>B', 'P>Q'], { G: ['A', 'B'], K: ['P', 'Q'] })
    const { G, K } = res.compounds
    expect(disjoint(G, K)).toBe(true)
    for (const [id, from, to] of [
      ['e0', 'A', 'P'],
      ['e1', 'P', 'A'],
    ]) {
      const route = res.edges[id].route
      expect(wellFormed(route, res.nodes[from], res.nodes[to])).toBe(true)
      // crosses both frames' borders
      expect(route.some((p) => onBorder(G, p))).toBe(true)
      expect(route.some((p) => onBorder(K, p))).toBe(true)
    }
  })

  test('an edge through two levels of frames', () => {
    const res = lay(['X>C', 'C>Y'], { G: ['H'], H: ['C'] })
    const { G, H } = res.compounds
    expect(inside(G, H)).toBe(true)
    for (const id of ['e0', 'e1']) {
      const route = res.edges[id].route
      expect(route.filter((p) => onBorder(G, p)).length).toBe(1)
      expect(route.filter((p) => onBorder(H, p)).length).toBe(1)
    }
    expect(wellFormed(res.edges.e0.route, res.nodes.X, res.nodes.C)).toBe(true)
    expect(wellFormed(res.edges.e1.route, res.nodes.C, res.nodes.Y)).toBe(true)
  })

  test('the frame is at least as wide as its title; sideways the title runs along the flow', () => {
    const wide = { compounds: [{ id: 'G', titleW: 30 }] }
    const down = lay(['A>B'], { G: ['A'] }, wide)
    expect(down.compounds.G.w).toBeGreaterThanOrEqual(32)
    expect(inside(down.compounds.G, down.nodes.A)).toBe(true)
    const right = lay(['A>B'], { G: ['A'] }, { ...wide, dir: 'right' })
    expect(right.compounds.G.w).toBeGreaterThanOrEqual(32)
    expect(right.compounds.G.h).toBeLessThan(32)
    expect(inside(right.compounds.G, right.nodes.A)).toBe(true)
    expect(wellFormed(right.edges.e0.route, right.nodes.A, right.nodes.B)).toBe(true)
  })

  test('an empty compound is a box; bad parents are cut with a warning', () => {
    const res = layout({
      ...inputOf(['A>B'], { E: [] }),
      compounds: [
        { id: 'E', titleW: 3 },
        { id: 'F', parent: 'nowhere' },
        { id: 'C1', parent: 'C2' },
        { id: 'C2', parent: 'C1' },
      ],
    })
    expect(res.compounds.E.h).toBe(2)
    expect(res.compounds.E.w).toBeGreaterThanOrEqual(5)
    expect(res.compounds.F).toBeDefined()
    expect(res.warnings.some((w) => w.includes('nowhere'))).toBe(true)
    expect(res.warnings.some((w) => w.includes('nests in itself'))).toBe(true)
  })

  test('the parent owns a frame port order: no crossing on the border', () => {
    // X→B and Y→A would cross twice at G's border if the ports kept the
    // inner declaration order; either the ports or the sources reorder,
    // and the members inside follow the pinned ports
    for (const edges of [
      ['X>B', 'Y>A', 'A', 'B'],
      ['X>A', 'Y>B', 'B', 'A'],
    ]) {
      const res = layout(inputOf(edges, { G: ['A', 'B'] }))
      const out = Math.sign(res.nodes.X.x - res.nodes.Y.x)
      const bx = res.nodes[edges[0].slice(2, 3)].x
      const ax = res.nodes[edges[1].slice(2, 3)].x
      expect(Math.sign(bx - ax)).toBe(out)
    }
  })

  test('a frame port slides over its inner endpoint', () => {
    // P, Q, A hang under the border; each edge should cross the border
    // above its member, not at the frame's left corner
    const res = layout(inputOf(['X>A', 'Y>P', 'Z>Q'], { G: ['P', 'Q', 'A'] }))
    const G = res.compounds.G
    for (const [id, target] of [
      ['e0', 'A'],
      ['e1', 'P'],
      ['e2', 'Q'],
    ]) {
      const t = res.nodes[target]
      const cross = res.edges[id].route.find(([, y]) => y === G.y) as Pt
      expect(cross[0]).toBeGreaterThanOrEqual(t.x)
      expect(cross[0]).toBeLessThan(t.x + t.w)
    }
  })

  test('a closed subgraph may turn against the flow; an open one may not', () => {
    const alt = { ...spacing, nodeNode: 1 }
    const base = inputOf(['A>B', 'X>G', 'G>Y'], { G: ['A', 'B'] })
    const res = layout({
      ...base,
      compounds: [{ id: 'G', titleW: 3, dir: 'right' }],
      altSpacing: alt,
    })
    // inside G the flow runs right: A beside B, boxes still 5×3
    expect(res.nodes.A.y).toBe(res.nodes.B.y)
    expect(res.nodes.A.x + res.nodes.A.w).toBeLessThanOrEqual(res.nodes.B.x)
    expect([res.nodes.A.w, res.nodes.A.h]).toEqual([5, 3])
    expect(inside(res.compounds.G, res.nodes.A)).toBe(true)
    // a crossing edge voids the override
    const open = layout({
      ...inputOf(['X>A', 'A>B'], { G: ['A', 'B'] }),
      compounds: [{ id: 'G', titleW: 3, dir: 'right' }],
      altSpacing: alt,
    })
    expect(open.nodes.A.y + open.nodes.A.h).toBeLessThanOrEqual(open.nodes.B.y)
  })

  test('nested direction flips: down, then right, then down again', () => {
    const alt = { ...spacing, nodeNode: 1 }
    const res = layout({
      ...inputOf(['A>B', 'B>H', 'P>Q', 'X>G'], { G: ['A', 'B', 'H'], H: ['P', 'Q'] }),
      compounds: [
        { id: 'G', titleW: 3, dir: 'right' },
        { id: 'H', parent: 'G', titleW: 3, dir: 'down' },
      ],
      altSpacing: alt,
    })
    // G flows right, H inside it flows down again; sizes survive the double flip
    expect(res.nodes.A.y).toBe(res.nodes.B.y)
    expect(res.nodes.A.x + res.nodes.A.w).toBeLessThanOrEqual(res.nodes.B.x)
    expect(res.nodes.P.x).toBe(res.nodes.Q.x)
    expect(res.nodes.P.y + res.nodes.P.h).toBeLessThanOrEqual(res.nodes.Q.y)
    expect([res.nodes.P.w, res.nodes.P.h]).toEqual([5, 3])
    expect(inside(res.compounds.G, res.compounds.H)).toBe(true)
  })

  test('a right layout with a down subgraph: the child stacks, the rest flows right', () => {
    const res = layout({
      ...inputOf(['A>B', 'X>G'], { G: ['A', 'B'] }),
      dir: 'right',
      compounds: [{ id: 'G', titleW: 3, dir: 'down' }],
      altSpacing: { ...spacing, nodeNode: 1 },
    })
    expect(res.nodes.A.x).toBe(res.nodes.B.x)
    expect(res.nodes.A.y + res.nodes.A.h).toBeLessThanOrEqual(res.nodes.B.y)
    expect([res.nodes.A.w, res.nodes.A.h]).toEqual([5, 3])
    // X sits left of the frame
    expect(res.nodes.X.x + res.nodes.X.w).toBeLessThanOrEqual(res.compounds.G.x)
  })

  test('random nested graphs: every edge routed once, frames consistent', () => {
    let seed = 4242
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let trial = 0; trial < 40; trial++) {
      const n = 4 + rand(7)
      const ids = Array.from({ length: n }, (_, i) => `N${i}`)
      const edges: string[] = []
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) if (i !== j && rand(4) === 0) edges.push(`${ids[i]}>${ids[j]}`)
      }
      const groups: Groups = { G: [], H: [] }
      for (const id of ids) {
        const k = rand(3)
        if (k === 0) groups.G.push(id)
        else if (k === 1) groups.H.push(id)
      }
      if (rand(2) === 0) groups.G.push('H')
      const input = inputOf(edges, groups)
      const res = layout(input)
      for (const e of input.edges) {
        const r = res.edges[e.id]
        expect(r).toBeDefined()
        expect(wellFormed(r.route, box(res, e.from), box(res, e.to))).toBe(true)
      }
      const { G, H } = res.compounds
      for (const nd of input.nodes) {
        if (nd.parent !== undefined)
          expect(inside(res.compounds[nd.parent], res.nodes[nd.id])).toBe(true)
      }
      if (groups.G.includes('H')) expect(inside(G, H)).toBe(true)
      else expect(disjoint(G, H)).toBe(true)
      for (const r of [...Object.values(res.nodes), ...Object.values(res.compounds)]) {
        expect(r.x + r.w).toBeLessThanOrEqual(res.width)
        expect(r.y + r.h).toBeLessThanOrEqual(res.height)
      }
    }
  })
})
