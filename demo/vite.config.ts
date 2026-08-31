import { sveltekit } from '@sveltejs/kit/vite';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The aliased lovely-mermaid source lives outside the demo's vite root, and
// the `bun link`ed svelte-asciiart (plus its lovely-ansi-svg core, linked one
// level deeper) must stay servable during dev. Once both are published, plain
// installs resolve inside node_modules and the realpaths degenerate to it.
const linked = [
	'node_modules/svelte-asciiart',
	'node_modules/svelte-asciiart/node_modules/lovely-ansi-svg'
]
	.filter(existsSync)
	.map((p) => realpathSync(p));

export default defineConfig({
	plugins: [
		sveltekit(),
		{
			// the aliased engine source lives outside this root; make sure the
			// dev server watches it so open tabs reload on engine edits
			name: 'watch-lovely-mermaid-src',
			configureServer(server) {
				server.watcher.add(fileURLToPath(new URL('../packages/lovely-mermaid/src', import.meta.url)));
			}
		}
	],
	resolve: {
		alias: {
			// layout-elk.ts lives in the aliased lovely-mermaid source outside
			// this root; pin its elkjs import to the demo's own copy so the
			// build never depends on a workspace-root install.
			'elkjs/lib/elk.bundled.js': fileURLToPath(
				new URL('./node_modules/elkjs/lib/elk.bundled.js', import.meta.url)
			)
		}
	},
	server: { fs: { allow: ['..', ...linked] } }
});
