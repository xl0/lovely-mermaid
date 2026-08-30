import { describe, expect, test } from 'bun:test'
import { breakCycles } from '../src/engine/cycles.ts'
import type { LGraph, LNode } from '../src/engine/graph.ts'
import { ancestors, borderNode, frameOf } from '../src/engine/graph.ts'
import { layout } from '../src/engine/index.ts'
import { assignLayers, splitLongEdges } from '../src/engine/layering.ts'
import { orderNodes } from '../src/engine/ordering.ts'
import { placeNodes } from '../src/engine/placement.ts'
import { routeEdges } from '../src/engine/routing.ts'
import type { Rect } from '../src/engine/types.ts'
import { graph, pure, spacing } from './engine-helpers.ts'

type Groups = Record<string, string[]>
const layered = (edges: string[], groups: Groups): LGraph =>
  splitLongEdges(assignLayers(breakCycles(graph(edges, groups), {}), {}))
const ordered = (edges: string[], groups: Groups): LGraph => orderNodes(layered(edges, groups), {})
const placed = (edges: string[], groups: Groups): LGraph => placeNodes(ordered(edges, groups), {})
const routed = (edges: string[], groups: Groups): LGraph => routeEdges(placed(edges, groups), {})
const node = (g: LGraph, id: string): LNode => g.nodes.find((n) => n.id === id) as LNode
const span = (g: LGraph, c: string): [number, number] => [
  borderNode(g, c, 'top').layer,
  borderNode(g, c, 'bottom').layer,
]
const inside = (r: Rect, n: LNode): boolean =>
  n.x > r.x && n.x + n.w <= r.x + r.w - 1 && n.y > r.y && n.y + n.h <= r.y + r.h - 1
const disjoint = (a: Rect, b: Rect): boolean =>
  a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
const contains = (a: Rect, b: Rect): boolean =>
  b.x > a.x && b.y > a.y && b.x + b.w < a.x + a.w && b.y + b.h < a.y + a.h

/** Every compound's nodes are one contiguous run in every layer. */
function contiguous(g: LGraph): boolean {
  for (const row of g.layers) {
    for (const c of g.compounds) {
      const flags = row.map((n) => ancestors(g, n).includes(c.id))
      const first = flags.indexOf(true)
      const last = flags.lastIndexOf(true)
      if (first >= 0 && flags.slice(first, last + 1).includes(false)) return false
    }
  }
  return true
}

