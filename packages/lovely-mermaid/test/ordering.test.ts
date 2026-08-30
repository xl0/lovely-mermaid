import { describe, expect, test } from 'bun:test'
import { breakCycles } from '../src/engine/cycles.ts'
import type { LGraph } from '../src/engine/graph.ts'
import type { OrderingOptions } from '../src/engine/index.ts'
import { assignLayers, splitLongEdges } from '../src/engine/layering.ts'
import { crossingsOf, orderNodes, portCell } from '../src/engine/ordering.ts'
import { graph, pure } from './engine-helpers.ts'

/** Through cycles, layers and split, ready for ordering. */
const layered = (edges: string[]): LGraph =>
  splitLongEdges(assignLayers(breakCycles(graph(edges), {}), {}))
const rows = (g: LGraph): string[][] => g.layers.map((row) => row.map((n) => n.id))
const southOf = (g: LGraph, id: string): string[] =>
  (g.nodes.find((n) => n.id === id) as LGraph['nodes'][number]).ports
    .filter((p) => p.side === 'S')
    .map((p) => p.out[0].dst.node.id)

describe('ordering', () => {
  test('removes a crossing by swapping two nodes, without touching its input', () => {
    // layers [A, B] / [X, Y] as declared; A→Y and B→X cross in that order
    const g = pure(layered(['A', 'B', 'X', 'Y', 'A>Y', 'B>X']), (g) => orderNodes(g, {}))
    expect(rows(g)).toEqual([
      ['A', 'B'],
      ['Y', 'X'],
    ])
    expect(crossingsOf(g)).toBe(0)
  })

  test('orders a node’s ports by where their edges go', () => {
    const before = layered(['A', 'B', 'X', 'Y', 'A>Y', 'A>X', 'B>X'])
    // B→X crosses A→Y, and A's ports [→Y, →X] cross each other over [X, Y]
    expect(crossingsOf(before)).toBe(2)
    const g = orderNodes(before, {})
    expect(crossingsOf(g)).toBe(0)
    // A's south ports follow the order its targets ended up in
    expect(southOf(g, 'A')).toEqual(rows(g)[1].filter((id) => id === 'X' || id === 'Y'))
  })

  test('keeps an already-minimal declaration order', () => {
    const edges = ['A>X', 'A>Y', 'B>Y', 'B>Z', 'X>P', 'Y>P', 'Z>Q']
    const g = orderNodes(layered(edges), {})
    expect(rows(g)).toEqual(rows(layered(edges)))
    expect(crossingsOf(g)).toBe(0)
  })

  test('`none` keeps declaration order but still assigns port cells', () => {
    const g = orderNodes(layered(['A', 'B', 'X', 'Y', 'A>Y', 'B>X']), { strategy: 'none' })
    expect(rows(g)).toEqual([
      ['A', 'B'],
      ['X', 'Y'],
    ])
    expect(crossingsOf(g)).toBe(1)
    for (const n of g.nodes) for (const p of n.ports) expect(p.pos).toBeGreaterThanOrEqual(0)
  })

  test('port cells: centre for one, spread for several, corners excluded, dummies at 0', () => {
    const node = (w: number) => ({
      id: 'n',
      kind: 'node' as const,
      w,
      h: 3,
      layer: 0,
      order: 0,
      x: -1,
      y: -1,
      ports: [],
    })
    expect(portCell(node(10), 0, 1)).toBe(4)
    expect([0, 1].map((i) => portCell(node(10), i, 2))).toEqual([2, 6])
    expect([0, 1, 2].map((i) => portCell(node(10), i, 3))).toEqual([2, 4, 7])
    expect([0, 1, 2, 3].map((i) => portCell(node(8), i, 4))).toEqual([1, 3, 4, 6])
    expect(portCell(node(3), 0, 1)).toBe(1)
    // over capacity: cells are shared evenly, never the corners
    expect([0, 1, 2, 3].map((i) => portCell(node(4), i, 4))).toEqual([1, 1, 2, 2])
    expect(portCell({ ...node(1), kind: 'dummy' }, 0, 2)).toBe(0)
  })

  test('never worsens random layered graphs; sub-steps are reported', () => {
    let seed = 777
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let trial = 0; trial < 30; trial++) {
      const n = 6 + rand(6)
      const ids = Array.from({ length: n }, (_, i) => `N${i}`)
      const edges: string[] = []
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) if (rand(3) === 0) edges.push(`${ids[i]}>${ids[j]}`)
      }
      if (edges.length < 2) continue
      const before = layered(edges)
      const notes: string[] = []
      const opts: OrderingOptions[] = [{}, { greedySwitch: false }, { thoroughness: 1 }]
      for (const o of opts) {
        const after = orderNodes(before, o, (_, note) => notes.push(note))
        expect(crossingsOf(after)).toBeLessThanOrEqual(crossingsOf(before))
        // same multiset of nodes per layer
        expect(rows(after).map((r) => [...r].sort())).toEqual(
          rows(before).map((r) => [...r].sort()),
        )
        for (const node of after.nodes)
          for (const p of node.ports) expect(p.order).toBeGreaterThanOrEqual(0)
      }
      if (crossingsOf(before) > 0)
        expect(notes.some((s) => /^sweep 1\.1 ↓ · \d+ crossings$/.test(s))).toBe(true)
    }
  })
})
