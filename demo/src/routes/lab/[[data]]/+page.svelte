<script lang="ts">
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { packHash, unpackHash } from '$lib/hash';
	import Editor from '$lib/lab/Editor.svelte';
	import type { Sel } from '$lib/lab/ranges';
	import {
		formatSnapshot,
		parseSnapshot,
		type SEdge,
		type SNode,
		type Snapshot,
		type SPort
	} from '$lib/lab/snapshot';
	import { DEFAULT_VIEW, type Rendered, snapshotSvg, type View } from '$lib/lab/snapshot-svg';

	// The layout lab: a mermaid source goes through the engine, every phase
	// snapshot is listed, the chosen one lands in the editor (editable), and
	// the picture follows the editor. State lives in the URL (/lab/<data>).
	const DEFAULT_SRC = `flowchart TD
  Start --> Parse --> Check
  Parse --> Build
  Check --> Build
  Check -->|ok| Lint
  Build --> Ship
  Lint --> Ship
  Start --> Ship
  Ship --> Parse
`;
	let src = $state(DEFAULT_SRC);
	let text = $state('{\n  "nodes": [],\n  "edges": []\n}\n');
	let view = $state<View>({ ...DEFAULT_VIEW });
	let phases = $state<Snapshot[]>([]);
	let phase = $state(-1);
	let genErr = $state('');
	let loaded = $state(!page.params.data);
	if (page.params.data) {
		unpackHash(page.params.data)
			.then((s) => {
				const o = JSON.parse(s) as { src?: string; text: string; view: Partial<View> };
				src = o.src ?? DEFAULT_SRC;
				text = o.text;
				view = { ...DEFAULT_VIEW, ...o.view };
			})
			.finally(() => (loaded = true));
	} else {
		generate();
	}
	let writeSeq = 0;
	$effect(() => {
		const s = JSON.stringify({ src, text, view });
		if (!loaded) return;
		const seq = ++writeSeq;
		const t = setTimeout(() => {
			packHash(s).then((h) => {
				if (seq === writeSeq) history.replaceState(null, '', `${base}/lab/${h}`);
			});
		}, 300);
		return () => clearTimeout(t);
	});

	async function generate() {
		try {
			const { traceEngine } = await import('lovely-mermaid-engine');
			const { snapshots, art } = traceEngine(src);
			phases = snapshots;
			genErr = art === null ? 'nothing rendered: unsupported or empty diagram' : art.warnings.join('; ');
			if (snapshots.length) show(snapshots.length - 1);
		} catch (e) {
			genErr = e instanceof Error ? e.message : String(e);
		}
	}
	function show(i: number) {
		phase = i;
		const s = phases[i];
		if (s) text = formatSnapshot(s);
	}

	type Result = Rendered & { snap: Snapshot };
	const attempt = $derived.by((): { ok: Result } | { error: string } => {
		try {
			const snap = parseSnapshot(text);
			return { ok: { ...snapshotSvg(snap, view), snap } };
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) };
		}
	});
	// The last good picture stays up while the JSON is mid-edit.
	let good = $state<Result | null>(null);
	$effect(() => {
		if ('ok' in attempt) good = attempt.ok;
	});
	const error = $derived('error' in attempt ? attempt.error : '');

	// --- pan / zoom
	let stage = $state<HTMLDivElement | null>(null);
	let tx = $state(0);
	let ty = $state(0);
	let k = $state(1);
	function zoomAt(px: number, py: number, f: number) {
		tx = px - (px - tx) * f;
		ty = py - (py - ty) * f;
		k *= f;
	}
	function zoomCenter(f: number) {
		const r = (stage as HTMLDivElement).getBoundingClientRect();
		zoomAt(r.width / 2, r.height / 2, f);
	}
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const r = (stage as HTMLDivElement).getBoundingClientRect();
		zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
	}
	let drag: { x: number; y: number; tx: number; ty: number; target: Element } | null = null;
	function onDown(e: PointerEvent) {
		drag = { x: e.clientX, y: e.clientY, tx, ty, target: e.target as Element };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onMove(e: PointerEvent) {
		if (!drag) return;
		tx = drag.tx + e.clientX - drag.x;
		ty = drag.ty + e.clientY - drag.y;
	}
	// A press that did not pan is a click: select the item's text in the editor.
	function onUp(e: PointerEvent) {
		if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) {
			const sel = selOf(drag.target);
			if (sel) editor?.select(sel);
		}
		drag = null;
	}
	function fit() {
		if (!stage || !good) return;
		const r = stage.getBoundingClientRect();
		// A local scale: reading `k` here would make the fit effect depend on
		// it and undo every zoom.
		const s = Math.min(1, (r.width - 16) / good.w, (r.height - 16) / good.h);
		k = s;
		tx = (r.width - good.w * s) / 2;
		ty = (r.height - good.h * s) / 2;
	}
	// Refit only when the picture's size or the panel width changes — not on
	// every edit, which replaces `good` and would snap the view back; fit()
	// reads `good` and writes the camera, so it runs untracked.
	const picW = $derived(good?.w ?? 0);
	const picH = $derived(good?.h ?? 0);
	$effect(() => {
		void picW;
		void picH;
		void panelW;
		untrack(fit);
	});

	// --- resizable side panel
	let panelW = $state(Number(localStorage.getItem('lab.panelW')) || 448);
	function onSplitDown(e: PointerEvent) {
		const x0 = e.clientX;
		const w0 = panelW;
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => {
			panelW = Math.max(200, Math.min(window.innerWidth - 300, w0 + ev.clientX - x0));
		};
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			localStorage.setItem('lab.panelW', String(panelW));
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}

	// --- editor <-> picture
	let editor: Editor | undefined = $state();
	function selOf(el: Element): Sel | null {
		const t = el.closest('[data-port],[data-node],[data-edge]');
		if (!t) return null;
		const pid = t.getAttribute('data-port');
		const nid = t.getAttribute('data-node');
		if (pid !== null) return { kind: 'port', node: t.getAttribute('data-pnode') as string, id: pid };
		if (nid !== null) return { kind: 'node', id: nid };
		return { kind: 'edge', index: Number(t.getAttribute('data-edge')) };
	}
	// The item under the editor's caret is outlined in the picture; the
	// outline is re-applied whenever the SVG is replaced.
	let caret = $state<Sel | null>(null);
	$effect(() => {
		void good?.svg;
		const st = stage;
		const c = caret;
		if (!st) return;
		for (const el of st.querySelectorAll('.sel')) el.classList.remove('sel');
		if (!c) return;
		const q =
			c.kind === 'node'
				? `[data-node="${CSS.escape(c.id)}"]`
				: c.kind === 'edge'
					? `[data-edge="${c.index}"]`
					: `[data-port="${CSS.escape(c.id)}"][data-pnode="${CSS.escape(c.node)}"]`;
		for (const el of st.querySelectorAll(q)) el.classList.add('sel');
	});

	// --- hover: the item under the pointer, and its edges lit up
	let hover = $state<
		| { kind: 'node'; item: SNode }
		| { kind: 'edge'; item: SEdge }
		| { kind: 'port'; item: SPort & { node: string } }
		| null
	>(null);
	function onOver(e: PointerEvent) {
		const t = (e.target as Element).closest('[data-port],[data-node],[data-edge]');
		const st = stage as HTMLDivElement;
		for (const el of st.querySelectorAll('.hl')) el.classList.remove('hl');
		editor?.mark(t ? selOf(t) : null);
		if (!t || !good) {
			hover = null;
			return;
		}
		t.classList.add('hl');
		const pid = t.getAttribute('data-port');
		const nid = t.getAttribute('data-node');
		if (pid !== null) {
			const pn = t.getAttribute('data-pnode') as string;
			const port = good.snap.nodes.find((n) => n.id === pn)?.ports?.find((q) => q.id === pid);
			hover = port ? { kind: 'port', item: { node: pn, ...port } } : null;
		} else if (nid !== null) {
			const item = good.snap.nodes.find((n) => n.id === nid);
			hover = item ? { kind: 'node', item } : null;
			const q = CSS.escape(nid);
			for (const el of st.querySelectorAll(`[data-from="${q}"],[data-to="${q}"]`)) el.classList.add('hl');
		} else {
			const item = good.snap.edges[Number(t.getAttribute('data-edge'))];
			hover = item ? { kind: 'edge', item } : null;
		}
	}
