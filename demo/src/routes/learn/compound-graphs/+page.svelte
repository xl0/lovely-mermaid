<script lang="ts">
	import { resolve } from '$app/paths';
	import BuildContract from '$lib/learn/BuildContract.svelte';
	import DiagramViewer from '$lib/DiagramViewer.svelte';
	import More from '$lib/learn/More.svelte';
	import Term from '$lib/learn/Term.svelte';

	// ---- block-order experiment -------------------------------------------
	const IDS = ['A1', 'B1', 'free', 'A2', 'B2'];
	const TOP_LABELS: Record<string, string> = { A1: 'a', B1: 'b', free: 'x', A2: 'c', B2: 'd' };
	const SLOT_X = [70, 170, 270, 370, 470];
	let order = $state([...IDS]);
	let dragId = $state<string | null>(null);
	let arena: SVGSVGElement | undefined = $state();

	const groupOf = (id: string): 'A' | 'B' | null =>
		id.startsWith('A') ? 'A' : id.startsWith('B') ? 'B' : null;
	const xOf = (id: string): number => SLOT_X[order.indexOf(id)];
	const frameOf = (group: 'A' | 'B') => {
		const xs = order.filter((id) => groupOf(id) === group).map(xOf);
		return { lo: Math.min(...xs) - 38, hi: Math.max(...xs) + 38 };
	};
	const frameA = $derived(frameOf('A'));
	const frameB = $derived(frameOf('B'));
	const badFrame = (group: 'A' | 'B'): boolean => {
		const positions = order
			.map((id, i) => ({ id, i }))
			.filter(({ id }) => groupOf(id) === group)
			.map(({ i }) => i);
		return order.slice(Math.min(...positions), Math.max(...positions) + 1).some((id) => groupOf(id) !== group);
	};
	const invalidFrames = $derived(Number(badFrame('A')) + Number(badFrame('B')));
	const frameWidth = $derived(frameA.hi - frameA.lo + frameB.hi - frameB.lo);
	const nCross = $derived.by(() => {
		const sourceIndex = new Map(IDS.map((id, i) => [id, i]));
		const p = order.map((id) => sourceIndex.get(id) as number);
		let n = 0;
		for (let i = 0; i < p.length; i++)
			for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) n++;
		return n;
	});

	function move(id: string, to: number): void {
		const from = order.indexOf(id);
		if (from === to || to < 0 || to >= order.length) return;
		const next = [...order];
		next.splice(from, 1);
		next.splice(to, 0, id);
		order = next;
	}

	function pointerMove(e: PointerEvent): void {
		if (dragId === null || arena === undefined) return;
		const box = arena.getBoundingClientRect();
		const x = ((e.clientX - box.left) / box.width) * 540;
		let nearest = 0;
		for (let i = 1; i < SLOT_X.length; i++)
			if (Math.abs(SLOT_X[i] - x) < Math.abs(SLOT_X[nearest] - x)) nearest = i;
		move(dragId, nearest);
	}

	// ---- live engine examples ---------------------------------------------
	const COMPACT = `flowchart TD
  subgraph S[service]
    parse --> validate
    validate --> store
  end`;
	const BUNDLE = `flowchart TD
  subgraph S[service]
    parse --> validate
    validate --> store
  end
  request --> parse
  audit --> validate
  retry --> store
  parse --> log
  validate --> metrics
  store --> done`;
	const NESTED = `flowchart TD
  subgraph S[service]
    subgraph C[core]
      parse --> validate
      validate --> store
    end
  end
  request --> parse
  store --> done`;
	let playSrc = $state(NESTED);
</script>

<svelte:head>
	<title>Compound graphs — lovely-mermaid learn</title>
</svelte:head>

