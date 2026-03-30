/**
 * Convert all profile MS2 spectra to centroid and output one `.txt` file per
 * spectrum into the `centroids/` subfolder of each molecule folder.
 *
 * Usage:
 *   npx tsx src/benchmark/convertToCentroid.ts
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { convert } from 'jcampconverter';
import { Spectrum } from 'ms-spectrum';

/* eslint-disable no-console */

const dataDir = join(import.meta.dirname, 'data');

const dirEntries = await readdir(dataDir, { withFileTypes: true });
const folders = dirEntries.filter((d) => d.isDirectory()).map((d) => d.name);

let totalFiles = 0;
const writes: Array<Promise<void>> = [];

for (const folder of folders) {
  const originalDataPath = join(dataDir, folder, 'originalData');
  const centroidsDir = join(dataDir, folder, 'centroids');
  // eslint-disable-next-line no-await-in-loop
  await mkdir(centroidsDir, { recursive: true });

  // eslint-disable-next-line no-await-in-loop
  const files = await readdir(originalDataPath).catch(() => [] as string[]);

  const jcampFiles = files
    .filter((f) => f.toLowerCase().endsWith('.jdx'))
    .filter((f) => f.toLowerCase().includes('ms2'));

  for (const jcampName of jcampFiles) {
    // eslint-disable-next-line no-await-in-loop
    const jcamp = await readFile(join(originalDataPath, jcampName), 'utf8');
    const converted = convert(jcamp);

    const entry = converted.flatten[0];
    const spectrumData = entry?.spectra[0]?.data;
    if (!spectrumData?.x || !spectrumData?.y) {
      console.warn(`⚠ No spectrum data in ${folder}/${jcampName} — skipped`);
      continue;
    }

    // Profile → centroid via peak-picking
    const centroid = new Spectrum({
      x: spectrumData.x,
      y: spectrumData.y,
    }).getPeaksAsDataXY({});

    // Build a tab-separated text file: m/z <tab> intensity
    const lines = ['m/z\tintensity'];
    for (let i = 0; i < centroid.x.length; i++) {
      lines.push(`${centroid.x[i]}\t${centroid.y[i]}`);
    }

    const baseName = jcampName.replace(/\.jdx$/i, '');
    const outName = `${baseName}.txt`;
    writes.push(
      writeFile(join(centroidsDir, outName), lines.join('\n'), 'utf8'),
    );

    totalFiles++;
    console.log(
      `✔ ${folder}/centroids/${outName}  (${centroid.x.length} peaks)`,
    );
  }
}

await Promise.all(writes);

console.log(
  `\nDone — ${totalFiles} centroid file(s) written to data/<molecule>/centroids/`,
);
