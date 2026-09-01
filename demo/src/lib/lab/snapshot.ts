// The lab's snapshot format is the engine's (see the package's
// engine/snapshot.ts); this module adds the validator for hand-edited JSON
// and the one-item-per-line formatter the editor shows.
import type { Pt, SEdge, SNode, SPort, Snapshot } from 'lovely-mermaid-engine';

export type { Pt, SEdge, SNode, SPort, Snapshot };

/** Parse and validate snapshot JSON; throws an Error naming what is wrong. */
export function parseSnapshot(text: string): Snapshot {
	const raw: unknown = JSON.parse(text);
	if (typeof raw !== 'object' || raw === null) throw new Error('snapshot must be an object');
	const s = raw as Record<string, unknown>;
	if (!Array.isArray(s.nodes)) throw new Error('`nodes` must be an array');
	if (!Array.isArray(s.edges)) throw new Error('`edges` must be an array');
	const num = (where: string, o: Record<string, unknown>, k: string): void => {
		if (o[k] !== undefined && typeof o[k] !== 'number') throw new Error(`${where}.${k} must be a number`);
	};
	const ids = new Set<string>();
	s.nodes.forEach((n: unknown, i: number) => {
		const where = `nodes[${i}]`;
		if (typeof n !== 'object' || n === null) throw new Error(`${where} must be an object`);
		const o = n as Record<string, unknown>;
		if (typeof o.id !== 'string' || o.id === '') throw new Error(`${where}.id must be a non-empty string`);
		if (ids.has(o.id)) throw new Error(`${where}: duplicate id "${o.id}"`);
		ids.add(o.id);
		for (const k of ['w', 'h', 'layer', 'order', 'x', 'y']) num(where, o, k);
		if (o.kind !== undefined && !['node', 'dummy', 'compound'].includes(o.kind as string))
			throw new Error(`${where}.kind must be node | dummy | compound`);
		if (o.ports !== undefined) {
			if (!Array.isArray(o.ports)) throw new Error(`${where}.ports must be an array`);
			const pids = new Set<string>();
			o.ports.forEach((q: unknown, j: number) => {
				const pw = `${where}.ports[${j}]`;
				if (typeof q !== 'object' || q === null) throw new Error(`${pw} must be an object`);
				const po = q as Record<string, unknown>;
				if (typeof po.id !== 'string' || po.id === '') throw new Error(`${pw}.id must be a non-empty string`);
				if (pids.has(po.id)) throw new Error(`${pw}: duplicate port id "${po.id}"`);
				pids.add(po.id);
				if (!['N', 'S', 'E', 'W'].includes(po.side as string)) throw new Error(`${pw}.side must be N | S | E | W`);
				for (const k of ['pos', 'order']) num(pw, po, k);
			});
		}
	});
	s.nodes.forEach((n, i) => {
		const p = (n as SNode).parent;
		if (p !== undefined && !ids.has(p)) throw new Error(`nodes[${i}].parent "${p}" is not a node`);
	});
	s.edges.forEach((e: unknown, i: number) => {
		const where = `edges[${i}]`;
		if (typeof e !== 'object' || e === null) throw new Error(`${where} must be an object`);
		const o = e as Record<string, unknown>;
		for (const k of ['from', 'to'] as const) {
			if (typeof o[k] !== 'string') throw new Error(`${where}.${k} must be a node id`);
			if (!ids.has(o[k] as string)) throw new Error(`${where}.${k} "${o[k]}" is not a node`);
			const pk = `${k}Port` as const;
			if (o[pk] !== undefined) {
				const node = (s.nodes as SNode[]).find((n) => n.id === o[k]) as SNode;
				if (!node.ports?.some((q) => q.id === o[pk]))
					throw new Error(`${where}.${pk} "${o[pk]}" is not a port of "${o[k]}"`);
			}
		}
		if (o.route !== undefined) {
			const r = o.route;
			if (!Array.isArray(r) || r.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((v) => typeof v !== 'number')))
				throw new Error(`${where}.route must be an array of [x, y]`);
		}
		if (o.label !== undefined) {
			const l = o.label as Record<string, unknown>;
			if (typeof l !== 'object' || l === null || typeof l.text !== 'string')
				throw new Error(`${where}.label must be { text, x?, y?, w?, h? }`);
			for (const k of ['x', 'y', 'w', 'h']) num(`${where}.label`, l, k);
		}
		if (o.labels !== undefined) {
			if (!Array.isArray(o.labels)) throw new Error(`${where}.labels must be an array`);
			o.labels.forEach((l: unknown, j: number) => {
				const q = l as Record<string, unknown>;
				const bad =
					typeof q !== 'object' ||
					q === null ||
					typeof q.text !== 'string' ||
					['x', 'y', 'w', 'h'].some((k) => typeof q[k] !== 'number');
				if (bad) throw new Error(`${where}.labels[${j}] must be { text, x, y, w, h }`);
			});
		}
	});
	return raw as Snapshot;
}

/** One node or edge per line: readable in the editor, still plain JSON. */
export function formatSnapshot(s: Snapshot): string {
	const items = (list: object[]): string => list.map((n) => `    ${JSON.stringify(n)}`).join(',\n');
	return `{\n  "title": ${JSON.stringify(s.title ?? '')},\n  "nodes": [\n${items(s.nodes)}\n  ],\n  "edges": [\n${items(s.edges)}\n  ]\n}\n`;
}
