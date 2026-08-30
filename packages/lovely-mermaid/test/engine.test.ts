import { describe, expect, test } from 'bun:test'
import { parseGraph } from '../src/diagrams/flowchart.ts'
import { reverse } from '../src/engine/cycles.ts'
import { buildGraph } from '../src/engine/graph.ts'
import type { LayoutInput, Snapshot } from '../src/engine/index.ts'
import { layout, PHASES } from '../src/engine/index.ts'
import { importGraph, renderEngine, traceEngine } from '../src/layout-engine.ts'

const spacing = { nodeNode: 3, nodeEdge: 1, edgeEdge: 1, channelGap: 1 }
const input: LayoutInput = {
  dir: 'down',
  spacing,
  nodes: ['A', 'B', 'C'].map((id) => ({ id, w: 7, h: 3 })),
  edges: [
    { id: 'ab', from: 'A', to: 'B' },
    { id: 'bc', from: 'B', to: 'C' },
    { id: 'ca', from: 'C', to: 'A' },
    { id: 'aa', from: 'A', to: 'A' },
  ],
}

describe('engine pipeline', () => {
  test('runs every phase, snapshots each, and returns integer geometry', () => {
    const snaps: Snapshot[] = []
    const res = layout(input, {}, (s) => snaps.push(s))
    // sub-step snapshots carry a ' · ' note; the phase snapshots are the rest
    expect(snaps.map((s) => s.title).filter((t) => !t?.includes(' · '))).toEqual([
      'import',
      ...PHASES,
    ])
    expect(Object.keys(res.nodes).sort()).toEqual(['A', 'B', 'C'])
    expect(Object.keys(res.edges).sort()).toEqual(['ab', 'bc', 'ca'])
    for (const r of Object.values(res.nodes)) {
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true)
    }
    for (const e of Object.values(res.edges)) expect(e.route.length).toBeGreaterThanOrEqual(2)
    expect(res.width).toBeGreaterThan(0)
    expect(res.height).toBeGreaterThan(0)
    // the reversed edge C→A runs upward, from its declared source
    const ca = res.edges.ca.route
    expect(ca[0][1]).toBeGreaterThan(ca[ca.length - 1][1])
    expect(res.warnings).toEqual(['edge "aa": self-loops are not routed yet'])
    // ports exist from import, unplaced
    expect(snaps[0].nodes.map((n) => n.id)).toEqual(['A', 'B', 'C'])
    expect(snaps[0].edges.map((e) => `${e.from}>${e.to}`)).toEqual(['A>B', 'B>C', 'C>A'])
    expect(snaps[0].nodes[0].ports?.map((p) => p.side)).toEqual(['S', 'N'])
  })

  test('`until` stops after the named phase', () => {
    const snaps: Snapshot[] = []
    layout(input, { until: 'layers' }, (s) => snaps.push(s))
    expect(snaps.map((s) => s.title)).toEqual(['import', 'cycles', 'layers'])
  })

  test('reverse swaps the ends and toggles the flag both ways', () => {
    const g = buildGraph(input)
    const e = g.edges[2] // C→A
    reverse(e)
    expect([e.src.node.id, e.dst.node.id, e.reversed]).toEqual(['A', 'C', true])
    expect(e.src.out).toContain(e)
    expect(e.dst.in).toContain(e)
    reverse(e)
    expect([e.src.node.id, e.dst.node.id, e.reversed]).toEqual(['C', 'A', false])
  })

  test('the bridge measures nodes and labels, and renders', () => {
    const src = 'flowchart TD\n  A[Start] --> B[Parse]\n  B -->|ok| A'
    const graph = parseGraph(src)
    expect(graph).not.toBeNull()
    const { input: li, lines } = importGraph(graph as NonNullable<typeof graph>)
    expect(lines).toEqual([['Start'], ['Parse']])
    expect(li.nodes).toEqual([
      { id: 'n0', label: 'Start', w: 9, h: 3 },
      { id: 'n1', label: 'Parse', w: 9, h: 3 },
    ])
    expect(li.edges[1].labels).toEqual([{ text: 'ok', w: 4, h: 1, at: 'center' }])
    const art = renderEngine(src)
    expect(art).not.toBeNull()
    const plain = (art as { plain: string[] }).plain.join('\n')
    for (const word of ['Start', 'Parse', '▼', '▲']) expect(plain).toContain(word)
    const titles = traceEngine(src).snapshots.map((s) => s.title ?? '')
    expect(titles.filter((t) => !t.includes(' · ')).length).toBe(1 + PHASES.length)
  })
})
