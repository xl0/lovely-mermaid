/**
 * Draws a Snapshot as an SVG string — the one picture both /lab (in the
 * browser) and tools/lab-svg.ts (to PNG) show, so a link from the page and a
 * render on the command line are the same frame.
 *
 * Units map to px through the view scale; where a coordinate is missing
 * the picture falls back to a slot grid (layer bands stacked down, one slot
 * column per occupant, dummies included) so a pre-placement snapshot still
 * reads as a drawing. Colors are inline presentation attributes: inkscape
 * rasterizes them and the page's hover CSS still overrides them.
 */
import type { Pt, SNode, SPort, Snapshot } from './snapshot';

export interface View {
	/** px per unit on each axis — 10×20 makes cells look like a terminal's. */
	sx: number;
	sy: number;
	/** slot-grid gaps in units, between columns and between layer bands */
	gapX: number;
	gapY: number;
	/** faint cell lines behind the picture */
	grid: boolean;
	/** edge labels: placed rects in the flat picture, midpoint chips elsewhere */
	labels?: boolean;
}
export const DEFAULT_VIEW: View = { sx: 10, sy: 20, gapX: 4, gapY: 2, grid: true, labels: true };

export interface Rendered {
	svg: string;
	/** picture size in px */
	w: number;
	h: number;
	stats: Record<string, number>;
	warnings: string[];
}

// Opacity rides on fill-opacity, not rgba(): inkscape paints rgba() black.
const C = {
	band: '#8abeb7',
	dim: '#666666',
	edge: '#8abeb7',
	rev: '#cc6666',
	node: '#2d2838',
	border: '#d4d4d4',
	text: '#d4d4d4',
	slot: '#505050',
	/** provisional geometry: a node without x, an edge without a route */
	prov: '#808080',
	port: '#81a2be',
	frame: '#9575cd',
	label: '#f0c674',
	labelBg: '#101014'
};
const FONT = "'JetBrains Mono', 'DejaVu Sans Mono', ui-monospace, monospace";

const esc = (s: string): string =>
	s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** A node's resolved rectangle, in units. */
interface Box {
	n: SNode;
	x: number;
	y: number;
	w: number;
	h: number;
	/** layer index in the picture (unlayered band = last), for crossings/bands */
	li: number | null;
	/** slotted on x: draw the reserved slot behind a dummy */
	slot: boolean;
	slotH: number;
	/** right edge in units, the slot's when slotted */
	right: number;
}

