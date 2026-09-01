import { describe, expect, test } from 'bun:test'
import { layout } from '../src/engine/index.ts'
import { placeEdgeLabels } from '../src/engine/labels.ts'
import type { InputEdge, InputLabel, LayoutResult, Pt, Rect } from '../src/engine/types.ts'
import { inputOf } from './engine-helpers.ts'

// The placement rules, pinned on hand-built geometry: tier order,
// scan-from-source, the embedded/off-line spacing split, end labels.
// Full-pipeline behaviour is covered by the integration test at the
// bottom and the label lint in geometry.test.ts.

const resOf = (
  w: number,
  h: number,
  nodes: Record<string, Rect>,
  routes: Record<string, Pt[]>,
): LayoutResult => ({
  width: w,
  height: h,
  nodes,
  compounds: {},
  edges: Object.fromEntries(
    Object.entries(routes).map(([id, route]) => [id, { route, labels: [] }]),
  ),
  warnings: [],
})
const lbl = (text: string, w: number, h = 1, at: InputLabel['at'] = 'center'): InputLabel => ({
  text,
  w,
  h,
  at,
})
const e0 = (...labels: InputLabel[]): InputEdge[] => [{ id: 'e0', from: 'a', to: 'b', labels }]

describe('label placement', () => {
  test('tier 1: embedded in a horizontal run, nearest the source', () => {
    const res = resOf(
      26,
      8,
      { a: { x: 0, y: 0, w: 5, h: 5 }, b: { x: 21, y: 0, w: 5, h: 5 } },
      {
        e0: [
          [4, 2],
          [20, 2],
        ],
      },
    )
    placeEdgeLabels(res, e0(lbl('go', 5)))
    // interior 5..19, both route-end reserves eat one more cell
    expect(res.edges.e0.labels).toEqual([{ text: 'go', x: 6, y: 2, w: 5, h: 1 }])
  })

  test('tier 2: one line interrupting a vertical run', () => {
    const res = resOf(
      6,
      20,
      { a: { x: 0, y: 0, w: 5, h: 5 }, b: { x: 0, y: 15, w: 5, h: 5 } },
      {
        e0: [
          [2, 4],
          [2, 15],
        ],
      },
    )
    placeEdgeLabels(res, e0(lbl('go', 3)))
    // on the line reads best: centred over the column, near the source
    expect(res.edges.e0.labels).toEqual([{ text: 'go', x: 1, y: 6, w: 3, h: 1 }])
  })

  test('tier 3: a block goes beside a horizontal run, above first', () => {
    const res = resOf(
      26,
      10,
      { a: { x: 0, y: 2, w: 5, h: 5 }, b: { x: 21, y: 2, w: 5, h: 5 } },
      {
        e0: [
          [4, 4],
          [20, 4],
        ],
      },
    )
    placeEdgeLabels(res, e0(lbl('two rows', 6, 2)))
    // slid right past the source box, rows above the run
    expect(res.edges.e0.labels).toEqual([{ text: 'two rows', x: 5, y: 2, w: 6, h: 2 }])
  })

  test('text never touches a foreign edge: slides past the crossing', () => {
    const res = resOf(
      7,
      15,
      { a: { x: 0, y: 0, w: 5, h: 3 }, b: { x: 0, y: 12, w: 5, h: 3 } },
      {
        e0: [
          [2, 2],
          [2, 12],
        ],
        e1: [
          [0, 5],
          [6, 5],
        ],
      },
    )
    placeEdgeLabels(res, e0(lbl('go', 3)))
    // interrupting the line, but rows 4-6 all sit against the crossing
    // at row 5; y=7 is the first row costing no touch penalty
    expect(res.edges.e0.labels).toEqual([{ text: 'go', x: 1, y: 7, w: 3, h: 1 }])
  })

  test('off-line text keeps 2 cells from foreign edges', () => {
    const res = resOf(
      26,
      10,
      { a: { x: 0, y: 2, w: 5, h: 5 }, b: { x: 21, y: 2, w: 5, h: 5 } },
      {
        e0: [
          [4, 4],
          [20, 4],
        ],
        e1: [
          [6, 1],
          [19, 1],
        ],
      },
    )
    placeEdgeLabels(res, e0(lbl('two rows', 6, 2)))
    // every above spot sits 1 cell under e1 — rejected; below is free
    expect(res.edges.e0.labels).toEqual([{ text: 'two rows', x: 5, y: 5, w: 6, h: 2 }])
  })

  test('end labels sit beside the line, right at their port', () => {
    const res = resOf(
      7,
      15,
      { a: { x: 0, y: 0, w: 5, h: 3 }, b: { x: 0, y: 12, w: 5, h: 3 } },
      {
        e0: [
          [2, 2],
          [2, 12],
        ],
      },
    )
    placeEdgeLabels(res, e0(lbl('1', 3, 1, 'tail'), lbl('*', 3, 1, 'head')))
    expect(res.edges.e0.labels).toEqual([
      { text: '1', x: 3, y: 3, w: 3, h: 1 },
      { text: '*', x: 3, y: 11, w: 3, h: 1 },
    ])
  })

  test('a fan of drops reads as one row of cards, touching tolerated', () => {
    const res = resOf(
      8,
      15,
      { a: { x: 0, y: 0, w: 7, h: 3 }, b: { x: 0, y: 12, w: 7, h: 3 } },
      {
        e0: [
          [2, 2],
          [2, 12],
        ],
        e1: [
          [4, 2],
          [4, 12],
        ],
      },
    )
    placeEdgeLabels(res, [
      { id: 'e0', from: 'a', to: 'b', labels: [lbl('1', 1, 1, 'tail')] },
      { id: 'e1', from: 'a', to: 'b', labels: [lbl('1', 1, 1, 'tail')] },
    ])
    // both at the port row, right of their line — e0's card touches
    // e1's line (penalty), which still beats sliding down a row
    expect(res.edges.e0.labels).toEqual([{ text: '1', x: 3, y: 3, w: 1, h: 1 }])
    expect(res.edges.e1.labels).toEqual([{ text: '1', x: 5, y: 3, w: 1, h: 1 }])
  })

  test('the flat shape embeds in a horizontal run that holds it', () => {
    const res = resOf(
      40,
      8,
      { a: { x: 0, y: 0, w: 5, h: 5 }, b: { x: 35, y: 0, w: 5, h: 5 } },
      {
        e0: [
          [4, 2],
          [34, 2],
        ],
      },
    )
    placeEdgeLabels(res, e0({ ...lbl('one two three', 13), tall: { w: 8, h: 2 } }))
    expect(res.edges.e0.labels).toEqual([{ text: 'one two three', x: 6, y: 2, w: 13, h: 1 }])
  })

  test('…and hangs beside a vertical run as the tall block', () => {
    // too wide to interrupt the line whole — the hard-wrapped shape
    // hangs off the column instead
    const res = resOf(
      16,
      20,
      { a: { x: 2, y: 0, w: 9, h: 5 }, b: { x: 2, y: 15, w: 9, h: 5 } },
      {
        e0: [
          [6, 4],
          [6, 15],
        ],
      },
    )
    placeEdgeLabels(res, e0({ ...lbl('one two three', 20), tall: { w: 8, h: 2 } }))
    expect(res.edges.e0.labels).toEqual([{ text: 'one two three', x: 7, y: 6, w: 8, h: 2 }])
  })

  test('interrupting text gravitates to centre, repelled by the wall', () => {
    // the run hugs the canvas edge: the centred spot is out of bounds,
    // so the slide settles at the least off-centre position that fits
    const res = resOf(
      5,
      13,
      { a: { x: 0, y: 0, w: 3, h: 3 }, b: { x: 0, y: 10, w: 3, h: 3 } },
      {
        e0: [
          [1, 2],
          [1, 10],
        ],
      },
    )
    placeEdgeLabels(res, e0(lbl('go!!', 4)))
    expect(res.edges.e0.labels).toEqual([{ text: 'go!!', x: 0, y: 4, w: 4, h: 1 }])
  })

  test('a label with room for nothing, not even a marker, joins the legend', () => {
    const res = resOf(
      6,
      8,
      { a: { x: 0, y: 0, w: 5, h: 3 }, b: { x: 0, y: 5, w: 5, h: 3 } },
      {
        e0: [
          [2, 2],
          [2, 5],
        ],
      },
    )
    placeEdgeLabels(res, e0(lbl('long one', 10)))
    expect(res.edges.e0.labels).toEqual([])
    expect(res.legend).toEqual([{ edge: 'e0', text: 'long one' }])
    expect(res.warnings).toEqual([])
  })

  test('a marker on the edge and the body floating in dead space', () => {
    // the run's interior holds 3 cells — a `[1]` marker but not the label
    const res = resOf(
      30,
      12,
      { a: { x: 0, y: 0, w: 5, h: 5 }, b: { x: 11, y: 0, w: 5, h: 5 } },
      {
        e0: [
          [4, 2],
          [11, 2],
        ],
      },
    )
    placeEdgeLabels(res, e0(lbl('a long label', 14)))
    expect(res.edges.e0.labels).toEqual([{ text: '[1]', x: 6, y: 2, w: 3, h: 1 }])
    expect(res.floats?.length).toBe(1)
    const f = (res.floats as NonNullable<typeof res.floats>)[0]
    expect(f).toMatchObject({ n: 1, edge: 'e0', text: 'a long label', w: 18, h: 1 })
    expect(f.x >= 0 && f.y >= 0 && f.x + f.w <= 30 && f.y + f.h <= 12).toBe(true)
    expect(res.legend).toBeUndefined()
  })

  test('marker numbers restart per self-contained frame', () => {
    // two frames, each with one marker+float pair kept inside — both
    // frames show their own [1]
    const res: LayoutResult = {
      width: 34,
      height: 30,
      nodes: {
        a: { x: 2, y: 2, w: 5, h: 5 },
        b: { x: 13, y: 2, w: 5, h: 5 },
        c: { x: 2, y: 17, w: 5, h: 5 },
        d: { x: 13, y: 17, w: 5, h: 5 },
      },
      compounds: { F: { x: 0, y: 0, w: 34, h: 14 }, G: { x: 0, y: 15, w: 34, h: 14 } },
      edges: {
        e0: {
          route: [
            [6, 4],
            [13, 4],
          ],
          labels: [],
        },
        e1: {
          route: [
            [6, 19],
            [13, 19],
          ],
          labels: [],
        },
      },
      warnings: [],
    }
    placeEdgeLabels(res, [
      { id: 'e0', from: 'a', to: 'b', labels: [lbl('a long label', 14)] },
      { id: 'e1', from: 'c', to: 'd', labels: [lbl('another long one', 16)] },
    ])
    expect(res.edges.e0.labels).toEqual([{ text: '[1]', x: 8, y: 4, w: 3, h: 1 }])
    expect(res.edges.e1.labels).toEqual([{ text: '[1]', x: 8, y: 19, w: 3, h: 1 }])
    expect((res.floats ?? []).map((f) => f.n)).toEqual([1, 1])
  })

  test('through layout(): placed, deterministic, only own cells covered', () => {
    const input = inputOf(['A>B', 'A>C'])
    input.edges[0].labels = [lbl('go', 4)]
    const res = layout(input)
    const again = layout(input)
    expect(JSON.stringify(again)).toBe(JSON.stringify(res))
    expect(res.edges.e0.labels.length).toBe(1)
    const l = res.edges.e0.labels[0]
    expect(l.x >= 0 && l.y >= 0 && l.x + l.w <= res.width && l.y + l.h <= res.height).toBe(true)
    // covers no cell of the other edge
    const cells = new Set<string>()
    const r1 = res.edges.e1.route
    for (let i = 1; i < r1.length; i++)
      for (let x = Math.min(r1[i - 1][0], r1[i][0]); x <= Math.max(r1[i - 1][0], r1[i][0]); x++)
        for (let y = Math.min(r1[i - 1][1], r1[i][1]); y <= Math.max(r1[i - 1][1], r1[i][1]); y++)
          cells.add(`${x},${y}`)
    for (let x = l.x; x < l.x + l.w; x++)
      for (let y = l.y; y < l.y + l.h; y++) expect(cells.has(`${x},${y}`)).toBe(false)
  })
})
