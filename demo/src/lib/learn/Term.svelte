<script lang="ts">
	import type { Snippet } from 'svelte';

	// A terminology admonition for the /learn pages: introduced where the
	// term first appears, so paragraphs don't stop to define words. With
	// `href` it doubles as a reference card — the name links to the source
	// (paper, article) and the body is a 1–2 line summary.
	let { name, href, children }: { name: string; href?: string; children: Snippet } = $props();
</script>

<aside class="term" class:reference={href !== undefined}>
	{#if href}
		<a class="name" {href} target="_blank" rel="noreferrer">{name} ↗</a>
	{:else}
		<span class="name">{name}</span>
	{/if}
	<span class="def">{@render children()}</span>
</aside>

<style>
	/* Run-in layout: the name leads the line and the definition flows after
	   it, so long names (three-author reference cards) don't squeeze the
	   text into a narrow column. */
	.term {
		display: block;
		margin: 0.9rem 0;
		padding: 0.55rem 0.75rem;
		border: 1px dashed var(--muted);
		border-radius: 5px;
		font-size: 0.9rem;
		color: var(--dim);
	}
	.term.reference {
		border: 0;
		border-left: 2px solid var(--muted);
		border-radius: 0;
		padding-block: 0.25rem;
	}
	.name {
		color: var(--purple);
		font-weight: bold;
		margin-right: 0.7rem;
	}
	a.name {
		text-decoration: none;
	}
	a.name:hover {
		text-decoration: underline;
	}
	.def :global(code) {
		font-size: 0.92em;
		background: var(--custom-bg);
		border-radius: 3px;
		padding: 0 0.25em;
	}
</style>
