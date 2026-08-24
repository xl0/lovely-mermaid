<script lang="ts">
	import { crossings, edgePts, slotted, type Pt } from '$lib/learn/slots';

	// Live layered layout drawn in the /learn figure language: runs elkjs on
	// a plain edge list (`a --> b` per line, `a[label]` for labels), keeps
	// ELK's layers and left-to-right order, and re-places x on the slot grid
	// — layer bands, dummy dots in their slots, per-layer occupancy, stats.
	// grid=false keeps ELK's actual x coordinates (for the placement lesson,
	// where those coordinates ARE the subject) instead of snapping to slots.
	let {
		src,
		options = {},
		grid = true
	}: { src: string; options?: Record<string, string>; grid?: boolean } = $props();

	function parseEdges(src: string): { labels: Map<string, string>; edges: [string, string][] } {
		const labels = new Map<string, string>();
		const edges: [string, string][] = [];
		const id = (tok: string): string | null => {
			const m = tok.trim().match(/^(\w+)(?:\[([^\]]*)\])?$/);
			if (!m) return null;
			if (m[2] || !labels.has(m[1])) labels.set(m[1], m[2] ?? m[1]);
			return m[1];
		};
		for (const line of src.split('\n')) {
			const t = line.trim();
			if (!t || /^graph\b/i.test(t)) continue;
			const parts = t.split('-->');
			for (let i = 0; i + 1 < parts.length; i++) {
				const u = id(parts[i]);
				const v = id(parts[i + 1]);
				if (u && v) edges.push([u, v]);
			}
		}
		return { labels, edges };
	}

	interface PNode {
		id: string;
		label: string;
		x: number;
		y: number;
		w: number;
		h: number;
	}
	interface PFig {
		w: number;
		h: number;
		nodes: PNode[];
		edges: { pts: Pt[]; up: boolean }[];
		dummies: Pt[];
		bands: { y: number; real: number; dummy: number }[];
		span: number;
		nDummy: number;
		nCross: number;
		nBend: number; // long-edge kinks: dummy where the chain changes x
	}
	let pfig = $state<PFig | null>(null);
	let perr = $state('');
	let runToken = 0;

	$effect(() => {
		const { labels, edges } = parseEdges(src);
		const opts = { ...options };
		const useGrid = grid;
		const token = ++runToken;
		(async () => {
			const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
			const laid = (await new ELK().layout({
				id: 'root',
				layoutOptions: {
					'elk.algorithm': 'layered',
					'elk.direction': 'DOWN',
					'elk.layered.spacing.nodeNodeBetweenLayers': '45',
					...opts
				},
				children: [...labels.entries()].map(([id, label]) => ({
					id,
					width: label.length * 7.2 + 20,
					height: 26
				})),
				edges: edges.map(([u, v], i) => ({ id: `e${i}`, sources: [u], targets: [v] }))
			})) as {
				width?: number;
				height?: number;
				children?: { id: string; x?: number; y?: number; width?: number; height?: number }[];
				edges?: {
					sources: string[];
					targets: string[];
					sections?: {
						startPoint: { x: number; y: number };
						bendPoints?: { x: number; y: number }[];
						endPoint: { x: number; y: number };
					}[];
				}[];
			};
			if (token !== runToken) return;
			const nodes: PNode[] = (laid.children ?? []).map((c) => ({
				id: c.id,
				label: labels.get(c.id) ?? c.id,
				x: (c.x ?? 0) + (c.width ?? 0) / 2,
				y: (c.y ?? 0) + (c.height ?? 0) / 2,
				w: c.width ?? 40,
				h: c.height ?? 26
			}));
			// Uniform node heights -> nodes of one layer share an exact center y.
			// ELK's layers and left-to-right order are kept; x is re-placed on
			// the slot grid like every other figure here.
			const ys = [...new Set(nodes.map((n) => Math.round(n.y)))].sort((a, b) => a - b);
			const byId = new Map(nodes.map((n) => [n.id, n]));
			const rk: Record<string, number> = {};
			const col: Record<string, number> = {};
			for (const n of nodes) {
				rk[n.id] = ys.findIndex((y) => Math.abs(y - n.y) < 2);
				col[n.id] = n.x;
			}
			const ids = nodes.map((n) => n.id);
			const pairs: [string, string][] = (laid.edges ?? []).map((e) => [e.sources[0], e.targets[0]]);
			// Where each routed edge crosses a layer's centerline: ELK's own
			// position for that dummy, which fixes its order within the layer.
			const routeX = new Map<string, (y: number) => number | undefined>();
			for (const e of laid.edges ?? []) {
				const sec = e.sections?.[0];
				if (!sec) continue;
				const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint];
				routeX.set(`${e.sources[0]}>${e.targets[0]}`, (y) => {
					for (let i = 0; i + 1 < pts.length; i++) {
						const a = pts[i];
						const b = pts[i + 1];
						if (a.y !== b.y && (a.y - y) * (b.y - y) <= 0)
							return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
					}
					return undefined;
				});
			}
			const pitch = Math.max(...nodes.map((n) => n.w)) + 24;
			const slots = slotted(ids, pairs, col, rk, pitch, pitch / 2, (u, v, layer) =>
				routeX.get(`${u}>${v}`)?.(ys[layer])
			);
			if (useGrid) {
				for (const n of nodes) n.x = slots.x[n.id];
			} else {
				// ELK's own coordinates, dummies where the routed edge crosses
				// the layer; the Slotted shape is reused as the position table.
				for (const n of nodes) slots.x[n.id] = n.x;
				for (const d of slots.dummies) d.x = routeX.get(`${d.u}>${d.v}`)?.(ys[d.layer]) ?? d.x;
				slots.width = laid.width ?? slots.width;
			}
			let nBend = 0;
			for (const [u, v] of pairs) {
				const xs = [
					slots.x[u],
					...slots.dummies.filter((d) => d.u === u && d.v === v).map((d) => d.x),
					slots.x[v]
				];
				for (let i = 2; i < xs.length; i++)
					if (Math.abs(xs[i] - xs[i - 1] - (xs[i - 1] - xs[i - 2])) > 1) nBend++;
			}
			const yOfId = (id: string) => (byId.get(id) as PNode).y;
			pfig = {
				w: slots.width,
				h: laid.height ?? 100,
				nodes,
				edges: pairs.map(([u, v]) => ({
					pts: edgePts(u, v, slots, yOfId, (r) => ys[r]),
					up: rk[v] < rk[u]
				})),
				dummies: slots.dummies.map((d) => ({ x: d.x, y: ys[d.layer] })),
				bands: ys.map((y, r) => ({ y, ...slots.occ[r] })),
				span: pairs.reduce((t, [u, v]) => t + Math.abs(rk[v] - rk[u]), 0),
				nDummy: slots.dummies.length,
				nCross: crossings(pairs, slots, rk),
				nBend
			};
			perr = '';
		})().catch((err) => {
			if (token === runToken) perr = String(err);
		});
	});
