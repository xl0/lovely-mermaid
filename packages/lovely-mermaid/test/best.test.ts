import { describe, expect, test } from 'bun:test'
import { layout, layoutBest } from '../src/engine/index.ts'
import type { Snapshot } from '../src/engine/snapshot.ts'
import { inputOf } from './engine-helpers.ts'

const wide = ['R>A', 'R>B', 'R>C', 'R>D', 'A(20)', 'B(20)', 'C(20)', 'D(20)']

describe('candidate loop', () => {
  test('searches free knobs, respects pinned ones, deterministically', () => {
    const input = inputOf(['A>B', 'B>C', 'C>A'])
    const a = layoutBest(input, { cycles: { strategy: 'dfs' } })
    expect(a.candidates.length).toBe(2)
    for (const c of a.candidates) expect(c.label.startsWith('dfs+')).toBe(true)
    const b = layoutBest(input, { cycles: { strategy: 'dfs' } })
    expect(b.candidates).toEqual(a.candidates)
    const free = layoutBest(input)
    expect(free.candidates.map((c) => c.label)).toEqual([
      'greedy+bk',
      'greedy+networkSimplex',
      'dfs+bk',
      'dfs+networkSimplex',
    ])
  })

  test('without a target the narrowest candidate wins', () => {
    const { result, candidates } = layoutBest(inputOf(wide))
    const min = Math.min(...candidates.map((c) => c.width))
    expect(result.width).toBe(min)
  })

  test('a width target triggers cap passes until something fits', () => {
    const uncapped = layoutBest(inputOf(wide))
    const { result, candidates, chosen } = layoutBest(inputOf(wide), {}, { width: 55 })
    expect(candidates.some((c) => c.label.includes('+cap'))).toBe(true)
    expect(result.width).toBeLessThan(uncapped.result.width)
    expect(result.width).toBeLessThanOrEqual(55)
    expect(chosen.layering?.maxWidth).toBeDefined()
    // among fitting candidates the shortest wins
    const fitting = candidates.filter((c) => c.fits === true)
    expect(Math.min(...fitting.map((c) => c.height))).toBe(result.height)
  })

  test('budget caps the number of layouts tried', () => {
    const { candidates } = layoutBest(inputOf(wide), {}, { width: 55, budget: 3 })
    expect(candidates.length).toBeLessThanOrEqual(3)
  })

  test('squeeze keeps the layout sound on random capped graphs', () => {
    let seed = 90831
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let trial = 0; trial < 15; trial++) {
      const n = 5 + rand(7)
      const items: string[] = Array.from({ length: n }, (_, i) => `N${i}(${4 + rand(16)})`)
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) if (rand(3) === 0) items.push(`N${i}>N${j}`)
      }
      const input = inputOf(items)
      const plain = layout(input, { layering: { maxWidth: 30 } })
      const squeezed = layout(input, { layering: { maxWidth: 30 }, squeeze: 70 })
      expect(Object.keys(squeezed.edges).sort()).toEqual(Object.keys(plain.edges).sort())
      expect(squeezed.width).toBeLessThanOrEqual(Math.max(70, plain.width))
      expect(squeezed.height).toBeLessThanOrEqual(plain.height)
      for (const e of Object.values(squeezed.edges)) {
        for (let k = 1; k < e.route.length; k++) {
          const [ax, ay] = e.route[k - 1]
          const [bx, by] = e.route[k]
          expect((ax !== bx) === (ay !== by)).toBe(false)
        }
      }
    }
  })

  test('the winner is re-run with the trace', () => {
    const snaps: Snapshot[] = []
    const { result } = layoutBest(inputOf(wide), {}, { width: 55 }, (s) => snaps.push(s))
    const flat = snaps.findLast((s) => s.title === 'labels · flat') as Snapshot
    expect(flat).toBeDefined()
    const right = Math.max(...flat.nodes.map((n) => (n.x ?? 0) + (n.w ?? 1)))
    expect(right).toBeLessThanOrEqual(result.width)
  })
})
