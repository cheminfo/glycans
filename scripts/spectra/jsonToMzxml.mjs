#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node convert-json-to-peaks.mjs <metadata.json>');
  process.exit(1);
}

const json = JSON.parse(await readFile(input, 'utf8'));
const output = input.replace(/\.json$/i, '.txt');

const peaks = json.peaks || [];

const lines = peaks
  .map((p) => {
    const mz = Number.parseFloat(p.mz);
    const intensity = Number.parseFloat(p.abundance);
    if (Number.isFinite(mz) && Number.isFinite(intensity)) {
      return `${mz}\t${intensity}`;
    }
    return null;
  })
  .filter(Boolean);

await writeFile(output, `${lines.join('\n')}\n`);
console.log(`✅ Wrote ${lines.length} peaks to: ${output}`);
