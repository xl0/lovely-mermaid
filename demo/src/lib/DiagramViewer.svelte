<script module lang="ts">
	// mermaid.render ids are global; a per-instance prefix keeps concurrent
	// viewers from clobbering each other's temp SVG nodes.
	let instances = 0;
</script>

<script lang="ts">
	import { diagramKind, type MermaidArt, render } from 'lovely-mermaid';
	import {
		type Candidate,
		type LayoutOptions,
		type Snapshot,
		traceEngine,
		traceEngineFit
	} from 'lovely-mermaid-engine';
	import AnsiCanvas from '$lib/AnsiCanvas.svelte';
	import { DEFAULT_VIEW, snapshotSvg } from '$lib/lab/snapshot-svg';
	import { defaultThemes, type RoleKey, type RoleStyle } from '$lib/theme';

	type Theme = Record<RoleKey, RoleStyle>;

	let {
		src,
		renderer = 'engine',
		elkOn = true,
		elkExtra = {},
		engineOpts = {},
		fitWidth = null,
		showLabels = true,
		dark = true,
		theme = defaultThemes.dark
	}: {
		src: string;
		renderer?: 'engine' | 'lovely' | 'mermaid';
		elkOn?: boolean;
		elkExtra?: Record<string, string>;
		engineOpts?: LayoutOptions;
		/** target width in cells; the candidate loop fits to it */
		fitWidth?: number | null;
		/** edge label chips in the engine view */
		showLabels?: boolean;
		dark?: boolean;
		theme?: Theme;
	} = $props();

	const id = ++instances;
	// The in-house engine, drawn with the lab's snapshot renderer for a
	// consistent look: the final flat snapshot of the whole hierarchy (or
	// the last one, when `until` stops early). A source the engine's
	// parsers do not know (sequence…) falls back to the rule renderer.
	const engine = $derived.by(() => {
		if (renderer !== 'engine') return { pic: null, supported: true, err: '', loop: null, ms: 0 };
		try {
			const opts = $state.snapshot(engineOpts);
			const t0 = performance.now();
			let snapshots: Snapshot[];
			let loop: { chosen: string; candidates: Candidate[] } | null = null;
			if (fitWidth !== null && fitWidth > 0) {
				const r = traceEngineFit(src, { width: fitWidth }, opts);
				if (r === null) return { pic: null, supported: false, err: '', loop: null, ms: 0 };
				snapshots = r.snapshots;
				loop = { chosen: r.chosen, candidates: r.candidates };
			} else {
				const r = traceEngine(src, opts);
				snapshots = r.snapshots;
			}
			const ms = performance.now() - t0;
			if (snapshots.length === 0)
				return { pic: null, supported: false, err: '', loop: null, ms: 0 };
			const snap =
				(snapshots.findLast((q: Snapshot) => q.title === 'labels · flat') ??
					snapshots.at(-1)) as Snapshot;
			return {
				pic: snapshotSvg(snap, { ...DEFAULT_VIEW, labels: showLabels }),
				supported: true,
				err: '',
				loop,
				ms
			};
		} catch (e) {
			return {
				pic: null,
				supported: true,
				err: `engine crashed: ${e instanceof Error ? e.message : e}`,
				loop: null,
				ms: 0
			};
		}
	});
	const baseArt = $derived(
		renderer === 'lovely' || (renderer === 'engine' && !engine.supported) ? render(src) : null
	);
	const elkSupported = $derived(
		['flowchart', 'state', 'class', 'er'].includes(diagramKind(src) ?? '')
	);

	let elkArt = $state<MermaidArt | null>(null);
	let elkErr = $state('');
	let elkSeq = 0;
	$effect(() => {
		const extra = { ...elkExtra };
		if (!elkOn || renderer !== 'lovely') {
			elkArt = null;
			elkErr = '';
			return;
		}
		const seq = ++elkSeq;
		const source = src;
		import('lovely-mermaid-elk')
			.then(({ renderElk }) => renderElk(source, extra))
			.then((a) => {
				if (seq === elkSeq) {
					elkArt = a;
					elkErr = '';
				}
			})
			.catch((e) => {
				if (seq === elkSeq) {
					elkArt = null;
					elkErr = `elk crashed: ${e instanceof Error ? e.message : e}`;
				}
			});
	});
	const elkPending = $derived(
		renderer === 'lovely' && elkOn && elkArt === null && elkErr === '' && elkSupported
	);
	const art = $derived(
		renderer === 'engine'
			? engine.supported
				? null
				: baseArt
			: elkPending
				? null
				: elkOn && elkArt !== null
					? elkArt
					: baseArt
	);
	const enginePic = $derived(renderer === 'engine' && engine.supported ? engine.pic : null);

	let mmSvg = $state('');
	let mmErr = $state('');
	let mmSeq = 0;
	$effect(() => {
		if (renderer !== 'mermaid') return;
		const seq = ++mmSeq;
		const source = src;
		const mmTheme = dark ? 'dark' : 'default';
		const elk = elkOn;
		Promise.all([import('mermaid'), import('@mermaid-js/layout-elk')]).then(
			async ([{ default: mermaid }, { default: elkLayouts }]) => {
				mermaid.registerLayoutLoaders(elkLayouts);
				mermaid.initialize({ startOnLoad: false, theme: mmTheme, layout: elk ? 'elk' : 'dagre' });
				try {
					const { svg } = await mermaid.render(`mmv-${id}-${seq}`, source);
					if (seq === mmSeq) {
						mmSvg = svg;
						mmErr = '';
					}
				} catch (e) {
					if (seq === mmSeq) {
						mmErr = String(e);
						mmSvg = '';
					}
				}
			}
		);
	});
	const mmSize = $derived.by(() => {
		const m = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(mmSvg);
		return m ? { w: +m[3], h: +m[4] } : { w: 0, h: 0 };
	});

	const CELL = 15;
	let s = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let vpW = $state(0);
	let vpH = $state(0);
	const artW = $derived(art === null ? 0 : (art.width + 2) * CELL * 0.6);
	const artH = $derived(art === null ? 0 : (art.plain.length + 2) * CELL);
	const worldW = $derived(
		renderer === 'mermaid' ? mmSize.w : enginePic !== null ? enginePic.w : artW
	);
	const worldH = $derived(
		renderer === 'mermaid' ? mmSize.h : enginePic !== null ? enginePic.h : artH
	);

	// Fit on the first size and when the world itself changes (another
	// renderer); option tweaks keep the camera where the user put it.
	let fitFor = '';
	const fitKey = $derived(`${renderer}`);
	$effect(() => {
		if (fitFor !== fitKey && worldW > 0 && vpW > 0) {
			fitFor = fitKey;
			fit();
		}
	});

	const clampS = (v: number): number => Math.min(8, Math.max(0.05, v));
	function fit() {
		if (worldW === 0 || vpW === 0) return;
		s = clampS(Math.min(vpW / worldW, vpH / worldH) * 0.95);
		center();
	}
	function center() {
		tx = (vpW - worldW * s) / 2;
		ty = (vpH - worldH * s) / 2;
	}
	function zoomAt(px: number, py: number, factor: number) {
		const next = clampS(s * factor);
		tx = px - ((px - tx) * next) / s;
		ty = py - ((py - ty) * next) / s;
		s = next;
	}
	// Wheel zoom only after a click inside — otherwise a viewer in a
	// scrolling page hijacks the scroll (the embedded-map problem). A click
	// arms it; the pointer leaving disarms it.
	let armed = $state(false);
	function onWheel(e: WheelEvent) {
		if (!armed) return;
		e.preventDefault();
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
	}

	let dragging = $state(false);
	// One pointer pans, two pinch-zoom about their midpoint (deltas from our
	// own positions — movementX/Y is unreliable for touch pointers).
	const pointers = new Map<number, { x: number; y: number }>();
	function stagePos(e: PointerEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}
	function onDown(e: PointerEvent) {
		e.preventDefault();
		armed = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, stagePos(e));
		dragging = true;
	}
	function onUp(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pointers.size === 0) dragging = false;
	}
	let pendX = 0;
	let pendY = 0;
	let pendRaf = 0;
	function onMove(e: PointerEvent) {
		const prev = pointers.get(e.pointerId);
		if (prev === undefined) return;
		const cur = stagePos(e);
		pointers.set(e.pointerId, cur);
		if (pointers.size === 2) {
			const other = [...pointers.entries()].find(([pid]) => pid !== e.pointerId)?.[1];
			if (!other) return;
			const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
			const dist = Math.hypot(cur.x - other.x, cur.y - other.y);
			const prevMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
			const mid = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
			if (prevDist > 0 && dist > 0) zoomAt(mid.x, mid.y, dist / prevDist);
			tx += mid.x - prevMid.x;
			ty += mid.y - prevMid.y;
		} else if (dragging) {
			pendX += cur.x - prev.x;
			pendY += cur.y - prev.y;
			if (pendRaf === 0) {
				pendRaf = requestAnimationFrame(() => {
					tx += pendX;
					ty += pendY;
					pendX = pendY = 0;
					pendRaf = 0;
				});
			}
		}
	}

	const k = $derived(
		artW === 0 ? 1 : Math.min(Math.min(vpW * 0.2, 560) / artW, (vpH * 0.3) / artH)
	);
	const miniRect = $derived({
		x: (-tx / s) * k,
		y: (-ty / s) * k,
		w: (vpW / s) * k,
		h: (vpH / s) * k
	});
	const miniVisible = $derived(
		artW > 0 && !(tx >= -2 && ty >= -2 && tx + artW * s <= vpW + 2 && ty + artH * s <= vpH + 2)
	);
	let miniDrag = $state(false);
	function miniTo(e: PointerEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		tx = vpW / 2 - ((e.clientX - r.left) / k) * s;
		ty = vpH / 2 - ((e.clientY - r.top) / k) * s;
	}
