import { describe, expect, test } from 'bun:test'
import type { LGraph } from '../src/engine/graph.ts'
import type { LayeringOptions } from '../src/engine/index.ts'
import { assignLayers, splitLongEdges } from '../src/engine/layering.ts'
import { graph, pure } from './engine-helpers.ts'

const layers = (g: LGraph): Record<string, number> =>
  Object.fromEntries(g.nodes.map((n) => [n.id, n.layer]))
const feasible = (g: LGraph): boolean =>
  g.edges.every((e) => e.dst.node.layer - e.src.node.layer >= e.minLen)
const cost = (g: LGraph): number =>
  g.edges.reduce((t, e) => t + e.weight * (e.dst.node.layer - e.src.node.layer), 0)
const both: LayeringOptions[] = [{ strategy: 'longestPath' }, { strategy: 'networkSimplex' }]

describe('layering', () => {
  test('maxWidth staggers an overwide row and keeps every edge pointing down', () => {
    const items = ['R>A', 'R>B', 'R>C', 'R>D', 'A(20)', 'B(20)', 'C(20)', 'D(20)']
    const plain = assignLayers(graph(items), {})
    expect(plain.layers.length).toBe(2)
    const g = assignLayers(graph(items), { maxWidth: 50 })
    expect(g.layers.length).toBe(3)
    const width = (row: (typeof g.layers)[number]): number =>
      row.reduce((t, n) => t + n.w, 0) + 3 * (row.length - 1)
    for (const row of g.layers) expect(width(row)).toBeLessThanOrEqual(50)
    for (const e of g.edges) {
      expect(e.dst.node.layer - e.src.node.layer).toBeGreaterThanOrEqual(e.minLen)
    }
  })

  test('packing keeps every invariant on random capped graphs', () => {
    let seed = 20260831
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let trial = 0; trial < 30; trial++) {
      const n = 5 + rand(8)
      const ids = Array.from({ length: n }, (_, i) => `N${i}(${4 + rand(18)})`)
      const items: string[] = [...ids]
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (rand(3) === 0) items.push(`N${i}>N${j}${rand(4) === 0 ? ':2' : ''}`)
        }
      }
      const cap = rand(2) === 0 ? undefined : 25 + rand(40)
      const g = assignLayers(graph(items), { maxWidth: cap })
      for (const e of g.edges) {
        expect(e.dst.node.layer - e.src.node.layer).toBeGreaterThanOrEqual(e.minLen)
      }
      if (cap !== undefined) {
        for (const row of g.layers) {
          if (row.length < 2) continue
          const w = row.reduce((t, q) => t + q.w, 0) + 3 * (row.length - 1)
          expect(w).toBeLessThanOrEqual(cap)
        }
      }
      // no empty rows survive packing's compaction unless a span needs them
      for (const [l, row] of g.layers.entries()) {
        if (row.length > 0) continue
        const needed = g.edges.some(
          (e) =>
            e.src.node.layer < l &&
            l < e.dst.node.layer &&
            e.dst.node.layer - e.src.node.layer - 1 < e.minLen,
        )
        expect(needed).toBe(true)
      }
    }
  })

  test('maxWidth prefers to move nodes whose edges go on down', () => {
    // E and F continue downward; A and B are sinks — E and F should move,
    // keeping their out-edges short
    const g = assignLayers(
      graph(['R>A', 'R>B', 'R>E', 'R>F', 'E>Z', 'F>Z', 'A(18)', 'B(18)', 'E(18)', 'F(18)']),
      { maxWidth: 45 },
    )
    const E = g.nodes.find((n) => n.id === 'E') as (typeof g.nodes)[number]
    const A = g.nodes.find((n) => n.id === 'A') as (typeof g.nodes)[number]
    expect(E.layer).toBe(A.layer + 1)
  })

  test('chains and diamonds, without touching the input', () => {
    for (const opts of both) {
      const g = pure(graph(['A>B', 'B>C', 'A>C', 'C>D']), (g) => assignLayers(g, opts))
      expect(layers(g)).toEqual({ A: 0, B: 1, C: 2, D: 3 })
      expect(g.layers.map((row) => row.map((n) => n.id))).toEqual([['A'], ['B'], ['C'], ['D']])
    }
  })

  test('minimum lengths are honoured', () => {
    for (const opts of both) {
      const g = assignLayers(graph(['A>B:2', 'B>C']), opts)
      expect(layers(g)).toEqual({ A: 0, B: 2, C: 3 })
    }
  })

  test('network simplex pulls a dangling source down; longest path leaves it at 0', () => {
    const edges = ['A>B', 'B>C', 'C>D', 'X>D']
    const lp = assignLayers(graph(edges), { strategy: 'longestPath' })
    expect(layers(lp).X).toBe(0)
    const ns = assignLayers(graph(edges), {})
    expect(layers(ns)).toEqual({ A: 0, B: 1, C: 2, D: 3, X: 2 })
    expect(cost(ns)).toBeLessThan(cost(lp))
  })

  test('a heavy edge is kept short at the expense of light ones', () => {
    const g = assignLayers(graph(['A>B', 'B>C', 'C>D', 'A>D*10', 'P>D']), {})
    expect(feasible(g)).toBe(true)
    expect(layers(g).D - layers(g).P).toBe(1)
    expect(layers(g)).toMatchObject({ A: 0, B: 1, C: 2, D: 3 })
  })

  test('balancing moves a free node to an emptier layer', () => {
    const g = assignLayers(graph(['A>B', 'B>C', 'C>D', 'D>E', 'A>X', 'X>E', 'A>P', 'A>Q']), {})
    expect(feasible(g)).toBe(true)
    // X may sit in layers 1..3; layer 1 holds B, P, Q — layer 2 is emptier
    expect(layers(g).X).toBe(2)
  })

  test('components lay out from layer 0 and cost never exceeds longest path', () => {
    const edges = ['A>B', 'B>C', 'X>Y', 'M>N', 'N>O', 'O>P', 'Q>P']
    const ns = assignLayers(graph(edges), {})
    const lp = assignLayers(graph(edges), { strategy: 'longestPath' })
    expect(feasible(ns)).toBe(true)
    expect(Math.min(...Object.values(layers(ns)))).toBe(0)
    expect(cost(ns)).toBeLessThanOrEqual(cost(lp))
    expect(layers(ns).Q).toBe(2)
  })

  test('splitting makes the layering proper', () => {
    const g = pure(
      assignLayers(graph(['A>B', 'B>C', 'A>C', 'A>D', 'D>C', 'C>E', 'A>E']), {}),
      splitLongEdges,
    )
    for (const e of g.edges) expect(e.dst.node.layer - e.src.node.layer).toBe(1)
    const dummies = g.nodes.filter((n) => n.kind === 'dummy')
    expect(dummies.map((d) => d.id)).toEqual(['e2@1', 'e6@1', 'e6@2'])
    expect(g.layers[1].map((n) => n.id)).toEqual(['B', 'D', 'e2@1', 'e6@1'])
    // the span-3 edge A→E is a chain of three segments sharing its origin
    const chain = g.edges.filter((e) => e.origin === 'e6')
    expect(chain.map((e) => `${e.src.node.id}>${e.dst.node.id}`)).toEqual([
      'A>e6@1',
      'e6@1>e6@2',
      'e6@2>E',
    ])
  })
})

