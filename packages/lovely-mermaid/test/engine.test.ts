import { describe, expect, test } from 'bun:test'
import type { LayoutInput, Snapshot } from '../src/engine/index.ts'
import { layout } from '../src/engine/index.ts'
import { renderEngine, traceEngine } from '../src/layout-engine.ts'

const spacing = { nodeNode: 3, nodeEdge: 1, edgeEdge: 1, channelGap: 1 }
const input = (dir: LayoutInput['dir']): LayoutInput => ({
  dir,
  spacing,
  nodes: ['A', 'B', 'C', 'D'].map((id) => ({ id, w: 7, h: 3 })),
  edges: [
    { id: 'ab', from: 'A', to: 'B' },
    { id: 'bc', from: 'B', to: 'C' },
    { id: 'ca', from: 'C', to: 'A' }, // cycle
    { id: 'ad', from: 'A', to: 'D' },
    { id: 'cd', from: 'C', to: 'D' }, // long edge A→D spans two layers
  ],
})

describe('engine skeleton', () => {
  test('lays out a cyclic graph with a long edge', () => {
    const snaps: Snapshot[] = []
    const res = layout(input('down'), (s) => snaps.push(s))
    expect(snaps.map((s) => s.title)).toEqual([
      'import',
      'cycles',
      'layers',
      'split',
      'order',
      'place',
      'route',
    ])
    // C→A reversed; layers A=0 B=1 C=2 D=3, so A→D crosses two layers
    expect(snaps[1].edges.filter((e) => e.reversed).length).toBe(1)
    expect(snaps[3].nodes.filter((n) => n.kind === 'dummy').length).toBe(2)
    expect(Object.keys(res.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])
    for (const e of Object.values(res.edges)) {
      expect(e.route.length).toBeGreaterThanOrEqual(2)
      for (const [x, y] of e.route) {
        expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true)
        expect(x >= 0 && x < res.width && y >= 0 && y < res.height).toBe(true)
      }
    }
    // the reversed edge's route runs from its declared source C to A
    const ca = res.edges.ca.route
    expect(ca[0][1]).toBeGreaterThan(ca[ca.length - 1][1])
  })

  test('other directions keep node sizes and turn the flow', () => {
    const down = layout(input('down'))
    const right = layout(input('right'))
    const up = layout(input('up'))
    const left = layout(input('left'))
    for (const r of [right, up, left]) expect(r.nodes.A).toMatchObject({ w: 7, h: 3 })
    // flow: down grows in y, right in x, up/left the other way round
    expect(down.nodes.D.y).toBeGreaterThan(down.nodes.A.y)
    expect(right.nodes.D.x).toBeGreaterThan(right.nodes.A.x)
    expect(up.nodes.D.y).toBeLessThan(up.nodes.A.y)
    expect(left.nodes.D.x).toBeLessThan(left.nodes.A.x)
    // up is the mirror of down
    expect([up.width, up.height]).toEqual([down.width, down.height])
    expect(up.nodes.A.y).toBe(down.height - down.nodes.A.y - 3)
    for (const [x, y] of left.edges.ab.route) {
      expect(x >= 0 && x < left.width && y >= 0 && y < left.height).toBe(true)
    }
  })

  test('renders a flowchart end to end', () => {
    const src =
      'flowchart TD\n  A[Start] --> B[Parse] --> C{Check}\n  C -->|ok| D[Ship]\n  C --> A\n  A --> D'
    const art = renderEngine(src)
    expect(art).not.toBeNull()
    const plain = (art as { plain: string[] }).plain.join('\n')
    for (const word of ['Start', 'Parse', 'Check', 'Ship', 'ok', '▼']) expect(plain).toContain(word)
    expect(traceEngine(src).snapshots.length).toBe(7)
  })
})
