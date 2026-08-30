<script lang="ts">
	// The snapshot editor: CodeMirror with JSON highlighting, inline parse
	// errors, context-aware completion (keys of the enclosing object, node
	// ids for from/to/parent, port ids, sides), and the two-way link to the
	// picture — `select` / `mark` an item's text, `onCaret` reports which
	// item the caret sits in.
	import { autocompletion } from '@codemirror/autocomplete';
	import { json, jsonParseLinter } from '@codemirror/lang-json';
	import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
	import { linter } from '@codemirror/lint';
	import { EditorState, StateEffect, StateField } from '@codemirror/state';
	import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
	import { tags } from '@lezer/highlight';
	import { basicSetup } from 'codemirror';
	import { onMount } from 'svelte';
	import { complete, itemAt, itemRanges, type Sel, selKey } from './ranges';

	let { value = $bindable(''), onCaret }: { value: string; onCaret?: (sel: Sel | null) => void } =
		$props();
	let host: HTMLDivElement;
	let view: EditorView | undefined;

	const setMark = StateEffect.define<{ from: number; to: number } | null>();
	const markField = StateField.define<DecorationSet>({
		create: () => Decoration.none,
		update(deco, tr) {
			let next = deco.map(tr.changes);
			for (const e of tr.effects) {
				if (e.is(setMark))
					next = e.value
						? Decoration.set([
								Decoration.mark({ class: 'cm-lab-mark' }).range(e.value.from, e.value.to)
							])
						: Decoration.none;
			}
			return next;
		},
		provide: (f) => EditorView.decorations.from(f)
	});

	const theme = EditorView.theme(
		{
			'&': { height: '100%', backgroundColor: 'var(--term-bg)', color: 'var(--fg)' },
			'.cm-scroller': { fontFamily: 'inherit', overflow: 'auto' },
			'.cm-gutters': { backgroundColor: 'var(--term-bg)', color: 'var(--dim)', border: 'none' },
			'.cm-activeLine, .cm-activeLineGutter': {
				backgroundColor: 'color-mix(in srgb, var(--fg) 6%, transparent)'
			},
			'&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
				backgroundColor: 'var(--active-bg) !important'
			},
			'.cm-cursor': { borderLeftColor: 'var(--fg)' },
			'.cm-lab-mark': { backgroundColor: 'color-mix(in srgb, var(--gold) 25%, transparent)' },
			'.cm-tooltip': {
				backgroundColor: 'var(--msg-bg)',
				color: 'var(--fg)',
				border: '1px solid var(--muted)'
			},
			'.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--active-bg)' }
		},
		{ dark: true }
	);
	const highlight = HighlightStyle.define([
		{ tag: tags.propertyName, color: 'var(--link)' },
		{ tag: tags.string, color: 'var(--ok)' },
		{ tag: tags.number, color: 'var(--gold)' },
		{ tag: [tags.bool, tags.null], color: 'var(--purple)' },
		{ tag: [tags.punctuation, tags.bracket], color: 'var(--dim)' }
	]);

	onMount(() => {
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					basicSetup,
					json(),
					linter(jsonParseLinter()),
					autocompletion({ override: [complete] }),
					syntaxHighlighting(highlight),
					theme,
					markField,
					EditorView.updateListener.of((u) => {
						if (u.docChanged) value = u.state.doc.toString();
						if (u.selectionSet || u.docChanged)
							onCaret?.(itemAt(itemRanges(u.state), u.state.selection.main.head)?.sel ?? null);
					})
				]
			})
		});
		return () => view?.destroy();
	});
	// An external value (preset, URL) replaces the document.
	$effect(() => {
		const v = value;
		if (view && v !== view.state.doc.toString())
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
	});

	const rangeOf = (sel: Sel) => {
		if (!view) return null;
		const key = selKey(sel);
		return itemRanges(view.state).find((r) => selKey(r.sel) === key) ?? null;
	};
	/** Select the item's text, scroll to it, focus the editor. */
	export function select(sel: Sel): void {
		const r = rangeOf(sel);
		if (!r || !view) return;
		view.dispatch({
			selection: { anchor: r.from, head: r.to },
			effects: EditorView.scrollIntoView(r.from, { y: 'center' })
		});
		view.focus();
	}
	/** Mark the item's text without touching focus or selection. */
	export function mark(sel: Sel | null): void {
		const r = sel ? rangeOf(sel) : null;
		view?.dispatch({ effects: setMark.of(r ? { from: r.from, to: r.to } : null) });
	}
</script>

<div class="editor" bind:this={host}></div>

<style>
	.editor {
		flex: 1;
		min-height: 0;
		border: 1px solid var(--muted);
	}
	.editor :global(.cm-editor) {
		height: 100%;
	}
</style>
