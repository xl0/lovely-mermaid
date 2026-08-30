import { describe, expect, test } from 'bun:test'
import { breakCycles } from '../src/engine/cycles.ts'
import type { LGraph } from '../src/engine/graph.ts'
import { buildGraph } from '../src/engine/graph.ts'
import type { CyclesOptions, LayoutInput } from '../src/engine/index.ts'
import { graph, pure, spacing } from './engine-helpers.ts'

const reversed = (g: LGraph): string[] =>
  g.edges.filter((e) => e.reversed).map((e) => `${e.dst.node.id}>${e.src.node.id}`)
/** Kahn: every node placeable → acyclic. */
const acyclic = (g: LGraph): boolean => {
  const indeg = new Map(g.nodes.map((n) => [n, 0]))
  for (const e of g.edges) indeg.set(e.dst.node, (indeg.get(e.dst.node) as number) + 1)
  const queue = g.nodes.filter((n) => indeg.get(n) === 0)
  for (let i = 0; i < queue.length; i++) {
    for (const p of queue[i].ports) {
      for (const e of p.out) {
        const d = (indeg.get(e.dst.node) as number) - 1
        indeg.set(e.dst.node, d)
        if (d === 0) queue.push(e.dst.node)
      }
    }
  }
  return queue.length === g.nodes.length
}

describe('cycle breaking', () => {
  const strategies: CyclesOptions[] = [{}, { strategy: 'greedy' }, { strategy: 'dfs' }]

  test('leaves a DAG alone and never touches its input', () => {
    for (const opts of strategies) {
      const g = pure(graph(['A>B', 'B>C', 'A>C', 'C>D']), (g) => breakCycles(g, opts))
      expect(reversed(g)).toEqual([])
    }
  })

  test('breaks a triangle with one reversal, the last edge in declaration order', () => {
    for (const opts of strategies) {
      const g = breakCycles(graph(['A>B', 'B>C', 'C>A']), opts)
      expect(reversed(g)).toEqual(['C>A'])
      expect(acyclic(g)).toBe(true)
    }
  })

  test('greedy finds the single edge shared by two cycles; dfs reverses two', () => {
    // cycles A-B-C and B-C-D share B>C
    const edges = ['A>B', 'B>C', 'C>A', 'C>D', 'D>B']
    const g = breakCycles(graph(edges), { strategy: 'greedy' })
    expect(reversed(g)).toEqual(['B>C'])
    expect(acyclic(g)).toBe(true)
    const d = breakCycles(graph(edges), { strategy: 'dfs' })
    expect(reversed(d)).toEqual(['C>A', 'D>B'])
    expect(acyclic(d)).toBe(true)
  })

  test('is deterministic and handles multi-edges and disconnected parts', () => {
    const edges = ['A>B', 'A>B', 'B>A', 'X>Y', 'Y>Z', 'Z>X', 'Z>X', 'P>Q']
    const a = breakCycles(graph(edges), {})
    const b = breakCycles(graph(edges), {})
    expect(reversed(a)).toEqual(reversed(b))
    expect(acyclic(a)).toBe(true)
    // the 2-cycle A<->B loses its single back edge, not the parallel pair
    expect(reversed(a)).toContain('B>A')
    expect(reversed(a).filter((e) => e === 'A>B')).toEqual([])
  })

  test('a reversed edge is stored in layout direction with the arrow at its original end', () => {
    const input: LayoutInput = {
      dir: 'down',
      spacing,
      nodes: ['A', 'B'].map((id) => ({ id, w: 5, h: 3 })),
      edges: [
        { id: 'ab', from: 'A', to: 'B' },
        { id: 'ba', from: 'B', to: 'A' },
      ],
    }
    const g = breakCycles(buildGraph(input), {})
    const e = g.edges.find((e) => e.id === 'ba')
    expect(e?.reversed).toBe(true)
    expect([e?.src.node.id, e?.dst.node.id]).toEqual(['A', 'B'])
  })
})
