<script lang="ts">
	import { base } from '$app/paths';
	import ElkGrid from '$lib/learn/ElkGrid.svelte';
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
	// The four-passes figure runs on its own sparser graph: the widget graph
	// is so constrained the passes barely differ, and the whole point is the
	// visible lean.
	const BKL: string[][] = [
		['a', 'b'],
		['c', 'd', 'e'],
		['f', 'g'],
		['h']
	];
	const BKSEG: [string, string][] = [
		['a', 'c'],
		['a', 'd'],
		['b', 'e'],
		['c', 'f'],
		['d', 'f'],
		['e', 'g'],
		['f', 'h'],
		['g', 'h']
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

	// ---- playground -------------------------------------------------------
	// Chosen so the four strategies visibly differ (measured: Brandes–Köpf
	// widest and straightest, linear segments narrower with one more kink,
	// network simplex between, SIMPLE narrowest and kinkiest).
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

<div class="page">
	<p class="crumbs"><a href="{base}/learn">learn</a> <span class="dim">/ node placement</span></p>
	<h1>Node placement</h1>
	<p class="lede">
		<a href="{base}/learn/crossing-minimization">Crossing minimization</a> fixed the order in
		every layer. Node placement turns those orders into coordinates — the first phase that
		produces geometry rather than structure. The vertical coordinate is free: a layer is a
		row, rows are spaced out, done. The horizontal coordinate is the decision, and it comes
		with two hard rules: the order within a layer is kept, and neighbours keep a minimum gap.
		Everything beyond that is taste — and the tastes disagree.
	</p>
	<Term name="node placement">
		Assigning an x coordinate to every node (and every dummy) given fixed layers and fixed
		orders. Also called coordinate assignment. Crossings are already decided; this phase
		cannot add or remove one.
	</Term>

	<h2>Four wishes, one axis</h2>
	<p>
		We want four things from the x coordinates. Long edges <b>straight</b> — a dummy chain
		that drifts sideways is a bend in the final edge, and every bend is work for the eye.
		Parents <b>centred</b> over their children — this is where a drawing's symmetry comes
		from. Edges <b>short</b>. And the whole drawing <b>narrow</b>.
	</p>
	<p>
		They cannot all win. A straight chain claims one column through every layer it crosses,
		and nothing else may use that column — so straightness eats width. Centring a parent
		between children that sit far apart stretches and bends its edges. And packing
		everything to the left is the narrowest drawing there is, and ruins the other three
		wishes at once.
	</p>

	<h2>Try it</h2>
	<p>
		Four layers, orders fixed, two long edges. Drag anything sideways. It stops at its
		neighbours and at the walls — the same two rules the engine works under. A <b>kink</b>,
		in the counter below, is a dummy where the edge changes direction; width and total
		horizontal edge length are what they sound like. Get all three numbers as low as you can,
		then notice you cannot do it — lowering one raises another. The buttons run the methods
		from the next section.
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
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<g
					class="grab"
					class:lift={n === dragN}
					onpointerdown={(ev) => grab(n, ev)}
					onpointermove={dragMove}
					onpointerup={drop}
					onpointercancel={drop}
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
		<button class="ghost" onclick={() => (xs = packLeft())}>[pack left]</button>
		<button class="ghost" onclick={() => (xs = balance(xs))}>[balance]</button>
		<button class="ghost" onclick={() => (xs = straighten(xs))}>[straight long edges]</button>
		<button class="ghost" onclick={() => (xs = spreadEven())}>[reset]</button>
	</div>
	<p>
		<em>[pack left]</em> wins width and loses everything else — both long edges zigzag out
		and back. <em>[balance]</em> shortens the edges and centres the nodes, but the kinks
		survive: each dummy drifts toward whatever it touches, and its chain-mates drift
		elsewhere. <em>[straight long edges]</em> stands each chain upright under its source,
		leaving one bend where the edge turns toward its target. And the drawing gets wider.
	</p>
	<p>
		The widening is worth a second look, because nothing in any single layer demands it.
		<code>a</code>'s column must clear three nodes in layer 1. <code>b</code>'s column must
		clear two more nodes in layer 2, to the right of <code>a</code>'s column. Count the gaps
		from the left wall to <code>b</code>'s column: three to clear <code>c</code>,
		<code>d</code>, <code>e</code>, then three more to clear <code>f</code> and
		<code>g</code> and keep the columns apart — six, in a graph where no single layer needs
		more than four. Rigid columns accumulate constraints <em>across</em> layers.
		That is the width bill, and it is why straightness is a choice rather than a default.
	</p>

	<h2>How engines place</h2>
	<p>
		The four methods in real engines all answer the same question — who decides where the
		slack goes — and the answers are: priorities, rigid pieces, averaged alignments, or a
		price list.
	</p>
	<p>
		The <b>priority method</b> is the classic. Walk the layers top to bottom. In each layer,
		take the nodes one at a time, most important first, and move each toward the average
		position of its neighbours in the layer above — as far as the current gaps allow. Dummies
		count as the most important nodes of all, so the chains settle first, and straight; the
		real nodes then fit in around them. Walk back bottom to top the same way, and repeat a
		few times. The <em>[balance]</em> button above is this method, minus the priorities.
	</p>
	<p>
		<b>Linear segments</b> reach straightness by construction instead. All the dummies of one
		edge form a single segment, and a segment only moves as one piece — so a long edge cannot
		kink in the middle, because there is no joint there to bend. That is what
		<em>[straight long edges]</em> does. The pair below shows what it buys and what it costs:
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
		Each pass leans; the average stands straight, edges are vertical wherever an alignment
		allowed it, and the whole thing runs in linear time. The known weakness is width — blocks
		refuse to overlap and push the drawing outward; on a corpus of real diagrams, linear
		segments came out about fifteen percent narrower for the same graphs.
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

	<h2>Playground</h2>
	<p>
		The engine's four placement strategies on one graph, drawn with its real coordinates —
		no slot grid this time, the coordinates are the point. Watch the width and the kink
		count: Brandes–Köpf is the widest and straightest, linear segments narrower with a kink
		more, network simplex in between, and <code>SIMPLE</code> — plain packing — the narrowest
		and the crookedest.
	</p>
	<div class="play">
		<div class="controls">
			<textarea bind:value={playSrc} rows="21" spellcheck="false" aria-label="Graph edges"
			></textarea>
			<label>
				<span class="dim">placement</span>
				<select bind:value={playNp}>
					<option>BRANDES_KOEPF</option>
					<option>LINEAR_SEGMENTS</option>
					<option>NETWORK_SIMPLEX</option>
					<option>SIMPLE</option>
				</select>
			</label>
		</div>
		<div class="play-fig">
			<ElkGrid src={playSrc} options={np(playNp)} grid={false} />
		</div>
	</div>

	<h2>Takeaways</h2>
	<ul>
		<li>Placement assigns x under two rules — keep the order, keep the gap — and four wishes: straight long edges, centred parents, short edges, narrow drawing.</li>
		<li>Straightness costs width: a straight chain owns its column through every layer it crosses.</li>
		<li>Priority method, linear segments, Brandes–Köpf, network simplex: priorities, rigid pieces, averaged alignments, or a price list. Brandes–Köpf is the usual default; linear segments are usually narrower.</li>
		<li>Crossings are settled before this phase; placement can only make a drawing wider, straighter, or more balanced — never less tangled.</li>
	</ul>
	<p class="dim">
		Next: edge routing — the nodes are placed; now the edges need paths between them.
	</p>
</div>

<style>
	.page {
		max-width: 52rem;
		margin: 0 auto;
		padding: 1.5rem 1rem 4rem;
		line-height: 1.55;
	}
	.crumbs a,
	a {
		color: var(--cmd);
	}
	h1 {
		font-size: 1.4rem;
	}
	h2 {
		font-size: 1.1rem;
		margin-top: 2.2rem;
		color: var(--accent);
	}
	.lede {
		font-size: 1.05rem;
	}
	.dim {
		color: var(--dim);
	}
	code {
		font-size: 0.92em;
		background: var(--custom-bg);
		border-radius: 3px;
		padding: 0 0.25em;
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		align-items: start;
	}
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
	@media (max-width: 40rem) {
		.row {
			grid-template-columns: 1fr;
		}
	}
	.row figure {
		margin: 0;
	}
	figcaption {
		font-size: 0.9rem;
		color: var(--dim);
	}
	figcaption b {
		color: var(--fg);
	}

	.figsvg {
		width: 100%;
		max-width: 26rem;
		display: block;
		margin: 0 auto 0.4rem;
	}
	.figsvg text,
	.arena text {
		fill: var(--fg);
		font-size: 13px;
		text-anchor: middle;
	}
	.edge {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.4;
	}
	.arrhead {
		fill: var(--accent);
	}
	.pill {
		fill: var(--custom-bg);
		stroke: var(--fg);
	}
	.band {
		fill: color-mix(in srgb, var(--accent) 8%, transparent);
	}
	svg .bandlabel {
		fill: var(--dim);
		font-size: 10px;
		text-anchor: start;
	}
	.dummy {
		fill: var(--dim);
	}
	.slot {
		fill: none;
		stroke: var(--muted);
		stroke-dasharray: 3 3;
	}

	.arena {
		user-select: none;
		width: 100%;
		max-width: 34rem;
		display: block;
		margin: 0 auto;
		touch-action: none;
	}
	.grab {
		cursor: grab;
	}
	/* The dummy slot is fill: none, so only its dashed outline and the dot
	   would be grabbable; pointer-events: all makes the whole area hit. */
	.grab .slot {
		pointer-events: all;
	}
	.grab.lift .pill,
	.grab.lift .slot {
		stroke: var(--accent);
		stroke-width: 2;
	}
	.grab text {
		user-select: none;
	}
	.statbar {
		display: flex;
		gap: 1.4rem;
		align-items: baseline;
		justify-content: center;
		margin: 0.4rem 0 0;
	}
	.statbar .good {
		color: var(--accent);
	}
	.ghost {
		font: inherit;
		border: none;
		background: none;
		color: var(--cmd);
		cursor: pointer;
		padding: 0;
	}

	.play {
		display: grid;
		grid-template-columns: minmax(16rem, 24rem) 1fr;
		gap: 1rem;
		align-items: start;
	}
	.play-fig {
		margin: 0;
		min-width: 0;
	}
	.controls textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-size: 0.9rem;
		font-variant-ligatures: none;
		background: var(--custom-bg);
		color: var(--fg);
		border: 1px solid var(--muted);
		border-radius: 4px;
		padding: 0.5rem;
		resize: vertical;
	}
	.controls label {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		margin-top: 0.5rem;
	}
	.controls select {
		font: inherit;
		font-size: 0.9rem;
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--muted);
		border-radius: 3px;
	}
	@media (max-width: 52rem) {
		.play {
			grid-template-columns: 1fr;
		}
	}
</style>
