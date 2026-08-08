import { defineConfig } from 'vitest/config';

// The deploy-time OpenClaw patch script is both an executable and an importable
// module, so it opens with a shebang. Node drops that line when it runs a file
// directly, but nothing strips it when the module is imported through the test
// transform, and the leading '#' is reported as a syntax error in whichever test
// imported it. Removing the shebang would break running the script by path.
const stripShebang = {
    name: 'strip-shebang',
    enforce: 'pre',
    transform(code, id) {
        if (!id.endsWith('.mjs') || !code.startsWith('#!')) return null;
        return { code: code.replace(/^#![^\n]*/, ''), map: null };
    }
};

export default defineConfig({
    plugins: [stripShebang]
});