</script>

<svelte:head>
	<title>lovely-mermaid — lab</title>
</svelte:head>

<div class="lab" style="grid-template-columns: {panelW}px 6px 1fr">
	<aside>
		<h1><span class="accent">lovely-mermaid</span> <span class="dim">/ lab</span></h1>
		<textarea class="src" bind:value={src} spellcheck="false" aria-label="Mermaid source"></textarea>
		<div class="row wrap">
			<button class="ghost" onclick={generate}>[generate]</button>
			{#each phases as p, i}
				<button class="ghost" class:active={i === phase} onclick={() => show(i)}>{p.title}</button>
			{/each}
		</div>
		{#if genErr}<p class="warn">{genErr}</p>{/if}
		<div class="row view">
			<label>sx <input type="number" min="1" bind:value={view.sx} /></label>
			<label>sy <input type="number" min="1" bind:value={view.sy} /></label>
			<label>gapX <input type="number" min="0" bind:value={view.gapX} /></label>
			<label>gapY <input type="number" min="0" bind:value={view.gapY} /></label>
			<button class="ghost" onclick={() => navigator.clipboard.writeText(location.href)}>[copy link]</button>
		</div>
		<Editor bind:value={text} bind:this={editor} onCaret={(s) => (caret = s)} />
		{#if error}<p class="err">{error}</p>{/if}
	</aside>
	<div class="split" role="separator" aria-orientation="vertical" onpointerdown={onSplitDown}></div>
	<main>
		<div
			class="stage"
			bind:this={stage}
			onwheel={onWheel}
			onpointerdown={onDown}
			onpointermove={onMove}
			onpointerup={onUp}
			onpointercancel={() => (drag = null)}
			onpointerover={onOver}
			onpointerleave={() => {
				hover = null;
				editor?.mark(null);
			}}
			role="img"
			aria-label="Snapshot drawing: drag to pan, scroll to zoom"
		>
			{#if good}
				<div class="content" style="transform: translate({tx}px, {ty}px) scale({k})">
					{@html good.svg}
				</div>
			{/if}
		</div>
		<div class="zoom">
			<span class="dim">{Math.round(k * 100)}%</span>
			<button class="ghost" onclick={() => zoomCenter(1.25)}>[+]</button>
			<button class="ghost" onclick={() => zoomCenter(0.8)}>[−]</button>
			<button class="ghost" onclick={() => zoomCenter(1 / k)}>[1:1]</button>
			<button class="ghost" onclick={fit}>[fit]</button>
		</div>
		<div class="foot">
			{#if good}
				<span class="dim">
					{#each Object.entries(good.stats) as [k, v]}{k}: {v} · {/each}
				</span>
				{#each good.warnings as w}<span class="warn">{w}</span>{/each}
			{/if}
			{#if hover}
				<pre class="hover">{hover.kind} {JSON.stringify(hover.item)}</pre>
			{/if}
		</div>
	</main>
</div>

<style>
	.lab {
		display: grid;
		height: 100vh;
	}
	.split {
		background: var(--muted);
		cursor: col-resize;
		touch-action: none;
	}
	.split:hover {
		background: var(--accent);
	}
	aside {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		min-height: 0;
		min-width: 0;
	}
	h1 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
	}
	.accent {
		color: var(--accent);
	}
	.dim {
		color: var(--dim);
	}
	.row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.wrap {
		flex-wrap: wrap;
		row-gap: 0.1rem;
	}
	.view label {
		color: var(--dim);
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}
	.view input {
		width: 3.5rem;
	}
	input,
	textarea {
		background: var(--term-bg);
		color: var(--fg);
		border: 1px solid var(--muted);
		font: inherit;
	}
	.src {
		height: 9rem;
		resize: vertical;
		padding: 0.4rem;
		white-space: pre;
		overflow: auto;
		flex: none;
	}
	button.ghost {
		background: none;
		border: none;
		color: var(--link);
		font: inherit;
		cursor: pointer;
		padding: 0;
	}
	button.active {
		color: var(--gold);
	}
	.err,
	.warn {
		color: var(--err);
		margin: 0;
	}
	main {
		position: relative;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.stage {
		position: relative;
		flex: 1;
		overflow: hidden;
		background: var(--term-bg);
		cursor: grab;
		touch-action: none;
	}
	.content {
		position: absolute;
		left: 0;
		top: 0;
		transform-origin: 0 0;
	}
	.content :global(svg) {
		display: block;
	}
	.zoom {
		position: absolute;
		right: 0.5rem;
		top: 0.5rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.stage :global(g.hl polyline) {
		stroke: var(--gold);
		stroke-width: 3;
	}
	.stage :global(g.hl rect) {
		stroke: var(--gold);
		stroke-width: 2;
	}
	.stage :global(g.hl circle) {
		fill: var(--gold);
	}
	.stage :global(g.sel polyline),
	.stage :global(g.sel rect) {
		stroke: var(--cmd);
		stroke-width: 2.5;
	}
	.stage :global(g.sel circle) {
		fill: var(--cmd);
	}
	.foot {
		padding: 0.4rem 0.75rem;
		border-top: 1px solid var(--muted);
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		min-height: 2.6rem;
		align-items: center;
	}
	.hover {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-all;
		color: var(--gold);
		flex-basis: 100%;
	}
</style>
