<script lang="ts">
	import { resolve } from '$app/paths';
	import DiagramViewer from '$lib/DiagramViewer.svelte';
	import BuildContract from '$lib/learn/BuildContract.svelte';
	import More from '$lib/learn/More.svelte';
	import Term from '$lib/learn/Term.svelte';

	// One graph, one declaration, three strategies, three drawings. The
	// shape is engineered so all three genuinely differ (verified): a
	// 3-cycle declared starting mid-loop, sources feeding both branches, a
	// side branch with a 2-cycle whose degrees bait the greedy heuristic.
	const ZOO = `graph TD
  C[proof] --> A[edit]
  A --> B[render]
  B --> C
  S[assets] --> B
  A --> W[save]
  W --> V[sync]
  V --> W
  V --> U[backup]
  T[fonts] --> W`;
	const SUB = `graph TD
  subgraph R[Retry loop]
    B[attempt] --> C[failed?]
    C --> B
  end
  A[start] --> B
  C --> D[give up]`;
	const cb = (v: string) => ({ 'elk.layered.cycleBreaking.strategy': v });
	let playSrc = $state(ZOO);
	let playCb = $state('GREEDY');

	// ---- hand-drawn zoo figures -------------------------------------------
	// Placements mirror the engine's real output per strategy (verified);
	// hand SVG lets us highlight layers and tag each node with the number the
	// strategy actually consulted.
	type ZN = { n: string; x: number; y: number; chip: string };
	type ZE = { u: string; v: string; rev?: boolean; dx?: number };
	type ZFig = { nodes: ZN[]; edges: ZE[]; bands: number[]; h: number };
	// Declared edges; dx nudges the save↔sync pair apart.
	const ZOO_E: [string, string, number?][] = [
		['proof', 'edit'],
		['edit', 'render'],
		['render', 'proof'],
		['assets', 'render'],
		['edit', 'save'],
		['save', 'sync', -7],
		['sync', 'save', 7],
		['sync', 'backup'],
		['fonts', 'save']
	];
	const zfig = (nodes: ZN[], rev: string[], layers: number): ZFig => ({
		nodes,
		edges: ZOO_E.map(([u, v, dx]) => ({ u, v, dx, rev: rev.includes(`${u}>${v}`) })),
		bands: Array.from({ length: layers }, (_, r) => 30 + 65 * r),
		h: 65 * layers - 12
	});
	const zat = (f: ZFig, n: string) => f.nodes.find((p) => p.n === n) as ZN;
	// Shorten each edge so the arrowhead stops at the node pill.
	const zline = (f: ZFig, e: ZE) => {
		const a = zat(f, e.u);
		const b = zat(f, e.v);
		const dx = e.dx ?? 0;
		const ddx = b.x - a.x;
		const ddy = b.y - a.y;
		const len = Math.hypot(ddx, ddy) || 1;
		return {
			x1: a.x + dx + (ddx * 20) / len,
			y1: a.y + (ddy * 20) / len,
			x2: b.x + dx - (ddx * 26) / len,
			y2: b.y - (ddy * 26) / len
		};
	};
	const FIG_GREEDY = zfig(
		[
			{ n: 'assets', x: 52, y: 30, chip: '+1' },
			{ n: 'edit', x: 150, y: 30, chip: '+1' },
			{ n: 'fonts', x: 252, y: 30, chip: '+1' },
			{ n: 'render', x: 96, y: 95, chip: '−1' },
			{ n: 'save', x: 236, y: 95, chip: '−2' },
			{ n: 'proof', x: 160, y: 160, chip: '0' },
			{ n: 'sync', x: 236, y: 160, chip: '+1' },
			{ n: 'backup', x: 236, y: 225, chip: '−1' }
		],
		['proof>edit', 'sync>save'],
		4
	);
	const FIG_DF = zfig(
		[
			{ n: 'assets', x: 150, y: 30, chip: '1' },
			{ n: 'render', x: 150, y: 95, chip: '2' },
			{ n: 'proof', x: 120, y: 160, chip: '3' },
			{ n: 'edit', x: 180, y: 225, chip: '4' },
			{ n: 'fonts', x: 80, y: 225, chip: '8' },
			{ n: 'save', x: 150, y: 290, chip: '5' },
			{ n: 'sync', x: 150, y: 355, chip: '6' },
			{ n: 'backup', x: 150, y: 420, chip: '7' }
		],
		['edit>render', 'sync>save'],
		7
	);
	const FIG_GMO = zfig(
		[
			{ n: 'proof', x: 120, y: 30, chip: '1' },
			{ n: 'assets', x: 52, y: 95, chip: '4' },
			{ n: 'edit', x: 150, y: 95, chip: '2' },
			{ n: 'fonts', x: 252, y: 95, chip: '8' },
			{ n: 'render', x: 90, y: 160, chip: '3' },
			{ n: 'save', x: 236, y: 160, chip: '5' },
			{ n: 'sync', x: 236, y: 225, chip: '6' },
			{ n: 'backup', x: 236, y: 290, chip: '7' }
		],
		['render>proof', 'sync>save'],
		5
	);
	const FIG_MO = zfig(
		[
			{ n: 'proof', x: 90, y: 30, chip: '1' },
			{ n: 'edit', x: 170, y: 95, chip: '2' },
			{ n: 'render', x: 90, y: 160, chip: '3' },
			{ n: 'save', x: 220, y: 160, chip: '5' },
			{ n: 'assets', x: 40, y: 225, chip: '4' },
			{ n: 'fonts', x: 150, y: 225, chip: '8' },
			{ n: 'sync', x: 252, y: 225, chip: '6' },
			{ n: 'backup', x: 252, y: 290, chip: '7' }
		],
		['render>proof', 'assets>render', 'fonts>save', 'sync>save'],
		5
	);

	// ---- the linear-arrangement widget ------------------------------------
	// Nodes on a line; edges as arcs; leftward arcs (drawn below, red) are
	// the reversals. The reader drags nodes to reorder and watches the count.
	const ARC_N = ['a', 'b', 'c', 'd', 'e', 'f'];
	const ARC_E: [string, string][] = [
		['a', 'b'],
		['b', 'c'],
		['c', 'd'],
		['d', 'a'],
		['b', 'd'],
		['e', 'a'],
		['c', 'f']
	];
	// What the ELS greedy heuristic computes for this graph (one reversal).
	const GREEDY_ORDER = ['e', 'b', 'c', 'd', 'a', 'f'];
	let order = $state([...ARC_N]);
	let dragN = $state<string | null>(null);
	let dragX = $state(0);
	let arcSvg: SVGSVGElement | undefined = $state();
	const SLOT = 100;
	const X0 = 50;
	const xOf = (n: string): number => (n === dragN ? dragX : X0 + order.indexOf(n) * SLOT);
	const isBack = ([u, v]: [string, string]): boolean => order.indexOf(u) > order.indexOf(v);
	const nBack = $derived(ARC_E.filter(isBack).length);
	const arcPath = ([u, v]: [string, string]): string => {
		const x1 = xOf(u);
		const x2 = xOf(v);
		const lift = Math.min(76, 22 + Math.abs(x2 - x1) * 0.22);
		return isBack([u, v])
			? `M ${x1} 116 Q ${(x1 + x2) / 2} ${116 + lift} ${x2} 116`
			: `M ${x1} 84 Q ${(x1 + x2) / 2} ${84 - lift} ${x2} 84`;
	};
	function svgX(e: PointerEvent): number {
		if (!arcSvg) return 0;
		const r = arcSvg.getBoundingClientRect();
		return ((e.clientX - r.left) / r.width) * 600;
	}
	function grab(n: string, e: PointerEvent) {
		dragN = n;
		dragX = svgX(e);
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	}
	function dragMove(e: PointerEvent) {
		if (dragN === null) return;
		dragX = Math.max(X0, Math.min(X0 + (ARC_N.length - 1) * SLOT, svgX(e)));
		const i = order.indexOf(dragN);
		const j = Math.round((dragX - X0) / SLOT);
		if (j !== i) {
			order.splice(i, 1);
			order.splice(j, 0, dragN);
		}
	}
	function drop() {
		dragN = null;
	}
	function moveNode(n: string, by: number) {
		const i = order.indexOf(n);
		const j = Math.max(0, Math.min(order.length - 1, i + by));
		if (i === j) return;
		order.splice(i, 1);
		order.splice(j, 0, n);
	}
	function nodeKey(n: string, e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		moveNode(n, e.key === 'ArrowLeft' ? -1 : 1);
	}
