<script lang="ts">
	import type { Snippet } from 'svelte';

	// A fold for optional depth. The open state is kept in sessionStorage per
	// id, so it survives reloads and HMR while you are reading.
	let {
		id,
		summary = 'I want to learn more',
		children
	}: { id: string; summary?: string; children: Snippet } = $props();
	const key = $derived(`learn-more:${id}`);
	let open = $state(false);
	$effect(() => {
		open = sessionStorage.getItem(key) === '1';
	});
</script>

<details
	class="more"
	bind:open
	ontoggle={(e) => {
		// The DOM property, not the bound state: this handler can run before
		// bind:open's listener updates `open`, which would persist the stale
		// value (open would store '0').
		sessionStorage.setItem(key, e.currentTarget.open ? '1' : '0');
	}}
>
	<summary>{summary}</summary>
	{@render children()}
</details>

<style>
	.more {
		margin: 0.8rem 0;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--muted);
		border-radius: 5px;
	}
	.more summary {
		cursor: pointer;
		color: var(--cmd);
		user-select: none;
	}
	.more[open] summary {
		margin-bottom: 0.4rem;
	}
</style>