export function snapshotSvg(snap: Snapshot, view: View = DEFAULT_VIEW): Rendered {
	const warnings: string[] = [];
	const { sx, sy, gapX, gapY, grid } = view;
	const fs = Math.max(11, Math.round(Math.min(sy * 0.7, sx * 1.7)));
	const byId = new Map(snap.nodes.map((n) => [n.id, n]));
	// a sideways picture (the flat view of an LR/RL layout) bands vertically
	const flowX =
		(snap.dir === 'right' || snap.dir === 'left') &&
		snap.nodes.every((n) => n.kind === 'compound' || (n.x !== undefined && n.y !== undefined));
	const declIdx = new Map(snap.nodes.map((n, i) => [n.id, i]));
	const leaves = snap.nodes.filter((n) => n.kind !== 'compound');

	// --- layers: order, then declaration; unlayered nodes are parked beside
	const keys = [...new Set(leaves.flatMap((n) => (n.layer === undefined ? [] : [n.layer])))].sort(
		(a, b) => a - b
	);
	const layers: SNode[][] = keys.map((k) => leaves.filter((n) => n.layer === k));
	const unlayered = leaves.filter((n) => n.layer === undefined);
	const rank = (n: SNode): number => n.order ?? (declIdx.get(n.id) as number);
	for (const row of layers)
		row.sort((a, b) => rank(a) - rank(b) || (declIdx.get(a.id) as number) - (declIdx.get(b.id) as number));

	// --- rects: real coordinates where given, slot grid otherwise
	const slotW = Math.max(1, ...leaves.filter((n) => n.x === undefined).map((n) => n.w ?? 0));
	const pitch = slotW + gapX;
	const box = new Map<string, Box>();
	const bands: { y0: number; y1: number; real: number; dummy: number; label: string }[] = [];
	let top = 0;
	layers.forEach((row, li) => {
		const bandH = Math.max(1, ...row.map((n) => n.h ?? 0));
		row.forEach((n, i) => {
			const w = n.w ?? 0;
			const h = n.h ?? 0;
			// a point (dummy) occupies one cell: centre that cell in the slot / band
			box.set(n.id, {
				n,
				x: n.x ?? gapX / 2 + i * pitch + Math.floor((slotW - Math.max(1, w)) / 2),
				y: n.y ?? top + Math.floor((bandH - Math.max(1, h)) / 2),
				w,
				h,
				li,
				slot: n.x === undefined,
				slotH: bandH,
				right: n.x === undefined ? gapX / 2 + i * pitch + slotW : n.x + w
			});
		});
		const bs = row.map((n) => box.get(n.id) as Box);
		bands.push({
			y0: flowX
				? Math.min(...bs.map((b) => b.x)) - gapX / 2
				: Math.min(...bs.map((b) => b.y)) - gapY / 2,
			y1: flowX
				? Math.max(...bs.map((b) => b.x + b.w)) + gapX / 2
				: Math.max(...bs.map((b) => b.y + b.h)) + gapY / 2,
			real: row.filter((n) => n.kind !== 'dummy').length,
			dummy: row.filter((n) => n.kind === 'dummy').length,
			label: `layer ${keys[li]}`
		});
		top += bandH + gapY;
	});
	// Unlayered nodes stand in a column beside the layered picture — parked,
	// not ranked: declaration order top-down, bands and counts stop before it.
	const layeredX1 = Math.max(0, ...[...box.values()].map((b) => b.right));
	const sideW = Math.max(1, ...unlayered.map((n) => n.w ?? 0));
	const sideX = layeredX1 + gapX;
	let sideTop = 0;
	for (const n of unlayered) {
		const w = n.w ?? 0;
		const h = n.h ?? 0;
		box.set(n.id, {
			n,
			x: n.x ?? sideX + (sideW - w) / 2,
			y: n.y ?? sideTop,
			w,
			h,
			li: null,
			slot: n.x === undefined,
			slotH: Math.max(1, h),
			right: (n.x ?? sideX + (sideW - w) / 2) + w
		});
		sideTop += h + gapY;
	}

	// --- compound frames: given rect, else the hull of the children (deepest first)
	const depth = (n: SNode): number => {
		let d = 0;
		for (let p = n.parent; p !== undefined; p = byId.get(p)?.parent) {
			if (++d > snap.nodes.length) throw new Error(`parent cycle at "${n.id}"`);
		}
		return d;
	};
	const compounds = snap.nodes
		.filter((n) => n.kind === 'compound')
		.map((n) => ({ n, d: depth(n) }))
		.sort((a, b) => b.d - a.d)
		.map((c) => c.n);
	const frames: Box[] = [];
	for (const c of compounds) {
		let b: Box | null = null;
		if (c.x !== undefined && c.y !== undefined) {
			b = { n: c, x: c.x, y: c.y, w: c.w ?? 0, h: c.h ?? 0, li: null, slot: false, slotH: 0, right: c.x + (c.w ?? 0) };
		} else {
			const kids = [...box.values(), ...frames].filter((k) => k.n.parent === c.id);
			if (kids.length === 0) {
				warnings.push(`compound "${c.id}" has no children and no rect — not drawn`);
				continue;
			}
			const x0 = Math.min(...kids.map((k) => k.x)) - gapX / 2;
			const y0 = Math.min(...kids.map((k) => k.y)) - gapY / 2;
			const x1 = Math.max(...kids.map((k) => k.x + k.w)) + gapX / 2;
			const y1 = Math.max(...kids.map((k) => k.y + k.h)) + gapY / 2;
			b = { n: c, x: x0, y: y0, w: x1 - x0, h: y1 - y0, li: null, slot: false, slotH: 0, right: x1 };
		}
		frames.push(b);
		box.set(c.id, b);
	}

	// --- ports: a border cell; without `pos` the side's ports spread evenly
	const portPt = new Map<string, { pt: Pt; port: SPort; placed: boolean }>();
	for (const b of box.values()) {
		const ports = b.n.ports ?? [];
		for (const side of ['N', 'S', 'E', 'W'] as const) {
			const onSide = ports
				.map((q, i) => ({ q, i }))
				.filter(({ q }) => q.side === side)
				.sort((u, v) => (u.q.order ?? u.i) - (v.q.order ?? v.i) || u.i - v.i);
			const len = side === 'N' || side === 'S' ? b.w : b.h;
			onSide.forEach(({ q }, i) => {
				const off = q.pos ?? ((i + 1) * len) / (onSide.length + 1);
				// a point-like node (a dummy) has no border: every port is the point
				const pt: Pt =
					b.w === 0 || b.h === 0
						? [b.x + b.w / 2, b.y + b.h / 2]
						: side === 'N'
							? [b.x + off, b.y]
							: side === 'S'
								? [b.x + off, b.y + b.h - 1]
								: side === 'W'
									? [b.x, b.y + off]
									: [b.x + b.w - 1, b.y + off];
				portPt.set(`${b.n.id}\u0000${q.id}`, { pt, port: q, placed: q.pos !== undefined });
			});
		}
	}

	// --- edges: routes, or a straight line between ports / facing sides
	const facing = (a: Box, b: Box): Pt => {
		if (a.w === 0 || a.h === 0) return [a.x + a.w / 2, a.y + a.h / 2];
		const dx = (b.x + b.w / 2 - a.x - a.w / 2) * sx;
		const dy = (b.y + b.h / 2 - a.y - a.h / 2) * sy;
		if (Math.abs(dy) >= Math.abs(dx)) return [a.x + a.w / 2, dy >= 0 ? a.y + a.h - 1 : a.y];
		return [dx >= 0 ? a.x + a.w - 1 : a.x, a.y + a.h / 2];
	};
	const lines = snap.edges.map((e): Pt[] => {
		const a = box.get(e.from);
		const b = box.get(e.to);
		if (a === undefined || b === undefined) return [];
		if (e.route !== undefined) return e.route;
		const pa = e.fromPort === undefined ? undefined : portPt.get(`${e.from}\u0000${e.fromPort}`)?.pt;
		const pb = e.toPort === undefined ? undefined : portPt.get(`${e.to}\u0000${e.toPort}`)?.pt;
		return [pa ?? facing(a, b), pb ?? facing(b, a)];
	});

	// --- stats and invariants
	const cx = (id: string): number => {
		const b = box.get(id) as Box;
		return b.x + b.w / 2;
	};
	const layered = snap.edges.filter((e) => {
		const a = box.get(e.from)?.li;
		const b = box.get(e.to)?.li;
		return a !== null && a !== undefined && b !== null && b !== undefined;
	});
	const li = (id: string): number => (box.get(id) as Box).li as number;
	const adjacent = layered.filter((e) => Math.abs(li(e.to) - li(e.from)) === 1);
	// A result view (`dir` set) carries whole routes: crossings are counted
	// as actual segment intersections, and the phase diagnostics (back
	// edges, uncountable long edges) do not apply.
	let crossings = 0;
	if (snap.dir !== undefined) {
		const hs: [number, number, number, number][] = [];
		const vs: [number, number, number, number][] = [];
		snap.edges.forEach((e, i) => {
			for (let k = 1; k < (e.route?.length ?? 0); k++) {
				const [ax, ay] = (e.route as Pt[])[k - 1];
				const [bx, by] = (e.route as Pt[])[k];
				if (ay === by) hs.push([ay, Math.min(ax, bx), Math.max(ax, bx), i]);
				else vs.push([ax, Math.min(ay, by), Math.max(ay, by), i]);
			}
		});
		for (const [hy, hx0, hx1, hi] of hs) {
			for (const [vx, vy0, vy1, vi] of vs) {
				if (hi !== vi && vx > hx0 && vx < hx1 && hy > vy0 && hy < vy1) crossings++;
			}
		}
	} else {
		for (let i = 0; i < adjacent.length; i++) {
			const e = adjacent[i];
			const [eu, el] = li(e.from) < li(e.to) ? [e.from, e.to] : [e.to, e.from];
			for (let j = i + 1; j < adjacent.length; j++) {
				const f = adjacent[j];
				const [fu, fl] = li(f.from) < li(f.to) ? [f.from, f.to] : [f.to, f.from];
				if (li(eu) !== li(fu)) continue;
				if ((cx(eu) - cx(fu)) * (cx(el) - cx(fl)) < 0) crossings++;
			}
		}
		const notDown = layered.filter((e) => e.reversed !== true && li(e.to) <= li(e.from)).length;
		if (notDown > 0) warnings.push(`${notDown} edge(s) do not point down a layer`);
		const long =
			layered.length - adjacent.length - layered.filter((e) => li(e.to) === li(e.from)).length;
		if (long > 0) warnings.push(`${long} edge(s) span several layers — not counted in crossings`);
	}
	const leafBoxes = leaves.map((n) => box.get(n.id) as Box);
	let overlaps = 0;
	for (let i = 0; i < leafBoxes.length; i++) {
		for (let j = i + 1; j < leafBoxes.length; j++) {
			const a = leafBoxes[i];
			const b = leafBoxes[j];
			if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++;
		}
	}
	if (overlaps > 0) warnings.push(`${overlaps} overlapping node pair(s)`);
	const allPts: Pt[] = [
		...[...box.values()].flatMap((b): Pt[] => [
			[b.x, b.y],
			[b.x + b.w, b.y + b.h]
		]),
		...lines.flat()
	];
	const x0 = Math.min(0, ...allPts.map((p) => p[0]));
	const y0 = Math.min(0, ...allPts.map((p) => p[1]));
	const x1 = Math.max(1, ...allPts.map((p) => p[0]));
	const y1 = Math.max(1, ...allPts.map((p) => p[1]));
	const stats: Record<string, number> = {
		nodes: leaves.filter((n) => n.kind !== 'dummy').length,
		dummies: leaves.filter((n) => n.kind === 'dummy').length,
		layers: keys.length,
		unlayered: unlayered.length,
		edges: snap.edges.length,
		crossings,
		width: Math.round(x1 - x0),
		height: Math.round(y1 - y0)
	};

	// --- paint
	// Rects address cell edges; points (route points, ports) address cells,
	// drawn through the cell's middle — a row-10 run and a row-10 label
	// coincide, and a route ending on a port lands on it exactly.
	const X = (u: number): number => (u - x0) * sx;
	const Y = (u: number): number => (u - y0) * sy;
	const PX = (u: number): number => X(u + 0.5);
	const PY = (u: number): number => Y(u + 0.5);
	// A box's stroke runs through the centres of its border cells — where a
	// terminal draws the frame, and where its ports sit.
	const rectAttrs = (b: { x: number; y: number; w: number; h: number }): string =>
		`x="${PX(b.x)}" y="${PY(b.y)}" width="${Math.max(0, b.w - 1) * sx}" height="${Math.max(0, b.h - 1) * sy}"`;
	const ML = 64;
	const MT = snap.title ? 30 : 12;
	const MR = 44;
	const W = X(x1) + ML + (unlayered.length ? MR + 8 : MR);
	const H = Y(y1) + MT + 12;
	const out: string[] = [];
	const push = (s: string): number => out.push(s);
	push(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" font-size="${fs}">`
	);
	push(
		`<defs><marker id="lab-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.edge}"/></marker>` +
			`<marker id="lab-arr-rev" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.rev}"/></marker>` +
			`<marker id="lab-arr-prov" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.prov}"/></marker>` +
			`<pattern id="lab-grid" width="${sx}" height="${sy}" patternUnits="userSpaceOnUse"><path d="M${sx} 0H0V${sy}" fill="none" stroke="#ffffff" stroke-opacity="0.07"/></pattern></defs>`
	);
	if (snap.title) push(`<text x="${ML}" y="20" fill="${C.edge}">${esc(snap.title)}</text>`);
	push(`<g transform="translate(${ML},${MT})">`);
	// the pattern's origin is this group's origin = cell (x0, y0), so its lines
	// fall on cell boundaries
	if (grid) push(`<rect x="0" y="0" width="${X(x1)}" height="${Y(y1)}" fill="url(#lab-grid)"/>`);
	for (const b of bands) {
		if (flowX) {
			push(
				`<rect x="${X(b.y0)}" y="${-MT + 4}" width="${X(b.y1) - X(b.y0)}" height="${Y(y1) + MT - 4 + 8}" fill="${C.band}" fill-opacity="0.08"/>` +
					`<text x="${X(b.y0) + 4}" y="${-MT + 14}" fill="${C.dim}" font-size="10">${b.label}</text>` +
					`<text x="${(X(b.y0) + X(b.y1)) / 2}" y="${Y(y1) + 10}" text-anchor="middle" fill="${C.dim}" font-size="11">${b.real}+${b.dummy}</text>`
			);
		} else {
			push(
				`<rect x="${-ML + 4}" y="${Y(b.y0)}" width="${X(layeredX1) + ML - 4 + MR}" height="${Y(b.y1) - Y(b.y0)}" fill="${C.band}" fill-opacity="0.08"/>` +
					`<text x="${-ML + 8}" y="${Y(b.y0) + 12}" fill="${C.dim}" font-size="10">${b.label}</text>` +
					`<text x="${X(layeredX1) + 8}" y="${(Y(b.y0) + Y(b.y1)) / 2 + 4}" fill="${C.dim}" font-size="11">${b.real}+${b.dummy}</text>`
			);
		}
	}
	if (unlayered.some((n) => n.x === undefined)) {
		push(
			`<text x="${X(sideX + sideW / 2)}" y="${Y(0) - 6}" text-anchor="middle" fill="${C.dim}" font-size="10">unlayered</text>`
		);
	}
	// hulls were computed deepest-first; paint shallowest-first so a nested
	// frame sits above its parent and receives the pointer events inside it
	for (const f of [...frames].reverse()) {
		const title = esc(f.n.label ?? f.n.id);
		const tw = title.length * fs * 0.62 + 8;
		// an untitled frame (a state `--` region) keeps its border unbroken
		const chip =
			title === ''
				? ''
				: `<rect x="${PX(f.x) + 6}" y="${PY(f.y) - fs * 0.6}" width="${tw}" height="${fs * 1.2}" fill="${C.labelBg}"/>` +
					`<text x="${PX(f.x) + 10}" y="${PY(f.y) + fs * 0.35}" fill="${C.frame}">${title}</text>`;
		push(
			`<g data-node="${esc(f.n.id)}"><rect ${rectAttrs(f)} fill="${C.frame}" fill-opacity="0.14" stroke="${C.frame}" stroke-dasharray="6 4" pointer-events="all"/>` +
				`${chip}</g>`
		);
	}
	// Nodes first, edges over them: a line cutting through a box is a
	// routing error and must stay visible. `pointer-events="all"` keeps an
	// unfilled (provisional) box hoverable inside, not just on its outline.
	for (const b of leafBoxes) {
		const id = esc(b.n.id);
		const placed = b.n.x !== undefined;
		if (b.n.kind === 'dummy') {
			const cxp = PX(b.x + b.w / 2);
			const cyp = PY(b.y + b.h / 2);
			// the reserved slot, drawn like a box of the slot's size: inset half a
			// cell like every node rect, so it matches its neighbours
			const sw = Math.max(0, slotW - 1) * sx;
			const sh = Math.max(0, b.slotH - 1) * sy;
			const slot = b.slot
				? `<rect x="${cxp - sw / 2}" y="${cyp - sh / 2}" width="${sw}" height="${sh}" rx="4" fill="none" stroke="${C.slot}" stroke-dasharray="3 3"/>`
				: '';
			const dot = placed
				? `fill="${C.dim}"`
				: `fill="none" stroke="${C.prov}" stroke-width="1.5"`;
			push(`<g data-node="${id}">${slot}<circle cx="${cxp}" cy="${cyp}" r="${Math.max(3, sx * 0.3)}" ${dot}/></g>`);
			continue;
		}
		const lines = (b.n.label ?? b.n.id).split('\n');
		const cxp = X(b.x + b.w / 2);
		const cyp = Y(b.y + b.h / 2);
		const text = lines
			.map(
				(l, k) =>
					`<text x="${cxp}" y="${cyp + fs * 0.35 + (k - (lines.length - 1) / 2) * fs * 1.2}" text-anchor="middle" fill="${placed ? C.text : C.prov}">${esc(l)}</text>`
			)
			.join('');
		const look = placed
			? `fill="${C.node}" stroke="${C.border}"`
			: `fill="none" stroke="${C.prov}" stroke-dasharray="5 4"`;
		push(
			`<g data-node="${id}"><rect ${rectAttrs(b)} rx="3" ${look} pointer-events="all"/>${text}</g>`
		);
	}
	snap.edges.forEach((e, i) => {
		const pts = lines[i];
		if (pts.length < 2) return;
		const prov = e.route === undefined;
		const color = e.reversed ? C.rev : prov ? C.prov : C.edge;
		const arrow = e.reversed ? 'lab-arr-rev' : prov ? 'lab-arr-prov' : 'lab-arr';
		// the head belongs to the edge's true end: never at a dummy, which only
		// carries the chain through its layer
		const headNode = box.get(e.reversed ? e.from : e.to);
		const marker =
			headNode?.n.kind === 'dummy'
				? ''
				: e.reversed
					? `marker-start="url(#${arrow})"`
					: `marker-end="url(#${arrow})"`;
		push(
			`<g data-edge="${i}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"><polyline points="${pts
				.map((p) => `${PX(p[0])},${PY(p[1])}`)
				.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"${prov ? ' stroke-dasharray="5 4"' : ''} ${marker}/></g>`
		);
	});
	for (const [key, { pt, port, placed }] of portPt) {
		const nid = key.split('\u0000')[0];
		const owner = box.get(nid);
		if (owner !== undefined && (owner.w === 0 || owner.h === 0)) continue; // a point has no border cells
		const look = placed ? `fill="${C.port}"` : `fill="none" stroke="${C.port}"`;
		push(
			`<g data-port="${esc(port.id)}" data-pnode="${esc(nid)}"><rect x="${PX(pt[0]) - 3}" y="${PY(pt[1]) - 3}" width="6" height="6" ${look}/></g>`
		);
	}
	snap.edges.forEach((e, i) => {
		if (view.labels === false) return;
		// placed labels (the flat result picture): exact grid-cell rects,
		// the text split into the block's rows and spread to the cell
		// pitch, so it sits on the grid the way terminal output will
		for (const l of e.labels ?? []) {
			// a float body hangs its lines off the `[n] ` prefix:
			// [1] line one
			//     line two
			// — indented by POSITION, not by leading spaces (SVG collapses
			// whitespace, which also made textLength stretch the remnant)
			const pre = /^\[\d+\] /.exec(l.text);
			const rows: { t: string; off: number }[] = pre
				? wrapCells(l.text.slice(pre[0].length), l.w - pre[0].length, l.h).map((ln, k) =>
						k === 0 ? { t: pre[0] + ln, off: 0 } : { t: ln, off: pre[0].length }
					)
				: wrapCells(l.text, l.w, l.h).map((t) => ({ t, off: 0 }));
			const text = rows
				.map(
					(r, k) =>
						`<text x="${X(l.x + r.off)}" y="${Y(l.y + k) + sy / 2 + fs * 0.35}" textLength="${r.t.length * sx}" lengthAdjust="spacing" fill="${C.label}">${esc(r.t)}</text>`
				)
				.join('');
			push(
				`<g data-edge="${i}"><rect x="${X(l.x)}" y="${Y(l.y)}" width="${l.w * sx}" height="${l.h * sy}" fill="${C.labelBg}"/>${text}</g>`
			);
		}
		const l = e.label;
		if (l === undefined) return;
		const tw = l.text.length * fs * 0.62 + 8;
		let x: number;
		let y: number;
		let w: number;
		let h: number;
		if (l.x !== undefined && l.y !== undefined) {
			x = X(l.x);
			y = Y(l.y);
			w = l.w !== undefined ? l.w * sx : tw;
			h = l.h !== undefined ? l.h * sy : fs + 4;
		} else {
			const pts = lines[i];
			if (pts.length < 2) return;
			const m = midpoint(pts.map((p): Pt => [PX(p[0]), PY(p[1])]));
			w = tw;
			h = fs + 4;
			x = m[0] - w / 2;
			y = m[1] - h / 2;
		}
		push(
			`<g data-edge="${i}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.labelBg}"/>` +
				`<text x="${x + w / 2}" y="${y + h / 2 + fs * 0.35}" text-anchor="middle" fill="${C.label}">${esc(l.text)}</text></g>`
		);
	});
	push('</g></svg>');
	return { svg: out.join('\n'), w: W, h: H, stats, warnings };
}

