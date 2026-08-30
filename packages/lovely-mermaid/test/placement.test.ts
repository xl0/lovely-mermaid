import { describe, expect, test } from 'bun:test'
import { breakCycles } from '../src/engine/cycles.ts'
import type { LGraph } from '../src/engine/graph.ts'
import type { PlacementOptions } from '../src/engine/index.ts'
import { assignLayers, splitLongEdges } from '../src/engine/layering.ts'
import { orderNodes } from '../src/engine/ordering.ts'
import { gap, placeNodes } from '../src/engine/placement.ts'
import { graph, pure } from './engine-helpers.ts'

const ordered = (items: string[]): LGraph =>
  orderNodes(splitLongEdges(assignLayers(breakCycles(graph(items), {}), {})), {})
const xs = (g: LGraph): Record<string, number> =>
  Object.fromEntries(g.nodes.map((n) => [n.id, n.x]))
/** Order kept, gaps respected, nothing negative. */
const valid = (g: LGraph): boolean =>
  g.nodes.every((n) => n.x >= 0) &&
  g.layers.every((row) =>
    row.every(
      (b, i) => i === 0 || b.x >= row[i - 1].x + row[i - 1].w + gap(g.spacing, row[i - 1], b),
    ),
  )
const width = (g: LGraph): number => Math.max(...g.nodes.map((n) => n.x + n.w))
/** Σ weight·|port column difference|, the network-simplex placer's objective. */
const cost = (g: LGraph): number =>
  g.edges.reduce((t, e) => {
    const w =
      e.src.node.kind === 'dummy' && e.dst.node.kind === 'dummy'
        ? 32
        : e.src.node.kind === 'dummy' || e.dst.node.kind === 'dummy'
          ? 8
          : 4
    return t + w * Math.abs(e.src.node.x + e.src.pos - (e.dst.node.x + e.dst.pos))
  }, 0)
const both: PlacementOptions[] = [{}, { strategy: 'networkSimplex' }]

describe('placement', () => {
  test('a chain is straight and starts at 0, without touching its input', () => {
    for (const opts of both) {
      const g = pure(ordered(['A>B', 'B>C']), (g) => placeNodes(g, opts))
      expect(xs(g)).toEqual({ A: 0, B: 0, C: 0 })
    }
  })

  test('a fan-out spreads the children and centres the parent on one of them', () => {
    for (const opts of both) {
      const g = placeNodes(ordered(['A>X', 'A>Y']), opts)
      expect(valid(g)).toBe(true)
      // X at 0, Y after the node-node gap; A's port to X or Y is straight
      expect(xs(g)).toMatchObject({ X: 0, Y: 8 })
      const a = g.nodes.find((n) => n.id === 'A') as LGraph['nodes'][number]
      const straight = a.ports
        .filter((p) => p.side === 'S')
        .some((p) => a.x + p.pos === p.out[0].dst.node.x + p.out[0].dst.pos)
      expect(straight).toBe(true)
    }
  })

  test('a long edge runs straight through its dummies', () => {
    for (const opts of both) {
      const g = placeNodes(ordered(['A>B', 'B>C', 'C>D', 'A>D', 'A>P', 'P>D']), opts)
      expect(valid(g)).toBe(true)
      const chain = g.edges.filter((e) => e.origin === 'e3')
      const cols = chain.map((e) => [e.src.node.x + e.src.pos, e.dst.node.x + e.dst.pos])
      // every inner segment (dummy to dummy) is straight
      for (const e of chain) {
        if (e.src.node.kind === 'dummy' && e.dst.node.kind === 'dummy')
          expect(e.src.node.x + e.src.pos).toBe(e.dst.node.x + e.dst.pos)
      }
      expect(cols.length).toBe(3)
    }
  })

  test('candidates are traced and the kept one is the narrowest valid layout', () => {
    const notes: string[] = []
    const g = placeNodes(ordered(['A>X', 'A>Y', 'B>Y', 'B>Z', 'X>P', 'Z>P']), {}, (_, n) =>
      notes.push(n),
    )
    expect(notes.length).toBe(4)
    expect(
      notes.every((n) => /^(upper|lower) medians, packed (left|right) · width \d+$/.test(n)),
    ).toBe(true)
    const widths = notes.map((n) => Number(n.match(/width (\d+)/)?.[1]))
    expect(width(g)).toBe(Math.min(...widths))
    expect(valid(g)).toBe(true)
  })

  test('network simplex never costs more than Brandes–Köpf on random graphs', () => {
    let seed = 4242
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let trial = 0; trial < 25; trial++) {
      const n = 5 + rand(6)
      const ids = Array.from({ length: n }, (_, i) => `N${i}(${3 + rand(8)})`)
      const items = [...ids]
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) if (rand(3) === 0) items.push(`N${i}>N${j}`)
      }
      if (items.length === n) continue
      const base = ordered(items)
      const bk = placeNodes(base, {})
      const ns = placeNodes(base, { strategy: 'networkSimplex' })
      expect(valid(bk)).toBe(true)
      expect(valid(ns)).toBe(true)
      expect(cost(ns)).toBeLessThanOrEqual(cost(bk))
      // deterministic
      expect(xs(placeNodes(base, {}))).toEqual(xs(bk))
    }
  })
})
