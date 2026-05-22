import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
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
