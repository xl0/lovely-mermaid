<script lang="ts">
	import { resolve } from '$app/paths';
	import BuildContract from '$lib/learn/BuildContract.svelte';
	import ElkGrid from '$lib/learn/ElkGrid.svelte';
	import More from '$lib/learn/More.svelte';
	import Term from '$lib/learn/Term.svelte';

	// ---- the placement widget ---------------------------------------------
	// Four layers, orders fixed (crossing minimization is done). The reader
	// drags items sideways continuously; the two hard rules — keep the order,
	// keep the gap — are enforced by clamping. Two long edges (a -> i and
	// b -> j, both over two layers) give dummy chains that can kink — and the
	// graph is built so that straightening them costs width: chain a must
	// clear c, d, e in layer 1, chain b must clear f, g to the right of
	// chain a in layer 2, and those gaps add up across layers to more than
	// any single layer needs (six gaps vs. four).
	const L: string[][] = [
		['a', 'b'],
		['c', 'd', 'e', 'a>i@1', 'b>j@1'],
		['a>i@2', 'f', 'g', 'b>j@2'],
		['i', 'j']
	];
	const SEG: [string, string][] = [
		['a', 'c'],
		['a', 'd'],
		['a', 'e'],
		['a', 'a>i@1'],
		['a>i@1', 'a>i@2'],
		['a>i@2', 'i'],
		['b', 'b>j@1'],
		['b>j@1', 'b>j@2'],
		['b>j@2', 'j'],
		['f', 'i'],
		['g', 'j']
	];
	// Dummy chains, for the straightening button and the kink count.
	const CHAINS: string[][] = [
		['a', 'a>i@1', 'a>i@2', 'i'],
		['b', 'b>j@1', 'b>j@2', 'j']
	];
	const layerOf: Record<string, number> = {};
	L.forEach((l, i) => l.forEach((n) => (layerOf[n] = i)));
	const isDummy = (n: string) => n.includes('>');
	const SEP = 56; // minimum centre-to-centre gap within a layer
	const XMIN = 60;
	const XMAX = 420;
	const BY = (r: number) => 40 + 65 * r;
	const ARENA_H = 275;
	type Xs = Record<string, number>;

	function packLeft(): Xs {
		const xs: Xs = {};
		for (const row of L) row.forEach((n, i) => (xs[n] = XMIN + i * SEP));
		return xs;
	}
	// The starting position: each row spread evenly across the arena —
	// legal, and about as thoughtless as placement gets.
	function spreadEven(): Xs {
		const xs: Xs = {};
		for (const row of L)
			row.forEach((n, i) => (xs[n] = XMIN + ((i + 0.5) * (XMAX - XMIN)) / row.length));
		return xs;
	}
	// Allowed range for n given everyone else's position: between its
	// in-layer neighbours (minus the gap) and the arena edges.
	function range(xs: Xs, n: string): [number, number] {
		const row = L[layerOf[n]];
		const i = row.indexOf(n);
		return [i > 0 ? xs[row[i - 1]] + SEP : XMIN, i < row.length - 1 ? xs[row[i + 1]] - SEP : XMAX];
	}
	const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
	const neighbours = (n: string) =>
		SEG.filter(([u, v]) => u === n || v === n).map(([u, v]) => (u === n ? v : u));
	// Rubber bands: every item drifts toward the mean of its neighbours, as
	// far as the order and the gap allow. Long edges may kink.
	function balance(from: Xs): Xs {
		const xs = { ...from };
		for (let round = 0; round < 40; round++)
			for (const row of L)
				for (const n of row) {
					const nb = neighbours(n);
					const want = nb.reduce((s, m) => s + xs[m], 0) / nb.length;
					const [lo, hi] = range(xs, n);
					xs[n] = clamp(xs[n] + (want - xs[n]) * 0.5, lo, hi);
				}
		return xs;
	}
	// Linear segments: a dummy chain is one rigid vertical piece, lined up
	// under its source (as Brandes–Köpf's downward alignment would), within
	// the tightest range any of its members has. The edge then runs straight
	// down and bends once, at the end, toward its target.
	// Place n at x and shove its in-layer neighbours aside to keep the gaps
	// (bounded by the arena, so x itself may get clamped).
	function setAndPush(xs: Xs, n: string, x: number) {
		const row = L[layerOf[n]];
		const i = row.indexOf(n);
		xs[n] = clamp(x, XMIN + i * SEP, XMAX - (row.length - 1 - i) * SEP);
		for (let k = i - 1; k >= 0; k--) xs[row[k]] = Math.min(xs[row[k]], xs[row[k + 1]] - SEP);
		for (let k = i + 1; k < row.length; k++) xs[row[k]] = Math.max(xs[row[k]], xs[row[k - 1]] + SEP);
	}
	function straighten(from: Xs): Xs {
		const xs = { ...from };
		// Chain members and their sources move together; everything else drifts.
		const fixed = new Set(CHAINS.flatMap((c) => c.slice(0, -1)));
		const align = () => {
			// Chains already aligned this pass are hard bounds for the next —
			// otherwise aligning one would shove the other's dummies aside.
			const placed = new Set<string>();
			for (const c of CHAINS) {
				const members = c.slice(0, -1);
				// The column every member can legally reach, nearest the source.
				let lo = XMIN;
				let hi = XMAX;
				for (const m of members) {
					const row = L[layerOf[m]];
					const i = row.indexOf(m);
					lo = Math.max(lo, XMIN + i * SEP);
					hi = Math.min(hi, XMAX - (row.length - 1 - i) * SEP);
					row.forEach((o, k) => {
						if (!placed.has(o)) return;
						if (k < i) lo = Math.max(lo, xs[o] + (i - k) * SEP);
						else if (k > i) hi = Math.min(hi, xs[o] - (k - i) * SEP);
					});
				}
				const x = clamp(xs[c[0]], lo, hi);
				for (const m of members) {
					setAndPush(xs, m, x);
					placed.add(m);
				}
			}
		};
		for (let round = 0; round < 30; round++) {
			align();
			// Free nodes drift toward their neighbours; chain members stay put.
			for (const row of L)
				for (const n of row) {
					if (fixed.has(n)) continue;
					const nb = neighbours(n);
					const want = nb.reduce((s, m) => s + xs[m], 0) / nb.length;
					const [lo, hi] = range(xs, n);
					xs[n] = clamp(xs[n] + (want - xs[n]) * 0.5, lo, hi);
				}
		}
		align();
		return xs;
	}
	// ---- simplified Brandes–Köpf, for the four-passes figure ---------------
	// Median alignment into blocks, then one-directional compaction; done
	// four times (align up/down x compact left/right). Conflict handling is
	// reduced to "alignments must not cross"; good enough on this graph.
	function bkPass(GL: string[][], GS: [string, string][], alignDown: boolean, compactLeft: boolean): Xs {
		const lom: Record<string, number> = {};
		GL.forEach((l, i) => l.forEach((n) => (lom[n] = i)));
		const parent: Record<string, string> = {};
		const root = (n: string): string => (parent[n] === n ? n : (parent[n] = root(parent[n])));
		for (const row of GL) for (const n of row) parent[n] = n;
		const posIn = (n: string) => GL[lom[n]].indexOf(n);
		const rows = alignDown ? GL.slice(1) : GL.slice(0, -1).reverse();
		for (const row of rows) {
			let r = compactLeft ? -1 : Infinity;
			const scan = compactLeft ? row : [...row].reverse();
			for (const n of scan) {
				const cands = GS.filter(([u, v]) => (alignDown ? v === n : u === n))
					.map(([u, v]) => (alignDown ? u : v))
					.sort((p, q) => posIn(p) - posIn(q));
				if (!cands.length) continue;
				const m = cands[compactLeft ? Math.floor((cands.length - 1) / 2) : Math.ceil((cands.length - 1) / 2)];
				const pm = posIn(m);
				if (compactLeft ? pm > r : pm < r) {
					parent[root(n)] = root(m);
					r = pm;
				}
			}
		}
		const x: Record<string, number> = {};
		for (const row of GL) for (const n of row) x[root(n)] = compactLeft ? XMIN : XMAX;
		for (let i = 0; i < 20; i++)
			for (const row of GL)
				if (compactLeft) {
					for (let k = 1; k < row.length; k++) {
						const a = root(row[k - 1]);
						const b = root(row[k]);
						if (a !== b && x[b] < x[a] + SEP) x[b] = x[a] + SEP;
					}
				} else {
					for (let k = row.length - 2; k >= 0; k--) {
						const a = root(row[k]);
						const b = root(row[k + 1]);
						if (a !== b && x[a] > x[b] - SEP) x[a] = x[b] - SEP;
					}
				}
		const xs: Xs = {};
		for (const row of GL) for (const n of row) xs[n] = x[root(n)];
		return xs;
	}
	// The four-passes figure runs on its own small graph: the widget graph is
	// so constrained the passes barely differ, and the whole point is the
	// visible lean.
	const BKL: string[][] = [
		['a', 'b'],
		['c', 'd', 'e'],
		['f', 'g'],
		['h', 'i']
	];
	const BKSEG: [string, string][] = [
		['a', 'c'],
		['a', 'd'],
		['a', 'e'],
		['b', 'c'],
		['c', 'f'],
		['d', 'f'],
		['d', 'g'],
		['e', 'g'],
		['f', 'h'],
		['f', 'i'],
		['g', 'i']
	];
	const BK_PASSES: { name: string; xs: Xs }[] = [
		{ name: 'align ↓, compact ←', xs: bkPass(BKL, BKSEG, true, true) },
		{ name: 'align ↓, compact →', xs: bkPass(BKL, BKSEG, true, false) },
		{ name: 'align ↑, compact ←', xs: bkPass(BKL, BKSEG, false, true) },
		{ name: 'align ↑, compact →', xs: bkPass(BKL, BKSEG, false, false) }
	];
	const X_BK: Xs = Object.fromEntries(
		BKL.flat().map((n) => [n, BK_PASSES.reduce((t, p) => t + p.xs[n], 0) / 4])
	);

	const X_PACK = packLeft();
	const X_STRAIGHT = straighten(X_PACK);

	let xs = $state<Xs>(spreadEven());
	let dragN = $state<string | null>(null);
	let arena: SVGSVGElement | undefined = $state();

	const widthOf = (x: Xs): number => {
		const all = Object.values(x);
		return Math.max(...all) - Math.min(...all) + 40;
	};
	const kinksOf = (x: Xs): number =>
		CHAINS.reduce((k, c) => {
			for (let i = 2; i < c.length; i++)
				if (Math.abs(x[c[i]] - x[c[i - 1]] - (x[c[i - 1]] - x[c[i - 2]])) > 1) k++;
			return k;
		}, 0);
	const lengthOf = (x: Xs): number => SEG.reduce((s, [u, v]) => s + Math.abs(x[v] - x[u]), 0);
	const width = $derived(widthOf(xs));
	const kinks = $derived(kinksOf(xs));
	const hlen = $derived(lengthOf(xs));

	function svgX(e: PointerEvent): number {
		if (!arena) return 0;
		const r = arena.getBoundingClientRect();
		return ((e.clientX - r.left) / r.width) * 460;
	}
	function grab(n: string, e: PointerEvent) {
		dragN = n;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	}
	function dragMove(e: PointerEvent) {
		if (dragN === null) return;
		const [lo, hi] = range(xs, dragN);
		xs[dragN] = clamp(svgX(e), lo, hi);
	}
	function drop() {
		dragN = null;
	}
	function nodeKey(n: string, e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		const [lo, hi] = range(xs, n);
		xs[n] = clamp(xs[n] + (e.key === 'ArrowLeft' ? -10 : 10), lo, hi);
	}

	// ---- playground -------------------------------------------------------
	// Chosen so the four strategies visibly differ (measured: Brandes–Köpf
	// widest and straightest, linear segments narrower with one more kink,
	// network simplex between, simple centring narrowest and kinkiest).
	const PLAY = `a --> g
a --> k
b --> c
b --> d
c --> j
c --> h
d --> l
e --> n
f --> j
g --> o
h --> m
i --> k
j --> m
j --> o
k --> o
k --> n
l --> o
m --> o
b --> e
b --> f
f --> i`;
	let playSrc = $state(PLAY);
	let playNp = $state('BRANDES_KOEPF');
	const np = (v: string) => ({ 'elk.layered.nodePlacement.strategy': v });
