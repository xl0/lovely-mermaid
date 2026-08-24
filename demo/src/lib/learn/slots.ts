// Slot-grid layout shared by the /learn figures.
// Every figure puts a layer's occupants — real nodes AND
// dummies — into fixed grid columns, so reserved space reads as a grid.
// Each occupant takes the nearest free column at or right of its natural
// position (nodes: their column; dummies: interpolated between their
// edge's endpoints), which keeps left-to-right order and aligns columns
// across layers.
export type Pt = { x: number; y: number };
export interface Slotted {
	x: Record<string, number>; // node id -> slot x
	dummies: { u: string; v: string; layer: number; x: number }[];
	occ: { real: number; dummy: number }[]; // per layer
	width: number; // widest layer, px
}
export function slotted(
	nodes: string[],
	edges: [string, string][],
	col: Record<string, number>,
	rk: Record<string, number>,
	pitch: number,
	x0: number,
	// Natural x of a dummy, when the caller knows better than interpolation
	// (the live playground uses ELK's routed positions, so the dummy order is
	// the engine's decision, not ours).
	dummyIdeal?: (u: string, v: string, layer: number) => number | undefined
): Slotted {
	const nl = Math.max(...nodes.map((n) => rk[n])) + 1;
	const per: { key: string; ideal: number }[][] = Array.from({ length: nl }, () => []);
	for (const n of nodes) per[rk[n]].push({ key: n, ideal: col[n] });
	const dummies: Slotted['dummies'] = [];
	for (const [u, v] of edges) {
		const span = rk[v] - rk[u];
		const dir = Math.sign(span);
		for (let i = 1; i < Math.abs(span); i++) {
			const layer = rk[u] + dir * i;
			const key = `${u}>${v}@${layer}`;
			per[layer].push({
				key,
				ideal: dummyIdeal?.(u, v, layer) ?? col[u] + ((col[v] - col[u]) * i) / Math.abs(span)
			});
			dummies.push({ u, v, layer, x: 0 });
		}
	}
	const x: Record<string, number> = {};
	let cols = 0;
	for (const items of per) {
		items.sort((a, b) => a.ideal - b.ideal);
		let next = 0;
		for (const it of items) {
			const c = Math.max(next, Math.round((it.ideal - x0) / pitch));
			x[it.key] = x0 + c * pitch;
			next = c + 1;
			cols = Math.max(cols, c + 1);
		}
	}
	for (const d of dummies) d.x = x[`${d.u}>${d.v}@${d.layer}`];
	return {
		x,
		dummies,
		occ: per.map((items, r) => {
			const real = nodes.filter((n) => rk[n] === r).length;
			return { real, dummy: items.length - real };
		}),
		width: cols * pitch
	};
}
// Polyline from u through its dummies to v, shortened at both ends so the
// arrowhead stops at the pill. yOf lets the widget substitute the drag y.
export function edgePts(
	u: string,
	v: string,
	s: Slotted,
	yOf: (n: string) => number,
	layerY: (r: number) => number
): Pt[] {
	const mid = s.dummies
		.filter((d) => d.u === u && d.v === v)
		.map((d) => ({ x: d.x, y: layerY(d.layer) }));
	const a = { x: s.x[u], y: yOf(u) };
	const b = { x: s.x[v], y: yOf(v) };
	const s0 = mid[0] ?? b;
	const e0 = mid[mid.length - 1] ?? a;
	const l0 = Math.hypot(s0.x - a.x, s0.y - a.y) || 1;
	const l1 = Math.hypot(b.x - e0.x, b.y - e0.y) || 1;
	return [
		{ x: a.x + ((s0.x - a.x) * 16) / l0, y: a.y + ((s0.y - a.y) * 16) / l0 },
		...mid,
		{ x: b.x - ((b.x - e0.x) * 24) / l1, y: b.y - ((b.y - e0.y) * 24) / l1 }
	];
}
// A static figure: graph + natural columns + pill width + viewBox width.
export interface Fig {
	nodes: string[];
	edges: [string, string][];
	col: Record<string, number>;
	pw: number;
	vw: number;
	pitch: number;
	x0: number; // first grid column's x
}

// Edge crossings on the grid: each edge is a chain of unit segments
// (u -> dummies -> v); two segments between the same layer pair cross iff
// their endpoint orders disagree. Dummies count like nodes — that is the
// whole point.
export function crossings(
	edges: [string, string][],
	s: Slotted,
	rk: Record<string, number>
): number {
	const segs: { layer: number; x1: number; x2: number }[] = [];
	for (const [u, v] of edges) {
		const chain = [
			{ x: s.x[u], layer: rk[u] },
			...s.dummies.filter((d) => d.u === u && d.v === v).map((d) => ({ x: d.x, layer: d.layer })),
			{ x: s.x[v], layer: rk[v] }
		];
		for (let i = 0; i + 1 < chain.length; i++)
			segs.push({ layer: Math.min(chain[i].layer, chain[i + 1].layer), x1: chain[i].x, x2: chain[i + 1].x });
	}
	let n = 0;
	for (let i = 0; i < segs.length; i++)
		for (let j = i + 1; j < segs.length; j++)
			if (segs[i].layer === segs[j].layer && (segs[i].x1 - segs[j].x1) * (segs[i].x2 - segs[j].x2) < 0) n++;
	return n;
}
