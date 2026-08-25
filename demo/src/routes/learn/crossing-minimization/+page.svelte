<script lang="ts">
	import { resolve } from '$app/paths';
	import ElkGrid from '$lib/learn/ElkGrid.svelte';
	import Term from '$lib/learn/Term.svelte';

	// ---- the reorder widget ---------------------------------------------
	// Three fixed layers; the reader drags items sideways within their layer.
	// The long edge a -> i puts a dummy ("a>i") in the middle layer, and the
	// dummy is draggable like any node — it is one, as far as this phase is
	// concerned. Crossings are counted from the orders alone. The minimum
	// (2) was brute-forced over all 3!·4!·3! orders.
	const L: string[][] = [
		['a', 'b', 'c'],
		['d', 'e', 'f', 'a>i'],
		['g', 'h', 'i']
	];
	// Unit segments between adjacent layers; the long edge is two of them.
	const SEG: [string, string][] = [
		['a', 'e'],
		['a', 'a>i'],
		['a>i', 'i'],
		['b', 'd'],
		['b', 'f'],
		['c', 'e'],
		['c', 'd'],
		['d', 'h'],
		['e', 'g'],
		['f', 'h'],
		['f', 'i']
	];
	const MIN_CROSS = 2;
	const BEST: string[][] = [
		['a', 'c', 'b'],
		['e', 'a>i', 'd', 'f'],
		['g', 'i', 'h']
	];
	const layerOf: Record<string, number> = {};
	L.forEach((l, i) => l.forEach((n) => (layerOf[n] = i)));
	const isDummy = (n: string) => n.includes('>');
	const X0 = 90;
	const PITCH = 80;
	const BY = (r: number) => 40 + 65 * r;
	const ARENA_H = 210;

	let order = $state(L.map((l) => [...l]));
	// Barycenters from the last sweep, shown as badges on the layer it sorted.
	let bcs = $state<Record<string, number>>({});
	let dragN = $state<string | null>(null);
	let dragX = $state(0);
	let arena: SVGSVGElement | undefined = $state();

	const posOf = (o: string[][], n: string) => o[layerOf[n]].indexOf(n);
	const xOf = (n: string): number => (n === dragN ? dragX : X0 + posOf(order, n) * PITCH);
	function crossings(o: string[][]): number {
		let c = 0;
		for (let i = 0; i < SEG.length; i++)
			for (let j = i + 1; j < SEG.length; j++) {
				const [u1, v1] = SEG[i];
				const [u2, v2] = SEG[j];
				if (layerOf[u1] !== layerOf[u2]) continue;
				if ((posOf(o, u1) - posOf(o, u2)) * (posOf(o, v1) - posOf(o, v2)) < 0) c++;
			}
		return c;
	}
	const nCross = $derived(crossings(order));

	// One barycenter pass: walking down, each layer is sorted by the mean
	// position of its neighbours in the layer above (already sorted); walking
	// up, by the neighbours below. Items with no neighbours on that side keep
	// their position.
	function sweep(down: boolean) {
		const next = order.map((l) => [...l]);
		const seq = down ? [1, 2] : [1, 0];
		const fresh: Record<string, number> = {};
		for (const k of seq) {
			const ref = down ? k - 1 : k + 1;
			const bc = (n: string): number => {
				const nb = SEG.filter(([u, v]) => (down ? v === n : u === n) && layerOf[down ? u : v] === ref)
					.map(([u, v]) => next[ref].indexOf(down ? u : v));
				return nb.length ? nb.reduce((a, b) => a + b, 0) / nb.length : next[k].indexOf(n);
			};
			const scored = next[k].map((n) => ({ n, b: bc(n) }));
			scored.forEach(({ n, b }) => (fresh[n] = b));
			next[k] = scored.sort((p, q) => p.b - q.b).map((x) => x.n);
		}
		order = next;
		bcs = fresh;
	}
	function setOrder(o: string[][]) {
		order = o.map((l) => [...l]);
		bcs = {};
	}
	function svgX(e: PointerEvent): number {
		if (!arena) return 0;
		const r = arena.getBoundingClientRect();
		return ((e.clientX - r.left) / r.width) * 460;
	}
	function grab(n: string, e: PointerEvent) {
		dragN = n;
		dragX = svgX(e);
		bcs = {};
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	}
	function dragMove(e: PointerEvent) {
		if (dragN === null) return;
		const row = order[layerOf[dragN]];
		dragX = Math.max(X0, Math.min(X0 + (row.length - 1) * PITCH, svgX(e)));
		const i = row.indexOf(dragN);
		const j = Math.round((dragX - X0) / PITCH);
		if (j !== i) {
			row.splice(i, 1);
			row.splice(j, 0, dragN);
		}
	}
	function drop() {
		dragN = null;
	}
	function nodeKey(n: string, e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		const row = order[layerOf[n]];
		const i = row.indexOf(n);
		const j = Math.max(0, Math.min(row.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)));
		if (i === j) return;
		row.splice(i, 1);
		row.splice(j, 0, n);
		bcs = {};
	}

	// ---- playground -------------------------------------------------------
	// Chosen so the thoroughness knob has visibly distinct steps (measured:
	// NONE 10 crossings; thoroughness 1 -> 7, 3 -> 6, 7 -> 5, 10 -> 4).
	const PLAY = `a --> d
b --> j
c --> f
d --> k
d --> j
e --> m
f --> j
g --> k
g --> j
h --> n
h --> m
i --> n
j --> n
j --> l
k --> m
b --> e
b --> g
d --> h
f --> i`;
	let playSrc = $state(PLAY);
	let playCm = $state('LAYER_SWEEP');
	let playThor = $state('7');
	const cm = (s: string, t: string) => ({
		'elk.layered.crossingMinimization.strategy': s,
		'elk.layered.thoroughness': t
	});
