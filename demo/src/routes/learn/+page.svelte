<script lang="ts">
	import { resolve } from '$app/paths';

	const topics = [
		{
			href: '/learn/drawing-graphs',
			title: 'Drawing graphs',
			blurb: 'what layout is, the algorithm families, why layered wins for directed graphs'
		},
		{
			href: '/learn/cycle-breaking',
			title: 'Cycle breaking',
			blurb: 'why some arrows point the "wrong" way'
		},
		{
			href: '/learn/layering',
			title: 'Layering',
			blurb: 'rows, dummy nodes, and the hidden cost of long edges'
		},
		{
			href: '/learn/crossing-minimization',
			title: 'Crossing minimization',
			blurb: 'ordering nodes within each layer'
		},
		{
			href: '/learn/node-placement',
			title: 'Node placement',
			blurb: 'turning orders into coordinates; the width-vs-straightness trade'
		},
		{
			href: '/learn/edge-routing',
			title: 'Edge routing',
			blurb: 'channels, tracks, and orthogonal lines'
		},
		{
			href: '/learn/compound-graphs',
			title: 'Compound graphs',
			blurb: 'nested boxes, border-crossing edges'
		},
		{
			href: '/learn/terminal-grid',
			title: 'The terminal grid',
			blurb: 'from float coordinates to character cells'
		},
		{
			href: '/learn/iterative-refinement',
			title: 'Iterative refinement',
			blurb: 'letting downstream costs reopen earlier decisions'
		}
	] as const;
</script>

<svelte:head>
	<title>lovely-mermaid — learn</title>
</svelte:head>

<div class="page">
	<h1><span class="accent">lovely-mermaid</span> <span class="dim">/ learn</span></h1>
	<p class="dim">
		How to build a layered graph layout engine, one decision at a time — live experiments expose
		the state, invariants, trade-offs, and feedback loops.
	</p>
	<ol start="0">
		{#each topics as t}
			<li>
				<a href={resolve(t.href)}>{t.title}</a>
				<span class="dim">— {t.blurb}</span>
			</li>
		{/each}
	</ol>
</div>

<style>
	.page {
		max-width: 46rem;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
	}
	h1 {
		font-size: 1.2rem;
		font-weight: normal;
	}
	.accent {
		color: var(--accent);
	}
	.dim {
		color: var(--dim);
	}
	ol {
		line-height: 2;
	}
	a {
		color: var(--cmd);
	}
</style>