<div class="lesson">
	<p class="dim"><a href={resolve('/learn')}>learn</a> / compound graphs</p>
	<h1>Compound graphs: boxes that constrain the graph</h1>
	<p class="lede">
		A subgraph is not a rectangle painted after layout. Its members must remain inside one
		contiguous frame, outsiders must remain outside, and edges must still reach their real
		endpoints across the border. The frame encloses the full measured rectangles, not only their
		centres. Those rules reach backward through every phase we have covered.
	</p>
	<Term name="compound graph / cluster">
		A graph whose nodes may contain other nodes. Mermaid calls a container a
		<code>subgraph</code>; graph-drawing papers usually call it a <em>cluster</em>. Containers may
		nest.
	</Term>

	<h2>Experiment: keep each cluster together</h2>
	<p>
		The upper layer is fixed. Drag the lower nodes sideways. Dashed frames are the smallest boxes
		that could contain each cluster’s members. A red frame also encloses a foreign node, so it is
		not a legal cluster. Find a legal order. The price is crossings: the unconstrained order has
		none, while the best legal order has three.
	</p>
	<svg
		bind:this={arena}
		viewBox="0 0 540 230"
		class="arena compound-arena"
		role="img"
		aria-label="Reorder nodes to keep cluster members contiguous"
		onpointermove={pointerMove}
		onpointerup={() => (dragId = null)}
		onpointercancel={() => (dragId = null)}
	>
		<defs>
			<marker id="compound-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
				<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
			</marker>
		</defs>
		<rect x="20" y="12" width="500" height="48" class="band" />
		<rect x="20" y="122" width="500" height="96" class="band" />
		<text x="25" y="27" class="bandlabel">fixed layer</text>

		<rect
			x={frameA.lo}
			y="132"
			width={frameA.hi - frameA.lo}
			height="76"
			rx="5"
			class="member-frame frame-a"
			class:invalid={badFrame('A')}
		/>
		<text x={frameA.lo + 7} y="147" class="frame-title">cluster A</text>
		<rect
			x={frameB.lo}
			y="132"
			width={frameB.hi - frameB.lo}
			height="76"
			rx="5"
			class="member-frame frame-b"
			class:invalid={badFrame('B')}
		/>
		<text x={frameB.lo + 7} y="162" class="frame-title">cluster B</text>

		{#each IDS as id, i}
			<path d="M {SLOT_X[i]} 48 L {xOf(id)} 169" class="edge" marker-end="url(#compound-arr)" />
			<rect x={SLOT_X[i] - 22} y="25" width="44" height="24" rx="10" class="pill" />
			<text x={SLOT_X[i]} y="41">{TOP_LABELS[id]}</text>
		{/each}
		{#each order as id}
			<g
				class="grab member"
				class:lift={dragId === id}
				role="slider"
				tabindex="0"
				aria-label={`Position of ${id}`}
				aria-valuemin="1"
				aria-valuemax="5"
				aria-valuenow={order.indexOf(id) + 1}
				onpointerdown={(e) => {
					dragId = id;
					e.currentTarget.setPointerCapture(e.pointerId);
				}}
				onkeydown={(e) => {
					if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
						e.preventDefault();
						move(id, order.indexOf(id) + (e.key === 'ArrowLeft' ? -1 : 1));
					}
				}}
			>
				<rect
					x={xOf(id) - 27}
					y="166"
					width="54"
					height="28"
					rx="11"
					class="pill"
					class:node-a={groupOf(id) === 'A'}
					class:node-b={groupOf(id) === 'B'}
				/>
				<text x={xOf(id)} y="184">{id}</text>
			</g>
		{/each}
	</svg>
	<div class="statbar">
		<span>crossings: <b class:good={invalidFrames === 0 && nCross === 3}>{nCross}</b></span>
		<span>invalid frames: <b class:good={invalidFrames === 0}>{invalidFrames}</b></span>
		<span>combined frame width: <b>{frameWidth}</b></span>
	</div>
	<div class="statbar">
		<button class="ghost" onclick={() => (order = [...IDS])}>unconstrained order</button>
		<button class="ghost" onclick={() => (order = ['A1', 'A2', 'free', 'B1', 'B2'])}>legal order</button>
	</div>
	<p>
		A normal crossing sweep prefers the first order because every edge stays straight. A
		cluster-aware sweep must move members as blocks. Here it accepts three crossings, keeps the
		unclustered node outside both frames, and cuts the combined frame width by more than half.
		Containment is a constraint, not another score to optimize when convenient.
	</p>
	<p>
		The widget uses equal-size pills to isolate that ordering constraint. A real frame starts at
		the leftmost child edge and ends at the rightmost child edge, then adds its title and padding.
		A wide label can therefore enlarge a cluster even when no child centre moves; a wrapped,
		taller node can enlarge it on the flow axis.
	</p>

	<h2>Two ways to lay out nested boxes</h2>
	<p>
		A recursive engine lays out the contents of each cluster first, then collapses that finished
		frame into one large node for the parent layout. This is simple and composable. The parent,
		however, no longer knows where an inner node sits. During that parent pass, a cross-boundary
		edge can target only the collapsed frame; reaching the child needs a later routing pass.
	</p>
	<div class="row method-row">
		<figure>
			<svg viewBox="0 0 320 270" class="figsvg" role="img" aria-label="Recursive cluster layout stops a cross-boundary edge at the frame">
				<defs>
					<marker id="recursive-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
						<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead-up" />
					</marker>
				</defs>
				<rect x="102" y="18" width="116" height="30" rx="12" class="pill" />
				<text x="160" y="38">request</text>
				<rect x="55" y="86" width="210" height="160" rx="4" class="cluster" />
				<text x="65" y="103" class="cltitle">service</text>
				<rect x="112" y="120" width="96" height="28" rx="11" class="pill" />
				<text x="160" y="139">parse</text>
				<rect x="112" y="192" width="96" height="28" rx="11" class="pill" />
				<text x="160" y="211">store</text>
				<path d="M 160 148 V 192" class="edge" marker-end="url(#recursive-arr)" />
				<path d="M 160 48 V 81" class="edge stop" marker-end="url(#recursive-arr)" />
				<text x="180" y="73" class="note">target hidden</text>
			</svg>
			<figcaption><b>Recursive.</b> Parent sees one opaque service box. The request route stops at its border.</figcaption>
		</figure>
		<figure>
			<svg viewBox="0 0 320 270" class="figsvg" role="img" aria-label="Global cluster layout pierces the frame and reaches the inner node">
				<defs>
					<marker id="global-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
						<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
					</marker>
				</defs>
				<rect x="102" y="18" width="116" height="30" rx="12" class="pill" />
				<text x="160" y="38">request</text>
				<rect x="55" y="86" width="210" height="160" rx="4" class="cluster" />
				<text x="65" y="103" class="cltitle">service</text>
				<rect x="85" y="120" width="86" height="28" rx="11" class="pill" />
				<text x="128" y="139">parse</text>
				<rect x="149" y="192" width="86" height="28" rx="11" class="pill" />
				<text x="192" y="211">store</text>
				<path d="M 128 148 V 168 H 192 V 192" class="edge" marker-end="url(#global-arr)" />
				<path d="M 160 48 V 112 H 192 V 192" class="edge cross-boundary" marker-end="url(#global-arr)" />
				<circle cx="160" cy="86" r="4" class="pierce" />
			</svg>
			<figcaption><b>One global run.</b> The request route pierces the frame and reaches store itself.</figcaption>
		</figure>
	</div>
	<p>
		ELK can instead include every descendant in one cluster-aware layout run. Layering keeps each
		cluster in a contiguous band. Crossing minimization preserves member blocks. Placement reserves
		borders and padding. Routing then knows both the outer source and the inner target.
	</p>
	<Term name="ELK hierarchy handling" href="https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html">
		<code>INCLUDE_CHILDREN</code> asks one algorithm invocation to process a node and all of its
		descendants. <code>SEPARATE_CHILDREN</code> lays hierarchy levels out separately.
	</Term>

	<h2>One logical edge becomes several route sections</h2>
	<p>
		An edge crossing nested boundaries lives in several coordinate systems. ELK returns one route
		section for each hierarchy level it traverses. The sections meet at border crossings; joining
		them produces one continuous edge with an arrowhead only at the real target.
	</p>
	<figure class="wide-figure">
		<svg viewBox="0 0 600 280" class="figsvg hierarchy-fig" role="img" aria-label="One edge split into route sections as it crosses nested cluster borders">
			<defs>
				<marker id="section-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
				</marker>
			</defs>
			<rect x="24" y="118" width="92" height="30" rx="12" class="pill" />
			<text x="70" y="138">request</text>
			<rect x="170" y="28" width="390" height="220" rx="5" class="cluster" />
			<text x="182" y="48" class="cltitle">service</text>
			<rect x="315" y="70" width="205" height="140" rx="5" class="cluster inner" />
			<text x="327" y="90" class="cltitle">core</text>
			<rect x="392" y="119" width="94" height="30" rx="12" class="pill" />
			<text x="439" y="139">validate</text>
			<path d="M 116 133 H 170" class="section section-root" />
			<path d="M 170 133 H 315" class="section section-service" />
			<path d="M 315 133 H 392" class="section section-core" marker-end="url(#section-arr)" />
			<circle cx="170" cy="133" r="5" class="pierce" />
			<circle cx="315" cy="133" r="5" class="pierce" />
			<text x="143" y="120" class="section-label">root</text>
			<text x="242" y="120" class="section-label">service</text>
			<text x="353" y="120" class="section-label">core</text>
		</svg>
		<figcaption>Three returned sections, one visible edge. Dots mark hierarchy crossings, not extra graph nodes.</figcaption>
	</figure>
	<p>
		The border is therefore part of the routing geometry. In SVG a renderer clips or joins the
		segments at the crossing. On a character grid we merge the edge’s direction bits with the
		frame’s direction bits, producing a junction glyph rather than painting one line over another.
		That grid-specific step is the next lesson.
	</p>
	<p>
		The two dots are hierarchy crossings, not endpoint ports. The edge’s real target port is on
		<code>validate</code>. A hierarchy crossing only connects route sections while the edge passes
		through a container border; it is not a source or target that the graph author connected.
	</p>
	<More id="compound-recursive" summary="When is recursive layout the better answer?">
		<p>
			When clusters have no cross-boundary edges, recursive layout is often the cleaner abstraction.
			Each cluster can choose its own direction and algorithm, its result can be cached, and the
			parent only packs rectangles. A global run pays for information it does not need in that case.
		</p>
		<p>
			The reason to pay for <code>INCLUDE_CHILDREN</code> is not nesting by itself. It is an edge
			whose real endpoint lies on the other side of a hierarchy boundary.
		</p>
	</More>

	<h2>Cross-boundary edges inflate clusters</h2>
	<p>
		A compact cluster first needs room for the measured width and height of every member, their
		internal edges, a title, and padding. Add several edges across its boundary and the global
		pipeline must also align outside layers, keep boundary crossings apart, and route inside the
		frame to each endpoint. Empty-looking space is often reserved geometry, not forgotten
		compaction.
	</p>
	<div class="row engine-row">
		<figure>
			<div class="engine-fig"><DiagramViewer src={COMPACT} /></div>
			<figcaption><b>Internal chain only.</b> The service frame hugs three nodes.</figcaption>
		</figure>
		<figure>
			<div class="engine-fig"><DiagramViewer src={BUNDLE} /></div>
			<figcaption><b>Six boundary edges.</b> Same internal chain; ports and routes widen the live ELK result.</figcaption>
		</figure>
	</div>
	<p>
		Direction becomes global too. A recursive engine may lay one child left-to-right inside a
		top-to-bottom parent. A single cluster-aware run cannot independently rotate part of the same
		layer system; cross-boundary edges would have to reconcile two meanings of “forward.”
	</p>
	<More id="compound-inflation" summary="Why can one innocent edge create so much empty space?">
		<p>
			A hierarchy edge couples decisions that were formerly local. Its source participates in the
			parent’s layers, its target participates in the child’s layers, and its route needs a legal
			crossing on every border between them. Moving either endpoint can shift a whole layer or widen
			the frame because every sibling must still remain outside.
		</p>
		<p>
			This is also why “shrink the rectangle afterward” is unsafe. The empty strip may contain a route
			section, a boundary crossing, or the separation needed to keep a sibling cluster disjoint.
		</p>
	</More>

	<h2>Playground</h2>
	<p>
		These presets use the real terminal renderer with ELK’s global hierarchy handling. Start with
		the nested case, then add another edge from <code>request</code> to <code>store</code>. Watch the
		edge cross two borders and the frames make room. Move a node declaration outside its
		<code>subgraph</code> block to change containment rather than merely changing order.
	</p>
	<div class="statbar presetbar">
		<button class="ghost" onclick={() => (playSrc = COMPACT)}>compact</button>
		<button class="ghost" onclick={() => (playSrc = BUNDLE)}>boundary bundle</button>
		<button class="ghost" onclick={() => (playSrc = NESTED)}>nested</button>
	</div>
	<div class="play">
		<div class="controls">
			<textarea bind:value={playSrc} rows="14" spellcheck="false" aria-label="Mermaid source"></textarea>
		</div>
		<div class="play-fig engine-fig"><DiagramViewer src={playSrc} /></div>
	</div>

	<BuildContract
		phase="Compound layout"
		receives="The containment tree, measured children, cross-boundary edges, titles, and frame padding."
		produces="Nested frames, hierarchy-aware phase constraints, and connected route sections in each coordinate system."
		guarantees="Children stay inside their ancestors, siblings remain disjoint, and every border crossing joins the same logical edge."
		baseline="Lay out groups recursively, wrap each child result in a padded frame, and split cross-boundary routes at every frame they pierce."
		pushback="Frames inflate around empty routing space, boundary edges dominate the order, or recursive and global layouts disagree badly."
	/>

	<h2>Takeaways</h2>
	<ul>
		<li>Containment is a hard geometric constraint: members stay contiguous and outsiders stay outside.</li>
		<li>Frames bound complete child rectangles plus title and padding, so long or wrapped labels can inflate their ancestors.</li>
		<li>Recursive layout composes cleanly, but hides inner endpoints from the parent router.</li>
		<li><code>INCLUDE_CHILDREN</code> keeps all hierarchy levels in one cluster-aware pipeline.</li>
		<li>A cross-boundary edge becomes connected route sections that meet where borders are pierced.</li>
		<li>Boundary crossings, layer alignment, and route tracks can inflate a cluster with apparently empty space.</li>
	</ul>
	<p class="dim">
		Next: <a href={resolve('/learn/terminal-grid')}>the terminal grid</a> — turning floating-point
		boxes and routes into cells without breaking alignment or junctions.
	</p>
</div>

<style>
	.compound-arena {
		max-width: 38rem;
	}
	.member-frame {
		fill: color-mix(in srgb, var(--purple) 8%, transparent);
		stroke: var(--purple);
		stroke-dasharray: 5 4;
	}
	.member-frame.frame-b {
		fill: color-mix(in srgb, var(--accent) 8%, transparent);
		stroke: var(--accent);
	}
	.member-frame.invalid {
		stroke: var(--err);
		stroke-width: 2;
	}
	.compound-arena .frame-title {
		fill: var(--dim);
		font-size: 10px;
		text-anchor: start;
	}
	.node-a {
		fill: color-mix(in srgb, var(--purple) 18%, var(--custom-bg));
	}
	.node-b {
		fill: color-mix(in srgb, var(--accent) 18%, var(--custom-bg));
	}
	.member {
		cursor: grab;
	}
	.method-row {
		margin-top: 1rem;
	}
	.method-row .figsvg {
		max-width: 20rem;
	}
	.note,
	.section-label {
		fill: var(--dim);
		font-size: 10px;
	}
	.stop {
		stroke: var(--err);
	}
	.pierce {
		fill: var(--bg);
		stroke: var(--accent);
		stroke-width: 2;
	}
	.cross-boundary {
		stroke-width: 2;
	}
	.wide-figure {
		margin: 1rem 0;
	}
	.hierarchy-fig {
		max-width: 40rem;
	}
	.cluster.inner {
		fill: color-mix(in srgb, var(--purple) 12%, transparent);
	}
	.section {
		fill: none;
		stroke-width: 3;
	}
	.section-root {
		stroke: var(--cmd);
	}
	.section-service {
		stroke: var(--accent);
	}
	.section-core {
		stroke: var(--purple);
	}
	.engine-row {
		margin-top: 1rem;
	}
	.engine-fig {
		height: 28rem;
		border: 1px solid var(--muted);
		border-radius: 6px;
		overflow: hidden;
	}
	.presetbar {
		margin-bottom: 0.8rem;
	}
	.play-fig {
		height: 32rem;
	}
</style>