</script>

<svelte:head>
	<title>learn — crossing minimization</title>
</svelte:head>

<!-- The widget graph drawn statically at a given order (no interaction). -->
{#snippet orderfig(o: string[][])}
	<svg viewBox="0 0 460 {ARENA_H}" class="figsvg" role="img" aria-label="Node order">
		{#each L as _, r}
			<rect x="4" y={BY(r) - 21} width="452" height="42" class="band" />
			<text x="8" y={BY(r) - 7} class="bandlabel">layer {r}</text>
		{/each}
		{#each SEG as [u, v]}
			{@const x1 = X0 + posOf(o, u) * PITCH}
			{@const x2 = X0 + posOf(o, v) * PITCH}
			{@const y1 = BY(layerOf[u])}
			{@const y2 = BY(layerOf[v])}
			{@const len = Math.hypot(x2 - x1, y2 - y1) || 1}
			<line
				x1={x1 + ((x2 - x1) * 16) / len}
				y1={y1 + ((y2 - y1) * 16) / len}
				x2={x2 - ((x2 - x1) * (isDummy(v) ? 8 : 24)) / len}
				y2={y2 - ((y2 - y1) * (isDummy(v) ? 8 : 24)) / len}
				class="edge"
				marker-end={isDummy(v) ? undefined : 'url(#arr)'}
			/>
		{/each}
		{#each o as row, r}
			{#each row as n, i}
				{@const x = X0 + i * PITCH}
				{#if isDummy(n)}
					<rect x={x - 14} y={BY(r) - 12} width="28" height="24" rx="10" class="slot" />
					<circle cx={x} cy={BY(r)} r="4" class="dummy" />
				{:else}
					<rect x={x - 20} y={BY(r) - 12} width="40" height="24" rx="10" class="pill" />
					<text {x} y={BY(r) + 4}>{n}</text>
				{/if}
			{/each}
		{/each}
	</svg>
{/snippet}

<div class="lesson">
	<p class="crumbs">
		<a href={resolve('/learn')}>learn</a> <span class="dim">/ crossing minimization</span>
	</p>
	<h1>Crossing minimization</h1>
	<p class="lede">
		<a href={resolve('/learn/layering')}>Layering</a> fixed the rows. Crossing minimization orders
		the nodes within each row before coordinates exist. Those orders determine which edges
		cross, making this the last purely combinatorial phase.
	</p>
	<p>
		Dummy nodes take part too. A long edge has a dummy in each intermediate layer, and every
		dummy needs a position in that layer’s order. A poor order makes the edge weave across the
		drawing; a good one lets it run nearly straight.
	</p>
	<Term name="crossing">
		Two edges that run between the same pair of layers cross exactly when their endpoints are
		in opposite order: <code>u₁</code> left of <code>u₂</code> above, but <code>v₁</code> right
		of <code>v₂</code> below. Crossings are a property of the orders alone — no coordinates
		needed to count them.
	</Term>

	<h2>Experiment: reorder the layers</h2>
	<p>
		Drag nodes sideways within their rows; the dotted dummy can move too. The declared order
		has nine crossings, while the minimum is two. After trying it by hand, run
		<em>sweep ↓</em> or <em>sweep ↑</em>. A sweep sorts nodes by the average position of their
		neighbours in the preceding row. The badges show those averages.
	</p>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg
		bind:this={arena}
		viewBox="0 0 460 {ARENA_H}"
		class="arena"
		role="application"
		aria-label="Drag nodes sideways within their layer"
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
			{@const x1 = xOf(u)}
			{@const x2 = xOf(v)}
			{@const y1 = BY(layerOf[u])}
			{@const y2 = BY(layerOf[v])}
			{@const len = Math.hypot(x2 - x1, y2 - y1) || 1}
			<line
				x1={x1 + ((x2 - x1) * 16) / len}
				y1={y1 + ((y2 - y1) * 16) / len}
				x2={x2 - ((x2 - x1) * (isDummy(v) ? 8 : 24)) / len}
				y2={y2 - ((y2 - y1) * (isDummy(v) ? 8 : 24)) / len}
				class="edge"
				marker-end={isDummy(v) ? undefined : 'url(#arr)'}
			/>
		{/each}
		{#each order as row, r}
			{#each row as n (n)}
				<g
					class="grab"
					class:lift={n === dragN}
					role="slider"
					tabindex="0"
					aria-label="Position of {isDummy(n) ? 'dummy' : 'node'} {n}"
					aria-valuemin="1"
					aria-valuemax={row.length}
					aria-valuenow={row.indexOf(n) + 1}
					onpointerdown={(ev) => grab(n, ev)}
					onpointermove={dragMove}
					onpointerup={drop}
					onpointercancel={drop}
					onkeydown={(ev) => nodeKey(n, ev)}
				>
					{#if isDummy(n)}
						<rect x={xOf(n) - 14} y={BY(r) - 12} width="28" height="24" rx="10" class="slot" />
						<circle cx={xOf(n)} cy={BY(r)} r="4" class="dummy" />
					{:else}
						<rect x={xOf(n) - 20} y={BY(r) - 12} width="40" height="24" rx="10" class="pill" />
						<text x={xOf(n)} y={BY(r) + 4}>{n}</text>
					{/if}
					{#if bcs[n] !== undefined}
						<circle cx={xOf(n) + 20} cy={BY(r) - 14} r="11" class="chip" />
						<text x={xOf(n) + 20} y={BY(r) - 11} class="chiptext">{bcs[n].toFixed(1)}</text>
					{/if}
				</g>
			{/each}
		{/each}
	</svg>
	<div class="statbar">
		<span>
			crossings: <b class:good={nCross === MIN_CROSS}>{nCross}</b>
			<span class="dim">(minimum: {MIN_CROSS})</span>
		</span>
		<button class="ghost" onclick={() => sweep(true)}>sweep ↓</button>
		<button class="ghost" onclick={() => sweep(false)}>sweep ↑</button>
		<button class="ghost" onclick={() => setOrder(L)}>declared order</button>
		<button
			class="ghost"
			onclick={() => setOrder(order.map((l) => [...l].sort(() => Math.random() - 0.5)))}
			>shuffle</button
		>
	</div>

	<h2>Counting is easy; choosing is hard</h2>
	<p>
		Once the orders are known, counting crossings is a comparison over pairs of edges.
		Choosing the orders is harder. Even the one-sided problem—freeze one of two layers and
		optimize the other—is NP-hard. Interactive engines therefore use fast heuristics and keep
		the best order they find.
	</p>
	<Term name="Eades & Wormald (1994)" href="https://doi.org/10.1007/BF01187020">
		<em>Edge crossings in drawings of bipartite graphs</em> — proves one-sided crossing
		minimization NP-hard and shows the median heuristic is within a factor of 3 of optimal.
	</Term>

	<h2>The layer sweep</h2>
	<p>
		The standard heuristic handles one adjacent pair of layers at a time. Freeze the top
		layer. For each node below it, compute the average position of its neighbours above, then
		sort by that value. Freeze the new order and continue downward. At the bottom, reverse
		direction and repeat.
	</p>
	<p>
		Engines alternate these sweeps until the order stops improving or an iteration limit is
		reached. In the widget, one downward sweep reduces nine crossings to three; the upward
		sweep reaches two. That success is specific to this graph. Barycenter sorting can stop at
		a local optimum.
	</p>
	<Term name="barycenter">
		The mean position of a node's neighbours in the adjacent, already-sorted layer. Sorting a
		layer by barycenter pulls every node under the centre of mass of what it connects to, which
		tends to untangle edges without ever counting a crossing.
	</Term>
	<p>
		Two refinements are common. The <b>median</b> variant uses the middle neighbour rather
		than the mean, making one distant neighbour less influential. A <b>transpose</b> pass then
		tests adjacent swaps and keeps any that reduce crossings. Engines may repeat the process
		from several starting orders and retain the best result; the playground exposes that as
		thoroughness.
	</p>
	<Term name="Sugiyama, Tagawa & Toda (1981)" href="https://doi.org/10.1109/TSMC.1981.4308636">
		<em>Methods for visual understanding of hierarchical system structures</em> — the paper
		that defined the layered pipeline, including the barycenter layer sweep used here.
	</Term>

	<h2>Long edges: where the tangle comes from</h2>
	<p>
		Look at the long edge <code>a → i</code> in the widget's graph, drawn with two different
		orders of the middle layer:
	</p>
	<div class="row">
		<figure>
			{@render orderfig(L)}
			<figcaption>
				<b>Declared order</b>, 9 crossings. The dummy is the last item in the middle
				layer, far to the right of both <code>a</code> and <code>i</code>.
			</figcaption>
		</figure>
		<figure>
			{@render orderfig(BEST)}
			<figcaption>
				<b>An optimal order</b>, 2 crossings. The dummy sits between <code>a</code> above
				and <code>i</code> below.
			</figcaption>
		</figure>
	</div>
	<p>
		The edge is unchanged; only its dummy moved. On the left, the dummy sits far to the right,
		so the edge travels out and back. Four of the nine crossings come from that detour. On the
		right, the dummy lies between the edge’s endpoints and the route is almost straight.
	</p>
	<p>
		On a larger graph, every long edge contributes a dummy to each layer it crosses. A dummy
		placed far from its neighbours pulls that edge across the layer. Long edges are not
		inherently tangled—a well-ordered dummy chain is nearly straight—but they create more
		opportunities for poor ordering.
	</p>
	<p>
		Two conclusions follow. The sweep must treat dummies exactly like nodes — it does; the
		barycenter of a dummy is the position of its one neighbour above, which is why the sweep
		pulls it under its source. And the best engines go one step further: they keep all the
		dummies of an edge in a single column, so the edge is not just low-crossing but
		<em>straight</em>. That is a placement concern, and it is where the next lesson starts.
	</p>

	<h2>Beyond the sweep</h2>
	<p>
		The sweep is not the best we know how to do; it is the best we know how to do in a
		millisecond. Several methods beat it on crossings. <b>Sifting</b> takes one node, slides
		it through every position in its layer, keeps the best, and repeats for every node — a
		quadratic pass instead of a sort, and reliably fewer crossings than barycenter plus
		transpose. <b>Global sifting</b> does the same across all layers at once and treats each
		dummy chain as one rigid block, so the dummies of one edge can no longer be ordered
		against each other. That is the spaghetti problem attacked head-on, and it shows on long-edge-heavy
		graphs. At the far end sit the exact methods: integer programming solves the whole thing
		optimally for graphs up to a few hundred nodes, and instances that are nearly planar
		solve fast regardless of size.
	</p>
	<Term name="Matuszewski, Schönfeld & Molitor (1999)" href="https://doi.org/10.1007/3-540-46648-7_22">
		<em>Using sifting for k-layer straightline crossing minimization</em> — sifting, borrowed
		from BDD variable ordering, applied layer by layer.
	</Term>
	<Term name="Bachmaier, Brandenburg, Brunner & Hübner (2011)" href="https://doi.org/10.7155/jgaa.00242">
		<em>Global k-level crossing reduction</em> — sifting over all levels at once
		with dummy chains as rigid blocks; fewer crossings and straighter long edges than
		level-by-level sweeps.
	</Term>
	<Term name="Jünger & Mutzel (1997)" href="https://doi.org/10.7155/jgaa.00001">
		<em>2-layer straightline crossing minimization: performance of exact and heuristic
		algorithms</em> — branch-and-cut for the exact optimum, and the benchmark that showed how
		close (and how far) the cheap heuristics land.
	</Term>
	<p>
		General-purpose engines still favour sweeps: Graphviz <code>dot</code> uses weighted
		medians, while ELK offers barycenters plus greedy switching. They are fast enough to run
		repeatedly and usually remove the obvious tangles.
	</p>
	<p>
		Raw crossing count is only a proxy for readability. A crossing near a node can obscure
		which port an edge uses; a crossing on a primary path may matter more than one on a minor
		edge; and a badly bent dummy chain can be harder to follow than one additional crossing.
		Edge weights and rigid dummy chains let an engine express some of those priorities.
	</p>

	<h2>Playground</h2>
	<p>
		Four layers, two long edges, live. <code>LAYER_SWEEP</code> is the heuristic above;
		<code>NONE</code> keeps nodes in declaration order (10 crossings here), so reordering lines
		in the source reorders the drawing — try making it worse, then better, by hand.
		Thoroughness is how many random restarts the sweep gets, keeping the best: 1 settles for
		the first answer at 7 crossings, and each step up finds a better local optimum — 6, 5,
		then 4. That is the sweep's character in one knob: cheap, decent, and never sure it is
		done.
	</p>
	<div class="play">
		<div class="controls">
			<textarea bind:value={playSrc} rows="19" spellcheck="false" aria-label="Graph edges"
			></textarea>
			<label>
				<span class="dim">strategy</span>
				<select bind:value={playCm}>
					<option>LAYER_SWEEP</option>
					<option>NONE</option>
				</select>
			</label>
			<label>
				<span class="dim">thoroughness</span>
				<select bind:value={playThor}>
					<option>1</option>
					<option>3</option>
					<option>7</option>
					<option>10</option>
				</select>
			</label>
		</div>
		<div class="play-fig">
			<ElkGrid src={playSrc} options={cm(playCm, playThor)} />
		</div>
	</div>

	<h2>Takeaways</h2>
	<ul>
		<li>With layers fixed, the only freedom is the order within each layer — and crossings are decided entirely by those orders.</li>
		<li>Counting crossings needs no geometry; minimizing them is NP-hard even for two layers with one frozen.</li>
		<li>The layer sweep sorts each layer by the barycenter (or median) of its neighbours in the previous one, alternating direction until stable; a transpose pass cleans up locally.</li>
		<li>Dummies are ordered like nodes. Spaghetti is dummies ordered badly — a misplaced dummy drags its edge on a detour across the layer.</li>
		<li>Sifting, global sifting and exact integer programming all beat the sweep on crossings; the sweep ships because it is fast and close, and because crossings are not the whole of readability anyway.</li>
	</ul>
	<p class="dim">
		Next: <a href={resolve('/learn/node-placement')}>node placement</a> — turning orders into
		coordinates, and what straight dummy chains cost in width.
	</p>
</div>

<style>
	.chip {
		fill: var(--custom-bg);
		stroke: var(--purple);
	}
	svg .chiptext {
		fill: var(--purple);
		font-size: 9px;
	}
</style>
