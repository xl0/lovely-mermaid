<script lang="ts">
	import { resolve } from '$app/paths';
	import BuildContract from '$lib/learn/BuildContract.svelte';
	import More from '$lib/learn/More.svelte';
	import Term from '$lib/learn/Term.svelte';

	// ---- channel-track experiment -----------------------------------------
	const JOGS = [
		{ from: 'A', to: 'W', x1: 60, x2: 190 },
		{ from: 'B', to: 'X', x1: 160, x2: 250 },
		{ from: 'C', to: 'Y', x1: 290, x2: 420 },
		{ from: 'D', to: 'Z', x1: 390, x2: 480 }
	];
	const TOP_NODES = [
		{ name: 'A', x: 60 },
		{ name: 'B', x: 160 },
		{ name: 'C', x: 290 },
		{ name: 'D', x: 390 }
	];
	const BOTTOM_NODES = [
		{ name: 'W', x: 190 },
		{ name: 'X', x: 250 },
		{ name: 'Y', x: 420 },
		{ name: 'Z', x: 480 }
	];
	const TRACK_Y = [92, 124, 156, 188];
	let trackOf = $state([0, 0, 0, 0]);
	let dragEdge = $state<number | null>(null);
	let channelSvg: SVGSVGElement | undefined = $state();
	const conflictPairs = $derived.by(() => {
		const pairs: {
			a: number;
			b: number;
			overlap?: { lo: number; hi: number; y: number };
			crossings: { x: number; y: number }[];
		}[] = [];
		const inside = (v: number, a: number, b: number): boolean =>
			v > Math.min(a, b) && v < Math.max(a, b);
		for (let i = 0; i < JOGS.length; i++) {
			for (let j = i + 1; j < JOGS.length; j++) {
				const a = JOGS[i];
				const b = JOGS[j];
				const ay = TRACK_Y[trackOf[i]];
				const by = TRACK_Y[trackOf[j]];
				const alo = Math.min(a.x1, a.x2);
				const ahi = Math.max(a.x1, a.x2);
				const blo = Math.min(b.x1, b.x2);
				const bhi = Math.max(b.x1, b.x2);
				const overlap =
					ay === by && alo < bhi && blo < ahi
						? { lo: Math.max(alo, blo), hi: Math.min(ahi, bhi), y: ay }
						: undefined;
				const crossings: { x: number; y: number }[] = [];
				const cross = (x: number, y1: number, y2: number, y: number, lo: number, hi: number) => {
					if (inside(y, y1, y2) && inside(x, lo, hi)) crossings.push({ x, y });
				};
				// Each route has a source stub above its jog and a target
				// stub below it. Test both stubs against the other jog.
				cross(a.x1, 46, ay, by, blo, bhi);
				cross(a.x2, ay, 234, by, blo, bhi);
				cross(b.x1, 46, by, ay, alo, ahi);
				cross(b.x2, by, 234, ay, alo, ahi);
				if (overlap || crossings.length > 0) pairs.push({ a: i, b: j, overlap, crossings });
			}
		}
		return pairs;
	});
	const conflicts = $derived.by(() => {
		const bad = new Set<number>();
		for (const pair of conflictPairs) {
			bad.add(pair.a);
			bad.add(pair.b);
		}
		return bad;
	});
	const rowsReserved = $derived(Math.max(...trackOf) + 1);
	const nConflicts = $derived(conflictPairs.length);
	const channelY = (e: PointerEvent): number => {
		if (!channelSvg) return 0;
		const r = channelSvg.getBoundingClientRect();
		return ((e.clientY - r.top) / r.height) * 280;
	};
	const nearestTrack = (y: number): number =>
		TRACK_Y.reduce((best, ty, i) =>
			Math.abs(ty - y) < Math.abs(TRACK_Y[best] - y) ? i : best
		, 0);
	function grabTrack(i: number, e: PointerEvent) {
		dragEdge = i;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		trackOf[i] = nearestTrack(channelY(e));
	}
	function moveTrack(e: PointerEvent) {
		if (dragEdge !== null) trackOf[dragEdge] = nearestTrack(channelY(e));
	}
	function dropTrack() {
		dragEdge = null;
	}
	function trackKey(i: number, e: KeyboardEvent) {
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		e.preventDefault();
		trackOf[i] = Math.max(0, Math.min(TRACK_Y.length - 1, trackOf[i] + (e.key === 'ArrowUp' ? -1 : 1)));
	}

	// ---- live ELK routing playground --------------------------------------
	interface Pt {
		x: number;
		y: number;
	}
	interface RouteFig {
		w: number;
		h: number;
		routing: string;
		nodes: { id: string; label: string; x: number; y: number; w: number; h: number }[];
		routes: Pt[][];
	}
	const PLAY = `start[request] --> parse
start --> cache
parse --> validate
cache --> validate
parse --> report
validate --> render
report --> render
start --> render`;
	let playSrc = $state(PLAY);
	let playRouting = $state('ORTHOGONAL');
	let routeFig = $state<RouteFig | null>(null);
	let routeErr = $state('');
	let routeToken = 0;

	function parseEdges(src: string): { labels: Map<string, string>; edges: [string, string][] } {
		const labels = new Map<string, string>();
		const edges: [string, string][] = [];
		const node = (raw: string): string | null => {
			const m = raw.trim().match(/^(\w+)(?:\[([^\]]*)\])?$/);
			if (!m) return null;
			if (m[2] || !labels.has(m[1])) labels.set(m[1], m[2] ?? m[1]);
			return m[1];
		};
		for (const line of src.split('\n')) {
			const parts = line.trim().split('-->');
			for (let i = 0; i + 1 < parts.length; i++) {
				const u = node(parts[i]);
				const v = node(parts[i + 1]);
				if (u && v) edges.push([u, v]);
			}
		}
		return { labels, edges };
	}
	function routePath(points: Pt[], routing: string): string {
		if (points.length === 0) return '';
		if (routing !== 'SPLINES')
			return `M ${points.map((p) => `${p.x} ${p.y}`).join(' L ')}`;
		const rest = [...points.slice(1)];
		// ELK spline bend points are piecewise Bézier control points. Some
		// modes return an odd grouping; split those joins at their midpoint.
		if (rest.length > 1 && rest.length % 3 !== 0 && rest.length % 2 !== 0) {
			for (let i = rest.length - 3; i >= 2; i -= 2) {
				rest.splice(i, 0, {
					x: (rest[i - 1].x + rest[i].x) / 2,
					y: (rest[i - 1].y + rest[i].y) / 2
				});
			}
		}
		let d = `M ${points[0].x} ${points[0].y}`;
		if (rest.length === 1) return `${d} L ${rest[0].x} ${rest[0].y}`;
		const stride = rest.length % 3 === 0 ? 3 : 2;
		for (let i = 0; i < rest.length; i += stride) {
			if (stride === 3)
				d += ` C ${rest[i].x} ${rest[i].y}, ${rest[i + 1].x} ${rest[i + 1].y}, ${rest[i + 2].x} ${rest[i + 2].y}`;
			else d += ` Q ${rest[i].x} ${rest[i].y}, ${rest[i + 1].x} ${rest[i + 1].y}`;
		}
		return d;
	}

	$effect(() => {
		const { labels, edges } = parseEdges(playSrc);
		const routing = playRouting;
		const token = ++routeToken;
		(async () => {
			const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
			const laid = (await new ELK().layout({
				id: 'root',
				layoutOptions: {
					'elk.algorithm': 'layered',
					'elk.direction': 'DOWN',
					'elk.edgeRouting': routing,
					'elk.layered.spacing.nodeNodeBetweenLayers': '54',
					'elk.spacing.nodeNode': '36'
				},
				children: [...labels.entries()].map(([id, label]) => ({
					id,
					width: Math.max(54, label.length * 7.2 + 22),
					height: 28
				})),
				edges: edges.map(([u, v], i) => ({ id: `e${i}`, sources: [u], targets: [v] }))
			})) as {
				width?: number;
				height?: number;
				children?: { id: string; x?: number; y?: number; width?: number; height?: number }[];
				edges?: { sections?: { startPoint: Pt; bendPoints?: Pt[]; endPoint: Pt }[] }[];
			};
			if (token !== routeToken) return;
			routeFig = {
				w: laid.width ?? 1,
				h: laid.height ?? 1,
				routing,
				nodes: (laid.children ?? []).map((n) => ({
					id: n.id,
					label: labels.get(n.id) ?? n.id,
					x: n.x ?? 0,
					y: n.y ?? 0,
					w: n.width ?? 54,
					h: n.height ?? 28
				})),
				routes: (laid.edges ?? []).flatMap((e) =>
					(e.sections ?? []).map((s) => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint])
				)
			};
			routeErr = '';
		})().catch((err) => {
			if (token === routeToken) {
				routeFig = null;
				routeErr = String(err);
			}
		});
	});