</script>

<svelte:head>
	<title>learn — cycle breaking</title>
</svelte:head>

{#snippet zoosvg(f: ZFig)}
	<svg viewBox="0 0 300 {f.h}" class="figsvg" role="img" aria-label="Strategy result">
		{#each f.bands as y, r}
			<rect x="4" y={y - 18} width="292" height="36" class="band" />
			<text x="8" y={y - 5} class="bandlabel">layer {r}</text>
		{/each}
		{#each f.edges as e}
			{@const l = zline(f, e)}
			<line
				x1={l.x1}
				y1={l.y1}
				x2={l.x2}
				y2={l.y2}
				class="edge"
				class:up={e.rev}
				marker-end={e.rev ? 'url(#arr-up)' : 'url(#arr)'}
			/>
		{/each}
		{#each f.nodes as p}
			<rect x={p.x - 30} y={p.y - 12} width="60" height="24" rx="10" class="pill" />
			<text x={p.x} y={p.y + 4}>{p.n}</text>
			<circle cx={p.x + 26} cy={p.y - 14} r="10" class="chip" />
			<text x={p.x + 26} y={p.y - 11} class="chiptext">{p.chip}</text>
		{/each}
	</svg>
{/snippet}

<div class="lesson">
	<p class="crumbs"><a href={resolve('/learn')}>learn</a> <span class="dim">/ cycle breaking</span></p>
	<h1>Cycle breaking</h1>
	<p class="lede">
		A cycle makes “every edge points forward” impossible. Layered layout gets past this by
		<b>temporarily reversing</b> some edges. The choice is not cosmetic: it decides which
		nodes land above the others.
	</p>
	<p>
		Layering works on the resulting DAG. When the drawing is routed, each reversed edge gets
		its original direction back and appears as a feedback edge against the main flow. Nothing
		is removed from the graph.
	</p>

	<h2>Find a better order</h2>
	<p>
		Put the nodes on a line. An edge that points right can stay as declared; an edge that
		points left must be reversed for layering. This <b>linear arrangement</b> is the useful
		mental model for cycle breaking.
	</p>
	<p>
		Drag the nodes below. Forward edges arc above the line; reversals arc below in red. The
		declared order <code>a…f</code> needs two reversals, but one is enough.
	</p>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg
		bind:this={arcSvg}
		viewBox="0 0 600 210"
		class="arcs"
		role="application"
		aria-label="Drag nodes to reorder the linear arrangement"
	>
		{#each ARC_E as e}
			<path d={arcPath(e)} class:back={isBack(e)} />
		{/each}
		{#each ARC_N as n}
			<g
				class="grab"
				class:lift={n === dragN}
				role="slider"
				tabindex="0"
				aria-label="Position of node {n}"
				aria-valuemin="1"
				aria-valuemax={ARC_N.length}
				aria-valuenow={order.indexOf(n) + 1}
				onpointerdown={(ev) => grab(n, ev)}
				onpointermove={dragMove}
				onpointerup={drop}
				onpointercancel={drop}
				onkeydown={(ev) => nodeKey(n, ev)}
			>
				<circle cx={xOf(n)} cy="100" r="15" />
				<text x={xOf(n)} y="105">{n}</text>
			</g>
		{/each}
	</svg>
	<div class="arcbar">
		<span>
			reversed: <b class:good={nBack === 1}>{nBack}</b> <span class="dim">(minimum: 1)</span>
		</span>
		<button class="ghost" onclick={() => (order = [...ARC_N])}>declared order</button>
		<button class="ghost" onclick={() => (order = [...GREEDY_ORDER])}>greedy answer</button>
		<button class="ghost" onclick={() => (order = [...order].sort(() => Math.random() - 0.5))}
			>shuffle</button
		>
	</div>
	<Term name="DAG">
		Directed acyclic graph: a directed graph with no cycles. Cycle breaking temporarily turns
		the input into one so layering can proceed.
	</Term>
	<Term name="feedback edge">
		An edge routed against the main flow. Retry, loop, and feedback paths commonly appear this
		way.
	</Term>
	<p class="aside">
		Why not hide the edge during layout? Its endpoints could then drift far apart, leaving a
		long return route when the edge is restored. Reversing it keeps the connection present
		while the layers are chosen.
	</p>

	<h2>The classic greedy heuristic</h2>
	<p>
		Finding an order with the fewest reversals is the <b>minimum feedback arc set</b>
		problem. It is NP-hard. General-purpose layout engines therefore use fast heuristics
		rather than exact optimization.
	</p>
	<p>
		A common default is the greedy heuristic of Eades, Lin and Smyth (1993). It builds the
		line from both ends, removing one node at a time:
	</p>
	<pre>while nodes remain:
  a node with no outgoing edges (a sink)      → put it at the END
  else a node with no incoming edges (a source) → put it NEXT
  else the node with the best out − in balance  → put it NEXT</pre>
	<p>
		The <em>greedy answer</em> button loads its result for the widget: one reversal. The
		heuristic reached it using only incoming and outgoing degree. It did not inspect labels or
		declaration order. That indifference explains some surprising drawings below.
	</p>
	<Term name="Eades, Lin & Smyth (1993)" href="https://doi.org/10.1016/0020-0190(93)90079-O">
		<em>A fast and effective heuristic for the feedback arc set problem</em> — the
		source/sink-peeling greedy above, with the guarantee that it reverses at most m/2 − n/6
		edges.
	</Term>

	<h2>The strategy zoo</h2>
	<p>
		Here is one declaration rendered four ways. It contains a proof–edit–render loop,
		two external inputs, and an autosave loop between <code>save</code> and
		<code>sync</code>:
	</p>
	<pre>{ZOO}</pre>
	<p>
		The drawings reproduce the engine’s output, with layer bands added. Each node’s badge
		shows the value used by that strategy: degree balance, visit order, or declaration order.
		Reversed edges are red.
	</p>
	<svg width="0" height="0" aria-hidden="true">
		<defs>
			<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
				<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
			</marker>
			<marker id="arr-up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
				<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead-up" />
			</marker>
		</defs>
	</svg>
	<div class="row">
		<figure>
			{@render zoosvg(FIG_GREEDY)}
			<figcaption>
				<b>GREEDY</b> (the heuristic above). Badges: out − in balance, the heuristic's
				only input. <code>edit</code> scores +1, looks source-like, and floats to the top,
				above the actual sources. Nothing you wrote suggested that.
			</figcaption>
		</figure>
		<figure>
			{@render zoosvg(FIG_DF)}
			<figcaption>
				<b>DEPTH_FIRST</b>. Badges: visit order. Walk from the sources, reverse the edge
				that closes a loop (here <code>edit → render</code>). The loop unrolls in walk
				order, and the drawing pays for it in height. <code>fonts</code>, the other
				source, is visited dead last.
			</figcaption>
		</figure>
		<figure>
			{@render zoosvg(FIG_GMO)}
			<figcaption>
				<b>GREEDY_MODEL_ORDER</b>. Badges: declaration order. The same greedy, but
				wherever degrees leave the choice open, declaration order decides —
				<code>proof</code> tops the loop because you wrote it first.
			</figcaption>
		</figure>
		<figure>
			{@render zoosvg(FIG_MO)}
			<figcaption>
				<b>MODEL_ORDER</b>. Badges: declaration order. Not really a cycle breaker: it
				reverses <em>every</em> edge that runs backward in declaration order, cycles or
				not. <code>assets → render</code> and <code>fonts → save</code> were never in any
				cycle — reversed anyway, and both sources sink to the bottom. Every red edge here
				points from a higher badge to a lower one.
			</figcaption>
		</figure>
	</div>
	<p>
		<b>Fewest reversals does not imply most readable.</b> The first three strategies use
		nearly the same number of reversals but produce different causal orders. The fourth
		follows declaration order more strictly and accepts extra reversals. Source order is
		information; strategies differ in how much weight they give it.
	</p>

	<h2>Cycles inside subgraphs</h2>
	<p>
		A <b>subgraph</b> is laid out as a unit and drawn inside a titled box. If it contains a
		cycle, cycle breaking determines the order inside that box. A bad order is especially
		obvious when a border presents the nodes as one process:
	</p>
	<Term name="subgraph / cluster">
		A declared group of nodes drawn inside a shared border ("cluster" in graph-drawing
		literature). Layout must keep its members together; everything else about handling them is
		a topic of its own, covered in a later lesson.
	</Term>
	<pre>{SUB}</pre>
	<div class="row">
		<figure>
			<svg viewBox="0 0 300 300" class="figsvg" role="img" aria-label="GREEDY subgraph result">
				<rect x="62" y="66" width="176" height="164" class="cluster" />
				<text x="72" y="82" class="cltitle">Retry loop</text>
				<path d="M 140 42 L 100 70 L 100 192 L 112 192" class="edge" marker-end="url(#arr)" />
				<line x1="157" y1="180" x2="157" y2="127" class="edge up" marker-end="url(#arr-up)" />
				<line x1="143" y1="124" x2="143" y2="177" class="edge" marker-end="url(#arr)" />
				<path d="M 184 118 L 205 130 L 205 259" class="edge" marker-end="url(#arr)" />
				<rect x="118" y="18" width="64" height="24" rx="10" class="pill" />
				<text x="150" y="34">start</text>
				<circle cx="178" cy="16" r="10" class="chip" />
				<text x="178" y="19" class="chiptext">+1</text>
				<rect x="118" y="100" width="64" height="24" rx="10" class="pill" />
				<text x="150" y="116">failed?</text>
				<circle cx="178" cy="98" r="10" class="chip" />
				<text x="178" y="101" class="chiptext">+1</text>
				<rect x="118" y="180" width="64" height="24" rx="10" class="pill" />
				<text x="150" y="196">attempt</text>
				<circle cx="178" cy="178" r="10" class="chip" />
				<text x="178" y="181" class="chiptext">−1</text>
				<rect x="173" y="262" width="64" height="24" rx="10" class="pill" />
				<text x="205" y="278">give up</text>
				<circle cx="233" cy="260" r="10" class="chip" />
				<text x="233" y="263" class="chiptext">−1</text>
			</svg>
			<figcaption>
				<b>GREEDY</b>. Badges: out − in balance. The same arithmetic, now inside the box:
				<code>failed?</code> floats above <code>attempt</code>, and <code>start</code> has
				to sneak in around it.
			</figcaption>
		</figure>
		<figure>
			<svg viewBox="0 0 300 300" class="figsvg" role="img" aria-label="GREEDY_MODEL_ORDER subgraph result">
				<rect x="86" y="66" width="128" height="164" class="cluster" />
				<text x="96" y="82" class="cltitle">Retry loop</text>
				<line x1="150" y1="42" x2="150" y2="97" class="edge" marker-end="url(#arr)" />
				<line x1="157" y1="124" x2="157" y2="177" class="edge" marker-end="url(#arr)" />
				<line x1="143" y1="180" x2="143" y2="127" class="edge up" marker-end="url(#arr-up)" />
				<line x1="150" y1="204" x2="150" y2="259" class="edge" marker-end="url(#arr)" />
				<rect x="118" y="18" width="64" height="24" rx="10" class="pill" />
				<text x="150" y="34">start</text>
				<circle cx="178" cy="16" r="10" class="chip" />
				<text x="178" y="19" class="chiptext">3</text>
				<rect x="118" y="100" width="64" height="24" rx="10" class="pill" />
				<text x="150" y="116">attempt</text>
				<circle cx="178" cy="98" r="10" class="chip" />
				<text x="178" y="101" class="chiptext">1</text>
				<rect x="118" y="180" width="64" height="24" rx="10" class="pill" />
				<text x="150" y="196">failed?</text>
				<circle cx="178" cy="178" r="10" class="chip" />
				<text x="178" y="181" class="chiptext">2</text>
				<rect x="118" y="262" width="64" height="24" rx="10" class="pill" />
				<text x="150" y="278">give up</text>
				<circle cx="178" cy="260" r="10" class="chip" />
				<text x="178" y="263" class="chiptext">4</text>
			</svg>
			<figcaption>
				<b>GREEDY_MODEL_ORDER</b>. Badges: declaration order — note <code>start</code> is
				declared third, after the subgraph. <code>attempt</code> before
				<code>failed?</code>, as declared — and the whole diagram falls into one straight
				column.
			</figcaption>
		</figure>
	</div>
	<More id="boundary-greedy" summary="Could the greedy do better inside a box?">
		<p>
			Look at the GREEDY badges again. <code>attempt</code> scores −1 <em>because</em> of the
			edge from <code>start</code> — the edge that marks it as the cluster's entrance is the
			very thing that sinks it. Flip the convention: inside a box, count an incoming edge
			from outside as +1 (an entrance should look like a local source) and an outgoing edge
			to outside as −1 (an exit should look like a local sink). Now <code>attempt</code>
			scores +1, <code>failed?</code> drops to −1, and the box orders itself correctly —
			degrees only, no declaration order consulted.
		</p>
		<p>
			Engines that lay out each cluster separately get this for free: every edge crossing the
			border is cut at the wall and replaced by a <em>port</em> — a stub pinned to the top
			border for traffic from above, the bottom for traffic below. Inside the box the port
			is a genuine local source (or sink), and the plain greedy sees exactly the biased
			degrees described above. Same fixed point, implemented as geometry instead of a score.
		</p>
		<p>
			The catch: "incoming from outside" assumes the flow enters from above. An edge feeding
			back into the box from below would crown the wrong node — and at cycle-breaking time
			nothing is above or below anything yet. It stays a heuristic; entries from the main
			flow just outnumber entries from feedback edges by a wide margin.
		</p>
	</More>

	<h2>Playground</h2>
	<p>
		The zoo graph below is editable and rendered live. Compare the four strategies. Then move
		<code>S[assets] --&gt; B</code> to the top and watch
		<code>GREEDY_MODEL_ORDER</code>. Finally, delete <code>V --&gt; W</code> to remove the
		save–sync cycle and compare again.
	</p>
	<div class="play">
		<div class="controls">
			<textarea bind:value={playSrc} rows="10" spellcheck="false" aria-label="Mermaid source"
			></textarea>
			<label>
				<span class="dim">strategy</span>
				<select bind:value={playCb}>
					<option>GREEDY</option>
					<option>DEPTH_FIRST</option>
					<option>GREEDY_MODEL_ORDER</option>
					<option>MODEL_ORDER</option>
				</select>
			</label>
		</div>
		<div class="fig play-fig">
			<DiagramViewer src={playSrc} elkExtra={cb(playCb)} />
		</div>
	</div>

	<BuildContract
		phase="Cycle breaking"
		receives="The directed graph, declaration order, edge priorities, and cluster ownership."
		produces="An acyclic working orientation plus the exact set of temporarily reversed edges."
		guarantees="The working graph has no directed cycle; every declared edge remains available to restore when we draw."
		baseline="Run depth-first search; mark every edge to an active ancestor as reversed, then retain that set through drawing."
		pushback="A completed candidate reverses an important edge, produces excessive layer span, or turns a cluster’s causal order upside down."
	/>

	<h2>Takeaways</h2>
	<ul>
		<li>A cycle forces at least one edge to render against the flow; layout reverses it temporarily, never deletes.</li>
		<li>Cycle breaking is choosing a linear order; backward edges in that order are the reversals.</li>
		<li>Minimizing reversals is NP-hard; the greedy default gets close by looking at degrees alone.</li>
		<li>Near-minimal still leaves huge freedom: same graph, four strategies, four drawings. Declaration order is information; some strategies read it.</li>
		<li>Strategy is a per-diagram setting — worth reaching for when a loop renders upside down.</li>
	</ul>
	<p class="dim">
		Next: <a href={resolve('/learn/layering')}>layering</a> — what "pointing forward" turns into,
		and why long edges quietly cost width.
	</p>
</div>

<style>
	.aside {
		color: var(--dim);
		border-left: 3px solid var(--muted);
		padding-left: 0.8rem;
	}
	pre {
		font-size: 0.92em;
		background: var(--custom-bg);
		border-radius: 3px;
		padding: 0.7rem 0.9rem;
		overflow-x: auto;
		line-height: 1.5;
	}

	.fig {
		height: 24rem;
		border: 1px solid var(--muted);
		border-radius: 6px;
		overflow: hidden;
		margin: 1rem 0;
	}
	.figsvg {
		max-width: 22rem;
	}
	.figsvg text {
		font-size: 12px;
	}
	.chip {
		fill: var(--custom-bg);
		stroke: var(--purple);
	}
	.chiptext {
		fill: var(--purple);
		font-size: 10px;
	}
	.arcs {
		user-select: none;
		width: 100%;
		max-width: 40rem;
		display: block;
		margin: 0 auto;
		touch-action: none;
	}
	.arcs path {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.6;
	}
	.arcs path.back {
		stroke: var(--err);
		stroke-width: 2.2;
	}
	.arcs circle {
		fill: var(--custom-bg);
		stroke: var(--fg);
	}
	.arcs text {
		fill: var(--fg);
		text-anchor: middle;
		font-size: 15px;
		user-select: none;
	}
	.grab.lift circle {
		stroke: var(--accent);
		stroke-width: 2;
	}
	.grab:focus circle {
		stroke: var(--accent);
		stroke-width: 2;
	}
	.play-fig {
		height: 30rem;
	}
</style>
