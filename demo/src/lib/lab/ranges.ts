// Where each snapshot item lives in the editor text, read off CodeMirror's
// JSON syntax tree (JSON.parse gives no positions, and the tree survives a
// half-typed document). Also the completion source, which needs the same
// tree walk to know what object it is inside.
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/** A selectable item of the picture, keyed the way the SVG tags it. */
export type Sel =
	| { kind: 'node'; id: string }
	| { kind: 'edge'; index: number }
	| { kind: 'port'; node: string; id: string };
export const selKey = (s: Sel): string =>
	s.kind === 'node' ? `n:${s.id}` : s.kind === 'edge' ? `e:${s.index}` : `p:${s.node} ${s.id}`;

export interface ItemRange {
	from: number;
	to: number;
	sel: Sel;
}

const children = (n: SyntaxNode, name: string): SyntaxNode[] => {
	const out: SyntaxNode[] = [];
	for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c);
	return out;
};
/** The text of a String / PropertyName node, or null while it is unterminated. */
const strOf = (state: EditorState, n: SyntaxNode | null): string | null => {
	if (!n || (n.name !== 'String' && n.name !== 'PropertyName')) return null;
	try {
		return JSON.parse(state.doc.sliceString(n.from, n.to)) as string;
	} catch {
		return null;
	}
};
const propName = (state: EditorState, p: SyntaxNode): string | null => strOf(state, p.firstChild);
/** The value node of property `key` on an Object node. */
const propValue = (state: EditorState, obj: SyntaxNode, key: string): SyntaxNode | null => {
	for (const p of children(obj, 'Property'))
		if (propName(state, p) === key) return p.lastChild;
	return null;
};

export function itemRanges(state: EditorState): ItemRange[] {
	const out: ItemRange[] = [];
	const root = syntaxTree(state).topNode.firstChild;
	if (!root || root.name !== 'Object') return out;
	const nodes = propValue(state, root, 'nodes');
	if (nodes?.name === 'Array') {
		for (const o of children(nodes, 'Object')) {
			const id = strOf(state, propValue(state, o, 'id'));
			if (id === null) continue;
			out.push({ from: o.from, to: o.to, sel: { kind: 'node', id } });
			const ports = propValue(state, o, 'ports');
			if (ports?.name !== 'Array') continue;
			for (const q of children(ports, 'Object')) {
				const pid = strOf(state, propValue(state, q, 'id'));
				if (pid !== null) out.push({ from: q.from, to: q.to, sel: { kind: 'port', node: id, id: pid } });
			}
		}
	}
	const edges = propValue(state, root, 'edges');
	if (edges?.name === 'Array')
		children(edges, 'Object').forEach((o, index) =>
			out.push({ from: o.from, to: o.to, sel: { kind: 'edge', index } })
		);
	return out;
}

/** The innermost item containing `pos` (a port inside its node wins). */
export function itemAt(ranges: ItemRange[], pos: number): ItemRange | null {
	let best: ItemRange | null = null;
	for (const r of ranges)
		if (r.from <= pos && pos <= r.to && (best === null || r.to - r.from < best.to - best.from))
			best = r;
	return best;
}

const KEYS: Record<string, string[]> = {
	root: ['title', 'nodes', 'edges'],
	nodes: ['id', 'label', 'kind', 'parent', 'w', 'h', 'layer', 'order', 'x', 'y', 'ports'],
	edges: ['from', 'to', 'fromPort', 'toPort', 'reversed', 'route', 'label'],
	ports: ['id', 'side', 'pos', 'order'],
	label: ['text', 'x', 'y', 'w', 'h']
};

/** Keys of the enclosing object, or values for the property being typed. */
export function complete(ctx: CompletionContext): CompletionResult | null {
	const { state, pos } = ctx;
	const n = syntaxTree(state).resolveInner(pos, -1);
	// nearest Property whose value part holds pos, and the enclosing Object
	let prop: SyntaxNode | null = null;
	let obj: SyntaxNode | null = null;
	for (let a: SyntaxNode | null = n; a; a = a.parent) {
		if (a.name === 'Property' && prop === null && a.firstChild && pos > a.firstChild.to) prop = a;
		if (a.name === 'Object') {
			obj = a;
			break;
		}
	}
	if (obj === null) return null;
	if (prop !== null) {
		const key = propName(state, prop);
		const strNode = n.name === 'String' ? n : null;
		const from = strNode?.from ?? ctx.matchBefore(/[\w"]*$/)?.from ?? pos;
		if (key === 'reversed') return { from, options: [{ label: 'true' }, { label: 'false' }] };
		const ranges = itemRanges(state);
		let vals: string[] = [];
		if (key === 'from' || key === 'to' || key === 'parent') {
			vals = ranges.flatMap((r) => (r.sel.kind === 'node' ? [r.sel.id] : []));
		} else if (key === 'fromPort' || key === 'toPort') {
			const ref = strOf(state, propValue(state, obj, key === 'fromPort' ? 'from' : 'to'));
			vals = ranges.flatMap((r) =>
				r.sel.kind === 'port' && (ref === null || r.sel.node === ref) ? [r.sel.id] : []
			);
		} else if (key === 'side') vals = ['N', 'S', 'E', 'W'];
		else if (key === 'kind') vals = ['node', 'dummy', 'compound'];
		if (vals.length === 0) return null;
		return {
			from,
			options: [...new Set(vals)].map((v) => ({ label: v, apply: JSON.stringify(v) })),
			validFor: /^"?[^"]*"?$/
		};
	}
	// key position: which array (or the root / a label object) are we in?
	const p = obj.parent;
	const kind =
		!p || p.name === 'JsonText'
			? 'root'
			: p.name === 'Array'
				? ((p.parent?.name === 'Property' ? propName(state, p.parent) : null) ?? 'root')
				: p.name === 'Property'
					? (propName(state, p) ?? 'root')
					: 'root';
	const present = new Set(children(obj, 'Property').map((q) => propName(state, q)));
	const word = ctx.matchBefore(/"?\w*$/);
	const options = (KEYS[kind] ?? [])
		.filter((k) => !present.has(k))
		.map((k) => ({ label: k, apply: `"${k}": ` }));
	if (options.length === 0) return null;
	return { from: word?.from ?? pos, options, validFor: /^"?\w*$/ };
}
