import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
export default {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// The fallback makes /render/<data> work on GitHub Pages: unknown
		// paths get 404.html, which boots the SPA router client-side.
		adapter: adapter({ fallback: '404.html' }),
		// Import lovely-mermaid's source directly (no build step, tracks HEAD).
		alias: {
			'lovely-mermaid': '../packages/lovely-mermaid/src/index.ts',
			'lovely-mermaid-elk': '../packages/lovely-mermaid/src/layout-elk.ts',
			'lovely-mermaid-engine': '../packages/lovely-mermaid/src/layout-engine.ts'
		},
		paths: { base: /** @type {`/${string}` | ''} */ (process.env.BASE_PATH ?? '') }
	}
};
