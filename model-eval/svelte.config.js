import node from '@sveltejs/adapter-node';
import vercel from '@sveltejs/adapter-vercel';

const adapter = process.env.VERCEL === '1' ? vercel : node;

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter()
	}
};

export default config;
