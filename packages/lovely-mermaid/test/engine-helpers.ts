import { expect } from 'bun:test'
import type { LGraph } from '../src/engine/graph.ts'
import { buildGraph, toSnapshot } from '../src/engine/graph.ts'

export const spacing = { nodeNode: 3, nodeEdge: 1, edgeEdge: 1, channelGap: 1 }

/**
 * A graph from `A>B` edges; `A>B:2` sets a minimum length, `A>B*3` a
 * weight, `A(10)` (anywhere in the list) a node width. An entry without
 * `>` just declares a node. Nodes are declared in order of first mention;
 * default size 5×3.
 */
export function graph(items: string[]): LGraph {
  const strip = (e: string): string => e.replace(/[:*]\d+/g, '').replace(/\(\d+\)/g, '')
  const widths = new Map<string, number>()
  for (const m of items.join(' ').matchAll(/(\w+)\((\d+)\)/g)) widths.set(m[1], Number(m[2]))
  const ids = [...new Set(items.flatMap((e) => strip(e).split('>')))]
  const edges = items.filter((e) => e.includes('>'))
  const g = buildGraph({
    dir: 'down',
    spacing,
    nodes: ids.map((id) => ({ id, w: widths.get(id) ?? 5, h: 3 })),
    edges: edges.map((e, i) => {
      const [from, to] = strip(e).split('>')
      return { id: `e${i}`, from, to }
    }),
  })
  edges.forEach((e, i) => {
    g.edges[i].minLen = Number(e.match(/:(\d+)/)?.[1] ?? 1)
    g.edges[i].weight = Number(e.match(/\*(\d+)/)?.[1] ?? 1)
  })
  return g
}

/** Freeze an object graph (cycles included) so any write throws. */
export function deepFreeze<T>(v: T, seen = new Set<object>()): T {
  if (typeof v !== 'object' || v === null || seen.has(v)) return v
  seen.add(v)
  Object.freeze(v)
  for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k], seen)
  return v
}

/** Run a phase on a frozen input: it must return a new graph and leave the input alone. */
export function pure<T extends LGraph>(g: T, phase: (g: T) => LGraph): LGraph {
  // the graph is cyclic; its snapshot is the acyclic view of the same state
  const before = JSON.stringify(toSnapshot(g, ''))
  const out = phase(deepFreeze(g))
  expect(out).not.toBe(g)
  expect(JSON.stringify(toSnapshot(g, ''))).toBe(before)
  return out
}
