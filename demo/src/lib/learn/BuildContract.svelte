<script lang="ts">
	let {
		phase,
		receives,
		produces,
		guarantees,
		baseline,
		pushback
	}: {
		phase: string;
		receives: string;
		produces: string;
		guarantees: string;
		baseline: string;
		pushback: string;
	} = $props();
</script>

<section class="contract">
	<h2>Builder’s contract</h2>
	<p class="phase">{phase}</p>
	<dl>
		<div><dt>Receives</dt><dd>{receives}</dd></div>
		<div><dt>Produces</dt><dd>{produces}</dd></div>
		<div><dt>Guarantees</dt><dd>{guarantees}</dd></div>
		<div><dt>First version</dt><dd>{baseline}</dd></div>
		<div><dt>Reopen when</dt><dd>{pushback}</dd></div>
	</dl>
</section>

<style>
	.contract {
		margin-top: 3rem;
		padding: 0.9rem 1rem 1rem;
		border: 1px solid var(--muted);
		border-left: 3px solid var(--purple);
		border-radius: 5px;
	}
	.contract h2 {
		margin: 0;
	}
	.phase {
		margin: 0.1rem 0 0.8rem;
		color: var(--dim);
	}
	dl {
		display: grid;
		gap: 0.45rem;
		margin: 0;
	}
	dl div {
		display: grid;
		grid-template-columns: 8.2rem 1fr;
		gap: 0.7rem;
	}
	dt {
		color: var(--accent);
	}
	dd {
		margin: 0;
	}
</style>
