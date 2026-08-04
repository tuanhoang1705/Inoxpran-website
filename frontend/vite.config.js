import os from 'node:os';
import path from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Vite can fail to finalize its optimizer cache in Unicode workspace paths on Windows.
	cacheDir:
		process.platform === 'win32'
			? path.join(os.tmpdir(), 'inoxpran-website-vite-cache-v2')
			: 'node_modules/.vite',
	optimizeDeps: {
		esbuildOptions: {
			// Inline maps preserve local debugging without external `.map` requests.
			// Those requests can overlap SSR and trigger a SvelteKit false-positive
			// eager-fetch warning. Production sourcemaps remain disabled below.
			sourcemap: 'inline'
		},
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
		watch: {
			// adapter-node and browser-test output can contain tens of thousands of files.
			// They are immutable inputs to neither Vite dev nor HMR, so watching them can
			// exhaust Windows handles and eventually stall every SSR request.
			ignored: ['**/build/**', '**/output/**']
		},
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
		cssTarget: 'safari12',
		rollupOptions: {
			output: {
				// WebGLRenderer is lazy, but its transitive graph is still just over Vite's
				// 500 KiB safety warning. Isolate the renderer module without pulling all
				// of its dependencies into the same manual chunk; Rollup can then share the
				// Three.js core used by the lightweight scene module.
				onlyExplicitManualChunks: true,
				manualChunks(id) {
					const normalizedId = id.replaceAll('\\', '/');
					if (normalizedId.endsWith('/node_modules/three/src/renderers/WebGLRenderer.js')) {
						return 'three-webgl-renderer';
					}
					return undefined;
				}
			}
		}
	}
});
