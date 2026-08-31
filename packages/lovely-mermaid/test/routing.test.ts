import { describe, expect, test } from 'bun:test'
import { breakCycles } from '../src/engine/cycles.ts'
import type { LGraph } from '../src/engine/graph.ts'
import { assignLayers, splitLongEdges } from '../src/engine/layering.ts'
import { orderNodes } from '../src/engine/ordering.ts'
import { placeNodes } from '../src/engine/placement.ts'
import { joinRoutes, routeEdges } from '../src/engine/routing.ts'
import type { Pt } from '../src/engine/types.ts'
import { graph, pure } from './engine-helpers.ts'

const placed = (items: string[], order: 'sweep' | 'none' = 'sweep'): LGraph =>
  placeNodes(
    orderNodes(splitLongEdges(assignLayers(breakCycles(graph(items), {}), {})), {
      strategy: order,
    }),
    {},
  )
const routed = (items: string[], order: 'sweep' | 'none' = 'sweep'): LGraph =>
  routeEdges(placed(items, order), {})
const routeOf = (g: LGraph, id: string): Pt[] => joinRoutes(g).get(id) as Pt[]

/** Every route is orthogonal, in bounds, starts and ends on its port cells. */
function wellFormed(g: LGraph): void {
  const height = Math.max(...g.nodes.map((n) => n.y + Math.max(1, n.h)))
  for (const e of g.edges) {
    if (e.src.node === e.dst.node) continue
    const r = e.route as Pt[]
    expect(r.length).toBeGreaterThanOrEqual(2)
    expect(r[0]).toEqual([
      e.src.node.x + e.src.pos,
      e.src.node.kind === 'dummy' ? e.src.node.y : e.src.node.y + e.src.node.h - 1,
    ])
    expect(r[r.length - 1][0]).toBe(e.dst.node.x + e.dst.pos)
    expect(r[r.length - 1][1]).toBe(e.dst.node.y)
    for (let i = 1; i < r.length; i++) {
      expect(r[i][0] === r[i - 1][0] || r[i][1] === r[i - 1][1]).toBe(true)
      expect(r[i][1]).toBeGreaterThanOrEqual(r[i - 1][1])
    }
    for (const [x, y] of r) expect(x >= 0 && y >= 0 && y < height).toBe(true)
  }
}

/**
 * No two edges share a vertical or horizontal stretch unless they belong to
 * the same trunk — they leave the same source cell or enter the same
 * target cell (a fan-out / fan-in bus with one junction).
 */
function noOverlap(g: LGraph): void {
  const byId = new Map(g.edges.map((e) => [e.id, e]))
  const srcCell = (id: string): string => {
    const e = byId.get(id) as LGraph['edges'][number]
    return `${e.src.node.id}:${e.src.node.x + e.src.pos}`
  }
  const dstCell = (id: string): string => {
    const e = byId.get(id) as LGraph['edges'][number]
    return `${e.dst.node.id}:${e.dst.node.x + e.dst.pos}`
  }
  const sameTrunk = (a: string, b: string): boolean =>
    (byId.get(a) as LGraph['edges'][number]).origin ===
      (byId.get(b) as LGraph['edges'][number]).origin ||
    srcCell(a) === srcCell(b) ||
    dstCell(a) === dstCell(b)
  const seen = new Map<string, string>()
  for (const e of g.edges) {
    const r = e.route as Pt[]
    for (let i = 1; i < r.length; i++) {
      const [ax, ay] = r[i - 1]
      const [bx, by] = r[i]
      const cells: string[] = []
      if (ax === bx)
        for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) cells.push(`v${ax},${y}`)
      else for (let x = Math.min(ax, bx) + 1; x < Math.max(ax, bx); x++) cells.push(`h${x},${ay}`)
      for (const k of cells) {
        const owner = seen.get(k)
        if (owner !== undefined && owner !== e.id && !sameTrunk(owner, e.id)) {
          throw new Error(`${e.id} overlaps ${owner} at ${k}`)
        }
        seen.set(k, e.id)
      }
    }
  }
}