</script>

<svelte:head>
	<title>learn — edge routing</title>
</svelte:head>

<div class="lesson">
	<p class="crumbs"><a href={resolve('/learn')}>learn</a> <span class="dim">/ edge routing</span></p>
	<h1>Edge routing</h1>
	<p class="lede">
		<a href={resolve('/learn/node-placement')}>Node placement</a> fixed each measured box’s
		position within its layer. Edge routing now chooses a path between each pair of endpoints. It
		does not reorder nodes or choose new x coordinates, but it may push whole layers farther apart
		to make room. The remaining questions are where an edge leaves a box, where it bends, and
		which other edges it may share space with.
	</p>
	<Term name="route">
		The geometric path of an edge from source to target. A route consists of straight segments
		joined at bend points; its last segment determines the arrowhead direction.
	</Term>
	<p>
		Routes attach to rectangle borders or explicit ports, not to abstract node centres. A wider
		node offers a longer border on which a port may slide; a taller node changes the top and
		bottom coordinates of its whole layer’s envelope. Label size therefore survives into routing
		as endpoint geometry even though the router never reads the label text.
	</p>

	<h2>Experiment: pack the channel</h2>
	<p>
		The gap between these two layers has four possible tracks. Drag each horizontal jog up or
		down. Two things can go wrong: jogs overlap on one track, or a vertical stub crosses another
		jog. Red marks both routes; a thick segment marks overlap and a dot marks a crossing. Find a
		conflict-free answer using two tracks. Separating the jogs is not enough — track order also
		matters.
	</p>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg
		bind:this={channelSvg}
		viewBox="0 0 500 280"
		class="channel"
		role="application"
		aria-label="Move edge jogs between routing tracks"
	>
		<defs>
			<marker id="channel-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
				<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
			</marker>
		</defs>
		<rect x="4" y="10" width="492" height="48" class="band" />
		<rect x="4" y="222" width="492" height="48" class="band" />
		{#each TRACK_Y as y, i}
			<line x1="54" y1={y} x2="476" y2={y} class="track-guide" />
			<text x="10" y={y + 4} class="track-label">track {i + 1}</text>
		{/each}
		{#each TOP_NODES as n}
			<rect x={n.x - 20} y="22" width="40" height="24" rx="10" class="pill" />
			<text x={n.x} y="38">{n.name}</text>
		{/each}
		{#each BOTTOM_NODES as n}
			<rect x={n.x - 20} y="234" width="40" height="24" rx="10" class="pill" />
			<text x={n.x} y="250">{n.name}</text>
		{/each}
		{#each JOGS as edge, i}
			{@const y = TRACK_Y[trackOf[i]]}
			<g
				class="route-grab"
				class:lift={dragEdge === i}
				class:conflict={conflicts.has(i)}
				role="slider"
				tabindex="0"
				aria-label="Track for {edge.from} to {edge.to}"
				aria-valuemin="1"
				aria-valuemax={TRACK_Y.length}
				aria-valuenow={trackOf[i] + 1}
				onpointerdown={(e) => grabTrack(i, e)}
				onpointermove={moveTrack}
				onpointerup={dropTrack}
				onpointercancel={dropTrack}
				onkeydown={(e) => trackKey(i, e)}
			>
				<path d="M {edge.x1} 46 V {y} H {edge.x2} V 234" class="channel-edge" marker-end="url(#channel-arr)" />
				<path d="M {edge.x1} 46 V {y} H {edge.x2} V 234" class="route-hit" />
			</g>
		{/each}
		{#each conflictPairs as pair}
			{#if pair.overlap}
				<line
					x1={pair.overlap.lo}
					y1={pair.overlap.y}
					x2={pair.overlap.hi}
					y2={pair.overlap.y}
					class="conflict-overlap"
				/>
			{/if}
			{#each pair.crossings as crossing}
				<circle cx={crossing.x} cy={crossing.y} r="5" class="conflict-crossing" />
			{/each}
		{/each}
	</svg>
	<div class="statbar">
		<span>conflicting pairs: <b class:good={nConflicts === 0}>{nConflicts}</b></span>
		<span>channel tracks reserved: <b class:good={nConflicts === 0 && rowsReserved === 2}>{rowsReserved}</b> <span class="dim">(minimum: 2)</span></span>
	</div>
	<div class="statbar">
		<button class="ghost" onclick={() => (trackOf = [1, 0, 1, 0])}>packed answer</button>
		<button class="ghost" onclick={() => (trackOf = [0, 1, 0, 1])}>separate but crossing</button>
		<button class="ghost" onclick={() => (trackOf = [0, 0, 0, 0])}>reset</button>
	</div>
	<Term name="channel / track">
		A channel is the open strip between consecutive layers. A track is one horizontal line in
		that strip. Overlapping jogs need separate tracks; their order must also keep vertical stubs
		from crossing another route’s jog.
	</Term>

	<h2>One edge, three shapes</h2>
	<p>
		A router inherits the node positions and dummy positions from earlier phases. It can connect
		those waypoints with different geometric vocabularies. The graph stays the same; only the
		paths change.
	</p>
	<div class="route-kinds">
		<figure>
			<svg viewBox="0 0 220 150" class="kindsvg" role="img" aria-label="Polyline edge">
				<rect x="16" y="14" width="64" height="24" rx="10" class="pill" />
				<rect x="140" y="112" width="64" height="24" rx="10" class="pill" />
				<polyline points="48,38 94,72 112,72 172,112" class="kind-edge" marker-end="url(#kind-arr)" />
				<circle cx="103" cy="72" r="4" class="dummy" />
				<text x="48" y="30">source</text><text x="172" y="128">target</text>
			</svg>
			<figcaption><b>Polyline</b>: straight segments may run at any angle. Few bends; diagonal strokes need a graphical canvas.</figcaption>
		</figure>
		<figure>
			<svg viewBox="0 0 220 150" class="kindsvg" role="img" aria-label="Spline edge">
				<rect x="16" y="14" width="64" height="24" rx="10" class="pill" />
				<rect x="140" y="112" width="64" height="24" rx="10" class="pill" />
				<path d="M 48 38 C 48 86, 172 64, 172 112" class="kind-edge" marker-end="url(#kind-arr)" />
				<circle cx="110" cy="72" r="4" class="dummy" />
				<text x="48" y="30">source</text><text x="172" y="128">target</text>
			</svg>
			<figcaption><b>Spline</b>: a smooth curve fitted through control points. This is the characteristic <code>dot</code> look.</figcaption>
		</figure>
		<figure>
			<svg viewBox="0 0 220 150" class="kindsvg" role="img" aria-label="Orthogonal edge">
				<defs>
					<marker id="kind-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
						<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
					</marker>
				</defs>
				<rect x="16" y="14" width="64" height="24" rx="10" class="pill" />
				<rect x="140" y="112" width="64" height="24" rx="10" class="pill" />
				<path d="M 48 38 V 72 H 172 V 112" class="kind-edge" marker-end="url(#kind-arr)" />
				<circle cx="110" cy="72" r="4" class="dummy" />
				<text x="48" y="30">source</text><text x="172" y="128">target</text>
			</svg>
			<figcaption><b>Orthogonal</b>: horizontal and vertical segments only. More bends, but every segment maps to a terminal line glyph.</figcaption>
		</figure>
	</div>
	<p>
		The dot in each figure is the dummy position chosen for the skipped layer. It guides the
		route but does not dictate the exact curve. A polyline can pass through it diagonally; an
		orthogonal route must approach and leave it on axis-aligned segments.
	</p>

	<h2>How channel routing works</h2>
	<p>
		For an orthogonal edge between adjacent layers, the basic shape is a vertical
		<b>source stub</b>, a horizontal <b>jog</b>, and a vertical <b>target stub</b>. If source and
		target ports already share an x coordinate, there is no jog and no track to allocate.
		Otherwise the jog claims an interval from one port coordinate to the other. Those coordinates
		need not be the box centres.
	</p>
	<p>
		Track assignment is therefore an interval-packing problem. Sort the jogs by their left
		endpoint. Put each on the first track whose existing intervals finish before it starts; open
		a new track only when none is free. The track count becomes part of the layer gap, so routing
		can make a drawing taller even though every node was already placed.
	</p>
	<p>
		That greedy pass decides which jogs may share a track. It does not decide the track order.
		The <em>separate but crossing</em> preset uses the minimum two tracks but orders them badly,
		so each pair of vertical stubs cuts through the other jog. Reversing the two tracks removes
		all four crossings without adding space.
	</p>
	<More id="interval-packing" summary="Side quest: why does greedy track packing work?">
		<p>
			Replace every jog by its horizontal interval. Now make a second graph: one vertex per
			interval, with an edge between two vertices when their intervals overlap. A track is a
			colour — overlapping intervals need different colours.
		</p>
		<p>
			For arbitrary graphs, finding the fewest colours is hard. Interval-overlap graphs are a
			friendlier species. At any x coordinate, count how many intervals cover it. Those intervals
			all overlap, so that count is an unavoidable lower bound on the number of tracks. Processing
			endpoints from left to right and reusing the first free track always meets that bound. The
			greedy answer is therefore optimal for this fixed set of jogs.
		</p>
		<p>
			The qualifier matters. A production router may move ports, merge branches, or add another
			bend to avoid a vertical stub crossing somebody else’s jog. Those choices change the
			intervals themselves. Greedy packing solves the track assignment after that geometry has
			been chosen; it does not solve the whole routing problem.
		</p>
	</More>

	<h2>Ports, trunks, and conflicts</h2>
	<p>
		A <b>port</b> is the exact point where an edge touches a node. Choosing a port means choosing
		a side of the box, a position along that side, and — when several ports share a side — their
		order. Those choices happen before the router assigns tracks.
	</p>
	<Term name="port">
		A connection point on a node border. A port may be free to slide along a side, fixed to one
		coordinate, or constrained to a particular side before routing begins.
	</Term>
	<p>
		Port order is a smaller version of node order. In the left figure, three free ports follow
		the targets’ left-to-right order. In the right figure, the model fixes the outer two ports in
		the opposite order. No ordinary route through the layer channel can remove the resulting
		crossing; avoiding it requires an exceptional detour around the outside.
	</p>
	<div class="row port-row">
		<figure>
			<svg viewBox="0 0 340 205" class="figsvg port-fig" role="img" aria-label="Free ports ordered to match their targets">
				<defs>
					<marker id="free-port-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
						<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
					</marker>
				</defs>
				<rect x="90" y="16" width="160" height="36" rx="12" class="pill" />
				<text x="170" y="39">producer</text>
				{#each [110, 170, 230] as x}
					<circle cx={x} cy="52" r="5" class="port-dot" />
				{/each}
				<path d="M 110 57 L 70 147" class="edge" marker-end="url(#free-port-arr)" />
				<path d="M 170 57 V 147" class="edge" marker-end="url(#free-port-arr)" />
				<path d="M 230 57 L 270 147" class="edge" marker-end="url(#free-port-arr)" />
				{#each ['A', 'B', 'C'] as n, i}
					<rect x={42 + i * 100} y="150" width="56" height="28" rx="11" class="pill" />
					<text x={70 + i * 100} y="169">{n}</text>
				{/each}
			</svg>
			<figcaption><b>Free order.</b> Ports follow A, B, C; the fan does not cross.</figcaption>
		</figure>
		<figure>
			<svg viewBox="0 0 340 205" class="figsvg port-fig" role="img" aria-label="Fixed reversed port order forces edge crossings">
				<defs>
					<marker id="fixed-port-ok-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
						<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
					</marker>
					<marker id="fixed-port-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
						<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead-up" />
					</marker>
				</defs>
				<rect x="90" y="16" width="160" height="36" rx="12" class="pill" />
				<text x="170" y="39">producer</text>
				{#each [110, 170, 230] as x}
					<circle cx={x} cy="52" r="5" class="port-dot fixed" />
				{/each}
				<path d="M 110 57 L 270 147" class="edge forced" marker-end="url(#fixed-port-arr)" />
				<path d="M 170 57 V 147" class="edge" marker-end="url(#fixed-port-ok-arr)" />
				<path d="M 230 57 L 70 147" class="edge forced" marker-end="url(#fixed-port-arr)" />
				{#each ['A', 'B', 'C'] as n, i}
					<rect x={42 + i * 100} y="150" width="56" height="28" rx="11" class="pill" />
					<text x={70 + i * 100} y="169">{n}</text>
				{/each}
			</svg>
			<figcaption><b>Fixed reversed order.</b> C, B, A forces the outer edges to cross inside the channel.</figcaption>
		</figure>
	</div>
	<p>
		A side constraint has a similar cost. A top-to-bottom flow normally enters on the north and
		leaves on the south. Requiring an east-side output may add two bends and an outer lane, but
		that detour is correct when the side identifies a real connector.
	</p>
	<p>
		Several edges can use separate ports, share one port and split immediately, or merge into one
		trunk and split later. Merging saves tracks and repeated ink, but also visually groups the
		edges. Readers may infer one relationship where the source declared three independent ones.
	</p>
	<p>
		lovely-mermaid does not expose author-defined ports today. Nodes are passed to ELK without
		port objects, so ELK chooses free attachment points on their borders; the rule-based terminal
		router likewise allocates attachment slots itself. The constraints here explain the layout
		model, not syntax that Mermaid authors can currently set.
	</p>
	<More id="port-constraints" summary="Side quest: how tightly can a port be constrained?">
		<ul>
			<li><b>Free:</b> the engine chooses side, order, and position.</li>
			<li><b>Fixed side:</b> north, east, south, or west is fixed; the port may slide on it.</li>
			<li><b>Fixed order:</b> ports keep their relative order around the node.</li>
			<li><b>Fixed ratio:</b> a port keeps a proportional position when the node is resized.</li>
			<li><b>Fixed position:</b> the exact coordinate is part of the input.</li>
		</ul>
		<p>
			Each step removes choices from crossing minimization and routing. Use the weakest
			constraint that carries the intended meaning: freedom buys compactness; constraints buy
			semantic stability.
		</p>
	</More>
	<p>
		Horizontal jogs are not the only collision. A source or target stub can cross another edge’s
		jog. Orthogonal routers call this a conflict. They may swap tracks, move a port, or insert two
		extra bends so one route detours around the crossing. Fewer bends, fewer crossings, fewer
		tracks: once again we have several prices and no universal winner.
	</p>

	<h2>Long edges and exceptional routes</h2>
	<p>
		A long edge was split into dummy nodes during layering. Routing reconnects that chain one
		channel at a time. If its dummy nodes share an x coordinate, every section can remain vertical;
		if they drift, each channel contributes another jog and possibly another track.
	</p>
	<p>
		Feedback edges do not fit the ordinary downward channels. After cycle breaking restores their
		declared direction, they need a return path: often a local route beside two adjacent layers,
		or an outer lane around several layers. Self-loops are more exceptional still. They leave and
		re-enter the same box, so engines usually place them after the main channel routes.
	</p>
	<More id="obstacle-routing" summary="Side quest: channel routing is not the only worldview">
		<p>
			Layered routing knows about layers, channels, and dummy chains. Diagram editors often start
			from the opposite situation: a human has already placed arbitrary rectangles, and each edge
			must find a path around them. There may be no layers at all.
		</p>
		<p>
			An obstacle router builds a visibility graph or a grid of free corridors, then runs a
			shortest-path search with penalties for bends and proximity to boxes. A later nudging pass
			separates routes that chose the same corridor. This decouples routing from layout, which is
			ideal for hand-positioned diagrams but throws away the strong channel structure available in
			a layered drawing.
		</p>
	</More>

	<h2>Labels need territory too</h2>
	<p>
		An edge label is geometry, not decoration. A router can reserve a rectangle for it and route
		through a label dummy, guaranteeing space but widening the channel. Or it can route first and
		place the label afterward on a clear segment, which keeps the graph compact but may force the
		label beside a vertical run or leave no good position at all.
	</p>
	<p>
		Our terminal renderer takes the second bargain. ELK routes without labels; afterward the label
		tries the longest horizontal runs, then a vertical run, then an abbreviated fallback. The
		router gets less information, but the diagram does not reserve a motorway for a two-word verb.
	</p>

	<h2>Playground</h2>
	<p>
		Edit the edges and compare the engine’s routing styles. Orthogonal routing allocates channel
		tracks; polyline routing uses direct diagonal segments; splines use Bézier control points.
		The long <code>start → render</code> edge makes each style handle a route that crosses several
		layers.
	</p>
	<p>
		ELK reruns its integrated pipeline when the style changes, so it may also adjust spacing or
		node placement to support the new routes. Compare the path geometry rather than expecting the
		boxes to remain pixel-for-pixel fixed.
	</p>
	<div class="play">
		<div class="controls">
			<textarea bind:value={playSrc} rows="15" spellcheck="false" aria-label="Graph edges"></textarea>
			<label>
				<span class="dim">routing</span>
				<select bind:value={playRouting}>
					<option value="ORTHOGONAL">orthogonal</option>
					<option value="POLYLINE">polyline</option>
					<option value="SPLINES">splines</option>
				</select>
			</label>
		</div>
		<div class="play-fig route-play">
			{#if routeFig}
				<svg viewBox="0 0 {routeFig.w} {routeFig.h}" class="routesvg" role="img" aria-label="Live edge routing result">
					<defs>
						<marker id="play-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
							<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
						</marker>
					</defs>
					{#each routeFig.routes as route}
						<path d={routePath(route, routeFig.routing)} class="route-edge" marker-end="url(#play-arr)" />
					{/each}
					{#each routeFig.nodes as n}
						<rect x={n.x} y={n.y} width={n.w} height={n.h} rx="12" class="pill" />
						<text x={n.x + n.w / 2} y={n.y + n.h / 2 + 4}>{n.label}</text>
					{/each}
				</svg>
			{:else if routeErr}
				<p class="dim">{routeErr}</p>
			{:else}
				<p class="dim">routing…</p>
			{/if}
		</div>
	</div>

	<BuildContract
		phase="Edge routing"
		receives="Placed rectangles, available ports, dummy chains, hierarchy borders, labels, and obstacle bounds."
		produces="Connected route sections, chosen attachment points, bends, tracks, and restored arrow directions."
		guarantees="Every edge reaches its declared endpoints without entering a node interior or losing a hierarchy crossing."
		baseline="Give each adjacent-layer edge a source stub, one horizontal jog, and a target stub; greedily pack overlapping jog intervals onto tracks."
		pushback="Routes require excessive tracks, bends, detours, conflicts, or leave important labels without territory."
	/>

	<h2>Takeaways</h2>
	<ul>
		<li>Routing starts from fixed layer order and cross-axis placement, then may widen layer gaps to fit tracks.</li>
		<li>Measured node width and height determine border and port coordinates; routes never attach to dimensionless points.</li>
		<li>Orthogonal routing turns each layer gap into a channel and packs overlapping jogs onto separate tracks.</li>
		<li>Ports, shared trunks, labels, and stub–jog conflicts couple local route choices; minimizing bends alone is not enough.</li>
		<li>Long edges route one channel at a time; feedback edges and self-loops need exceptional paths.</li>
		<li>Polyline, spline, and orthogonal routes express the same graph with different geometric vocabularies.</li>
	</ul>
	<p class="dim">
		Next: <a href={resolve('/learn/compound-graphs')}>compound graphs</a> — what changes when
		nodes must remain inside nested boxes.
	</p>
</div>

<style>
	.channel {
		display: block;
		width: 100%;
		max-width: 36rem;
		margin: 0 auto;
		touch-action: none;
		user-select: none;
	}
	.port-row {
		margin: 1rem 0;
	}
	.port-fig {
		max-width: 21rem;
	}
	.port-dot {
		fill: var(--bg);
		stroke: var(--accent);
		stroke-width: 2;
	}
	.port-dot.fixed {
		stroke: var(--err);
	}
	.edge.forced {
		stroke: var(--err);
		stroke-width: 2;
	}
	.channel text,
	.kindsvg text,
	.routesvg text {
		fill: var(--fg);
		font-size: 13px;
		text-anchor: middle;
	}
	.channel .track-label {
		fill: var(--dim);
		font-size: 10px;
		text-anchor: start;
	}
	.track-guide {
		stroke: var(--muted);
		stroke-width: 1;
		stroke-dasharray: 3 5;
	}
	.channel-edge {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.8;
	}
	.route-grab {
		cursor: ns-resize;
	}
	.route-grab.conflict .channel-edge {
		stroke: var(--err);
	}
	.conflict-overlap {
		stroke: var(--err);
		stroke-width: 6;
		opacity: 0.45;
		pointer-events: none;
	}
	.conflict-crossing {
		fill: var(--err);
		stroke: var(--bg);
		stroke-width: 2;
		pointer-events: none;
	}
	.route-grab.lift .channel-edge,
	.route-grab:focus .channel-edge {
		stroke-width: 3;
	}
	.route-hit {
		fill: none;
		stroke: transparent;
		stroke-width: 14;
		pointer-events: stroke;
	}
	.route-kinds {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		align-items: start;
	}
	.route-kinds figure {
		margin: 0;
	}
	.kindsvg {
		display: block;
		width: 100%;
		margin-bottom: 0.4rem;
	}
	.kind-edge,
	.route-edge {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.6;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.route-play {
		display: flex;
		min-height: 28rem;
		align-items: center;
		justify-content: center;
	}
	.routesvg {
		display: block;
		width: 100%;
		max-height: 28rem;
	}
	@media (max-width: 48rem) {
		.route-kinds {
			grid-template-columns: 1fr;
		}
		.kindsvg {
			max-width: 22rem;
			margin-inline: auto;
		}
	}
</style>
