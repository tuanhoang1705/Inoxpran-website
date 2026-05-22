"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _vite = require("@sveltejs/kit/vite");

var _vite2 = require("vite");

var _default = (0, _vite2.defineConfig)({
  plugins: [(0, _vite.sveltekit)()],
  server: {
    proxy: {
      '/api': 'http://localhost:3056'
    }
  },
  css: {
    devSourcemap: false
  },
  build: {
    sourcemap: false
  }
});

exports["default"] = _default;