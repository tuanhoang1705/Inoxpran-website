"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.API_KEY_HEADER = exports.API_BASE = void 0;

var _private = require("$env/dynamic/private");

var DEFAULT_API_BASE = 'http://localhost:3056/v1/api';
var API_BASE_URL = _private.env.API_BASE_URL;
var API_KEY = _private.env.API_KEY;
var API_BASE = (API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, '');
exports.API_BASE = API_BASE;
var API_KEY_HEADER = API_KEY;
exports.API_KEY_HEADER = API_KEY_HEADER;