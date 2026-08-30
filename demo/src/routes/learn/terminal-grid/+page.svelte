<script lang="ts">
	import { resolve } from '$app/paths';
	import BuildContract from '$lib/learn/BuildContract.svelte';
	import DiagramViewer from '$lib/DiagramViewer.svelte';
	import More from '$lib/learn/More.svelte';
	import Term from '$lib/learn/Term.svelte';
	import { clusters, clusterWidth } from 'lovely-ansi-svg';

	// ---- snapping experiment ----------------------------------------------
	const GRID_LINES = Array.from({ length: 9 }, (_, i) => i);
	const ROW_LINES = Array.from({ length: 7 }, (_, i) => i);
	const CELL = 30;
	let drift = $state(0.3);
	const floatEndX = $derived(5.4 + drift);
	const naiveEndX = $derived(Math.round(floatEndX));
	const naiveInvalid = $derived(naiveEndX !== 5);
	const point = (ox: number, x: number, y: number): string => `${ox + x * CELL},${40 + y * CELL}`;

	// ---- display-width experiment -----------------------------------------
	let label = $state('A界é👨‍👩‍👧');
	const measuredLabel = $derived(
		[...clusters(label)].map((text) => ({ text, width: clusterWidth(text) })).filter((c) => c.width > 0)
	);
	const labelColumns = $derived(measuredLabel.reduce((n, c) => n + c.width, 0));

	// ---- direction-bit experiment -----------------------------------------
	const U = 1;
	const D = 2;
	const L = 4;
	const R = 8;
	const GLYPHS = ['·', '│', '│', '│', '─', '┘', '┐', '┤', '─', '└', '┌', '├', '─', '┴', '┬', '┼'];
	let mask = $state(L | R);
	const bitNames = $derived(
		[
			[U, 'U'],
			[D, 'D'],
			[L, 'L'],
			[R, 'R']
		]
			.filter(([bit]) => mask & (bit as number))
			.map(([, name]) => name)
			.join(' | ') || 'none'
	);
	const toggle = (bit: number): void => {
		mask ^= bit;
	};

	// ---- live playground ---------------------------------------------------
	const JUNCTIONS = `A[start] --> M[merge]
B[cache] --> M
M --> C[ship]
M --> D[log]`;
	const WIDE = `A[compile 界] -->|validates output| B[ship 👨‍👩‍👧]
A --> C[é cache]
C --> B`;
	const FRAME = `subgraph S[service]
  parse --> validate
  validate --> store
end
request --> parse
store --> done`;
	let playBody = $state(JUNCTIONS);
	let playDir = $state('TD');
	const playSrc = $derived(`flowchart ${playDir}\n${playBody}`);
</script>

<svelte:head>
	<title>The terminal grid — lovely-mermaid learn</title>
</svelte:head>

