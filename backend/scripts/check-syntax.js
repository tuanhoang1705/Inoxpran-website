'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const roots = ['server.js', 'src', 'scripts'];
const files = [];

const visit = (relativePath) => {
  const absolutePath = path.resolve(__dirname, '..', relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      visit(path.join(relativePath, entry.name));
    }
    return;
  }
  if (/\.(?:js|mjs)$/.test(relativePath)) files.push(relativePath);
};

for (const root of roots) visit(root);

let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });
  if (result.status === 0) continue;
  failed = true;
  process.stderr.write(result.stderr || result.stdout || `${file}: syntax check failed\n`);
}

if (failed) process.exit(1);
console.info(`Syntax check passed for ${files.length} backend files.`);
