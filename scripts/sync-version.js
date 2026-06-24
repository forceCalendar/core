import { readFileSync, writeFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const indexUrl = new URL('../core/index.js', import.meta.url);
const source = readFileSync(indexUrl, 'utf8');
const versionExport = `export const VERSION = '${packageJson.version}';`;

const next = source.replace(/export const VERSION = '[^']+';/, versionExport);

if (next === source && !source.includes(versionExport)) {
  throw new Error('Could not find VERSION export in core/index.js');
}

writeFileSync(indexUrl, next);