describe('compound graphs', () => {
  test('import: border rows per compound, parents, edges to a compound hit its rows', () => {
    const g = graph(['A>B', 'X>G', 'G>Y'], { G: ['A', 'B'] })
    expect(node(g, 'A').parent).toBe('G')
    expect(node(g, 'X').parent).toBeUndefined()
    expect(borderNode(g, 'G', 'top').border).toBe('top')
    expect(g.edges.map((e) => `${e.src.node.id}>${e.dst.node.id}`)).toEqual([
      'A>B',
      'X>G/top',
      'G/bottom>Y',
    ])
  })

  test('layering: the rows enclose the members and nest, nothing else is left behind', () => {
    const g = pure(
      breakCycles(graph(['A>B', 'B>C', 'X>A'], { G: ['A', 'B', 'H'], H: ['C'] }), {}),
      (g) => assignLayers(g, {}),
    )
    const [gTop, gBottom] = span(g, 'G')
    const [hTop, hBottom] = span(g, 'H')
    expect(gTop).toBeLessThan(node(g, 'A').layer)
    expect(node(g, 'B').layer).toBeLessThan(gBottom)
    expect(gTop).toBeLessThan(hTop)
    expect(hTop).toBeLessThan(node(g, 'C').layer)
    expect(node(g, 'C').layer).toBeLessThan(hBottom)
    expect(hBottom).toBeLessThan(gBottom)
    expect(node(g, 'X').layer).toBeLessThan(node(g, 'A').layer)
    // the nesting edges are gone; the real ones remain
    expect(g.edges.map((e) => e.id).sort()).toEqual(['e0', 'e1', 'e2'])
    for (const n of g.nodes) for (const p of n.ports) expect(p.in.length + p.out.length).toBe(1)
  })

  test('layering: a frame hugs its content instead of floating up', () => {
    // X→Y→Z outside, then Z→A inside G: G's top row should sit right above A
    const g = assignLayers(graph(['X>Y', 'Y>Z', 'Z>A'], { G: ['A'] }), {})
    expect(span(g, 'G')[0]).toBe(node(g, 'A').layer - 1)
  })

  test('layering: an empty compound is two rows; an edge into its own frame is reversed', () => {
    const g = assignLayers(graph(['A>G'], { G: ['A'], E: [] }), {})
    const [eTop, eBottom] = span(g, 'E')
    expect(eBottom).toBe(eTop + 1)
    expect(g.edges[0].reversed).toBe(true)
    expect(g.edges[0].src.node.id).toBe('G/top')
  })

  test('split: dummies stay inside the frame down to its bottom row, side columns are added', () => {
    // A in G, far below is Z outside; the chain leaves through G's bottom row
    const g = layered(['A>Z:4', 'A>B'], { G: ['A', 'B'] })
    const [, gBottom] = span(g, 'G')
    for (const n of g.nodes) {
      if (n.kind !== 'dummy') continue
      expect(n.parent).toBe(n.layer <= gBottom ? 'G' : undefined)
    }
    const [gTop] = span(g, 'G')
    for (let l = gTop; l <= gBottom; l++) {
      const ids = g.layers[l].map((n) => n.id)
      expect(ids).toContain(`G/left@${l}`)
      expect(ids).toContain(`G/right@${l}`)
    }
    const chain = g.edges.filter((e) => e.border === true)
    expect(chain.length).toBe(2 * (gBottom - gTop))
  })

  test('ordering: blocks are contiguous, side columns at their ends, and crossings still drop', () => {
    const g = pure(
      layered(['A>Y', 'B>X', 'C>Z', 'A', 'B', 'C', 'X', 'Y', 'Z'], { G: ['B', 'X'] }),
      (g) => orderNodes(g, {}),
    )
    expect(contiguous(g)).toBe(true)
    for (const row of g.layers) {
      const flags = row.map((n) => ancestors(g, n).includes('G'))
      const first = flags.indexOf(true)
      if (first < 0) continue
      expect(row[first].border).toBe('left')
      expect(row[flags.lastIndexOf(true)].border).toBe('right')
    }
    // the outside pair A→Y, C→Z untangles around the block
    const order = (id: string): number => node(g, id).order
    expect(order('A') < order('C')).toBe(order('Y') < order('Z'))
  })

  test('placement: side columns are straight, frames nest and siblings are disjoint', () => {
    const g = pure(
      ordered(['A>B', 'B>C', 'C>D', 'X>A', 'D>Y', 'P>Q'], {
        G: ['A', 'B', 'H'],
        H: ['C', 'D'],
        K: ['P', 'Q'],
      }),
      (g) => placeNodes(g, {}),
    )
    for (const c of g.compounds) {
      for (const side of ['left', 'right']) {
        const xs = g.nodes.filter((n) => n.origin === c.id && n.border === side).map((n) => n.x)
        expect(new Set(xs).size).toBe(1)
      }
    }
    const r = routeEdges(g, {})
    const frames = new Map(g.compounds.map((c) => [c.id, frameOf(r, c.id) as Rect]))
    for (const n of r.nodes) {
      if (n.kind !== 'node' || n.parent === undefined) continue
      expect(inside(frames.get(n.parent) as Rect, n)).toBe(true)
    }
    expect(contains(frames.get('G') as Rect, frames.get('H') as Rect)).toBe(true)
    expect(disjoint(frames.get('G') as Rect, frames.get('K') as Rect)).toBe(true)
    expect(frames.get('G')?.w).toBeGreaterThanOrEqual(3 + 2) // titleW 3 plus corners
  })

  test('placement: an edge entering a frame through its side bends, the frame does not', () => {
    // G spans layers that K also spans; A→Q enters K from the side
    const g = routed(['A>B', 'B>C', 'P>Q', 'A>Q:3'], { G: ['A', 'B', 'C'], K: ['P', 'Q'] })
    for (const c of ['G', 'K']) {
      const xs = g.nodes.filter((n) => n.origin === c && n.border === 'left').map((n) => n.x)
      expect(new Set(xs).size).toBe(1)
    }
  })

  test('network simplex placer keeps the columns straight too', () => {
    const g = placeNodes(ordered(['A>B', 'B>C', 'X>A', 'C>Y'], { G: ['A', 'B', 'C'] }), {
      strategy: 'networkSimplex',
    })
    const xs = g.nodes.filter((n) => n.origin === 'G' && n.border === 'left').map((n) => n.x)
    expect(new Set(xs).size).toBe(1)
  })

  test('layout: frames in the result, sideways title becomes a least span', () => {
    const input = {
      dir: 'down' as const,
      spacing,
      nodes: [
        { id: 'A', w: 5, h: 3, parent: 'G' },
        { id: 'B', w: 5, h: 3 },
      ],
      edges: [{ id: 'e', from: 'A', to: 'B' }],
      compounds: [{ id: 'G', titleW: 20 }],
    }
    const down = layout(input)
    expect(down.compounds.G.w).toBeGreaterThanOrEqual(22)
    expect(inside(down.compounds.G, { ...down.nodes.A, id: 'A' } as LNode)).toBe(true)
    expect(down.width).toBeGreaterThanOrEqual(down.compounds.G.x + down.compounds.G.w)
    const right = layout({ ...input, dir: 'right' })
    // the title runs along the flow axis: the frame is at least that wide
    expect(right.compounds.G.w).toBeGreaterThanOrEqual(22)
    expect(right.compounds.G.h).toBeLessThan(22)
    expect(inside(right.compounds.G, { ...right.nodes.A, id: 'A' } as LNode)).toBe(true)
  })

  test('layout: no routed border edges, frames grow the canvas, random graphs stay sane', () => {
    let seed = 4242
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let trial = 0; trial < 25; trial++) {
      const n = 5 + rand(6)
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
      if (rand(2) === 0) groups.G.push('H') // nest H in G
      const g = routed(edges, groups)
      expect(contiguous(g)).toBe(true)
      for (const e of g.edges) {
        if (e.border === true) expect(e.route).toBeNull()
        else expect(e.route).not.toBeNull()
      }
      const frames = new Map(g.compounds.map((c) => [c.id, frameOf(g, c.id) as Rect]))
      for (const nd of g.nodes) {
        if (nd.kind !== 'node' || nd.parent === undefined) continue
        expect(inside(frames.get(nd.parent) as Rect, nd)).toBe(true)
      }
      const G = frames.get('G') as Rect
      const H = frames.get('H') as Rect
      if (groups.G.includes('H')) expect(contains(G, H)).toBe(true)
      else expect(disjoint(G, H)).toBe(true)
    }
  })
})
