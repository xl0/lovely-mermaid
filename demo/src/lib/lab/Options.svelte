<script lang="ts">
	// Engine options as controls: `until` (stop after a phase) plus one
	// select / number per knob. An empty control means "engine default" and
	// leaves the key out. The schema mirrors LayoutOptions in the engine's
	// types.ts — keep the two in sync.
	import { type LayoutOptions, PHASES } from 'lovely-mermaid-engine';

	let { value = $bindable({}) }: { value: LayoutOptions } = $props();

	type Spec = readonly string[] | 'number' | 'boolean';
	type Bag = Record<string, string | number | boolean | undefined>;
	const schema: Record<string, Record<string, Spec>> = {
		cycles: { strategy: ['greedy', 'dfs'] },
		layering: {
			strategy: ['networkSimplex', 'longestPath'],
			maxWidth: 'number',
			packWidth: 'number'
		},
		ordering: { strategy: ['sweep', 'none'], thoroughness: 'number', greedySwitch: 'boolean' },
		placement: { strategy: ['bk', 'networkSimplex'] }
	};
	const phases = Object.keys(schema);

	const current = (phase: string, key: string): string | number | boolean | undefined =>
		(value as Record<string, Bag | undefined>)[phase]?.[key];

	function set(phase: string, key: string, raw: string) {
		const bag: Bag = { ...((value as Record<string, Bag | undefined>)[phase] ?? {}) };
		const spec = schema[phase][key];
		if (raw === '') delete bag[key];
		else bag[key] = spec === 'number' ? Number(raw) : spec === 'boolean' ? raw === 'true' : raw;
		const next = { ...value } as Record<string, unknown>;
		if (Object.keys(bag).length) next[phase] = bag;
		else delete next[phase];
		value = next as LayoutOptions;
	}
	function setUntil(raw: string) {
		const next = { ...value };
		if (raw === '') delete next.until;
		else next.until = raw as LayoutOptions['until'];
		value = next;
	}
	function setSqueeze(raw: string) {
		const next = { ...value };
		if (raw === '') delete next.squeeze;
		else next.squeeze = Number(raw);
		value = next;
	}
</script>

<div class="options">
	<span class="key">until</span>
	<select value={value.until ?? ''} onchange={(e) => setUntil(e.currentTarget.value)}>
		<option value="">(run all)</option>
		{#each PHASES as p}<option value={p}>{p}</option>{/each}
	</select>
	<span class="key">squeeze</span>
	<input
		type="number"
		min="10"
		placeholder="off"
		value={value.squeeze ?? ''}
		onchange={(e) => setSqueeze(e.currentTarget.value)}
	/>
	{#each phases as phase}
		{#each Object.entries(schema[phase]) as [key, spec]}
			<span class="key">{phase}.{key}</span>
			{#if spec === 'boolean'}
				<input
					type="checkbox"
					checked={(current(phase, key) ?? true) as boolean}
					onchange={(e) => set(phase, key, String(e.currentTarget.checked))}
				/>
			{:else if spec === 'number'}
				<input
					type="number"
					min="1"
					value={current(phase, key) ?? ''}
					placeholder="default"
					onchange={(e) => set(phase, key, e.currentTarget.value)}
				/>
			{:else}
				<select value={current(phase, key) ?? ''} onchange={(e) => set(phase, key, e.currentTarget.value)}>
					<option value="">default</option>
					{#each spec as c}<option value={c}>{c}</option>{/each}
				</select>
			{/if}
		{/each}
	{/each}
</div>

<style>
	.options {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.15rem 0.5rem;
		align-items: center;
	}
	.key {
		color: var(--dim);
	}
	select,
	input {
		background: var(--term-bg);
		color: var(--fg);
		border: 1px solid var(--muted);
		font: inherit;
		padding: 0.1rem 0.3rem;
	}
</style>
