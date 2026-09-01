import { describe, expect, test } from 'bun:test'
import { layout, layoutBest, layoutFast } from '../src/engine/index.ts'
import type { Snapshot } from '../src/engine/snapshot.ts'
import type { Candidate } from '../src/engine/types.ts'
import { inputOf } from './engine-helpers.ts'

const wide = ['R>A', 'R>B', 'R>C', 'R>D', 'A(20)', 'B(20)', 'C(20)', 'D(20)']

describe('candidate loop', () => {
  test('searches free knobs, respects pinned ones, deterministically', () => {
    const input = inputOf(['A>B', 'B>C', 'C>A'])
    const a = layoutBest(input, { cycles: { strategy: 'dfs' } })
    for (const c of a.candidates) expect(c.label.startsWith('dfs+')).toBe(true)
    const b = layoutBest(input, { cycles: { strategy: 'dfs' } })
    expect(b.candidates).toEqual(a.candidates)
    const free = layoutBest(input)
    // the probe cells, then up to two opportunistic stacked probes
    expect(free.candidates.slice(0, 7).map((c) => c.label)).toEqual([
      'greedy+bk',
      'greedy+networkSimplex',
      'greedy+ns2',
      'dfs+bk',
      'dfs+networkSimplex',
      'dfs+ns2',
      'greedy2+networkSimplex',
    ])
    for (const c of free.candidates.slice(7)) expect(c.label.endsWith('+stack')).toBe(true)
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

describe('fast mode', () => {
  test('layoutFast is one capped greedy+bk pass, deterministic', () => {
    const input = inputOf(wide)
    const fast = layoutFast(input, { width: 55 })
    const again = layoutFast(input, { width: 55 })
    expect(again).toEqual(fast)
    const manual = layout(input, {
      cycles: { strategy: 'greedy' },
      placement: { strategy: 'bk' },
      layering: { maxWidth: 55 },
    })
    expect(fast.width).toBe(manual.width)
    expect(fast.height).toBe(manual.height)
    // no target: plain uncapped pass
    const free = layoutFast(input)
    expect(free.width).toBe(
      layout(input, { cycles: { strategy: 'greedy' }, placement: { strategy: 'bk' } }).width,
    )
  })

  test('tiny loop budgets degrade instead of crashing', () => {
    for (const budget of [1, 2, 3, 8]) {
      const { result, candidates } = layoutBest(inputOf(wide), {}, { width: 55, budget })
      expect(candidates.length).toBeLessThanOrEqual(budget)
      expect(candidates.length).toBeGreaterThan(0)
      expect(result.width).toBeGreaterThan(0)
    }
  })
})

describe('sideways fit', () => {
  const chain = ['A>B', 'B>C', 'C>D', 'D>E', 'E>F']

  test('a chain stacks into the target instead of flowing wide', () => {
    const input = { ...inputOf(chain), dir: 'right' as const }
    const { result, candidates, chosen } = layoutBest(input, {}, { width: 18 })
    expect(result.width).toBeLessThanOrEqual(18)
    expect((candidates.find((c) => c.opts === chosen) as Candidate).label).toContain('+stack')
    expect(result.warnings).toEqual([])
  })

  test('an unreachable target keeps the narrowest layout and warns', () => {
    const input = { ...inputOf(chain), dir: 'right' as const }
    const { result } = layoutBest(input, {}, { width: 4 })
    expect(result.width).toBeGreaterThan(4)
    const warn = result.warnings.find((w) => w.includes('sideways'))
    expect(warn).toContain(`${result.width} columns`)
  })

  test('fast mode stacks its calibration pass', () => {
    const input = { ...inputOf(chain), dir: 'right' as const }
    const fast = layoutFast(input, { width: 18 })
    expect(fast.width).toBeLessThanOrEqual(18)
  })
})

describe('opportunistic stacking', () => {
  test('a free-lunch stack is adopted without a target: LR width drops, height holds', () => {
    // T is tall, so the chain's 11-row stack hides under T's 25 rows
    // (an LR row-spacing profile, as the bridge would pass)
    const input = {
      dir: 'right' as const,
      spacing: { nodeNode: 1, nodeEdge: 0, edgeEdge: 0, channelGap: 1, framePad: 0 },
      nodes: [
        { id: 'T', w: 5, h: 25 },
        { id: 'A', w: 5, h: 3 },
        { id: 'B', w: 5, h: 3 },
        { id: 'C', w: 5, h: 3 },
      ],
      edges: [
        { id: 'ta', from: 'T', to: 'A' },
        { id: 'ab', from: 'A', to: 'B' },
        { id: 'bc', from: 'B', to: 'C' },
      ],
    }
    const flat = layoutBest(input, { stackChains: false })
    const { result, candidates, chosen } = layoutBest(input)
    expect((candidates.find((c) => c.opts === chosen) as Candidate).label).toContain('+stack')
    expect(result.width).toBeLessThan(flat.result.width)
    expect(result.height).toBeLessThanOrEqual(flat.result.height)
  })

  test('a stack that pays height is rejected without a target', () => {
    const input = { ...inputOf(['A>B', 'B>C', 'C>D', 'D>E']), dir: 'right' as const }
    const { result, candidates, chosen } = layoutBest(input)
    expect((candidates.find((c) => c.opts === chosen) as Candidate).label).not.toContain('+stack')
    expect(result.height).toBe(3) // the flat chain stays a single row
  })

  test('a free-lunch stack is adopted in a down flow: height drops, width holds', () => {
    // R pays the width (and is too bulky to join the stack itself),
    // the chain stacks sideways under it
    const input = inputOf(['R>A', 'A>B', 'B>C', 'R(80)'])
    const flat = layoutBest(input, { stackChains: false })
    const { result, candidates, chosen } = layoutBest(input)
    expect((candidates.find((c) => c.opts === chosen) as Candidate).label).toContain('+stack')
    expect(result.width).toBeLessThanOrEqual(flat.result.width)
    expect(result.height).toBeLessThan(flat.result.height)
  })
})

describe('chain stacking', () => {
  test('a stacked chain runs down one band: full width becomes the widest node', () => {
    const input = { ...inputOf(['A>B', 'B>C', 'C>D']), dir: 'right' as const }
    const flat = layout(input)
    const stacked = layout(input, { stackChains: true })
    expect(stacked.width).toBeLessThan(flat.width)
    expect(stacked.height).toBeGreaterThan(flat.height)
    // members share the band's left edge and follow each other down
    expect(stacked.nodes.B.x).toBe(stacked.nodes.A.x)
    expect(stacked.nodes.B.y).toBeGreaterThan(stacked.nodes.A.y)
    // each chain edge is one straight vertical drop
    for (const id of ['e0', 'e1', 'e2']) {
      const r = stacked.edges[id].route
      expect(new Set(r.map(([x]) => x)).size).toBe(1)
    }
  })

  test('a stub joins a short member to a route on the stack border', () => {
    // Y is much narrower than X, so the stack is wider than Y and Y's
    // outgoing route needs the stub to reach Y's own border
    const input = { ...inputOf(['X>Y', 'Y>Z', 'W>Z', 'X(21)']), dir: 'right' as const }
    const res = layout(input, { stackChains: true })
    expect(res.width).toBeLessThan(layout(input).width) // the chain did stack
    for (const e of input.edges) {
      const r = res.edges[e.id].route
      const src = res.nodes[e.from]
      const dst = res.nodes[e.to]
      const inside = (p: [number, number], n: { x: number; y: number; w: number; h: number }) =>
        p[0] >= n.x && p[0] < n.x + n.w && p[1] >= n.y && p[1] < n.y + n.h
      expect(inside(r[0], src)).toBe(true)
      expect(inside(r[r.length - 1], dst)).toBe(true)
    }
  })

  test('the loop probes stacked cells for a capped sideways layout', () => {
    const input = { ...inputOf(['A>B', 'B>C', 'C>D', 'D>E', 'A>E']), dir: 'right' as const }
    const { result, candidates } = layoutBest(input, {}, { width: 22 })
    expect(candidates.some((c) => c.label.includes('+stack'))).toBe(true)
    expect(result.width).toBeLessThanOrEqual(22)
  })
})
