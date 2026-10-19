const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }

    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absolute);
    }
  }

  return files;
}

const root = path.resolve(__dirname, '..');
const files = walk(root);

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
