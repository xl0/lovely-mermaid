<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { displayWidth } from 'lovely-ansi-svg';
	import { diagramKind, type MermaidArt, render } from 'lovely-mermaid';
	import AnsiCanvas from '$lib/AnsiCanvas.svelte';
	import { packHash, unpackHash } from '$lib/hash';
	import { defaultThemes } from '$lib/theme';
	import ThemeEditor from '$lib/ThemeEditor.svelte';

	// A bare /render opens empty with the editor up — a scratchpad; with data
	// it is a viewer. Raw replaceState below never updates page.params, so
	// the decode runs once.
	let src = $state<string | null>(page.params.data ? null : '');
	let failed = $state(false);
	let editOpen = $state(!page.params.data);
	$effect(() => {
		const d = page.params.data;
		if (!d) return;
		unpackHash(d)
			.then((s) => {
				// new links carry settings as JSON; old ones are the bare source
				try {
					const o = JSON.parse(s) as {
						src?: string;
						renderer?: 'lovely' | 'mermaid';
						elkOn?: boolean;
						elkExtra?: Record<string, string>;
						dark?: boolean;
					};
					if (typeof o === 'object' && o !== null && typeof o.src === 'string') {
						src = o.src;
						if (o.renderer !== undefined) renderer = o.renderer;
						if (o.elkOn !== undefined) elkOn = o.elkOn;
						if (o.elkExtra !== undefined) elkExtra = o.elkExtra;
						if (o.dark !== undefined) dark = o.dark;
						return;
					}
				} catch {
					// plain source
				}
				src = s;
			})
			.catch(() => (failed = true));
	});

	// The editor drawer edits `src` in place; the URL follows, so the link in
	// the address bar always names what is on screen. Async writes apply only
	// the latest.
	let writeSeq = 0;
	$effect(() => {
		const s = src;
		const payload = JSON.stringify({ src: s, renderer, elkOn, elkExtra, dark });
		if (s === null) return;
		const seq = ++writeSeq;
		if (s.trim() === '') {
			writeSeq++;
			history.replaceState(null, '', `${base}/render`);
			return;
		}
		packHash(payload).then((h) => {
			if (seq === writeSeq) history.replaceState(null, '', `${base}/render/${h}`);
		});
	});

	let dark = $state(true);
	$effect(() => {
		document.body.classList.toggle('light', !dark);
	});
	let theme = $state(structuredClone(defaultThemes.dark));
	function setMode(d: boolean) {
		dark = d;
		theme = structuredClone(defaultThemes[d ? 'dark' : 'light']);
	}
	let menuOpen = $state(false);


	const baseArt = $derived(src === null ? null : render(src));

	// One [elk] toggle for both renderers: on the terminal renderer it swaps
	// the layout engine to elkjs; on mermaid.js it swaps dagre for ELK.
	// Disabled for diagram kinds renderElk does not lay out.
	let renderer = $state<'lovely' | 'mermaid'>('lovely');
	let elkOn = $state(true);
	const elkSupported = $derived(
		src !== null && ['flowchart', 'state', 'class', 'er'].includes(diagramKind(src) ?? '')
	);
	// Experiment panel: each select overrides one ELK layoutOption; the first
	// value is what renderElk's own OPTS resolve to, so picking it clears the
	// override. Some combos genuinely crash elkjs (model-order strategies on
	// hierarchy with in-cluster cycles) — a crash falls back to the rule
	// render and shows the message.
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
	let elkErr = $state('');
	let elkArt = $state<MermaidArt | null>(null);
	let elkSeq = 0;
	$effect(() => {
		const extra = { ...elkExtra };
		if (!elkOn || renderer !== 'lovely' || src === null || src.trim() === '') {
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
	// While ELK is still laying out, hold the frame instead of flashing the
	// rule-based render and swapping.
	const elkPending = $derived(elkOn && elkArt === null && elkErr === '' && elkSupported);
	const art = $derived(elkPending ? null : elkOn && elkArt !== null ? elkArt : baseArt);

	// The official mermaid.js renderer as a second opinion; loaded on first
	// use so the terminal path never pays for it. ELK layout is optional:
	// dagre (mermaid's default) collapses clusters, so boundary-crossing
	// edges stop at the cluster border — ELK routes them to the node.
	let mmSvg = $state('');
	let mmErr = $state('');
	let mmSeq = 0;
	$effect(() => {
		if (renderer !== 'mermaid' || src === null || src.trim() === '') return;
		const seq = ++mmSeq;
		const source = src;
		const mmTheme = dark ? 'dark' : 'default';
		const elk = elkOn;
		Promise.all([import('mermaid'), import('@mermaid-js/layout-elk')]).then(
			async ([{ default: mermaid }, { default: elkLayouts }]) => {
				mermaid.registerLayoutLoaders(elkLayouts);
				mermaid.initialize({ startOnLoad: false, theme: mmTheme, layout: elk ? 'elk' : 'dagre' });
				try {
					const { svg } = await mermaid.render(`mm-${seq}`, source);
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

	// Same fixed pixels per cell as the main page: 9px cells land glyphs on
	// whole pixels at scale 1.
	const CELL = 15;

	// The view transform: art pixels -> screen is translate(tx,ty) scale(s).
	let s = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let vpW = $state(0);
	let vpH = $state(0);
	// The canvas renderer shares the art's cell geometry, so the art's pixel
	// size is arithmetic, not a DOM measurement (margin of 1 cell each side).
	const artW = $derived(art === null ? 0 : (art.width + 2) * CELL * 0.6);
	const artH = $derived(art === null ? 0 : (art.plain.length + 2) * CELL);
	// What the camera frames: the cell art, or the mermaid SVG's viewBox.
	const worldW = $derived(renderer === 'mermaid' ? mmSize.w : artW);
	const worldH = $derived(renderer === 'mermaid' ? mmSize.h : artH);
	let fitted = false;
	$effect(() => {
		if (!fitted && worldW > 0 && vpW > 0) {
			fitted = true;
			fit();
		}
	});
	// Refit once when the renderer switches (mermaid sizes arrive async).
	let fitFor = 'lovely';
	const fitKey = $derived(`${renderer}${elkOn ? '+elk' : ''}${JSON.stringify(elkExtra)}`);
	$effect(() => {
		if (fitKey !== fitFor && worldW > 0 && vpW > 0) {
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
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
	}

	// Text search over the rendered cells: matches carry display-column
	// geometry so highlights land exactly under the canvas glyphs.
	let query = $state('');
	let cur = $state(0);
	let searchEl: HTMLInputElement | undefined = $state();
	const matches = $derived.by(() => {
		if (art === null || query === '') return [];
		const q = query.toLowerCase();
		const out: { row: number; x: number; w: number }[] = [];
		art.plain.forEach((line, r) => {
			const low = line.toLowerCase();
			let i = low.indexOf(q);
			while (i !== -1) {
				out.push({
					row: r,
					x: displayWidth(line.slice(0, i)),
					w: displayWidth(line.slice(i, i + q.length))
				});
				i = low.indexOf(q, i + q.length);
			}
		});
		return out;
	});
	$effect(() => {
		if (cur >= matches.length) cur = 0;
	});
	function jumpTo(i: number) {
		const m = matches[i];
		if (!m) return;
		cur = i;
		if (s < 0.9) s = clampS(1);
		tx = vpW / 2 - (m.x + m.w / 2 + 1) * CELL * 0.6 * s;
		ty = vpH / 2 - (m.row + 1.5) * CELL * s;
	}
	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && matches.length > 0) {
			e.preventDefault();
			jumpTo((cur + (e.shiftKey ? matches.length - 1 : 1)) % matches.length);
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			query = '';
			searchEl?.blur();
		}
	}

	let copied = $state(false);
	async function copy() {
		if (art === null) return;
		await navigator.clipboard.writeText(art.plain.join('\n'));
		copied = true;
		setTimeout(() => (copied = false), 1200);
	}

	let dragging = $state(false);
	// One pointer pans, two pinch-zoom about their midpoint. Deltas come from
	// our own positions — movementX/Y is unreliable for touch pointers.
	const pointers = new Map<number, { x: number; y: number }>();
	function stagePos(e: PointerEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}
	function onDown(e: PointerEvent) {
		// No default: dragging must pan, never start a text selection.
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, stagePos(e));
		dragging = true;
	}
	function onUp(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pointers.size === 0) dragging = false;
	}
	// Pointermove fires faster than the frame rate; a lone pan accumulates
	// and applies once per animation frame, one style write per frame.
	let pendX = 0;
	let pendY = 0;
	let pendRaf = 0;
	function onMove(e: PointerEvent) {
		const prev = pointers.get(e.pointerId);
		if (prev === undefined) return;
		const cur = stagePos(e);
		pointers.set(e.pointerId, cur);
		if (pointers.size === 2) {
			// Only this pointer moved; the other anchors the previous pair.
			const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)?.[1];
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

	// The minimap: the same art scaled to a corner thumbnail, with the visible
	// region outlined; click or drag centres the view there.
	// Sized to the viewport, not a fixed pixel cap: a fifth of the width and
	// under a third of the height, so it reads on large screens too.
	const k = $derived(
		artW === 0 ? 1 : Math.min(Math.min(vpW * 0.2, 560) / artW, (vpH * 0.3) / artH)
	);
	const miniRect = $derived({
		x: (-tx / s) * k,
		y: (-ty / s) * k,
		w: (vpW / s) * k,
		h: (vpH / s) * k
	});
	// The minimap earns its corner only when some of the diagram is off
	// screen; fully visible art needs no locator.
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

<svelte:head>
	<title>lovely-mermaid — diagram</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			menuOpen = false;
			editOpen = false;
		} else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
			// The stage is a canvas — native find has no text to see, so
			// Ctrl+F drives the diagram search instead.
			e.preventDefault();
			searchEl?.focus();
			searchEl?.select();
		} else if (
			e.key === '/' &&
			document.activeElement?.tagName !== 'TEXTAREA' &&
			document.activeElement?.tagName !== 'INPUT'
		) {
			e.preventDefault();
			searchEl?.focus();
		}
	}}
/>

<div class="viewer">
	<div class="bar">
		<span class="accent">lovely-mermaid</span>
		{#if art}
			<span class="dim">{art.width}×{art.plain.length} cells</span>
			<span class="dim">{Math.round(s * 100)}%</span>
		{/if}
		<span class="spacer"></span>
		<span class="search">
			<input
				bind:this={searchEl}
				bind:value={query}
				onkeydown={onSearchKey}
				oninput={() => {
					if (matches.length > 0) jumpTo(0);
				}}
				placeholder="/find"
				aria-label="Search the diagram text"
			/>
			{#if query !== ''}
				<span class="dim">{matches.length === 0 ? '0/0' : `${cur + 1}/${matches.length}`}</span>
			{/if}
		</span>
		<button
			class="ghost"
			class:active={renderer === 'mermaid'}
			onclick={() => (renderer = renderer === 'lovely' ? 'mermaid' : 'lovely')}
			>[mermaid]</button
		>
		<button
			class="ghost"
			class:active={elkOn && elkSupported}
			disabled={!elkSupported}
			onclick={() => (elkOn = !elkOn)}>[elk]</button
		>
		<button
			class="ghost"
			class:active={elkMenuOpen}
			disabled={!elkSupported || !elkOn || renderer !== 'lovely'}
			onclick={() => (elkMenuOpen = !elkMenuOpen)}>[opts]</button
		>
		<button class="ghost" onclick={fit}>[fit]</button>
		<button
			class="ghost"
			onclick={() => {
				s = 1;
				center();
			}}>[1:1]</button
		>
		<button class="ghost" onclick={() => zoomAt(vpW / 2, vpH / 2, 1.25)}>[+]</button>
		<button class="ghost" onclick={() => zoomAt(vpW / 2, vpH / 2, 0.8)}>[−]</button>
		<button class="ghost" class:active={menuOpen} onclick={() => (menuOpen = !menuOpen)}
			>[theme]</button
		>
		<button class="ghost" onclick={() => setMode(!dark)}>[{dark ? 'light' : 'dark'}]</button>
		<button class="ghost" onclick={copy} disabled={art === null}>
			{copied ? 'copied' : '[copy]'}
		</button>
		<button class="ghost" class:active={editOpen} onclick={() => (editOpen = !editOpen)}>
			[edit]
		</button>
	</div>

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
	>
		{#if failed}
			<div class="note err">This link does not decode to a diagram.</div>
		{:else if src === null}
			<div class="note dim">decoding…</div>
		{:else if src.trim() === ''}
			<div class="note dim">⏳ waiting for a diagram — type below</div>
		{:else if renderer === 'mermaid'}
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
		{:else if elkPending}
			<div class="note dim">laying out…</div>
		{:else if art === null}
			<div class="note err">render(src) → null — nothing to draw for this source.</div>
		{:else}
			<AnsiCanvas {art} {theme} {dark} cell={CELL} {s} {tx} {ty} />
			{#if matches.length > 0}
				<div class="hl-layer" style="transform: translate({tx}px, {ty}px) scale({s})">
					{#each matches as m, i (i)}
						<div
							class="hl"
							class:cur={i === cur}
							style="left: {(m.x + 1) * CELL * 0.6}px; top: {(m.row + 1) *
								CELL}px; width: {m.w * CELL * 0.6}px; height: {CELL}px"
						></div>
					{/each}
				</div>
			{/if}
		{/if}

		{#if renderer === 'lovely' && art && artW > 0}
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
					// Zoom anchored at the art point under the minimap cursor.
					e.preventDefault();
					e.stopPropagation();
					const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
					const px = (e.clientX - r.left) / k;
					const py = (e.clientY - r.top) / k;
					zoomAt(tx + px * s, ty + py * s, Math.exp(-e.deltaY * 0.0015));
				}}
			>
				<!-- the same canvas renderer at a fixed camera: repaints only when
				     the art or theme changes, never during pan/zoom -->
				<AnsiCanvas {art} {theme} {dark} cell={CELL} s={k} tx={0} ty={0} />
				<div
					class="mini-view"
					style="transform: translate({miniRect.x}px, {miniRect.y}px); width: {miniRect.w}px; height: {miniRect.h}px"
				></div>
			</div>
		{/if}

		{#if menuOpen}
			<div
				class="menu"
				role="dialog"
				aria-label="Theme editor"
				tabindex="-1"
				onpointerdown={(e) => e.stopPropagation()}
			>
				<div class="menu-title">theme</div>
				<ThemeEditor bind:theme onreset={() => setMode(dark)} />
			</div>
		{/if}
		{#if elkMenuOpen}
			<div
				class="menu"
				role="dialog"
				aria-label="ELK layout options"
				tabindex="-1"
				onpointerdown={(e) => e.stopPropagation()}
			>
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
				{#if elkErr !== ''}<div class="elk-err">⚠ {elkErr}</div>{/if}
			</div>
		{/if}
	</div>

	{#if art && art.warnings.length}
		<div class="warnings">
			{#each art.warnings as w}<div>⚠ {w}</div>{/each}
		</div>
	{/if}

	{#if editOpen && src !== null}
		<!-- the same prompt-style editor as the main page, docked to the bottom;
		     edits re-render live and rewrite the URL -->
		<div class="editor-box">
			<span class="editor-title">Edit me</span>
			<span class="accent">❯</span>
			<textarea
				bind:value={src}
				rows={Math.min(16, Math.max(2, src.split('\n').length))}
				wrap="off"
				spellcheck="false"
				aria-label="Mermaid source"
			></textarea>
		</div>
	{/if}
</div>

<style>
	:global(html),
	:global(body) {
		height: 100%;
		overflow: hidden;
	}
	.viewer {
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.5rem 0.9rem;
		flex-wrap: wrap;
	}
	.dim {
		color: var(--dim);
	}
	.err {
		color: var(--err);
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
		text-decoration: none;
	}
	.ghost:hover {
		color: var(--cmd);
	}
	.ghost.active {
		color: var(--accent);
	}

	.search {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.search input {
		font: inherit;
		width: 9rem;
		padding: 0 0.3rem;
		border: none;
		border-bottom: 1px solid var(--muted);
		outline: none;
		background: transparent;
		color: var(--fg);
	}
	.search input:focus {
		border-bottom-color: var(--accent);
	}

	.stage {
		position: relative;
		flex: 1;
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

	.hl-layer {
		position: absolute;
		left: 0;
		top: 0;
		transform-origin: 0 0;
		pointer-events: none;
	}
	.hl {
		position: absolute;
		background: rgba(255, 200, 0, 0.28);
		outline: 1px solid rgba(255, 200, 0, 0.6);
	}
	.hl.cur {
		background: rgba(255, 130, 0, 0.45);
		outline: 2px solid rgba(255, 130, 0, 0.95);
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
		/* slides in from below when the diagram stops fitting the view;
		   permanently promoted so the slide never creates a layer mid-drag —
		   that rasterization was a visible hitch */
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

	.menu {
		position: absolute;
		top: 0.6rem;
		right: 0.8rem;
		z-index: 10;
		padding: 0.7rem 0.9rem;
		background: var(--custom-bg);
		border-radius: 4px;
		box-shadow: 0 6px 20px var(--shadow);
		cursor: auto;
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
	.elk-err {
		max-width: 16rem;
		margin-top: 0.5rem;
		color: var(--warnc);
		font-size: 0.85rem;
	}

	.warnings {
		padding: 0.3rem 0.9rem;
		color: var(--warnc);
		opacity: 0.75;
	}

	/* the editor drawer, DynamicBorder-style like the main page's editor */
	.editor-box {
		margin: 0.6rem 0.9rem 0.9rem;
		border: 1px solid #5f87ff;
		border-radius: 6px;
		padding: 0.45rem 0.7rem;
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		position: relative;
		background: var(--bg);
	}
	.editor-title {
		position: absolute;
		top: -0.75em;
		right: 1rem;
		padding: 0 0.4em;
		background: var(--bg);
		color: #5f87ff;
		font-size: 0.8rem;
		user-select: none;
	}
	.editor-box textarea {
		flex: 1;
		max-height: 40vh;
		resize: none;
		box-sizing: border-box;
		font: inherit;
		/* `-->` must read as what you type, not the ⟶ ligature */
		font-variant-ligatures: none;
		line-height: 1.35;
		padding: 0;
		border: none;
		outline: none;
		background: transparent;
		color: var(--fg);
	}
</style>
