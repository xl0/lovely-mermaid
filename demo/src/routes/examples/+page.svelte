<script lang="ts">
	import { base } from '$app/paths';
	import { packHash, unpackHash } from '$lib/hash';
	import { SvelteSet } from 'svelte/reactivity';
	import type { LayoutOptions } from 'lovely-mermaid-engine';
	import DiagramViewer from '$lib/DiagramViewer.svelte';
	import Options from '$lib/lab/Options.svelte';
	import { defaultThemes } from '$lib/theme';

	// The repo's standing test corpus, inlined at build time.
	const files = import.meta.glob('../../../../examples/*.mmd', {
		query: '?raw',
		import: 'default',
		eager: true
	}) as Record<string, string>;
	const diagrams = Object.entries(files)
		.map(([path, src]) => ({ name: path.split('/').pop()!.replace(/\.mmd$/, ''), src }))
		.sort((a, b) => a.name.localeCompare(b.name));

	let renderer = $state<'engine' | 'lovely' | 'mermaid'>('engine');
	let elkOn = $state(true);
	let engineOpts = $state<LayoutOptions>({});
	let engineMenuOpen = $state(false);
	let fitWidth = $state<number | null>(null);

	// The settings travel in the URL hash so a reload keeps them.
	let loaded = $state(false);
	{
		const h = location.hash.slice(1);
		if (h === '') loaded = true;
		else {
			unpackHash(h)
				.then((json) => {
					const v = JSON.parse(json) as {
						renderer?: typeof renderer;
						elkOn?: boolean;
						elkExtra?: Record<string, string>;
						engineOpts?: LayoutOptions;
						fitWidth?: number | null;
						showLabels?: boolean;
						dark?: boolean;
					};
					if (v.renderer !== undefined) renderer = v.renderer;
					if (v.elkOn !== undefined) elkOn = v.elkOn;
					if (v.elkExtra !== undefined) elkExtra = v.elkExtra;
					if (v.engineOpts !== undefined) engineOpts = v.engineOpts;
					if (v.fitWidth !== undefined) fitWidth = v.fitWidth;
					if (v.showLabels !== undefined) showLabels = v.showLabels;
					if (v.dark !== undefined) dark = v.dark;
				})
				.catch(() => {})
				.finally(() => (loaded = true));
		}
	}
	let writeSeq = 0;
	$effect(() => {
		const json = JSON.stringify({
			renderer,
			elkOn,
			elkExtra,
			engineOpts,
			fitWidth,
			showLabels,
			dark
		});
		if (!loaded) return;
		const seq = ++writeSeq;
		const t = setTimeout(() => {
			packHash(json).then((h) => {
				if (seq === writeSeq) history.replaceState(null, '', `${base}/examples#${h}`);
			});
		}, 300);
		return () => clearTimeout(t);
	});
	// typing in the fit box re-runs the candidate loop on every card:
	// commit after a pause (or instantly on Enter/blur via change)
	let fitTimer: ReturnType<typeof setTimeout> | undefined;
	function commitFit(v: string) {
		clearTimeout(fitTimer);
		fitWidth = v === '' ? null : Number(v);
	}
	let showLabels = $state(true);
	let dark = $state(true);
	$effect(() => {
		document.body.classList.toggle('light', !dark);
	});
	const theme = $derived(defaultThemes[dark ? 'dark' : 'light']);

	// Same experiment panel as the render page; overrides apply to every card.
	const ELK_CHOICES: { key: string; label: string; values: string[] }[] = [
		{
			key: 'elk.layered.nodePlacement.strategy',
			label: 'placement',
			values: ['BRANDES_KOEPF', 'LINEAR_SEGMENTS', 'NETWORK_SIMPLEX', 'SIMPLE']
		},
		{
			key: 'elk.layered.layering.strategy',
			label: 'layering',
			values: ['NETWORK_SIMPLEX', 'LONGEST_PATH', 'COFFMAN_GRAHAM', 'MIN_WIDTH']
		},
		{
			key: 'elk.layered.cycleBreaking.strategy',
			label: 'cycle breaking',
			values: ['DEPTH_FIRST', 'GREEDY', 'GREEDY_MODEL_ORDER', 'MODEL_ORDER']
		},
		{
			key: 'elk.layered.compaction.postCompaction.strategy',
			label: 'compaction',
			values: ['NONE', 'LEFT', 'RIGHT', 'EDGE_LENGTH']
		},
		{
			key: 'elk.layered.considerModelOrder.strategy',
			label: 'model order',
			values: ['NONE', 'NODES_AND_EDGES', 'PREFER_NODES', 'PREFER_EDGES']
		},
		{ key: 'elk.layered.mergeEdges', label: 'merge edges', values: ['false', 'true'] },
		{ key: 'elk.layered.feedbackEdges', label: 'feedback edges', values: ['false', 'true'] }
	];
	let elkExtra = $state<Record<string, string>>({});
	let elkMenuOpen = $state(false);
	// Cards with their mermaid source shown beside the render.
	const srcOpen = new SvelteSet<string>();