</script>

	{#if pfig}
		<svg viewBox="0 0 {pfig.w + 180} {pfig.h + 24}" class="playsvg" role="img" aria-label="Live layering result">
			<defs>
			<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
				<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead" />
			</marker>
			<marker id="arr-up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
				<path d="M 0 0 L 10 5 L 0 10 z" class="arrhead-up" />
			</marker>
		</defs>
		<g transform="translate(70, 12)">
				{#each pfig.bands as b, i}
					<rect x="-62" y={b.y - 21} width={pfig.w + 134} height="42" class="band" />
					<text x="-58" y={b.y - 7} class="bandlabel">layer {i}</text>
					<text x={pfig.w + 80} y={b.y + 4} class="occ">{b.real}+{b.dummy}</text>
				{/each}
				{#each pfig.edges as e}
					<polyline
						points={e.pts.map((p) => `${p.x},${p.y}`).join(' ')}
						class="edge"
						class:up={e.up}
						marker-end={e.up ? 'url(#arr-up)' : 'url(#arr)'}
					/>
				{/each}
				{#each pfig.dummies as d}
					{#if grid}
						<rect x={d.x - 14} y={d.y - 12} width="28" height="24" rx="10" class="slot" />
					{/if}
					<circle cx={d.x} cy={d.y} r="4" class="dummy" />
				{/each}
				{#each pfig.nodes as n}
					<rect x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx="12" class="pill" />
					<text x={n.x} y={n.y + 4}>{n.label}</text>
				{/each}
			</g>
		</svg>
		<p class="dim stats">
			layers: {pfig.bands.length} · span: {pfig.span} · dummies: {pfig.nDummy} · crossings:
			{pfig.nCross}{#if !grid}{' '}· width: {Math.round(pfig.w)} · long-edge kinks: {pfig.nBend}{/if}
		</p>
	{/if}
	{#if perr}<p class="dim">{perr}</p>{/if}

<style>
	.playsvg {
		width: 100%;
		max-height: 34rem;
		display: block;
	}
	.playsvg text {
		fill: var(--fg);
		font-size: 13px;
		text-anchor: middle;
	}
	.playsvg polyline {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.4;
	}
	.playsvg polyline.up {
		stroke: var(--err);
	}
	.arrhead {
		fill: var(--accent);
	}
	.arrhead-up {
		fill: var(--err);
	}
	.pill {
		fill: var(--custom-bg);
		stroke: var(--fg);
	}
	.band {
		fill: color-mix(in srgb, var(--accent) 8%, transparent);
	}
	.playsvg .bandlabel {
		fill: var(--dim);
		font-size: 10px;
		text-anchor: start;
	}
	.playsvg .occ {
		fill: var(--dim);
		font-size: 11px;
		text-anchor: start;
	}
	.dummy {
		fill: var(--dim);
	}
	.slot {
		fill: none;
		stroke: var(--muted);
		stroke-dasharray: 3 3;
	}
	.stats {
		text-align: center;
		margin: 0.2rem 0 0;
		color: var(--dim);
		font-size: 0.9rem;
	}
</style>