<div class="lesson">
	<p class="dim"><a href={resolve('/learn')}>learn</a> / the terminal grid</p>
	<h1>The terminal grid: geometry becomes cells</h1>
	<p class="lede">
		ELK gives us floating-point rectangles and polylines. A terminal gives us integer rows and
		display columns, with one glyph per cell and no sub-pixel anything. Converting between them is
		a final geometry pass: snap coordinates, repair routes, resolve junctions, and make text occupy
		exactly the cells reserved for it.
	</p>
	<Term name="character cell / display column">
		A terminal screen is a rectangular grid. Rows are uniform, but one visible text unit may occupy
		one or two display columns; a zero-width grapheme occupies none. “Character” and JavaScript
		string index are not useful units for layout.
	</Term>

	<h2>Experiment: rounding can break a route</h2>
	<p>
		The dashed route below is two ELK sections joined across a hierarchy boundary. The second
		section is intended to be vertical, but its x coordinate has a small drift. Move the drift
		across a rounding threshold. Independent rounding can turn the vertical section into a diagonal
		that the terminal cannot draw in one run.
	</p>
	<label class="drift-control">
		<span>section drift</span>
		<input type="range" min="-0.4" max="0.5" step="0.1" bind:value={drift} />
		<output>{drift >= 0 ? '+' : ''}{drift.toFixed(1)}</output>
	</label>
	<svg viewBox="0 0 720 250" class="snap-fig" role="img" aria-label="Naive rounding compared with orientation-preserving snapping">
		{#each [20, 380] as ox, panel}
			<text x={ox + 120} y="20" class="panel-title">{panel === 0 ? 'round each point' : 'preserve segment direction'}</text>
			{#each GRID_LINES as i}
				<line x1={ox + i * CELL} y1="40" x2={ox + i * CELL} y2="220" class="gridline" />
			{/each}
			{#each ROW_LINES as i}
				<line x1={ox} y1={40 + i * CELL} x2={ox + 240} y2={40 + i * CELL} class="gridline" />
			{/each}
			<polyline
				points={`${point(ox, 1.4, 1.4)} ${point(ox, 5.4, 1.4)} ${point(ox, floatEndX, 5.4)}`}
				class="float-route"
			/>
			<path d={`M ${point(ox, 1, 1)} L ${point(ox, 5, 1)}`} class="snapped-route" />
			<path
				d={`M ${point(ox, 5, 1)} L ${point(ox, panel === 0 ? naiveEndX : 5, 5)}`}
				class="snapped-route"
				class:invalid={panel === 0 && naiveInvalid}
			/>
			<circle cx={ox + 5 * CELL} cy={40 + CELL} r="5" class="snap-point" />
			<circle cx={ox + (panel === 0 ? naiveEndX : 5) * CELL} cy={40 + 5 * CELL} r="5" class="snap-point" />
		{/each}
	</svg>
	<div class="statbar">
		<span>independent rounding: <b class:bad={naiveInvalid}>{naiveInvalid ? '1 diagonal' : 'orthogonal'}</b></span>
		<span>direction-preserving: <b class="good">orthogonal</b></span>
	</div>
	<p>
		The repair is small. For each segment we first ask which axis changed most in the floating-point
		result. A mostly vertical segment inherits the previous point’s snapped x; a mostly horizontal
		one inherits its y. Consecutive duplicate points are then removed. We preserve ELK’s intended
		direction instead of pretending a diagonal box-drawing glyph exists.
	</p>

	<h2>Parity keeps aligned centres on the grid</h2>
	<p>
		Node centres guide both placement and edge attachment. If a box starts on an integer coordinate,
		an odd geometric width puts its centre on a half coordinate; an even width keeps it integral.
		Mix those parities in an aligned column and rounding may send a route stub one cell left at one
		end and one cell right at the other.
	</p>
	<div class="row parity-row">
		<figure>
			<svg viewBox="0 0 300 150" class="figsvg parity-fig" role="img" aria-label="Odd width puts the box centre on a half coordinate">
				<rect x={20 + 2 * 24} y="55" width={7 * 24} height="48" class="parity-box odd" />
				{#each Array.from({ length: 11 }, (_, i) => i) as i}
					<line x1={20 + i * 24} y1="28" x2={20 + i * 24} y2="126" class="gridline" />
				{/each}
				<line x1={20 + 5.5 * 24} y1="38" x2={20 + 5.5 * 24} y2="120" class="centre-line" />
				<text x="150" y="22">width 7</text>
				<text x={20 + 5.5 * 24} y="143" class="coord">centre x = 5.5</text>
			</svg>
			<figcaption><b>Odd width.</b> Centre falls halfway between integer coordinates.</figcaption>
		</figure>
		<figure>
			<svg viewBox="0 0 300 150" class="figsvg parity-fig" role="img" aria-label="Even width keeps the box centre on an integer coordinate">
				<rect x={20 + 2 * 24} y="55" width={8 * 24} height="48" class="parity-box even" />
				{#each Array.from({ length: 11 }, (_, i) => i) as i}
					<line x1={20 + i * 24} y1="28" x2={20 + i * 24} y2="126" class="gridline" />
				{/each}
				<line x1={20 + 6 * 24} y1="38" x2={20 + 6 * 24} y2="120" class="centre-line" />
				<text x="150" y="22">width 8</text>
				<text x={20 + 6 * 24} y="143" class="coord">centre x = 6</text>
			</svg>
			<figcaption><b>Even width.</b> Centre and aligned route stay on one integer column.</figcaption>
		</figure>
	</div>
	<p>
		We therefore round every measured node width up to an even number before layout. This is not
		padding for appearance. It removes an entire class of one-cell snapping artifacts before ELK
		can create them.
	</p>
	<p>
		Port coordinates arrive in the same floating-point geometry as route endpoints. By this stage
		ELK has already chosen any free port position; we snap that endpoint to the corresponding
		border cell and keep the final segment attached to it. Explicit fixed ports would use the
		same conversion — less freedom during layout, no special glyph on the grid.
	</p>
	<More id="grid-half-open" summary="Why do arrowheads need a one-cell correction?">
		<p>
			ELK rectangles are geometric and half-open: a box at <code>x</code> with width <code>w</code>
			extends to <code>x + w</code>. The left coordinate maps to the left border cell, while the
			right coordinate is one position beyond the right border cell. Top and bottom behave the same
			way.
		</p>
		<p>
			When an edge approaches from the left or top, its endpoint already names the border cell. When
			it approaches from the right or bottom, we subtract one cell before drawing the arrowhead. One
			formula for all four sides would put half the arrows inside their boxes and half outside. Very
			democratic; not very useful.
		</p>
	</More>

	<h2>Text width is not string length</h2>
	<p>
		Coordinates are only honest if labels reserve the same number of columns they later paint.
		JavaScript counts UTF-16 code units. Terminals display grapheme clusters: a base plus combining
		marks is one visible unit, a family emoji joined from several code points is one unit, and CJK
		or emoji usually occupies two columns.
	</p>
	<p>
		This measurement happens before node placement. Ordinary labels wrap at 24 display columns
		over at most four lines; the widest line sets the box width and the line count sets its
		height. We then add borders and padding and round the width to even before handing the
		rectangle to ELK. The box drawn at the end uses those same measurements.
	</p>
	<div class="width-lab">
		<input bind:value={label} aria-label="Label to measure" spellcheck="false" />
		<div class="width-stats">
			<span>JS length: <b>{label.length}</b></span>
			<span>code points: <b>{[...label].length}</b></span>
			<span>graphemes: <b>{measuredLabel.length}</b></span>
			<span>display columns: <b class="good">{labelColumns}</b></span>
		</div>
		<div class="cell-strip" aria-label={`${labelColumns} display columns`}>
			{#each measuredLabel as cluster}
				<span style={`grid-column: span ${cluster.width}`} title={`${cluster.width} column${cluster.width === 1 ? '' : 's'}`}>
					{cluster.text}<small>{cluster.width}</small>
				</span>
			{/each}
		</div>
	</div>
	<p>
		We segment with <code>Intl.Segmenter</code>, measure each cluster with Unicode width data, and
		paint that same cluster as one unit. A two-column cluster claims a hidden continuation cell so
		the next glyph cannot overwrite its second column; only the visible cluster is emitted in the
		final string. Measure and paint disagreeing is how an emoji escapes its own box.
	</p>

	<h2>Edges are direction bits before they are glyphs</h2>
	<p>
		Drawing <code>─</code> immediately loses information: a later vertical edge would need to know
		that the cell already connects left and right. Instead each edge contributes any of four bits —
		up, down, left, right — to every cell it traverses. Toggle the bits below. The glyph is chosen
		only after all edges have landed.
	</p>
	<div class="junction-lab">
		<button class="ghost bit-up" class:active={Boolean(mask & U)} aria-pressed={Boolean(mask & U)} onclick={() => toggle(U)}>↑ U</button>
		<button class="ghost bit-left" class:active={Boolean(mask & L)} aria-pressed={Boolean(mask & L)} onclick={() => toggle(L)}>← L</button>
		<div class="junction-cell">{GLYPHS[mask]}</div>
		<button class="ghost bit-right" class:active={Boolean(mask & R)} aria-pressed={Boolean(mask & R)} onclick={() => toggle(R)}>R →</button>
		<button class="ghost bit-down" class:active={Boolean(mask & D)} aria-pressed={Boolean(mask & D)} onclick={() => toggle(D)}>D ↓</button>
	</div>
	<p class="junction-readout"><code>{bitNames}</code> = <b>{mask}</b> → <span>{GLYPHS[mask]}</span></p>
	<p>
		Bitwise OR is independent of draw order, so horizontal-then-vertical and
		vertical-then-horizontal both become <code>┼</code>. Three directions become the appropriate tee;
		two adjacent directions become a corner. Dotted and thick styles travel beside the mask and are
		applied during the same finalization pass.
	</p>
	<Term name="direction mask">
		Four yes/no flags stored in one number: <code>U=1</code>, <code>D=2</code>, <code>L=4</code>,
		<code>R=8</code>. Combining flags records every direction connected through a cell without
		choosing a glyph too early.
	</Term>

	<h2>Not every cell is available to an edge</h2>
	<p>
		The grid is also an occupancy map. Node interiors are marked occupied, so ordinary edge segments
		cannot overwrite them. A frame border is different: a cross-boundary route may pierce it, and
		the border’s existing directions merge with the edge mask. Text cells refuse piercing because
		turning the <code>v</code> in <code>service</code> into a junction would be memorable for the wrong
		reason.
	</p>
	<div class="cell-rules">
		<div><span class="sample blank">·</span><b>blank</b><small>edge may claim it</small></div>
		<div><span class="sample node">x</span><b>node interior</b><small>occupied; edge refused</small></div>
		<div><span class="sample border">━</span><b>frame border</b><small>pierce and merge</small></div>
		<div><span class="sample text">v</span><b>text</b><small>text wins</small></div>
	</div>
	<p>
		Nested frames add one more per-cell value: depth. The viewer can tint cells by that depth without
		changing the plain text. Roles, author classes, links, and frame depth all travel as span metadata;
		the geometry remains theme-independent.
	</p>

	<h2>Labels reserve cells after routing</h2>
	<p>
		Our ELK input deliberately omits edge labels. Giving labels to the layout engine reserves large
		corridors and spreads the graph. After routing, we try the longest horizontal runs first and
		slide the label to a stretch free of boxes, crossings, and other labels. If none fits, we try a
		vertical run; only the last resort is an ellipsised label beside the edge.
	</p>
	<div class="row label-row">
		<figure>
			<pre>──── validates ────▶</pre>
			<figcaption><b>Horizontal run.</b> Text replaces cells in the line.</figcaption>
		</figure>
		<figure>
			<pre>       │
    retry
       │</pre>
			<figcaption><b>Vertical run.</b> Text straddles and interrupts the stroke.</figcaption>
		</figure>
	</div>
	<p>
		Painting a label clears the direction mask under every occupied display column before storing
		the text. Otherwise finalizing the mask afterward would put the edge straight back through the
		letters. This ordering — routes, labels, glyph resolution — is part of the algorithm.
	</p>
	<More id="grid-flips" summary="How do bottom-to-top and right-to-left avoid mirrored text?">
		<p>
			The layout is computed in the corresponding forward orientation, then the finished canvas is
			flipped. Box-drawing glyphs are remapped: <code>┌</code> becomes <code>┐</code> in a horizontal
			flip, and arrowheads reverse.
		</p>
		<p>
			A horizontal flip also reverses every row. We identify contiguous text and edge-label runs and
			reverse those runs back, while leaving user-authored glyphs untouched. Geometry mirrors; words
			keep reading normally.
		</p>
	</More>

	<h2>Playground</h2>
	<p>
		The textarea is the body of a live flowchart; the direction control supplies its header. Try the
		wide-label preset, change direction, then add three edges into one node. The dimension badge is
		the widest painted row by the number of emitted rows — exactly what a terminal caller needs to
		decide whether the result fits.
	</p>
	<div class="statbar presetbar">
		<button class="ghost" onclick={() => (playBody = JUNCTIONS)}>junctions</button>
		<button class="ghost" onclick={() => (playBody = WIDE)}>wide labels</button>
		<button class="ghost" onclick={() => (playBody = FRAME)}>frame piercing</button>
	</div>
	<div class="play">
		<div class="controls">
			<textarea bind:value={playBody} rows="12" spellcheck="false" aria-label="Flowchart body"></textarea>
			<label>
				<span class="dim">direction</span>
				<select bind:value={playDir}>
					<option>TD</option>
					<option>BT</option>
					<option>LR</option>
					<option>RL</option>
				</select>
			</label>
		</div>
		<div class="play-fig"><DiagramViewer src={playSrc} /></div>
	</div>

	<BuildContract
		phase="Terminal conversion"
		receives="Measured labels, floating-point rectangles and routes, ports, frame depth, and semantic metadata."
		produces="An integer cell canvas with occupancy, direction masks, glyphs, text runs, and metadata."
		guarantees="Connected geometry stays connected and every painted grapheme occupies the display columns reserved for it."
		baseline="Measure and wrap labels, snap rectangles, rasterize orthogonal segments into direction bits, then choose junction glyphs last."
		pushback="Snapping disconnects a route, labels disappear, borders collide, or the final width exceeds the caller’s useful budget."
	/>

	<h2>Takeaways</h2>
	<ul>
		<li>Labels are measured and wrapped first; their resulting rectangles constrain every later layout phase.</li>
		<li>Snapping is geometry: preserve segment orientation, then remove collapsed points.</li>
		<li>Even node widths keep aligned centres and route stubs on integer columns.</li>
		<li>Grapheme clusters are measured and painted as the same zero-, one-, or two-column units.</li>
		<li>Edges accumulate direction masks; glyphs are chosen only after every route is present.</li>
		<li>Occupancy, borders, labels, and frame depth all live on the cell grid.</li>
	</ul>
	<p class="dim">
		Next: <a href={resolve('/learn/iterative-refinement')}>iterative refinement</a> — the first
		complete drawing reports which earlier decisions deserve another try.
	</p>
</div>

<style>
	.drift-control {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		justify-content: center;
		margin: 1rem 0 0.4rem;
		color: var(--dim);
	}
	.drift-control input {
		width: 16rem;
	}
	.drift-control output {
		width: 2.8rem;
		color: var(--fg);
	}
	.snap-fig {
		display: block;
		width: 100%;
		max-width: 46rem;
		margin: 0 auto;
	}
	.snap-fig text,
	.parity-fig text {
		fill: var(--fg);
		font-size: 12px;
		text-anchor: middle;
	}
	.gridline {
		stroke: var(--muted);
		stroke-width: 0.7;
		opacity: 0.55;
	}
	.float-route {
		fill: none;
		stroke: var(--purple);
		stroke-width: 2;
		stroke-dasharray: 5 4;
	}
	.snapped-route {
		fill: none;
		stroke: var(--accent);
		stroke-width: 3;
	}
	.snapped-route.invalid {
		stroke: var(--err);
	}
	.snap-point {
		fill: var(--bg);
		stroke: var(--fg);
		stroke-width: 2;
	}
	.panel-title {
		fill: var(--dim) !important;
	}
	.bad {
		color: var(--err);
	}
	.parity-row {
		margin-top: 1rem;
	}
	.parity-fig {
		max-width: 20rem;
	}
	.parity-box {
		fill: color-mix(in srgb, var(--purple) 10%, var(--custom-bg));
		stroke: var(--fg);
	}
	.parity-box.even {
		fill: color-mix(in srgb, var(--accent) 10%, var(--custom-bg));
	}
	.centre-line {
		stroke: var(--accent);
		stroke-width: 2;
		stroke-dasharray: 4 3;
	}
	.coord {
		fill: var(--dim) !important;
		font-size: 10px !important;
	}
	.width-lab {
		margin: 1rem 0;
		padding: 0.8rem;
		border: 1px solid var(--muted);
		border-radius: 5px;
	}
	.width-lab > input {
		box-sizing: border-box;
		width: 100%;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--muted);
		border-radius: 3px;
		background: var(--custom-bg);
		color: var(--fg);
		font: inherit;
	}
	.width-stats {
		display: flex;
		gap: 1.4rem;
		flex-wrap: wrap;
		margin: 0.7rem 0;
		color: var(--dim);
	}
	.cell-strip {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 2.5rem;
		justify-content: start;
	}
	.cell-strip > span {
		position: relative;
		min-height: 2.6rem;
		border: 1px solid var(--muted);
		background: color-mix(in srgb, var(--accent) 7%, transparent);
		font-size: 1.25rem;
		line-height: 2.6rem;
		text-align: center;
	}
	.cell-strip small {
		position: absolute;
		right: 3px;
		bottom: -9px;
		color: var(--dim);
		font-size: 9px;
		line-height: 1;
	}
	.junction-lab {
		display: grid;
		grid-template-columns: 5rem 5rem 5rem;
		grid-template-rows: 3rem 5rem 3rem;
		align-items: center;
		justify-content: center;
		margin: 1rem auto 0;
		text-align: center;
	}
	.junction-lab .active {
		color: var(--accent);
		font-weight: bold;
	}
	.bit-up {
		grid-column: 2;
	}
	.bit-left {
		grid-row: 2;
	}
	.bit-right {
		grid-column: 3;
		grid-row: 2;
	}
	.bit-down {
		grid-column: 2;
		grid-row: 3;
	}
	.junction-cell {
		grid-column: 2;
		grid-row: 2;
		font-size: 4rem;
		line-height: 1;
	}
	.junction-readout {
		margin-top: 0;
		text-align: center;
	}
	.junction-readout span {
		color: var(--accent);
		font-size: 1.5rem;
	}
	.cell-rules {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.7rem;
		margin: 1rem 0;
	}
	.cell-rules > div {
		display: grid;
		grid-template-columns: 2.5rem 1fr;
		align-items: center;
		padding: 0.6rem;
		border: 1px solid var(--muted);
		border-radius: 4px;
	}
	.cell-rules small {
		grid-column: 2;
		color: var(--dim);
	}
	.sample {
		grid-row: 1 / 3;
		font-size: 1.7rem;
	}
	.sample.border {
		color: var(--purple);
	}
	.sample.node,
	.sample.text {
		color: var(--err);
	}
	.label-row {
		margin-top: 1rem;
	}
	.label-row pre {
		margin: 0 0 0.4rem;
		padding: 1.2rem;
		border: 1px solid var(--muted);
		border-radius: 4px;
		color: var(--accent);
		font: inherit;
		text-align: center;
	}
	.presetbar {
		margin-bottom: 0.8rem;
	}
	.play-fig {
		height: 31rem;
		border: 1px solid var(--muted);
		border-radius: 6px;
		overflow: hidden;
	}
	@media (max-width: 48rem) {
		.cell-rules {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