</script>

<svelte:head>
	<title>lovely-mermaid — examples</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			elkMenuOpen = false;
			engineMenuOpen = false;
		}
	}}
/>

<div class="gallery">
	<div class="bar">
		<span class="accent">lovely-mermaid</span>
		<span class="dim">examples</span>
		<a class="ghost" href="{base}/learn">[learn]</a>
		<span class="spacer"></span>
		<button
			class="ghost"
			class:active={renderer === 'engine'}
			onclick={() => (renderer = 'engine')}>[engine]</button
		>
		<button
			class="ghost"
			class:active={renderer === 'lovely'}
			onclick={() => (renderer = 'lovely')}>[legacy]</button
		>
		<button
			class="ghost"
			class:active={renderer === 'mermaid'}
			onclick={() => (renderer = 'mermaid')}>[mermaid]</button
		>
		<button
			class="ghost"
			class:active={elkOn}
			disabled={renderer !== 'lovely'}
			onclick={() => (elkOn = !elkOn)}>[elk]</button
		>
		{#if renderer === 'engine'}
			<label class="dim">labels <input type="checkbox" bind:checked={showLabels} /></label>
			<label class="dim fit">
				fit <input
					type="number"
					min="20"
					placeholder="off"
					value={fitWidth ?? ''}
					oninput={(e) => {
						const v = e.currentTarget.value;
						clearTimeout(fitTimer);
						fitTimer = setTimeout(() => commitFit(v), 500);
					}}
					onchange={(e) => commitFit(e.currentTarget.value)}
				/>
			</label>
		{/if}
		<button
			class="ghost"
			class:active={engineMenuOpen || elkMenuOpen}
			disabled={renderer === 'mermaid' || (renderer === 'lovely' && !elkOn)}
			onclick={() => {
				if (renderer === 'engine') engineMenuOpen = !engineMenuOpen;
				else elkMenuOpen = !elkMenuOpen;
			}}>[opts]</button
		>
		<button class="ghost" onclick={() => (dark = !dark)}>[{dark ? 'light' : 'dark'}]</button>
	</div>

	{#if engineMenuOpen && renderer === 'engine'}
		<div class="menu" role="dialog" aria-label="engine layout options" tabindex="-1">
			<div class="menu-title">engine options</div>
			<Options bind:value={engineOpts} />
			<button
				class="ghost elk-reset"
				disabled={Object.keys(engineOpts).length === 0}
				onclick={() => (engineOpts = {})}>[reset]</button
			>
		</div>
	{/if}
	{#if elkMenuOpen && renderer === 'lovely'}
		<div class="menu" role="dialog" aria-label="ELK layout options" tabindex="-1">
			<div class="menu-title">elk options</div>
			{#each ELK_CHOICES as c}
				<label class="elk-opt">
					<span class="dim">{c.label}</span>
					<select
						value={elkExtra[c.key] ?? c.values[0]}
						onchange={(e) => {
							const v = e.currentTarget.value;
							if (v === c.values[0]) delete elkExtra[c.key];
							else elkExtra[c.key] = v;
						}}
					>
						{#each c.values as v}<option value={v}>{v.toLowerCase()}</option>{/each}
					</select>
				</label>
			{/each}
			<button
				class="ghost elk-reset"
				disabled={Object.keys(elkExtra).length === 0}
				onclick={() => (elkExtra = {})}>[reset]</button
			>
		</div>
	{/if}

	<div class="cards">
		{#each diagrams as d (d.name)}
			<section class="card">
				<h2>
					{d.name}
					<button
						class="ghost"
						class:active={srcOpen.has(d.name)}
						onclick={() => {
							if (!srcOpen.delete(d.name)) srcOpen.add(d.name);
						}}>[src]</button
					>
				</h2>
				<div class="frame" class:split={srcOpen.has(d.name)}>
					<DiagramViewer
						src={d.src}
						{renderer}
						{elkOn}
						{elkExtra}
						{engineOpts}
						{fitWidth}
						{showLabels}
						{dark}
						{theme}
					/>
					{#if srcOpen.has(d.name)}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
						<pre
							class="src"
							tabindex="0"
							onkeydown={(e) => {
								// select-all inside the pane selects the source only
								if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
									e.preventDefault();
									const sel = getSelection();
									const range = document.createRange();
									range.selectNodeContents(e.currentTarget);
									sel?.removeAllRanges();
									sel?.addRange(range);
								}
							}}>{d.src}</pre>
					{/if}
				</div>
			</section>
		{/each}
	</div>
</div>

<style>
	.gallery {
		min-height: 100vh;
	}
	.bar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.5rem 0.9rem;
		flex-wrap: wrap;
		background: var(--bg);
	}
	.dim {
		color: var(--dim);
	}
	.accent {
		color: var(--accent);
	}
	.spacer {
		flex: 1;
	}
	.ghost {
		font: inherit;
		border: none;
		background: none;
		color: var(--ghost);
		cursor: pointer;
		padding: 0;
	}
	.ghost:hover {
		color: var(--cmd);
	}
	.ghost.active {
		color: var(--accent);
	}
	.ghost:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.menu {
		position: fixed;
		top: 2.6rem;
		right: 0.8rem;
		z-index: 30;
		padding: 0.7rem 0.9rem;
		background: var(--custom-bg);
		border-radius: 4px;
		box-shadow: 0 6px 20px var(--shadow);
	}
	.menu-title {
		color: var(--purple);
		font-weight: bold;
		margin-bottom: 0.5rem;
	}
	.elk-opt {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin: 0.25rem 0;
	}
	.elk-opt select {
		font: inherit;
		font-size: 0.85rem;
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--muted);
		border-radius: 3px;
		padding: 0.1rem 0.2rem;
	}
	.elk-reset {
		margin-top: 0.4rem;
	}
	.fit input {
		width: 4.5rem;
		font: inherit;
		font-size: 0.85rem;
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--muted);
		border-radius: 3px;
		padding: 0.1rem 0.3rem;
	}

	.cards {
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
		padding: 0.4rem 0.9rem 1.2rem;
	}
	.card h2 {
		margin: 0 0 0.35rem;
		font-size: 1rem;
		color: var(--cmd);
		font-weight: normal;
	}
	.frame {
		height: 72vh;
		border: 1px solid var(--muted);
		border-radius: 6px;
		overflow: hidden;
	}
	.frame.split {
		display: grid;
		grid-template-columns: 1fr auto;
	}
	.src {
		margin: 0;
		outline: none;
		padding: 0.6rem 0.9rem;
		max-width: 36rem;
		overflow: auto;
		border-left: 1px solid var(--muted);
		background: var(--bg);
		color: var(--fg);
		font-size: 0.85rem;
		line-height: 1.35;
		user-select: text;
	}
</style>