describe('routing', () => {
  test('self-loops hang off the east border on reserved columns', () => {
    const g = routed(['A>A', 'A>B', 'C>B', 'A>A'])
    const A = g.nodes.find((n) => n.id === 'A') as LGraph['nodes'][number]
    const C = g.nodes.find((n) => n.id === 'C') as LGraph['nodes'][number]
    const loops = g.edges.filter((e) => e.src.node === e.dst.node)
    expect(loops.length).toBe(2)
    const routes = loops.map((e) => e.route as Pt[])
    // both loop around the east border, the second two columns further out
    for (const r of routes) {
      expect(r[0][0]).toBe(A.x + A.w - 1)
      expect(r[1][1]).toBe(r[0][1])
      expect(r[2][1]).toBe(r[3][1])
    }
    const outs = routes.map((r) => r[1][0]).sort((a, b) => a - b)
    expect(outs).toEqual([A.x + A.w + 1, A.x + A.w + 3])
    // the neighbour keeps clear of the reserved columns
    if (C.layer === A.layer && C.x > A.x) expect(C.x).toBeGreaterThan(A.x + A.w + 4)
    wellFormed(g)
  })

  test('relaxation: an unobstructed chain drops dead straight from its port', () => {
    const g = routed(['A>Z:3'])
    const chain = g.nodes.filter((n) => n.kind === 'dummy')
    expect(chain.length).toBe(2)
    const e = g.edges.find((x) => x.id === 'e0') as LGraph['edges'][number]
    for (const d of chain) expect(d.x).toBe(e.src.node.x + e.src.pos)
    expect(new Set(routeOf(g, 'e0').map(([x]) => x)).size).toBe(1)
    wellFormed(g)
  })

  test('relaxation: an obstructed chain takes one column, nearest the port its gaps allow', () => {
    const g = routed(['A>B', 'B>C', 'C>D', 'A>D:3', 'A(7)', 'B(3)', 'C(3)'])
    const chain = g.nodes.filter((n) => n.kind === 'dummy' && n.origin === 'e3')
    expect(chain.length).toBe(2)
    expect(new Set(chain.map((n) => n.x)).size).toBe(1)
    // one jog at most between the port column and the chain column
    expect(new Set(routeOf(g, 'e3').map(([x]) => x)).size).toBeLessThanOrEqual(2)
    wellFormed(g)
  })

  test('relaxation: an over-constrained chain stays inside its gaps', () => {
    // wide nodes on both sides leave the middle chain no slack anywhere
    const g = routed(['L1>L2', 'L2>L3', 'R1>R2', 'R2>R3', 'A>Z:3', 'L1', 'R1', 'A', 'Z'])
    for (const n of g.nodes) {
      if (n.kind !== 'dummy') continue
      const row = g.layers[n.layer]
      const a = row[n.order - 1]
      const b = row[n.order + 1]
      if (a !== undefined) expect(n.x).toBeGreaterThanOrEqual(a.x + a.w + 1)
      if (b !== undefined) expect(n.x).toBeLessThanOrEqual(b.x - 2)
    }
    wellFormed(g)
  })

  test('a straight chain needs one row per channel, without touching its input', () => {
    const g = pure(placed(['A>B', 'B>C']), (g) => routeEdges(g, {}))
    const ys = Object.fromEntries(g.nodes.map((n) => [n.id, n.y]))
    expect(ys).toEqual({ A: 0, B: 4, C: 8 })
    expect(routeOf(g, 'e0')).toEqual([
      [2, 2],
      [2, 4],
    ])
    wellFormed(g)
  })

  test('a fan-out gets one track and a jog', () => {
    const g = routed(['A>X', 'A>Y'])
    // A sits over X (straight); the edge to Y jogs on the single track
    const ys = Object.fromEntries(g.nodes.map((n) => [n.id, n.y]))
    expect(ys.X).toBe(3 + 1 + 2) // band 3, channel = 1 track + 2 gap rows
    const toY = routeOf(g, 'e1')
    expect(toY.length).toBe(4)
    expect(toY[1][1]).toBe(4) // the track row: band bottom 2, gap 1
    expect(toY[1][1]).toBe(toY[2][1])
    wellFormed(g)
    noOverlap(g)
  })

  test('two edges swapping columns get split so nothing merges', () => {
    // declaration order kept and columns forced into an X: A over X, B over Y,
    // but A→Y and B→X
    const p = placed(['A', 'B', 'X', 'Y', 'A>Y', 'B>X'], 'none')
    for (const n of p.nodes) n.x = { A: 0, B: 8, X: 0, Y: 8 }[n.id] as number
    const g = routeEdges(p, {})
    wellFormed(g)
    noOverlap(g)
    const a = routeOf(g, 'e0')
    const b = routeOf(g, 'e1')
    // one of them jogs through a free column: six points; the other four
    expect([a.length, b.length].sort()).toEqual([4, 6])
    const rows = new Set([...a, ...b].map((p) => p[1]))
    expect(rows.size).toBeGreaterThanOrEqual(4)
  })

  test('a shared target cell is one trunk with a junction', () => {
    const g = routed(['A>T', 'B>T', 'T(3)'])
    wellFormed(g)
    // both edges end on T's single cell; their last points coincide
    expect(routeOf(g, 'e0').at(-1)).toEqual(routeOf(g, 'e1').at(-1))
  })

  test('random graphs route without overlaps and within bounds', () => {
    let seed = 99
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let trial = 0; trial < 25; trial++) {
      const n = 5 + rand(6)
      const items = Array.from({ length: n }, (_, i) => `N${i}(${3 + rand(8)})`)
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) if (rand(3) === 0) items.push(`N${i}>N${j}`)
      if (items.length === n) continue
      const g = routed(items)
      wellFormed(g)
      noOverlap(g)
      expect(g.warnings.filter((w) => w.startsWith('routing'))).toEqual([])
      // horizontal runs lie in channels, never inside a band
      const bands = g.layers.map((row) => {
        const top = Math.min(...row.map((n) => n.y))
        return [top, top + Math.max(1, ...row.map((n) => n.h)) - 1]
      })
      for (const e of g.edges) {
        const r = e.route as Pt[]
        for (let i = 1; i < r.length; i++) {
          if (r[i][1] !== r[i - 1][1] || r[i][0] === r[i - 1][0]) continue
          expect(bands.some(([t, b]) => r[i][1] >= t && r[i][1] <= b)).toBe(false)
        }
      }
    }
  })
})
