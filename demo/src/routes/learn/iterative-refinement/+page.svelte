<script lang="ts">
	import { resolve } from '$app/paths';
	import More from '$lib/learn/More.svelte';
	import Term from '$lib/learn/Term.svelte';

	type Candidate = 'packed' | 'refined';
	let candidate = $state<Candidate>('packed');

	const sources = [90, 250, 410, 570];
	const packedTargets = [40, 100, 160, 220];
	const refinedTargets = sources;
	const tracks = [108, 108, 140, 172];
	const targets = $derived(candidate === 'packed' ? packedTargets : refinedTargets);
	const metrics = $derived(
		candidate === 'packed'
			? { lowerSpan: 230, tracks: 3, bends: 8, horizontal: 800 }
			: { lowerSpan: 530, tracks: 0, bends: 0, horizontal: 0 }
	);

	const phases = ['cycle', 'layers', 'order', 'placement', 'routing'];
</script>

<svelte:head>
	<title>Iterative refinement — lovely-mermaid learn</title>
</svelte:head>

<div class="lesson">
	<p class="dim"><a href={resolve('/learn')}>learn</a> / iterative refinement</p>
	<h1>Iterative refinement: let later phases push back</h1>
	<p class="lede">
		The pipeline gave us manageable subproblems by committing to one kind of decision at a time.
		That is a good first engine, not a law of nature. A better engine keeps its intermediate state,
		measures the complete drawing, and reopens the latest phase capable of repairing an expensive
		result.
	</p>

	<h2>Experiment: placement looked cheap</h2>
	<p>
		The four wide nodes already determine the drawing’s width. A one-pass placement packs the
		narrow lower layer against the left edge anyway: that minimizes the lower layer considered by
		itself. Routing then discovers four long horizontal jogs whose intervals overlap, so the
		channel needs three tracks.
	</p>
	<p>
		Reopen placement. Spreading the lower nodes under their partners makes that layer wider, but
		does not widen the complete drawing — the upper layer already occupies that territory. Routing
		can now use four straight segments. The local placement score got worse; the final drawing got
		better.
	</p>
	<div class="refine-controls" role="group" aria-label="Layout candidate">
		<button class="ghost" class:active={candidate === 'packed'} aria-pressed={candidate === 'packed'} onclick={() => (candidate = 'packed')}>one-pass candidate</button>
		<span class="dim">→</span>
		<button class="ghost" class:active={candidate === 'refined'} aria-pressed={candidate === 'refined'} onclick={() => (candidate = 'refined')}>reopen placement</button>
	</div>
	<ol class="phase-strip" aria-label="Pipeline checkpoints">
		{#each phases as phase}
			<li class:reopened={candidate === 'refined' && phase === 'placement'} class:rerun={candidate === 'refined' && phase === 'routing'}>
				<span>{phase}</span>
				<small>{candidate === 'refined' && phase === 'placement' ? 'changed' : candidate === 'refined' && phase === 'routing' ? 'rerun' : 'kept'}</small>
			</li>
		{/each}
	</ol>
	<figure class="refinement-figure">
		<svg viewBox="0 0 660 310" class="figsvg" role="img" aria-label={candidate === 'packed' ? 'Packed lower layer requires three routing tracks' : 'Reopened placement aligns nodes and removes routing tracks'}>
			<defs>
				<marker id="refine-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
				</marker>
			</defs>
			<rect x="10" y="14" width="640" height="68" class="band" />
			<rect x="10" y="238" width="640" height="58" class="band" />
			<text x="18" y="28" class="bandlabel">wide upper layer</text>
			<text x="18" y="252" class="bandlabel">narrow lower layer</text>
			{#each sources as x, i}
				<rect x={x - 70} y="34" width="140" height="38" rx="11" class="pill" />
				<text x={x} y="58">wide {i + 1}</text>
			{/each}
			{#each sources as sx, i}
				{@const tx = targets[i]}
				{#if candidate === 'packed'}
					<path d={`M ${sx} 72 V ${tracks[i]} H ${tx} V 256`} class="edge" marker-end="url(#refine-arr)" />
				{:else}
					<path d={`M ${sx} 72 V 256`} class="edge" marker-end="url(#refine-arr)" />
				{/if}
			{/each}
			{#if candidate === 'packed'}
				{#each [108, 140, 172] as y, i}
					<text x="646" y={y + 3} class="track-label">t{i + 1}</text>
				{/each}
			{/if}
			{#each targets as x, i}
				<rect x={x - 25} y="258" width="50" height="28" rx="10" class="pill target" />
				<text x={x} y="277">{String.fromCharCode(65 + i)}</text>
			{/each}
		</svg>
		<figcaption>
			{#if candidate === 'packed'}
				<b>One pass.</b> The lower layer is locally compact, but the overlapping jogs require three channel tracks.
			{:else}
				<b>Refined.</b> Placement uses width that already existed; routing becomes straight without changing order or overall width.
			{/if}
		</figcaption>
	</figure>
	<div class="statbar">
		<span>lower span <b>{metrics.lowerSpan}</b></span>
		<span>drawing width <b>620</b></span>
		<span class:good={metrics.tracks === 0}>tracks <b>{metrics.tracks}</b></span>
		<span class:good={metrics.bends === 0}>bends <b>{metrics.bends}</b></span>
		<span class:good={metrics.horizontal === 0}>horizontal route <b>{metrics.horizontal}</b></span>
	</div>
	<p class="verdict" class:good={candidate === 'refined'}>
		{candidate === 'packed'
			? 'Routing reports congestion → reopen placement.'
			: 'Accept: the complete candidate improves without widening the drawing.'}
	</p>
	<Term name="checkpoint">
		A saved, consistent layout state at a phase boundary. It includes enough provenance to run the
		next phase again: reversed edges, dummy ownership, layer order, port constraints, and whatever
		earlier decisions remain valid — not coordinates alone.
	</Term>

	<h2>The pipeline is a dependency graph</h2>
	<p>
		Backtracking does not mean erasing everything and starting over. A changed output invalidates
		only the phases that consume it. In the experiment, layers and orders remain valid; new
		coordinates invalidate routing, so routing runs again.
	</p>
	<div class="table-wrap">
		<table>
			<thead><tr><th>Change</th><th>Keep</th><th>Invalidate and rerun</th></tr></thead>
			<tbody>
				<tr><td>reversed edges</td><td>measured nodes, hierarchy</td><td>layering onward</td></tr>
				<tr><td>layers or dummy chains</td><td>orientation</td><td>ordering onward</td></tr>
				<tr><td>order within a layer</td><td>orientation, layers</td><td>placement onward</td></tr>
				<tr><td>coordinates or node gaps</td><td>orientation, layers, order</td><td>routing and grid conversion</td></tr>
				<tr><td>routes or ports</td><td>all node geometry</td><td>labels and grid conversion</td></tr>
			</tbody>
		</table>
	</div>
	<p>
		A hierarchy constraint can touch every row in that table. Treat it as part of the graph state,
		not as decoration attached after ordinary layout finishes.
	</p>

	<h2>Information goes forward; diagnostics go backward</h2>
	<p>
		Before adding a feedback loop, ask whether the late phase discovered anything new. Measured node
		sizes, fixed port order, cluster membership, and important-edge weights are known before layout.
		Pass them forward. If routing is the first phase told about fixed ports, reopening crossing
		minimization merely repairs a broken interface.
	</p>
	<p>
		Other costs exist only after geometry is concrete: the maximum number of overlapping jog
		intervals, actual bend count, available label segments, frame inflation, and snapping damage.
		These are diagnostics. Each should name the latest phase capable of repairing it and carry the
		evidence needed for a targeted repair.
	</p>
	<Term name="invalidation">
		Marking derived state stale because one of its inputs changed. Explicit invalidation prevents a
		particularly entertaining class of bugs: displaying new nodes with yesterday’s routes.
	</Term>

	<h2>Three refinement tools</h2>
	<h3>Repair locally</h3>
	<p>
		Start at the latest possible phase. Swap two route tracks, slide a free port, move a label to a
		clear segment, or repair one snapped seam. Local repair preserves more of the drawing and is
		usually cheap.
	</p>
	<h3>Alternate between coupled phases</h3>
	<p>
		Some objectives belong to two phases. Placement changes route congestion; routing reveals which
		alignments matter. Optimize placement while order is fixed, reroute, then use the routing
		diagnostics for another placement pass. Stop when neither pass improves the complete candidate.
	</p>
	<Term name="coordinate descent">
		Optimize one block of decisions while holding the others fixed, then rotate to the next block.
		Here the “coordinates” may be discrete orders or port assignments, not only x and y numbers.
	</Term>
	<h3>Keep several complete candidates</h3>
	<p>
		Cycle breaking, layering, and ordering are discrete choices with large downstream effects. For
		those, keep a small portfolio: several reversals, layerings, or sweep starts. Complete each
		candidate through routing and compare final drawings. This is a bounded search, not a promise to
		find the global optimum before the heat death of the universe.
	</p>
	<More id="refinement-search" summary="Side quest: beam search and large-neighbourhood repair">
		<p>
			A beam search retains the best <code>k</code> partial candidates after each discrete phase.
			Unlike one greedy choice, it can preserve a slightly worse layering that later routes much
			better. The beam width is the explicit quality–runtime budget.
		</p>
		<p>
			Large-neighbourhood repair keeps most of one complete drawing fixed, releases a troublesome
			region — perhaps two layers and the routes between them — and solves that region again. Routing
			calls the same idea <em>rip up and reroute</em>. Both are useful when a local swap is too small
			and a whole-pipeline restart is wasteful.
		</p>
	</More>

	<h2>Score complete drawings</h2>
	<p>
		A phase-local score is evidence, not the verdict. The widget’s packed lower layer wins on its own
		span and loses on the complete route. Candidate acceptance must therefore inspect the final
		drawing.
	</p>
	<p>
		Use a lexicographic objective. First reject invalid candidates: overlap, disconnected routes,
		broken containment, or lost required labels. Then compare semantic damage, crossings, route
		congestion, dimensions, bends, and movement from the previous drawing in the order appropriate
		to the product. A weighted sum too easily lets ten tidy bends purchase one missing label.
	</p>
	<Term name="lexicographic objective">
		Compare the most important metric first; inspect the next only when the first ties. Hard rules
		can therefore never be traded for enough small aesthetic wins.
	</Term>
	<More id="refinement-stability" summary="Why stability belongs in the score">
		<p>
			For an editor or streaming renderer, a drawing is compared with its previous frame as well as
			with abstract perfection. Penalize unnecessary changes to reversals, layer assignments, order,
			and coordinates. Otherwise adding one leaf can produce a globally “better” drawing in which
			every familiar node jumps somewhere new.
		</p>
		<p>
			Stability comes after validity and important readability constraints. Freezing a bad old layout
			forever is stable in the same sense that a fossil is stable.
		</p>
	</More>

	<h2>A small refinement controller</h2>
	<p>
		The engine needs explicit phase state, diagnostics, invalidation, and comparison. The controller
		can remain small:
	</p>
	<pre><code>best = complete(seed)

for attempt in 1..budget:
    problem = worstDiagnostic(best)
    phase = latestResponsiblePhase(problem)
    candidate = restore(best.checkpoint.before(phase))
    repair(candidate, problem)
    completeFrom(candidate, phase)

    if compare(candidate, best) &lt; 0:
        best = candidate

return best</code></pre>
	<p>
		Keep the best complete candidate, not merely the latest one. Require strict improvement, hash
	
discrete states to avoid revisiting them, use deterministic tie-breaking, and stop after a fixed
		budget. Those four rules turn a feedback loop into an algorithm instead of an oscillation with
		excellent logging.
	</p>

	<h2>Takeaways</h2>
	<ul>
		<li>The one-way layered pipeline is a useful baseline, not a restriction a better engine must preserve.</li>
		<li>Known constraints flow forward; downstream geometry returns diagnostics backward.</li>
		<li>Reopen the latest phase capable of fixing the problem, then invalidate only its descendants.</li>
		<li>Judge complete candidates. A phase can improve its local objective while making the drawing worse.</li>
		<li>Bound the search, retain best-so-far, prevent repeated states, and include stability in the objective.</li>
	</ul>
	<p class="dim">
		Previous: <a href={resolve('/learn/terminal-grid')}>the terminal grid</a>. The pipeline now has a
		controller: build a candidate, listen to what failed downstream, and revise the responsible
		decision.
	</p>
</div>

<style>
	.refine-controls {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		justify-content: center;
		margin: 1rem 0 0.7rem;
	}
	.refine-controls .active {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 0.25em;
	}
	.phase-strip {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 0.4rem;
		margin: 0 0 0.8rem;
		padding: 0;
		list-style: none;
	}
	.phase-strip li {
		padding: 0.35rem 0.45rem;
		border-bottom: 2px solid var(--muted);
		text-align: center;
	}
	.phase-strip small {
		display: block;
		color: var(--dim);
	}
	.phase-strip .reopened {
		border-color: var(--purple);
	}
	.phase-strip .rerun {
		border-color: var(--accent);
	}
	.refinement-figure {
		margin: 0;
	}
	.refinement-figure .figsvg {
		max-width: 41rem;
		border: 1px solid var(--muted);
		border-radius: 6px;
		background: var(--term-bg);
	}
	svg .track-label {
		fill: var(--dim);
		font-size: 10px;
		text-anchor: end;
	}
	.target {
		stroke: var(--purple);
	}
	.verdict {
		margin: 0.5rem 0 1rem;
		color: var(--err);
		text-align: center;
	}
	.verdict.good {
		color: var(--accent);
	}
	h3 {
		margin: 1.5rem 0 0.2rem;
		font-size: 1rem;
	}
	.table-wrap {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.92rem;
	}
	th,
	td {
		padding: 0.45rem 0.55rem;
		border-bottom: 1px solid var(--muted);
		text-align: left;
		vertical-align: top;
	}
	th {
		color: var(--accent);
		font-weight: normal;
	}
	pre {
		overflow-x: auto;
		padding: 0.8rem 1rem;
		border: 1px solid var(--muted);
		border-radius: 5px;
		background: var(--custom-bg);
		font: inherit;
		font-size: 0.9rem;
		line-height: 1.5;
	}
	pre code {
		padding: 0;
		background: none;
	}
</style>