</script>

<div
	class="stage"
	class:dragging
	role="application"
	aria-label="Diagram viewport: drag to pan, scroll to zoom"
	bind:clientWidth={vpW}
	bind:clientHeight={vpH}
	onwheel={onWheel}
	onpointerdown={onDown}
	onpointermove={onMove}
	onpointerup={onUp}
	onpointercancel={onUp}
	onpointerleave={() => (armed = false)}
>
	{#if renderer === 'mermaid'}
		{#if mmErr !== ''}
			<div class="note err">{mmErr}</div>
		{:else if mmSvg === ''}
			<div class="note dim">rendering…</div>
		{:else}
			<div
				class="mm-layer"
				style="transform: translate({tx}px, {ty}px) scale({s}); width: {mmSize.w}px; height: {mmSize.h}px"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- mermaid sanitizes its own output -->
				{@html mmSvg}
			</div>
		{/if}
	{:else if enginePic !== null}
		<div
			class="mm-layer"
			style="transform: translate({tx}px, {ty}px) scale({s}); width: {enginePic.w}px; height: {enginePic.h}px"
		>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- our own snapshot SVG -->
			{@html enginePic.svg}
		</div>
	{:else if elkPending}
		<div class="note dim">laying out…</div>
	{:else if art === null}
		<div class="note err">
			{renderer === 'engine' && engine.err !== ''
				? engine.err
				: 'render(src) → null — nothing to draw for this source.'}
		</div>
	{:else}
		<AnsiCanvas {art} {theme} {dark} cell={CELL} {s} {tx} {ty} />
	{/if}

	{#if !armed}
		<div class="wheel-hint dim">click to zoom</div>
	{/if}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="badges" onpointerdown={(e) => e.stopPropagation()}>
		{#if art !== null && renderer !== 'mermaid'}
			<span class="dim">{art.width}×{art.plain.length}</span>
		{/if}
		{#if enginePic !== null}
			<span class="dim">{enginePic.stats.width}×{enginePic.stats.height}</span>
			<span class="dim">{engine.ms < 10 ? engine.ms.toFixed(1) : Math.round(engine.ms)}ms</span>
		{/if}
		{#if enginePic !== null && enginePic.warnings.length > 0}
			<span class="err">⚠ {enginePic.warnings.join(' · ')}</span>
		{/if}
		{#if engine.loop !== null && enginePic !== null}
			<span class="dim" title={engine.loop.candidates
					.map((c) => `${c.label}: ${c.width}×${c.height}${c.fits === false ? ' ✗' : ''}`)
					.join('\n')}>{engine.loop.chosen} · {engine.loop.candidates.length} tried</span>
		{/if}
		{#if renderer === 'engine' && !engine.supported}
			<span class="dim">rule layout (no engine for this kind)</span>
		{/if}
		{#if elkErr !== ''}
			<span class="err">⚠ {elkErr} (rule fallback)</span>
		{:else if renderer === 'lovely' && elkOn && !elkSupported}
			<span class="dim">rule layout (no elk for this kind)</span>
		{/if}
		<button class="ghost" onclick={fit}>[fit]</button>
	</div>

	{#if renderer !== 'mermaid' && art && artW > 0}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="minimap"
			class:off={!miniVisible}
			style="width: {artW * k}px; height: {artH * k}px"
			onpointerdown={(e) => {
				e.preventDefault();
				e.stopPropagation();
				(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
				miniDrag = true;
				miniTo(e);
			}}
			onpointermove={(e) => {
				if (miniDrag) miniTo(e);
			}}
			onpointerup={() => (miniDrag = false)}
			onpointercancel={() => (miniDrag = false)}
			onwheel={(e) => {
				if (!armed) return;
				e.preventDefault();
				e.stopPropagation();
				const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
				const px = (e.clientX - r.left) / k;
				const py = (e.clientY - r.top) / k;
				zoomAt(tx + px * s, ty + py * s, Math.exp(-e.deltaY * 0.0015));
			}}
		>
			<AnsiCanvas {art} {theme} {dark} cell={CELL} s={k} tx={0} ty={0} />
			<div
				class="mini-view"
				style="transform: translate({miniRect.x}px, {miniRect.y}px); width: {miniRect.w}px; height: {miniRect.h}px"
			></div>
		</div>
	{/if}
</div>

<style>
	.stage {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--term-bg);
		cursor: grab;
		touch-action: none;
		user-select: none;
	}
	.stage.dragging {
		cursor: grabbing;
	}
	.note {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.dim {
		color: var(--dim);
	}
	.err {
		color: var(--err);
	}
	.wheel-hint {
		position: absolute;
		bottom: 0.5rem;
		right: 0.7rem;
		font-size: 0.8rem;
		opacity: 0;
		transition: opacity 0.15s;
		pointer-events: none;
	}
	.stage:hover .wheel-hint {
		opacity: 0.8;
	}
	.badges {
		position: absolute;
		top: 0.4rem;
		left: 0.6rem;
		display: flex;
		gap: 0.7rem;
		align-items: center;
		font-size: 0.85rem;
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

	.mm-layer {
		position: absolute;
		left: 0;
		top: 0;
		transform-origin: 0 0;
	}
	.mm-layer :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
		max-width: none !important;
	}

	.minimap {
		position: absolute;
		left: 0.8rem;
		bottom: 0.8rem;
		overflow: hidden;
		border: 1px solid var(--muted);
		border-radius: 4px;
		background: var(--term-bg);
		box-shadow: 0 4px 16px var(--shadow);
		cursor: crosshair;
		transition: transform 0.18s ease-out;
		will-change: transform;
	}
	.minimap.off {
		transform: translateY(calc(100% + 1.6rem));
		pointer-events: none;
	}
	.mini-view {
		position: absolute;
		left: 0;
		top: 0;
		border: 1px solid var(--cmd);
		background: rgba(128, 128, 128, 0.15);
		pointer-events: none;
		will-change: transform;
	}
</style>