</script>

<svelte:head>
	<title>learn — node placement</title>
</svelte:head>

{#snippet placefig(x: Xs, GL: string[][], GS: [string, string][])}
	{@const lom: Record<string, number> = Object.fromEntries(
		GL.flatMap((l, i) => l.map((n) => [n, i]))
	)}
	<svg viewBox="0 0 460 {ARENA_H}" class="figsvg" role="img" aria-label="Node placement">
		{#each GL as _, r}
			<rect x="4" y={BY(r) - 21} width="452" height="42" class="band" />
			<text x="8" y={BY(r) - 7} class="bandlabel">layer {r}</text>
		{/each}
		{#each GS as [u, v]}
			{@const x1 = x[u]}
			{@const x2 = x[v]}
			{@const y1 = BY(lom[u])}
			{@const y2 = BY(lom[v])}
			{@const len = Math.hypot(x2 - x1, y2 - y1) || 1}
			<line
				x1={x1 + ((x2 - x1) * (isDummy(u) ? 8 : 16)) / len}
				y1={y1 + ((y2 - y1) * (isDummy(u) ? 8 : 16)) / len}
				x2={x2 - ((x2 - x1) * (isDummy(v) ? 8 : 24)) / len}
				y2={y2 - ((y2 - y1) * (isDummy(v) ? 8 : 24)) / len}
				class="edge"
				marker-end={isDummy(v) ? undefined : 'url(#arr)'}
			/>
		{/each}
		{#each GL as row, r}
			{#each row as n}
				{#if isDummy(n)}
					<rect x={x[n] - 14} y={BY(r) - 12} width="28" height="24" rx="10" class="slot" />
					<circle cx={x[n]} cy={BY(r)} r="4" class="dummy" />
				{:else}
					<rect x={x[n] - 20} y={BY(r) - 12} width="40" height="24" rx="10" class="pill" />
					<text x={x[n]} y={BY(r) + 4}>{n}</text>
				{/if}
			{/each}
		{/each}
	</svg>
{/snippet}

<div class="lesson">
	<p class="crumbs"><a href={resolve('/learn')}>learn</a> <span class="dim">/ node placement</span></p>
	<h1>Node placement</h1>
	<p class="lede">
		<a href={resolve('/learn/crossing-minimization')}>Crossing minimization</a> fixed each layer’s
		order. Node placement now assigns horizontal coordinates. It must preserve that order and
		leave a minimum gap between neighbouring box edges, not merely between their centres. Within
		those constraints, it decides whether the drawing is compact, balanced, or straight.
	</p>
	<Term name="node placement">
		Assigning an x coordinate to every node and dummy after layers and orders are fixed. Also
		called coordinate assignment. This phase changes geometry, not the crossing count.
	</Term>

	<h2>Experiment: place the nodes</h2>
	<p>
		Drag any node or dummy sideways. It stops at its neighbours and the arena walls, preserving
		order and minimum spacing. A <b>kink</b> is a dummy where its edge changes direction.
		Try reducing width, kinks, and total horizontal edge length together, then compare the
		three presets.
	</p>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg
		bind:this={arena}
		viewBox="0 0 460 {ARENA_H}"
		class="arena"
		role="application"
		aria-label="Drag nodes sideways to place them"
	>
		<defs>
			<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
				<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
			</marker>
		</defs>
		{#each L as _, r}
			<rect x="4" y={BY(r) - 21} width="452" height="42" class="band" />
			<text x="8" y={BY(r) - 7} class="bandlabel">layer {r}</text>
		{/each}
		{#each SEG as [u, v]}
			{@const x1 = xs[u]}
			{@const x2 = xs[v]}
			{@const y1 = BY(layerOf[u])}
			{@const y2 = BY(layerOf[v])}
			{@const len = Math.hypot(x2 - x1, y2 - y1) || 1}
			<line
				x1={x1 + ((x2 - x1) * (isDummy(u) ? 8 : 16)) / len}
				y1={y1 + ((y2 - y1) * (isDummy(u) ? 8 : 16)) / len}
				x2={x2 - ((x2 - x1) * (isDummy(v) ? 8 : 24)) / len}
				y2={y2 - ((y2 - y1) * (isDummy(v) ? 8 : 24)) / len}
				class="edge"
				marker-end={isDummy(v) ? undefined : 'url(#arr)'}
			/>
		{/each}
		{#each L as row, r}
			{#each row as n}
				<g
					class="grab"
					class:lift={n === dragN}
					role="slider"
					tabindex="0"
					aria-label="Horizontal position of {isDummy(n) ? 'dummy' : 'node'} {n}"
					aria-valuemin={Math.round(range(xs, n)[0])}
					aria-valuemax={Math.round(range(xs, n)[1])}
					aria-valuenow={Math.round(xs[n])}
					onpointerdown={(ev) => grab(n, ev)}
					onpointermove={dragMove}
					onpointerup={drop}
					onpointercancel={drop}
					onkeydown={(ev) => nodeKey(n, ev)}
				>
					{#if isDummy(n)}
						<rect x={xs[n] - 14} y={BY(r) - 12} width="28" height="24" rx="10" class="slot" />
						<circle cx={xs[n]} cy={BY(r)} r="4" class="dummy" />
					{:else}
						<rect x={xs[n] - 20} y={BY(r) - 12} width="40" height="24" rx="10" class="pill" />
						<text x={xs[n]} y={BY(r) + 4}>{n}</text>
					{/if}
				</g>
			{/each}
		{/each}
	</svg>
	<div class="statbar">
		<span>width: <b>{Math.round(width)}</b></span>
		<span>long-edge kinks: <b class:good={kinks === 0}>{kinks}</b></span>
		<span>horizontal edge length: <b>{Math.round(hlen)}</b></span>
	</div>
	<div class="statbar">
		<button class="ghost" onclick={() => (xs = packLeft())}>pack left</button>
		<button class="ghost" onclick={() => (xs = balance(xs))}>balance</button>
		<button class="ghost" onclick={() => (xs = straighten(xs))}>straight long edges</button>
		<button class="ghost" onclick={() => (xs = spreadEven())}>reset</button>
	</div>
	<p>
		<em>Pack left</em> minimizes width, but both long edges zigzag. <em>Balance</em> shortens
		edges and centres nodes, while allowing each dummy to move independently, so kinks remain.
		<em>Straight long edges</em> aligns each chain under its source and leaves one bend near
		the target. The aligned result is wider.
	</p>

	<h2>Placement moves boxes, not points</h2>
	<p>
		The diagrams above use node centres as shorthand, but every real node already has a measured
		width and height before placement begins. If <code>u</code> is immediately left of
		<code>v</code>, their centres must satisfy
		<code>x(v) − x(u) ≥ width(u)/2 + gap + width(v)/2</code>. A long label therefore pushes its
		neighbour away even when both centres would otherwise align neatly with their edges.
	</p>
	<p>
		The experiment deliberately gives every real node the same 40-unit width. Its fixed
		56-unit centre gap is 20 units for each half-box plus 16 units of empty space. A production
		placement method uses the measured half-width of each neighbouring pair instead; the
		ordering rule stays the same, but the legal coordinates are no longer evenly spaced.
	</p>
	<p>
		Height acts on the flow axis. A layer must be thick enough for its tallest node, and the next
		layer starts beyond that envelope plus the between-layer spacing. A wrapped label can
		therefore make its whole layer taller and push every later layer down. In a left-to-right
		layout, width and height exchange these roles.
	</p>
	<p>
		Ports belong to those rectangles. A free port gains more border along which to slide when its
		node becomes wider, while a fixed port keeps its declared side, order, or position. Placement
		may align important ports directly rather than aligning box centres; the same measured gap
		constraints still keep the rectangles disjoint.
	</p>
	<p>
		For ordinary nodes, our renderer wraps labels at 24 display columns over at most four lines.
		The box width comes from the widest wrapped line plus borders and padding; its height comes
		from the line count. Class and ER boxes likewise use their widest compartment and total
		compartment rows. Those dimensions are handed to ELK before any coordinates are chosen.
	</p>

	<h2>Four objectives, one axis</h2>
	<p>
		We want long edges <b>straight</b>, parents <b>centred</b> over their children, edges
		<b>short</b>, and the whole drawing <b>narrow</b>. A dummy chain that drifts sideways
		becomes a bend in the final edge; centring related nodes creates useful symmetry.
	</p>
	<p>
		The objectives conflict. A straight dummy chain reserves one column through every layer
		it crosses, which can widen the drawing. Centring a parent over distant children lengthens
		its edges. Packing every row against the left margin minimizes width but usually produces
		poor alignment.
	</p>
	<p>
		No single layer explains the extra width.
		<code>a</code>'s column must clear three nodes in layer 1. <code>b</code>'s column must
		clear two more nodes in layer 2, to the right of <code>a</code>'s column. Count the gaps
		from the left wall to <code>b</code>'s column: three to clear <code>c</code>,
		<code>d</code>, <code>e</code>, then three more to clear <code>f</code> and
		<code>g</code> and keep the columns apart — six, in a graph where no single layer needs
		more than four. Rigid columns accumulate spacing constraints across layers. Straightness
		therefore has a global width cost.
	</p>

	<h2>How engines place</h2>
	<p>
		Placement methods differ mainly in how they distribute unused horizontal space. Four
		common answers are priorities, rigid segments, averaged alignments, and weighted
		optimization.
	</p>
	<p>
		The <b>priority method</b> is the classic. Walk the layers top to bottom. In each layer,
		process dummies first, then real nodes from most to fewest neighbours in the layer above.
		Move each toward those neighbours’ average position, as far as the current gaps allow; a
		higher-priority node may push lower-priority nodes aside. Dummy chains therefore settle
		first, and straight, while real nodes fit around them. Walk back bottom to top using the
		layer below, and repeat a few times. The <em>balance</em> preset above demonstrates the same
		attraction toward neighbours, but omits priorities.
	</p>
	<p>
		<b>Linear segments</b> reach straightness by construction instead. All the dummies of one
		edge form a single segment, and a segment only moves as one piece — so a long edge cannot
		kink in the middle, because there is no independent joint there to bend. That is what
		<em>straight long edges</em> demonstrates:
	</p>
	<div class="row">
		<figure>
			{@render placefig(X_PACK, L, SEG)}
			<figcaption>
				<b>Packed left</b>: width {Math.round(widthOf(X_PACK))}, {kinksOf(X_PACK)} kinks,
				horizontal edge length {Math.round(lengthOf(X_PACK))}. Legal, narrow, and the long
				edges zigzag.
			</figcaption>
		</figure>
		<figure>
			{@render placefig(X_STRAIGHT, L, SEG)}
			<figcaption>
				<b>Straightened</b>: width {Math.round(widthOf(X_STRAIGHT))}, {kinksOf(X_STRAIGHT)}
				kinks, horizontal edge length {Math.round(lengthOf(X_STRAIGHT))}. Each chain stands
				under its source, and the drawing pays for the columns.
			</figcaption>
		</figure>
	</div>
	<Term name="Sander (1996)" href="https://doi.org/10.1007/bfb0021828">
		<em>A fast heuristic for hierarchical Manhattan layout</em> — the linear-segments
		placement with pendulum and rubber-band phases, from the VCG tool.
	</Term>
	<p>
		<b>Brandes–Köpf</b>, the widespread default, has a different idea. Align each node
		vertically with one of its <em>median</em> neighbours; alignments chain across layers
		into vertical blocks. Then push every block as far as it will go in one direction, and
		the blocks land wherever the pushing stopped. One such pass is
		fast but lopsided — everything leans the way it was pushed. So do it four times, once
		for each combination of aligning downward or upward and compacting leftward or
		rightward, and take the average. Here it is on a small graph with room to lean:
	</p>
	<div class="row5">
		{#each BK_PASSES as pass}
			<figure>
				{@render placefig(pass.xs, BKL, BKSEG)}
				<figcaption>{pass.name}</figcaption>
			</figure>
		{/each}
	</div>
	<figure class="bkavg">
		{@render placefig(X_BK, BKL, BKSEG)}
		<figcaption><b>average of the four</b></figcaption>
	</figure>
	<p>
		Each pass leans toward its compaction direction. Averaging cancels much of that bias while
		preserving many vertical alignments, and the algorithm runs in linear time. Its block
		compaction can produce wide drawings. In our comparison corpus, the linear-segments
		strategy was about fifteen percent narrower on average.
	</p>
	<Term name="Brandes & Köpf (2002)" href="https://doi.org/10.1007/3-540-45848-4_3">
		<em>Fast and simple horizontal coordinate assignment</em> — median alignment into blocks,
		one-directional compaction, four passes averaged; linear time.
	</Term>
	<p>
		And <code>dot</code> phrases the whole thing as optimization: choose x to minimize total
		weighted horizontal edge length, solved with a network simplex. The weights are the
		taste — real-to-real edges count once, real-to-dummy twice, dummy-to-dummy eight times —
		so long edges come out straight because bending them is expensive, not because a rule
		forbids it.
	</p>
	<More id="network-simplex" summary="Side quest: what is a network simplex?">
		<p>
			<b>Short version:</b> give every legal placement a price, then find the cheapest one.
			“Network” refers to a temporary graph of rules that the solver builds; it is not the
			diagram itself. “Simplex” is the improvement procedure. It is unrelated to the
			<em>simple centring</em> preset below.
		</p>
		<p>
			For horizontal placement, the problem has three ingredients:
		</p>
		<ul>
			<li>
				<b>Choices:</b> one horizontal coordinate, <code>x(v)</code>, for every node and
				dummy.
			</li>
			<li>
				<b>Rules:</b> if <code>u</code> is immediately left of <code>v</code>, leave enough
				space for both node widths and the gap between them. Nodes may slide, but may not
				overlap or swap order.
			</li>
			<li>
				<b>Price:</b> add up every edge segment’s horizontal length, multiplied by that
				segment’s weight. Lower is better.
			</li>
		</ul>
		<p>
			The weights express taste. Moving a node ten units left might shorten two ordinary
			segments by ten but lengthen one important segment by ten. If all three cost the same,
			the move saves ten overall. If the important segment has weight eight, the move costs
			sixty instead. This is why a high weight on dummy-to-dummy segments keeps long edges
			straight without making straightness a hard rule.
		</p>
		<p>
			It is called <b>linear</b> optimization because every rule and every price is made only
			from sums and constant multipliers: twice this distance, plus eight times that one.
			There are no curves or thresholds. That restricted shape lets a specialized solver avoid
			trying coordinates one by one.
		</p>
		<p>
			The layout engine turns the rules and prices into an <b>auxiliary network</b>. An arc can
			say “these two items need at least this much separation” or “distance here costs this
			much.” Any arrangement satisfying every minimum separation is feasible. The solver starts
			with one such arrangement and repeatedly improves it:
		</p>
		<ol>
			<li>Find a connected group that would make the total price fall if shifted sideways.</li>
			<li>
				Shift the group until it reaches the next minimum gap. No overlap or order change is
				allowed.
			</li>
			<li>
				Update which gaps are exactly at their minimum, then look for another improving shift.
			</li>
		</ol>
		<p>
			Under the hood, the solver keeps a spanning tree made from gaps that are exactly at their
			minimum. Replacing one edge of that tree with another is a <b>pivot</b>, the basic simplex
			step. Stop when no pivot can lower the price. This tree representation is what makes
			network simplex much cheaper than a general-purpose optimizer for this kind of problem.
		</p>
		<p>
			You met the same machinery in <a href={resolve('/learn/layering')}>layering</a>, with a
			different price list. There the choices are layer numbers, the rule is “every target must
			be below its source,” and the price is total vertical edge span. Here the choices are x
			coordinates, the rules are left-to-right gaps, and the price is weighted horizontal edge
			length. Same solver; different problem.
		</p>
		<p>
			“Optimal” therefore needs a qualifier. Network simplex finds the best coordinates for the
			chosen weights and constraints. It does not revisit crossings, understand semantic
			importance, or know that one bend looks uglier than another unless the model assigns that
			bend a higher cost.
		</p>
	</More>

	<h2>Playground</h2>
	<p>
		The playground uses the engine’s real coordinates rather than the slot grid. On this
		particular graph, Brandes–Köpf is widest and straightest; linear segments is narrower with
		one additional kink; network simplex falls between them; and simple centring packs
		most tightly while bending the long edges most.
	</p>
	<p>
		To expose the size constraint, change the first line to
		<code>a[long source label] --&gt; g</code>. The measured box widens, its neighbours
		move, and every strategy must preserve the new edge-to-edge gap.
	</p>
	<div class="play">
		<div class="controls">
			<textarea bind:value={playSrc} rows="21" spellcheck="false" aria-label="Graph edges"
			></textarea>
			<label>
				<span class="dim">placement</span>
				<select bind:value={playNp}>
					<option value="BRANDES_KOEPF">Brandes–Köpf</option>
					<option value="LINEAR_SEGMENTS">linear segments</option>
					<option value="NETWORK_SIMPLEX">network simplex</option>
					<option value="SIMPLE">simple centring</option>
				</select>
			</label>
		</div>
		<div class="play-fig">
			<ElkGrid src={playSrc} options={np(playNp)} grid={false} />
		</div>
	</div>

	<BuildContract
		phase="Node placement"
		receives="Layer orders, measured node rectangles, dummy chains, ports, and minimum gaps."
		produces="Coordinates for every real node, dummy, and layer envelope."
		guarantees="Layer order is unchanged and measured rectangles remain disjoint with the required gaps."
		baseline="Pack each layer by box-edge gaps, then repeatedly pull nodes toward their neighbours while clamping them between ordered neighbours."
		pushback="Routing needs too many tracks or bends, the drawing is too wide, or labels and important paths have no usable alignment."
	/>

	<h2>Takeaways</h2>
	<ul>
		<li>Placement assigns x under two rules — keep the order and keep measured box edges apart — plus four wishes: straight long edges, centred parents, short edges, narrow drawing.</li>
		<li>Long labels change geometry before placement: width pushes neighbours sideways; wrapped height expands the layer on the flow axis.</li>
		<li>Straightness can cost width: a straight chain owns its column through every layer it crosses.</li>
		<li>Priority placement moves important nodes first; linear segments make dummy chains rigid; Brandes–Köpf averages four aligned compactions; network simplex minimizes a weighted price.</li>
		<li>Brandes–Köpf is the usual default; linear segments are often narrower. Simple centring is a baseline, not a serious general strategy.</li>
		<li>Crossings were settled by the layer orders. Placement changes geometry, not their combinatorial count.</li>
	</ul>
	<p class="dim">
		Next: <a href={resolve('/learn/edge-routing')}>edge routing</a> — the nodes are placed; now
		the edges need paths between them.
	</p>
</div>

<style>
	.row5 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		align-items: start;
		margin: 0.8rem 0;
	}
	@media (max-width: 40rem) {
		.row5 {
			grid-template-columns: 1fr;
		}
	}
	.row5 figure {
		margin: 0;
	}
	.row5 figcaption {
		text-align: center;
	}
	.bkavg {
		max-width: 28rem;
		margin: 0.4rem auto 0;
	}
	.bkavg figcaption {
		text-align: center;
	}
</style>
