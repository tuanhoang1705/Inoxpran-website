import os from 'node:os';
import path from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Vite can fail to finalize its optimizer cache in Unicode workspace paths on Windows.
	cacheDir:
		process.platform === 'win32'
			? path.join(os.tmpdir(), 'inoxpran-website-vite-cache')
			: 'node_modules/.vite',
	optimizeDeps: {
		include: [
			'@tiptap/core',
			'@tiptap/extension-color',
			'@tiptap/extension-image',
			'@tiptap/extension-link',
			'@tiptap/extension-placeholder',
			'@tiptap/extension-text-align',
			'@tiptap/extension-text-style',
			'@tiptap/extension-underline',
			'@tiptap/starter-kit'
		]
	},
	server: {
		proxy: {
			'^/api/(?!home-feed(?:$|/|\\?)|telemetry(?:$|/|\\?)|chat(?:$|/|\\?)|cart/count(?:$|/|\\?)).*':
				'http://localhost:3056',
			'^/api$': 'http://localhost:3056'
		}
	},
	css: {
		devSourcemap: false
	},
	build: {
		sourcemap: false,
		target: ['es2018', 'safari12', 'ios12'],
		cssTarget: 'safari12'
	}
});