/** Greedy word wrap by character count (label cells ≈ characters for
 * the terminal consumer); an overlong word hard-splits, overflow rows
 * truncate into an ellipsis on the last one. */
function wrapCells(text: string, w: number, h: number): string[] {
	const rows: string[] = [];
	let cur = '';
	for (const word of text.split(/\s+/).filter((s) => s !== '')) {
		let t = word;
		while (t.length > 0) {
			const add = cur === '' ? t : `${cur} ${t}`;
			if (add.length <= w) {
				cur = add;
				t = '';
			} else if (cur === '') {
				rows.push(t.slice(0, w));
				t = t.slice(w);
			} else {
				rows.push(cur);
				cur = '';
			}
		}
	}
	if (cur !== '') rows.push(cur);
	if (rows.length === 0) rows.push('');
	if (rows.length > h) {
		rows.length = h;
		const last = rows[h - 1];
		rows[h - 1] = last.length >= w ? `${last.slice(0, Math.max(0, w - 1))}…` : `${last}…`;
	}
	return rows;
}

/** The point halfway along a polyline's length. */
function midpoint(pts: Pt[]): Pt {
	const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
	let rest = seg.reduce((a, b) => a + b, 0) / 2;
	for (let i = 0; i < seg.length; i++) {
		if (rest <= seg[i] && seg[i] > 0) {
			const t = rest / seg[i];
			return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
		}
		rest -= seg[i];
	}
	return pts[pts.length - 1];
}