describe('network simplex optimality', () => {
  test('matches brute force on small random DAGs', () => {
    // deterministic LCG so failures reproduce
    let seed = 12345
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let trial = 0; trial < 40; trial++) {
      const n = 4 + rand(2) // 4 or 5 nodes
      const ids = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i))
      const edges: string[] = []
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (rand(3) === 0)
            edges.push(
              `${ids[i]}>${ids[j]}${rand(3) === 0 ? `*${1 + rand(4)}` : ''}${rand(4) === 0 ? ':2' : ''}`,
            )
        }
      }
      if (edges.length === 0) continue
      const g = assignLayers(graph(edges), {})
      expect(feasible(g)).toBe(true)
      // brute force: every assignment in [0, 2n)^n
      const present = g.nodes.map((v) => v.id)
      let best = Number.POSITIVE_INFINITY
      const range = 2 * n
      const total = range ** present.length
      for (let code = 0; code < total; code++) {
        let c = code
        const l: Record<string, number> = {}
        for (const id of present) {
          l[id] = c % range
          c = Math.floor(c / range)
        }
        let ok = true
        let cst = 0
        for (const e of g.edges) {
          const len = l[e.dst.node.id] - l[e.src.node.id]
          if (len < e.minLen) {
            ok = false
            break
          }
          cst += e.weight * len
        }
        if (ok && cst < best) best = cst
      }
      expect(cost(g)).toBe(best)
    }
  })
})
