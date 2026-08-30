<script lang="ts">
	import { resolve } from '$app/paths';
	import * as d3 from 'd3-force';
	import More from '$lib/learn/More.svelte';
	import Term from '$lib/learn/Term.svelte';

	// One small service-dependency graph, drawn several ways. Hand-placed
	// coordinates — these figures illustrate layout *styles*, they are not
	// produced by the algorithms they depict.
	type P = { n: string; x: number; y: number };
	const EDGES: [string, string][] = [
		['ui', 'api'],
		['api', 'auth'],
		['api', 'cache'],
		['api', 'jobs'],
		['api', 'db'],
		['auth', 'db'],
		['jobs', 'db'],
		['jobs', 'mail']
	];
	// Nodes on a circle, in alphabetical order — placement that ignores the
	// edges entirely.
	const CIRC: P[] = [
		{ n: 'ui', x: 150, y: 30 },
		{ n: 'api', x: 228, y: 68 },
		{ n: 'auth', x: 247, y: 152 },
		{ n: 'db', x: 193, y: 220 },
		{ n: 'cache', x: 107, y: 220 },
		{ n: 'jobs', x: 53, y: 152 },
		{ n: 'mail', x: 72, y: 68 }
	];
	// A force-directed-style equilibrium: connected nodes near each other,
	// no direction discipline.
	const FORCE: P[] = [
		{ n: 'ui', x: 96, y: 36 },
		{ n: 'api', x: 150, y: 105 },
		{ n: 'auth', x: 238, y: 84 },
		{ n: 'cache', x: 62, y: 150 },
		{ n: 'jobs', x: 168, y: 190 },
		{ n: 'db', x: 250, y: 172 },
		{ n: 'mail', x: 84, y: 232 }
	];
	// The layered drawing: layers as rows, every edge pointing down.
	const LAYER: P[] = [
		{ n: 'ui', x: 150, y: 30 },
		{ n: 'api', x: 150, y: 95 },
		{ n: 'auth', x: 82, y: 160 },
		{ n: 'cache', x: 218, y: 160 },
		{ n: 'jobs', x: 150, y: 160 },
		{ n: 'db', x: 116, y: 225 },
		{ n: 'mail', x: 184, y: 225 }
	];
	const BANDS = [
		{ y: 12, label: 'layer 0' },
		{ y: 77, label: 'layer 1' },
		{ y: 142, label: 'layer 2' },
		{ y: 207, label: 'layer 3' }
	];
	const at = (ps: P[], n: string): P => ps.find((p) => p.n === n) as P;
	// Shorten each edge line so the arrowhead stops at the node pill.
	const line = (ps: P[], [u, v]: [string, string]) => {
		const a = at(ps, u);
		const b = at(ps, v);
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy) || 1;
		const rA = 20 / len;
		const rB = 24 / len;
		return {
			x1: a.x + dx * rA,
			y1: a.y + dy * rA,
			x2: b.x - dx * rB,
			y2: b.y - dy * rB
		};
	};

	// ---- embedding example: pentagon 1-2-3-4-5 with chords 1-3 and 2-4 ----
	// Two embeddings of the same graph: E1 draws 1-3 inside and routes 2-4
	// around the outside; E2 swaps them. Rotation tables verified against
	// the drawn geometry.
	const EMB_E: [number, number][] = [
		[1, 2],
		[2, 3],
		[3, 4],
		[4, 5],
		[5, 1],
		[1, 3],
		[2, 4]
	];
	const EMB_P: Record<number, [number, number]> = {
		1: [150, 30],
		2: [250, 100],
		3: [220, 210],
		4: [80, 210],
		5: [50, 100]
	};

	// The pipeline strip: pill-SVG like the other schematics (the full viewer
	// would be overkill for a five-box chain).
	const PHASES = (() => {
		const labels = [
			'cycle breaking',
			'layering',
			'crossing minimization',
			'node placement',
			'edge routing'
		];
		let x = 0;
		return labels.map((label) => {
			const w = label.length * 7.2 + 22;
			const p = { label, x, w };
			x += w + 30;
			return p;
		});
	})();
	const PHASES_W = PHASES[PHASES.length - 1].x + PHASES[PHASES.length - 1].w;

	// ---- live family examples: real elkjs output, minimal SVG --------------
	// Each family figure runs the actual algorithm in the browser (elkjs
	// bundles them all) and draws positions + straight/routed edges.
	interface FigNode {
		id: string;
		x: number;
		y: number;
		w: number;
		h: number;
	}
	interface Fig {
		w: number;
		h: number;
		nodes: FigNode[];
		edges: { x1: number; y1: number; x2: number; y2: number }[];
		routes: { d: string }[];
	}
	const NODE_W = 52;
	const NODE_H = 24;
	const SERVICE = ['ui', 'api', 'auth', 'cache', 'jobs', 'db', 'mail'];
	const TREE_E: [string, string][] = [
		['app', 'ui'],
		['app', 'core'],
		['app', 'infra'],
		['ui', 'views'],
		['ui', 'state'],
		['core', 'model'],
		['core', 'rules'],
		['infra', 'db'],
		['infra', 'queue']
	];
	const TREE = ['app', 'ui', 'core', 'infra', 'views', 'state', 'model', 'rules', 'db', 'queue'];
	// Rectpacking has no edges: disconnected boxes of assorted sizes.
	const BOXES = [56, 90, 40, 70, 48, 110, 62, 44].map((w, i) => ({
		id: `b${i}`,
		w,
		h: 24 + (i % 3) * 14
	}));

	async function lay(
		opts: Record<string, string>,
		nodes: { id: string; w: number; h: number }[],
		edges: [string, string][]
	): Promise<Fig> {
		const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
		const elk = new ELK();
		const laid = (await elk.layout({
			id: 'root',
			layoutOptions: opts,
			children: nodes.map((n) => ({ id: n.id, width: n.w, height: n.h })),
			edges: edges.map(([u, v], i) => ({ id: `e${i}`, sources: [u], targets: [v] }))
		})) as {
			width?: number;
			height?: number;
			children?: { id: string; x?: number; y?: number; width?: number; height?: number }[];
			edges?: {
				sources: string[];
				targets: string[];
				sections?: {
					startPoint: { x: number; y: number };
					bendPoints?: { x: number; y: number }[];
					endPoint: { x: number; y: number };
				}[];
			}[];
		};
		const ns: FigNode[] = (laid.children ?? []).map((c) => ({
			id: c.id,
			x: (c.x ?? 0) + (c.width ?? 0) / 2,
			y: (c.y ?? 0) + (c.height ?? 0) / 2,
			w: c.width ?? NODE_W,
			h: c.height ?? NODE_H
		}));
		const byId = new Map(ns.map((n) => [n.id, n]));
		const straight: Fig['edges'] = [];
		const routes: Fig['routes'] = [];
		for (const e of laid.edges ?? []) {
			const sec = e.sections?.[0];
			if (sec) {
				const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint];
				routes.push({ d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') });
				continue;
			}
			// No routing from this algorithm: a straight line, clipped at the
			// node pills so the arrowhead survives.
			const a = byId.get(e.sources[0]);
			const b = byId.get(e.targets[0]);
			if (!a || !b) continue;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const len = Math.hypot(dx, dy) || 1;
			straight.push({
				x1: a.x + (dx / len) * 20,
				y1: a.y + (dy / len) * 20,
				x2: b.x - (dx / len) * 26,
				y2: b.y - (dy / len) * 26
			});
		}
		return { w: laid.width ?? 100, h: laid.height ?? 100, nodes: ns, edges: straight, routes };
	}

	const svcNodes = SERVICE.map((id) => ({ id, w: NODE_W, h: NODE_H }));
	const treeNodes = TREE.map((id) => ({ id, w: NODE_W, h: NODE_H }));
	interface Job {
		name: string;
		opts: Record<string, string>;
		nodes: typeof svcNodes;
		edges: [string, string][];
		// Iterative algorithms start from a seeded random state, so re-running
		// with a new seed gives a genuinely different equilibrium. The
		// constructive ones (tree, radial, packing, layered) are deterministic
		// — re-running would be a no-op, so they get no button.
		seeded?: boolean;
	}
	const JOBS: Job[] = [
		{
			name: 'stress',
			opts: { 'elk.algorithm': 'stress', 'elk.stress.desiredEdgeLength': '85' },
			nodes: svcNodes,
			edges: EDGES,
			seeded: true
		},
		{
			name: 'mrtree',
			opts: { 'elk.algorithm': 'mrtree', 'elk.spacing.nodeNode': '16' },
			nodes: treeNodes,
			edges: TREE_E
		},
		{
			name: 'radial',
			opts: { 'elk.algorithm': 'radial', 'elk.spacing.nodeNode': '18' },
			nodes: treeNodes,
			edges: TREE_E
		},
		{
			name: 'rectpacking',
			opts: { 'elk.algorithm': 'rectpacking', 'elk.aspectRatio': '1.6', 'elk.spacing.nodeNode': '10' },
			nodes: BOXES,
			edges: []
		},
		{
			name: 'layered',
			opts: {
				'elk.algorithm': 'layered',
				'elk.direction': 'DOWN',
				'elk.edgeRouting': 'ORTHOGONAL',
				'elk.layered.spacing.nodeNodeBetweenLayers': '28',
				'elk.spacing.nodeNode': '18'
			},
			nodes: svcNodes,
			edges: EDGES
		}
	];
	let figs = $state<Record<string, Fig>>({});
	const seeds: Record<string, number> = {};
	function runJob(job: Job): void {
		seeds[job.name] = (seeds[job.name] ?? 0) + 1;
		lay({ ...job.opts, 'elk.randomSeed': String(seeds[job.name]) }, job.nodes, job.edges).then(
			(f) => {
				figs[job.name] = f;
			}
		);
	}
	const jobOf = (name: string): Job => JOBS.find((j) => j.name === name) as Job;
	$effect(() => {
		for (const job of JOBS) runJob(job);
	});

	// ---- the force figure is a LIVE simulation (d3-force), not a result ----
	// d3-force exposes the iteration itself: every tick nudges nodes along
	// spring + repulsion forces while the temperature (alpha) cools. We rerun
	// from fresh random positions so you can watch it settle — and settle
	// somewhere else next time.
	interface SimNode extends d3.SimulationNodeDatum {
		id: string;
	}
	const SIM_W = 460;
	const SIM_H = 320;
	let simNodes = $state<{ n: string; x: number; y: number }[]>([]);
	let simAlpha = $state(0);
	let sim: d3.Simulation<SimNode, undefined> | null = null;
	function startForce(): void {
		sim?.stop();
		const nodes: SimNode[] = SERVICE.map((id) => ({
			id,
			x: SIM_W / 2 + (Math.random() - 0.5) * 60,
			y: SIM_H / 2 + (Math.random() - 0.5) * 60
		}));
		const links = EDGES.map(([source, target]) => ({ source, target }));
		sim = d3
			.forceSimulation(nodes)
			.force('spring', d3.forceLink<SimNode, { source: string; target: string }>(links).id((n) => n.id).distance(80))
			.force('repulsion', d3.forceManyBody().strength(-350))
			.force('center', d3.forceCenter(SIM_W / 2, SIM_H / 2))
			.force('collide', d3.forceCollide(32))
			.on('tick', () => {
				simNodes = nodes.map((n) => ({ n: n.id, x: n.x ?? 0, y: n.y ?? 0 }));
				simAlpha = sim?.alpha() ?? 0;
			});
	}
	// ---- directed force: the same simulation plus per-EDGE gravity --------
	// Each directed edge wants its target below its source by a gap; edges
	// in violation get pushed apart along y (DiG-CoLa's hierarchy energy,
	// Sugiyama-Misue's magnetic field, as a d3 custom force). One deliberate
	// cycle edge (db -> ui) can never comply — it ends up pointing upward,
	// carrying the strain the others shed.
	const DIR_EDGES: [string, string][] = [...EDGES, ['db', 'ui']];
	let dirNodes = $state<{ n: string; x: number; y: number }[]>([]);
	let dirAlpha = $state(0);
	let sim2: d3.Simulation<SimNode, undefined> | null = null;
	function startDirected(): void {
		sim2?.stop();
		const nodes: SimNode[] = SERVICE.map((id) => ({
			id,
			x: SIM_W / 2 + (Math.random() - 0.5) * 60,
			y: SIM_H / 2 + (Math.random() - 0.5) * 60
		}));
		const links = DIR_EDGES.map(([source, target]) => ({ source, target }));
		sim2 = d3
			.forceSimulation(nodes)
			.force(
				'spring',
				d3
					.forceLink<SimNode, { source: string; target: string }>(links)
					.id((n) => n.id)
					.distance(70)
			)
			.force('repulsion', d3.forceManyBody().strength(-300))
			.force('center', d3.forceCenter(SIM_W / 2, SIM_H / 2))
			.force('collide', d3.forceCollide(30))
			.force('down', (alpha: number) => {
				// After forceLink initializes, each link's source/target are the
				// node objects themselves.
				for (const l of links as unknown as { source: SimNode; target: SimNode }[]) {
					const strain = (l.source.y ?? 0) + 55 - (l.target.y ?? 0);
					if (strain > 0) {
						const f = strain * 0.06 * alpha;
						l.source.vy = (l.source.vy ?? 0) - f;
						l.target.vy = (l.target.vy ?? 0) + f;
					}
				}
			})
			.on('tick', () => {
				dirNodes = nodes.map((n) => ({ n: n.id, x: n.x ?? 0, y: n.y ?? 0 }));
				dirAlpha = sim2?.alpha() ?? 0;
			});
	}

	// ---- the hanging-mobile variant: pinned root + node weight -------------
	// The naive-physics formulation: the first declared node is bolted in
	// place, every node has weight (constant downward acceleration), springs
	// contract, nodes repulse. Depth then emerges from connectivity — each
	// node hangs as low as its springs allow.
	const HANG_H = 420;
	let hangNodes = $state<{ n: string; x: number; y: number }[]>([]);
	let hangAlpha = $state(0);
	let sim3: d3.Simulation<SimNode, undefined> | null = null;
	function startHang(): void {
		sim3?.stop();
		const nodes: SimNode[] = SERVICE.map((id) => ({
			id,
			x: SIM_W / 2 + (Math.random() - 0.5) * 80,
			y: 60 + Math.random() * 80
		}));
		// Pin the root (the first node declared) near the top.
		nodes[0].fx = SIM_W / 2;
		nodes[0].fy = 30;
		const links = DIR_EDGES.map(([source, target]) => ({ source, target }));
		sim3 = d3
			.forceSimulation(nodes)
			.force(
				'spring',
				d3
					.forceLink<SimNode, { source: string; target: string }>(links)
					.id((n) => n.id)
					.distance(65)
					// Uniform springs: d3's default strength is 1/min(degree),
					// which makes hub springs 4-5x weaker than leaf springs —
					// non-physical, and it hid the cycle spring's pull.
					.strength(0.9)
			)
			.force('repulsion', d3.forceManyBody().strength(-200))
			// Strong enough to visibly stretch the springs — weak gravity
			// leaves a sideways clump because repulsion wins before alpha
			// cools; slower decay + a hot start give it time to straighten.
			.force('gravity', (alpha: number) => {
				for (const n of nodes) {
					if (n.fy == null) n.vy = (n.vy ?? 0) + 15 * alpha;
				}
			})
			.force('drift', d3.forceX(SIM_W / 2).strength(0.03))
			.force('collide', d3.forceCollide(30))
			.alphaDecay(0.01)
			.alpha(1.4)
			.on('tick', () => {
				hangNodes = nodes.map((n) => ({ n: n.id, x: n.x ?? 0, y: n.y ?? 0 }));
				hangAlpha = sim3?.alpha() ?? 0;
			});
	}

	$effect(() => {
		startForce();
		startDirected();
		// startHang(); // the hanging-mobile prototype is shelved; see markup
		return () => {
			sim?.stop();
			sim2?.stop();
			sim3?.stop();
		};
	});
</script>

<svelte:head>
	<title>learn — drawing graphs</title>
</svelte:head>

{#snippet famfig(name: string, caption: string)}
	<figure class="famfig">
		{#if figs[name]}
			{@const f = figs[name]}
			<svg viewBox="-10 -10 {f.w + 20} {f.h + 20}" role="img" aria-label={caption || name}>
				{#each f.routes as r}
					<path d={r.d} class="route" marker-end="url(#arr)" />
				{/each}
				{#each f.edges as l}
					<line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} marker-end="url(#arr)" />
				{/each}
				{#each f.nodes as n}
					<rect x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx="10" class="pill" />
					{#if !n.id.startsWith('b')}
						<text x={n.x} y={n.y + 4}>{n.id}</text>
					{/if}
				{/each}
			</svg>
		{:else}
			<div class="pending dim">running…</div>
		{/if}
		{#if jobOf(name).seeded}
			<button class="ghost rerun" onclick={() => runJob(jobOf(name))}>re-run</button>
		{/if}
		{#if caption !== ''}<figcaption>{caption}</figcaption>{/if}
	</figure>
{/snippet}

{#snippet embDrawing(outer: number, caption: string)}
	<figure class="famfig">
		<svg viewBox="-50 0 365 275" role="img" aria-label={caption}>
			{#each EMB_E as [u, v]}
				{#if !(u === 1 && v === 3 && outer === 13) && !(u === 2 && v === 4 && outer === 24)}
					<line x1={EMB_P[u][0]} y1={EMB_P[u][1]} x2={EMB_P[v][0]} y2={EMB_P[v][1]} />
				{/if}
			{/each}
			{#if outer === 13}
				<!-- 1-3 around the outside: left of 5, under 4, into 3 from below -->
				<path
					d="M {EMB_P[1][0]} {EMB_P[1][1]} C -120 40, -40 330, {EMB_P[3][0] - 5} {EMB_P[3][1] + 14}"
					class="route"
				/>
			{:else if outer === 24}
				<!-- 2-4 around the outside: right of 3, under it, into 4 from below -->
				<path
					d="M {EMB_P[2][0]} {EMB_P[2][1]} C 380 180, 260 320, {EMB_P[4][0] + 5} {EMB_P[4][1] + 12}"
					class="route"
				/>
			{/if}
			{#each Object.entries(EMB_P) as [n, [x, y]]}
				<circle cx={x} cy={y} r="11" class="pill" />
				<text {x} y={y + 4}>{n}</text>
			{/each}
		</svg>
		<figcaption>{caption}</figcaption>
	</figure>
{/snippet}

{#snippet drawing(ps: P[], bands: boolean, caption: string)}
	<figure>
		<svg viewBox="0 0 300 260" role="img" aria-label={caption}>
			{#if bands}
				{#each BANDS as b}
					<rect x="4" y={b.y} width="292" height="36" class="band" />
					<text x="8" y={b.y + 13} class="bandlabel">{b.label}</text>
				{/each}
			{/if}
			{#each EDGES as e}
				{@const l = line(ps, e)}
				<line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} marker-end="url(#arr)" />
			{/each}
			{#each ps as p}
				<rect x={p.x - 26} y={p.y - 12} width="52" height="24" rx="10" class="pill" />
				<text x={p.x} y={p.y + 4}>{p.n}</text>
			{/each}
		</svg>
		<figcaption>{caption}</figcaption>
	</figure>
{/snippet}

<div class="lesson">
	<p class="crumbs"><a href={resolve('/learn')}>learn</a> <span class="dim">/ drawing graphs</span></p>
	<h1>Lesson 0: how do you draw a graph at all?</h1>
	<p class="lede">
		A graph contains things and connections, not coordinates. Layout invents the picture.
		This page compares the main layout families, defines what a “good” drawing can mean, and
		explains why directed software diagrams usually use layered layout.
	</p>
	<Term name="graph">
		Things and connections: <em>nodes</em> (the things) and <em>edges</em> (the connections).
		When edges have a direction — an arrow from one node to another — the graph is
		<em>directed</em>.
	</Term>

	<h2>Same graph, three drawings</h2>
	<p>
		Let's start with one small dependency graph — <code>ui</code> calls <code>api</code>, which
		fans out to services — drawn three ways. Every drawing contains exactly the same nodes and
		arrows:
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
	<div class="row3">
		{@render drawing(
			CIRC,
			false,
			'Placement that ignores the edges (alphabetical, on a circle): technically correct, unreadable — lines cross for no reason and direction is noise.'
		)}
		{@render drawing(
			FORCE,
			false,
			'Force-directed style: connected nodes pull together, everything else pushes apart. Organic and balanced — but arrows point every which way; you cannot tell what depends on what at a glance.'
		)}
		{@render drawing(
			LAYER,
			true,
			'Layered style: nodes sorted into layers — rows stacked along the flow — and every arrow points to a later row. The direction of the arrows becomes the direction of the page.'
		)}
	</div>
	<p>
		All three are "the graph". Which one is <em>right</em> depends on what the reader should
		be able to do with it.
	</p>

	<h2>What "good" means</h2>
	<p>
		Common objectives include few edge crossings, short edges, even spacing, few bends,
		symmetry where the structure supports it, and—for directed graphs—a consistent flow
		direction. These objectives conflict. Removing a crossing may require a longer edge;
		straightening a path may widen the drawing. Practical algorithms therefore combine
		heuristics and prioritize different objectives. Those priorities distinguish the layout
		families.
	</p>

	<h2>The families, up close</h2>
	<div class="fam">
		<p>
			<b>Force-directed.</b> Treat edges as springs and nodes as charged particles; simulate
			until the system settles. Optimizes "connected things sit together" and produces the
			organic blobs you know from social-network visualizations. Strengths: works on any
			graph, reveals clusters. Weaknesses: ignores direction entirely, results differ run to
				run — press <em>re-run</em> and watch the same graph settle somewhere else — and large
			graphs get stuck in ugly local minima. The classic choice for <em>undirected</em> data.
		</p>
		<figure class="famfig">
			<svg viewBox="0 0 {SIM_W} {SIM_H}" role="img" aria-label="Live force simulation">
				{#if simNodes.length > 0}
					{#each EDGES as e}
						{@const l = line(simNodes, e)}
						<line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} marker-end="url(#arr)" />
					{/each}
				{/if}
				{#each simNodes as p}
					<rect x={p.x - 26} y={p.y - 12} width="52" height="24" rx="10" class="pill" />
					<text x={p.x} y={p.y + 4}>{p.n}</text>
				{/each}
			</svg>
			<button class="ghost rerun" onclick={startForce}>re-run</button>
			<figcaption>
				temperature = {simAlpha.toFixed(2)}
			</figcaption>
		</figure>
	</div>
	<More id="directed-force">
		<p>
			The direction-blindness has a classic fix: give every <em>edge</em> a downward
			preference (per edge, not gravity on nodes — that just sinks the drawing). Below, the
			same simulation with that one extra force, plus a deliberate cycle edge
			<code>db → ui</code>: the flow sorts itself top-to-bottom, and the one edge that cannot
			comply points up (red). Note there was no cycle-breaking phase — the losing edge was
			<em>found by relaxation</em>.
		</p>
		<figure class="famfig">
			<svg viewBox="0 0 {SIM_W} {SIM_H}" role="img" aria-label="Directed force simulation">
				{#if dirNodes.length > 0}
					{#each DIR_EDGES as e}
						{@const l = line(dirNodes, e)}
						<line
							x1={l.x1}
							y1={l.y1}
							x2={l.x2}
							y2={l.y2}
							class:up={l.y2 < l.y1}
							marker-end={l.y2 < l.y1 ? 'url(#arr-up)' : 'url(#arr)'}
						/>
					{/each}
				{/if}
				{#each dirNodes as p}
					<rect x={p.x - 26} y={p.y - 12} width="52" height="24" rx="10" class="pill" />
					<text x={p.x} y={p.y + 4}>{p.n}</text>
				{/each}
			</svg>
			<button class="ghost rerun" onclick={startDirected}>re-run</button>
			<figcaption>
				edges pointing upward are red — temperature = {dirAlpha.toFixed(2)}
			</figcaption>
		</figure>
		<!-- The hanging-mobile prototype (pin the first declared node, give
		     every node weight, let it hang), shelved: real potential, but it
		     deserves a custom engine rather than borrowed forces. The
		     simulation code (startHang & friends) stays in the script.
		<p>
			And the naive-physics formulation, taken literally: bolt the first declared node in
			place, give every node weight, let springs contract and nodes repulse — a hanging
			mobile. It works better than it has any right to: depth emerges from connectivity,
			each node dangling as low as its springs allow. But notice what is doing the work —
			the pin and the graph's shape, not the arrows. Physics never saw the edge directions;
			on this graph they mostly agree with gravity by luck of the topology, and where they do
			not, the edge just points up (red), with no force even trying to fix it. Worse, the
			violation spreads: the cycle edge is a spring back to the pinned root, so it physically
			hoists <code>db</code> above its own parents and drags their arrows into the red with
			it. The per-edge bias above is the same physics with the arrows actually wired into it.
		</p>
		<figure class="famfig">
			<svg viewBox="0 0 {SIM_W} {HANG_H}" role="img" aria-label="Hanging-mobile simulation">
				{#if hangNodes.length > 0}
					{#each DIR_EDGES as e}
						{@const l = line(hangNodes, e)}
						<line
							x1={l.x1}
							y1={l.y1}
							x2={l.x2}
							y2={l.y2}
							class:up={l.y2 < l.y1}
							marker-end={l.y2 < l.y1 ? 'url(#arr-up)' : 'url(#arr)'}
						/>
					{/each}
				{/if}
				{#each hangNodes as p}
					<rect x={p.x - 26} y={p.y - 12} width="52" height="24" rx="10" class="pill" />
					<text x={p.x} y={p.y + 4}>{p.n}</text>
				{/each}
			</svg>
			<button class="ghost rerun" onclick={startHang}>[re-run]</button>
			<figcaption>
				pinned root = <code>ui</code>, the first node declared — temperature = ...
			</figcaption>
		</figure>
		-->
		<Term name="Sugiyama & Misue (1995)" href="https://doi.org/10.1006/jvlc.1995.1013">
			<em>Graph Drawing by the Magnetic-Spring Model</em> — edges as magnetized springs
			aligning to a global field; the original force-directed answer to direction.
		</Term>
		<Term name="Dwyer & Koren (2005)" href="https://dblp.org/rec/conf/infovis/DwyerK05.html">
			<em>DiG-CoLa</em> — stress layout plus a hierarchy energy penalizing every
			upward-pointing edge, solved as constrained optimization; lives on in the WebCola
			library.
		</Term>
	</More>
	<div class="fam">
		<p>
			<b>Stress / MDS.</b> A more principled cousin: place nodes so that geometric distance
			matches graph-theoretic distance (number of hops) as closely as possible, solved as
			numeric optimization. Steadier than springs, same blindness to direction.
		</p>
		{@render famfig('stress', '')}
	</div>
	<div class="fam">
		<p>
			<b>Trees and radial.</b> If the graph is a strict hierarchy — every node has exactly
			one parent — layout is nearly solved: tidy-tree algorithms produce the textbook picture
			in linear time, and radial variants wrap the same tree around its root. The moment two
			parents share a child, you leave tree territory.
		</p>
		<div class="pair">
			{@render famfig('mrtree', 'a module tree')}
			{@render famfig('radial', 'the same tree, wrapped around its root')}
		</div>
	</div>
	<div class="fam">
		<div>
			<p>
				<b>Orthogonal (circuit-style).</b> All edges run horizontal/vertical, snapped to a
				grid, leaving nodes through <em>ports</em> on their sides. Computed by the
				topology-shape-metrics school in three refinements — what crosses what, then where
				the bends go, then how long every segment is — so node placement is never decided
				directly; positions fall out at the end. Works well for circuit-like, low-degree
				graphs; struggles with big labeled boxes and high fan-out, which is what software
				diagrams have.
			</p>
			<More id="tsm">
				<p>
					TSM takes any graph, but all of its machinery operates on planar embeddings —
					a non-planar input is first planarized into a planar stand-in.
				</p>
				<Term name="planar">
					A graph is planar if it <em>can</em> be drawn with zero edge crossings. A
					property of the graph, not of any particular drawing — a planar graph drawn
					badly still crosses.
				</Term>
				<Term name="embedding">
					The combinatorial recipe for a crossing-free drawing — and "combinatorial
					recipe" means nothing deeper than a table: for each node, its neighbours listed
					in clockwise order. No coordinates anywhere. One graph usually admits many
					embeddings.
				</Term>
				<p>
					Concretely. Here is one planar graph — a pentagon <code>1‑2‑3‑4‑5</code> with
					two chords, <code>1‑3</code> and <code>2‑4</code> — drawn twice, crossing-free
					both times:
				</p>
				<div class="pair">
					{@render embDrawing(
						24,
						'E1: chord 1‑3 inside, chord 2‑4 routed around the outside.'
					)}
					{@render embDrawing(
						13,
						'E2: the chords trade places — 2‑4 inside, 1‑3 outside. Same graph, and still no crossings.'
					)}
				</div>
				<p>
					The recipes, written out — each table <em>is</em> its embedding, the whole of
					it. Walk clockwise around each node in the drawings above and check a row or
					two; only node 5 kept its order:
				</p>
				<div class="pair">
					<pre>E1               clockwise
1 → (2, 3, 5)
2 → (3, 1, 4)
3 → (4, 1, 2)
4 → (5, 3, 2)
5 → (1, 4)</pre>
					<pre>E2
1 → (2, 5, 3)
2 → (3, 4, 1)
3 → (4, 2, 1)
4 → (5, 2, 3)
5 → (1, 4)</pre>
				</div>
				<p>
					Any drawing you can massage out of E1 without lifting edges over nodes — stretch
					it, squash it, wobble every line — keeps E1's table intact. That is why the
					embedding is called the drawing's <em>topology</em>: it is exactly what survives
					deformation. It also fixes the drawing's <em>faces</em>: in E1 the chord
					<code>1‑3</code> walls the pentagon's interior into two rooms, in E2 that wall
					is <code>2‑4</code> — different embeddings, different rooms.
				</p>
				<Term name="face">
					A region the drawing carves the plane into. In E1: the triangle
					<code>1‑2‑3</code>, the quad <code>1‑3‑4‑5</code>, the sliver between the outer
					arc and the pentagon's rim, and the unbounded everything-outside (which counts
					as a face too).
				</Term>
				<p>
					So much for the theory. The TSM algorithm itself is three refinements run in
					sequence, each committing one aspect of the final drawing and handing the rest
					on:
				</p>
				<ol>
					<li>
						<b>Topology.</b> Choose the embedding — one recipe table out of the many the
						graph admits, decided by heuristics that estimate which will need few bends.
						E1 versus E2 above is exactly this choice. That pins down the entire "which
						side does everything pass on" structure of the drawing before anything has
						coordinates. (If the input is not planar, no crossing-free drawing exists at
						all — then this step also chooses <em>which pairs of edges</em> cross,
						turning each crossing into an invisible dummy node: <em>planarization</em>.
						A planar input needs none of that, however far some edges detour around the
						outside.)
					</li>
					<li>
						<b>Shape.</b> Given the embedding, decide every corner: which edges bend,
						which way, and the angles around each node. Tamassia's classic result
						computes the <em>global minimum number of bends</em> for the chosen
						embedding via min-cost network flow — one of the few spots in graph drawing
						where something is solved optimally. Still no coordinates, just shapes.
					</li>
					<li>
						<b>Metrics.</b> Compaction: stretch every horizontal and vertical segment to
						an integer length so nothing overlaps and area is small. Node positions
						simply fall out of the segment lengths.
					</li>
				</ol>
				<Term name="Tamassia (1987)" href="https://doi.org/10.1137/0216030">
					<em>On Embedding a Graph in the Grid with the Minimum Number of Bends</em> —
					shows the minimum-bend drawing for a fixed embedding can be computed exactly,
					by casting bends as flow in a min-cost network.
				</Term>
				<p>
					So "where does the node go" is answered last, as a by-product — the opposite of
					layered layout, which commits to positions (layer, then order, then x) and routes
					edges around the result.
				</p>
				<p>
					One caveat worth knowing: Tamassia's bend optimum holds <em>per embedding</em> —
					optimizing over all embeddings is NP-hard again, so step 1 may lock in a choice
					step 2 cannot repair: the same phase-commitment curse that haunts every
					multi-phase layout.
				</p>
			</More>
		</div>
		<figure class="famfig">
			<svg viewBox="0 0 300 200" role="img" aria-label="Orthogonal drawing, schematic">
				{#each ['M 86 40 L 134 40', 'M 186 40 L 234 40', 'M 86 150 L 134 150', 'M 186 150 L 234 150', 'M 60 52 L 60 138', 'M 160 52 L 160 138', 'M 260 52 L 260 138', 'M 74 52 L 74 100 L 146 100 L 146 138'] as d}
					<path {d} class="route" />
				{/each}
				{#each [['a', 60, 40], ['b', 160, 40], ['c', 260, 40], ['d', 60, 150], ['e', 160, 150], ['f', 260, 150]] as [n, x, y]}
					<rect x={(x as number) - 26} y={(y as number) - 12} width="52" height="24" rx="4" class="pill" />
					<text x={x as number} y={(y as number) + 4}>{n}</text>
				{/each}
			</svg>
			<figcaption>
				Every edge axis-aligned, two bends total, ports spread along node sides. Layered
				layout borrows exactly this <em>edge routing</em> style (visible below) without
				adopting TSM's placement.
			</figcaption>
		</figure>
	</div>
	<div class="fam">
		<p>
			<b>Packing.</b> Not one graph but many disconnected pieces (or plain rectangles):
			arrange them to fill space at a target aspect ratio. A supporting act — real engines
			run it after the main layout, per connected component.
		</p>
		{@render famfig('rectpacking', 'disconnected boxes, packed to an aspect ratio')}
	</div>
	<div class="fam">
		<p>
			<b>Layered (Sugiyama).</b> The family for graphs where <em>direction is the meaning</em>:
				dependencies, causality, time, control flow. Its one organizing rule: the reader's eye
				travels one way — sources at the top, consequences below. Compare with force and stress
				on the very same graph. Mermaid flowcharts, Graphviz <code>dot</code>, and ELK (used
				by the live figures on these pages) all offer layered layout.
		</p>
		{@render famfig('layered', 'the service graph again — every arrow pointing one way')}
	</div>

	<h2>"Layers", precisely</h2>
	<p>
		The word is unfortunate: these are not Photoshop layers stacked toward the viewer. A layer
		(Graphviz says <b>rank</b>) is a <em>row</em> — look at the third drawing above. The
		algorithm sorts nodes into consecutive rows along the flow direction, like the levels of
		an org chart: the CEO's row, the VPs' row, everyone who reports to a VP. In a top-down
		diagram layers are horizontal rows; flip to left-right and they become columns. Same idea,
		rotated.
	</p>
	<p>
		The layered figure in the families section is exactly this picture, computed: the layer
		bands are invisible, but every node sits in one.
	</p>

	<h2>Why layered layout cannot abide a cycle</h2>
	<p>
		The layered promise — every edge points to a strictly later row — quietly assumes the graph
		has an ordering at all. Rows are numbered: an edge from row 2 to row 5 is fine; an edge
		from row 5 back to row 2 breaks the promise. Suppose the graph has a cycle,
		<code>A → B → C → A</code> — try to number those rows.
	</p>
	<p>
		Force-directed layout never notices (it makes no direction promise). Layered layout must do
		something about it <em>before anything else can run</em> — which is why "cycle breaking" is
		phase one of the pipeline, and where we pick up in
		<a href={resolve('/learn/cycle-breaking')}>lesson 1</a>.
	</p>

	<h2>The pipeline</h2>
	<p>
		A traditional layered engine proceeds through five phases. Each narrows the choices
		available to the next:
	</p>
	<svg
		viewBox="-4 0 {PHASES_W + 8} 40"
		class="pipeline"
		role="img"
		aria-label="The five phases of layered layout"
	>
		{#each PHASES as p, i}
			<rect x={p.x} y="8" width={p.w} height="24" rx="10" class="pill" />
			<text x={p.x + p.w / 2} y="24">{p.label}</text>
			{#if i + 1 < PHASES.length}
				<line x1={p.x + p.w + 3} y1="20" x2={p.x + p.w + 24} y2="20" marker-end="url(#arr)" />
			{/if}
		{/each}
	</svg>
	<p>
		This order makes the first implementation tractable. In a one-pass engine, placement cannot
		reorder a layer to remove a crossing; local oddities often trace back to an earlier commitment.
		A better engine can preserve each phase’s output, measure the complete drawing, and reopen the
		responsible decision. The phases remain useful even when the arrows between them eventually
		point both ways.
	</p>

	<div class="">
		<p>
			<b>1 · Cycle breaking.</b> "Every edge points forward" is unsatisfiable the moment the
			graph has a cycle, so some edges are picked and temporarily
			reversed. Which edges get picked decides what ends up on top of what — a choice with
			more personality than it sounds, and the subject of
			<a href={resolve('/learn/cycle-breaking')}>its own page</a>.
		</p>
	</div>

	<div class="fam">
		<p>
			<b>2 · Layering.</b> Assign every node a layer so each edge points to a strictly later
			one. Good layerings keep edges short — an edge from layer 1 to layer 5 costs vertical
			distance and, less obviously, width: any edge spanning more than one layer is split
			into a chain of invisible <em>dummy nodes</em>, one per layer crossed, so that later
			phases only ever deal with edges between adjacent layers. Every dummy takes up
			horizontal room in its layer like a real node. Long edges are quietly expensive.
		</p>
		<div class="pair">
			<figure class="famfig">
				<svg viewBox="0 0 300 260" role="img" aria-label="A long edge as written">
					{#each BANDS as b}
						<rect x="4" y={b.y} width="292" height="36" class="band" />
						<text x="8" y={b.y + 13} class="bandlabel">{b.label}</text>
					{/each}
					<line x1="137" y1="41" x2="93" y2="85" marker-end="url(#arr)" />
					<line x1="80" y1="107" x2="80" y2="148" marker-end="url(#arr)" />
					<line x1="93" y1="172" x2="137" y2="215" marker-end="url(#arr)" />
					<line x1="150" y1="42" x2="150" y2="213" marker-end="url(#arr)" />
					{#each [['A', 150, 30], ['B', 80, 95], ['C', 80, 160], ['D', 150, 225]] as [n, x, y]}
						<rect x={(x as number) - 26} y={(y as number) - 12} width="52" height="24" rx="10" class="pill" />
						<text x={x as number} y={(y as number) + 4}>{n}</text>
					{/each}
				</svg>
				<figcaption>As written: A → D spans three layers.</figcaption>
			</figure>
			<figure class="famfig">
				<svg viewBox="0 0 300 260" role="img" aria-label="The same edge with dummy nodes">
					{#each BANDS as b}
						<rect x="4" y={b.y} width="292" height="36" class="band" />
						<text x="8" y={b.y + 13} class="bandlabel">{b.label}</text>
					{/each}
					<line x1="137" y1="41" x2="93" y2="85" marker-end="url(#arr)" />
					<line x1="80" y1="107" x2="80" y2="148" marker-end="url(#arr)" />
					<line x1="93" y1="172" x2="137" y2="215" marker-end="url(#arr)" />
					<path d="M 162 41 L 215 88" class="route" />
					<path d="M 215 102 L 215 153" class="route" />
					<path d="M 213 167 L 165 214" class="route" marker-end="url(#arr)" />
					<circle cx="215" cy="95" r="7" class="dummy" />
					<circle cx="215" cy="160" r="7" class="dummy" />
					{#each [['A', 150, 30], ['B', 80, 95], ['C', 80, 160], ['D', 150, 225]] as [n, x, y]}
						<rect x={(x as number) - 26} y={(y as number) - 12} width="52" height="24" rx="10" class="pill" />
						<text x={x as number} y={(y as number) + 4}>{n}</text>
					{/each}
				</svg>
				<figcaption>
					As the engine sees it: two dummy nodes, three adjacent-layer edges. The dummies
					occupy space in layers 1 and 2.
				</figcaption>
			</figure>
		</div>
	</div>

	<div class="fam">
		<p>
			<b>3 · Crossing minimization.</b> Order the nodes within each layer — coordinates still
			do not exist, only left-to-right order, because crossings depend on nothing else. This
			is where most of the readability is won or lost, and it is NP-hard even for two layers.
			The standard heuristic is the <em>layer sweep</em>: hold one layer fixed, reorder its
			neighbour by the <em>barycenter</em> rule — place each node at the average position of
			the neighbours it connects to — then sweep down and up until nothing improves. Dummy
			nodes take part like everyone else, which is how long edges end up woven sensibly
			through intermediate layers.
		</p>
		<div class="pair">
			<figure class="famfig">
				<svg viewBox="0 0 300 240" role="img" aria-label="Arbitrary order with crossings">
					{#each [[45, 185], [115, 45], [185, 255], [255, 115]] as [x1, x2]}
						<line y1="52" y2="188" {x1} {x2} marker-end="url(#arr)" />
					{/each}
					{#each [['a', 45], ['b', 115], ['c', 185], ['d', 255]] as [n, x]}
						<rect x={(x as number) - 26} y="28" width="52" height="24" rx="10" class="pill" />
						<text x={x as number} y="44">{n}</text>
					{/each}
					{#each [['p', 45], ['q', 115], ['r', 185], ['s', 255]] as [n, x]}
						<rect x={(x as number) - 26} y="188" width="52" height="24" rx="10" class="pill" />
						<text x={x as number} y="204">{n}</text>
					{/each}
				</svg>
				<figcaption>Bottom layer in arbitrary order: 3 crossings.</figcaption>
			</figure>
			<figure class="famfig">
				<svg viewBox="0 0 300 240" role="img" aria-label="Barycenter order, no crossings">
					{#each [45, 115, 185, 255] as x}
						<line y1="52" y2="188" x1={x} x2={x} marker-end="url(#arr)" />
					{/each}
					{#each [['a', 45], ['b', 115], ['c', 185], ['d', 255]] as [n, x]}
						<rect x={(x as number) - 26} y="28" width="52" height="24" rx="10" class="pill" />
						<text x={x as number} y="44">{n}</text>
					{/each}
					{#each [['r', 45], ['p', 115], ['s', 185], ['q', 255]] as [n, x]}
						<rect x={(x as number) - 26} y="188" width="52" height="24" rx="10" class="pill" />
						<text x={x as number} y="204">{n}</text>
					{/each}
				</svg>
				<figcaption>Same edges, bottom layer sorted by barycenter: 0 crossings.</figcaption>
			</figure>
		</div>
	</div>

	<div class="fam">
			<p>
				<b>4 · Node placement.</b> Turn the orders into actual coordinates on the cross axis.
				The order is locked; what remains is how much space to put where. The objective is
				to balance several goals: centre related nodes, shorten edges, keep dummy chains
				straight, and limit width. Straightness and compactness pull against each other, so
				this phase decides where horizontal space is spent.
		</p>
		<div class="pair">
			<figure class="famfig">
				<svg viewBox="0 0 300 210" role="img" aria-label="Packed placement, zigzag path">
					<line x1="60" y1="52" x2="60" y2="88" marker-end="url(#arr)" />
					<line x1="74" y1="52" x2="114" y2="90" marker-end="url(#arr)" />
					<line x1="116" y1="120" x2="74" y2="156" marker-end="url(#arr)" />
					{#each [['A', 60, 40], ['B', 60, 105], ['C', 130, 105], ['D', 60, 170]] as [n, x, y]}
						<rect x={(x as number) - 26} y={(y as number) - 12} width="52" height="24" rx="10" class="pill" />
						<text x={x as number} y={(y as number) + 4}>{n}</text>
					{/each}
				</svg>
				<figcaption>Every layer packed left: the A → C → D path zigzags.</figcaption>
			</figure>
			<figure class="famfig">
				<svg viewBox="0 0 300 210" role="img" aria-label="Aligned placement, straight path">
					<line x1="116" y1="52" x2="74" y2="90" marker-end="url(#arr)" />
					<line x1="130" y1="52" x2="130" y2="88" marker-end="url(#arr)" />
					<line x1="130" y1="117" x2="130" y2="153" marker-end="url(#arr)" />
					{#each [['A', 130, 40], ['B', 60, 105], ['C', 130, 105], ['D', 130, 170]] as [n, x, y]}
						<rect x={(x as number) - 26} y={(y as number) - 12} width="52" height="24" rx="10" class="pill" />
						<text x={x as number} y={(y as number) + 4}>{n}</text>
					{/each}
				</svg>
				<figcaption>Same orders, A → C → D aligned into a straight spine.</figcaption>
			</figure>
		</div>
	</div>

	<div class="fam">
			<p>
				<b>5 · Edge routing.</b> Draw the connections. With orthogonal routing (all segments
			horizontal or vertical) the gap between two layers becomes a <em>channel</em>: each
			crossing edge drops in, runs horizontally, and drops out. Two horizontal runs that
			overlap must sit on different <em>tracks</em> — separate heights inside the channel —
			and every occupied track makes the gap between the layers taller. Assigning runs to as
				few tracks as possible is the same puzzle as scheduling meetings into as few rooms.
				Once the horizontal runs are fixed, the minimum track assignment is solvable exactly.
		</p>
		<figure class="famfig">
			<svg viewBox="0 0 300 210" role="img" aria-label="Channel routing with two tracks">
				<line x1="10" y1="85" x2="290" y2="85" class="track" />
				<line x1="10" y1="110" x2="290" y2="110" class="track" />
				<text x="12" y="80" class="bandlabel">track 1</text>
				<text x="12" y="105" class="bandlabel">track 2</text>
				<path d="M 60 52 L 60 85 L 240 85 L 240 158" class="route" marker-end="url(#arr)" />
				<path d="M 240 52 L 240 110 L 60 110 L 60 158" class="route" marker-end="url(#arr)" />
				<line x1="150" y1="52" x2="150" y2="158" marker-end="url(#arr)" />
				{#each [['A', 60, 40], ['B', 150, 40], ['C', 240, 40], ['D', 60, 170], ['E', 150, 170], ['F', 240, 170]] as [n, x, y]}
					<rect x={(x as number) - 26} y={(y as number) - 12} width="52" height="24" rx="10" class="pill" />
					<text x={x as number} y={(y as number) + 4}>{n}</text>
				{/each}
			</svg>
			<figcaption>
				A → F and C → D both need the full width of the channel, so they get separate
				tracks; B → E crosses them without caring.
			</figcaption>
		</figure>
	</div>

	<p class="dim">
		Each phase gets its own page, followed by a final lesson on feeding downstream failures back
		into earlier choices. Start with <a href={resolve('/learn/cycle-breaking')}>cycle breaking</a>.
	</p>
</div>

<style>
	.row3 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 1rem;
	}
	figure {
		margin: 0;
	}
	figure svg {
		width: 100%;
		border: 1px solid var(--muted);
		border-radius: 6px;
		background: var(--term-bg);
	}
	figcaption {
		margin-top: 0.4rem;
	}
	svg line {
		stroke: var(--accent);
		stroke-width: 1.4;
	}
	svg line.up {
		stroke: var(--err);
	}
	svg text {
		fill: var(--fg);
		font-size: 13px;
		text-anchor: middle;
	}
	svg line.track {
		stroke: var(--muted);
		stroke-width: 1;
		stroke-dasharray: 4 4;
	}

	.pipeline {
		width: 100%;
		margin: 0.6rem 0;
	}

	.fam {
		display: grid;
		grid-template-columns: 1fr minmax(14rem, 19rem);
		gap: 1.2rem;
		align-items: start;
		margin: 1.2rem 0;
	}
	.fam:has(.pair) {
		grid-template-columns: 1fr;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.famfig {
		position: relative;
		margin: 0 0 0.6rem;
	}
	.rerun {
		position: absolute;
		top: 0.35rem;
		left: 0.6rem;
	}
	.famfig svg {
		max-height: 15rem;
	}
	.route {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.4;
	}
	.pending {
		border: 1px dashed var(--muted);
		border-radius: 6px;
		padding: 2rem;
		text-align: center;
	}
	@media (max-width: 48rem) {
		.fam {
			grid-template-columns: 1fr;
		}
	}
</style>
