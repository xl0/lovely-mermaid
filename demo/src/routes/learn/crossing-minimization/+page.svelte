<script lang="ts">
	import { base } from '$app/paths';
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

<div class="page">
	<p class="crumbs">
		<a href="{base}/learn">learn</a> <span class="dim">/ crossing minimization</span>
	</p>
	<h1>Crossing minimization</h1>
	<p class="lede">
		<a href="{base}/learn/layering">Layering</a> settled the rows. What is left to decide
		before anything gets coordinates is the <em>order</em> within each row — and that order
		decides the crossings. Every edge crossing in a layered drawing is the product of two
		choices made in this phase, one per layer. It is the last purely combinatorial step, and
		the one where most of the readability is won or lost.
	</p>
	<p>
		Dummy nodes are in the game. A long edge has a dummy in every layer it passes through, and
		each dummy gets ordered along with the real nodes of its layer. Order them badly and the
		edge weaves across the drawing; order them well and it runs straight. We come back to
		this.
	</p>
	<Term name="crossing">
		Two edges that run between the same pair of layers cross exactly when their endpoints are
		in opposite order: <code>u₁</code> left of <code>u₂</code> above, but <code>v₁</code> right
		of <code>v₂</code> below. Crossings are a property of the orders alone — no coordinates
		needed to count them.
	</Term>

	<h2>Counting is easy, choosing is not</h2>
	<p>
		With orders in hand, counting crossings is a loop over pairs of edges. Choosing the orders
		is another matter: even the smallest version of the problem — two layers, one of them
		frozen, find the order of the other that minimizes crossings — is NP-hard. A real drawing
		has many layers and nothing frozen, so engines do what they did for cycle breaking: run a
		heuristic and accept good enough.
	</p>
	<Term name="Eades & Wormald (1994)" href="https://doi.org/10.1007/BF01187020">
		<em>Edge crossings in drawings of bipartite graphs</em> — proves one-sided crossing
		minimization NP-hard and shows the median heuristic is within a factor of 3 of optimal.
	</Term>

	<h2>Try it</h2>
	<p>
		Three layers, nine nodes, and one long edge (<code>a → i</code>) whose dummy sits in the
		middle row. Drag anything sideways — the dummy too, it is a node here. The declared order
		costs 9 crossings; the minimum is 2. Find it, then let the heuristic try: <em>[sweep ↓]</em>
		re-sorts rows 1 and 2 by the average position of their neighbours above,
		<em>[sweep ↑]</em> does the same looking down. The badges show the averages it sorted by.
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
		<button class="ghost" onclick={() => sweep(true)}>[sweep ↓]</button>
		<button class="ghost" onclick={() => sweep(false)}>[sweep ↑]</button>
		<button class="ghost" onclick={() => setOrder(L)}>[declared order]</button>
		<button
			class="ghost"
			onclick={() => setOrder(order.map((l) => [...l].sort(() => Math.random() - 0.5)))}
			>[shuffle]</button
		>
	</div>

	<h2>The layer sweep</h2>
	<p>
		The standard heuristic takes the layers one pair at a time. Freeze the top layer. For each
		node in the next layer, compute its <b>barycenter</b> — the average position of its
		neighbours in the frozen layer — and sort the layer by it. That layer is now frozen; repeat
		downward. At the bottom, turn around and sweep upward, sorting each layer by its neighbours
		below. Keep alternating until an entire sweep changes nothing, or patience runs out. From
		the declared order above, one sweep down reaches 3 crossings and the sweep back up reaches
		the optimum — for this graph. Nothing guarantees that in general; the barycenter can settle
		into orders that a single swap would improve.
	</p>
	<Term name="barycenter">
		The mean position of a node's neighbours in the adjacent, already-sorted layer. Sorting a
		layer by barycenter pulls every node under the centre of mass of what it connects to, which
		tends to untangle edges without ever counting a crossing.
	</Term>
	<p>
		Two refinements are standard. The <b>median</b> variant sorts by the median neighbour
		position instead of the mean — less sensitive to one far-away neighbour, and the variant
		with a provable bound. And after sweeping, a <b>transpose</b> pass walks each layer
		swapping adjacent pairs whenever the swap reduces crossings, which catches exactly the
		local mistakes the barycenter leaves behind. Engines run the whole thing several times
		from different starting orders and keep the best; that count is the "thoroughness" knob
		in the playground below.
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
		The edge itself is the same in both drawings. What differs is where its dummy ended up in
		the middle layer. On the left, the dummy is placed far to the right, so the edge has to
		travel right to reach it and then back left to reach <code>i</code> — and every node and
		edge it passes on the way out, it passes again on the way back: four of the nine
		crossings come from that one misplaced dummy. On the right, the dummy sits directly between its
		two ends and the edge runs almost straight.
	</p>
	<p>
		Now scale it up. A real diagram has a dozen long edges, several spanning three or four
		layers, each with a dummy in every layer it crosses. Each dummy is one more item for the
		sweep to order, and every one that lands far from its neighbours drags its edge on a
		detour across the layer. The tangle that results is what people call spaghetti. It is
		not caused by long edges as such — a long edge with well-placed dummies is just a
		straight line — but by their dummies being ordered badly.
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
		What ships is still the sweep — graphviz's <code>dot</code> with weighted medians, ELK with
		barycenters and a greedy switch — because on ordinary diagrams it lands within a few
		percent of optimal, and the remaining crossings rarely change how the drawing reads. The
		bigger lever is the objective, not the solver. Counting every crossing as one is not a
		model of readability: a crossing right next to a node hurts more than one in the middle
		of a gap, a crossing on an important edge hurts more than one on a minor edge, and a
		dummy chain that bends is often worse than an extra crossing. The engines that weight such
		things — edge weights in <code>dot</code>, rigid chains in global sifting — buy more
		legibility per millisecond than a better crossing counter does.
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
		Next: <a href="{base}/learn/node-placement">node placement</a> — turning orders into
		coordinates, and what straight dummy chains cost in width.
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
	.chip {
		fill: var(--custom-bg);
		stroke: var(--purple);
	}
	svg .chiptext {
		fill: var(--purple);
		font-size: 9px;
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
