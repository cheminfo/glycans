/**
 * Convert all profile MS2 spectra to centroid and output one `.txt` file per
 * spectrum, named after the molecule folder and the original JCAMP filename.
 *
 * Output directory: `centroidSpectra/` (relative to this script).
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
const outputDir = join(import.meta.dirname, 'centroidSpectra');

await mkdir(outputDir, { recursive: true });

const dirEntries = await readdir(dataDir, { withFileTypes: true });
const folders = dirEntries.filter((d) => d.isDirectory()).map((d) => d.name);

let totalFiles = 0;

for (const folder of folders) {
  const folderPath = join(dataDir, folder);
  const files = await readdir(folderPath);

  const jcampFiles = files
    .filter((f) => f.toLowerCase().endsWith('.jdx'))
    .filter((f) => f.toLowerCase().includes('ms2'));

  for (const jcampName of jcampFiles) {
    const jcamp = await readFile(join(folderPath, jcampName), 'utf8');
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

    // Output filename: "MoleculeName_spectrumFile.txt"
    const baseName = jcampName.replace(/\.jdx$/i, '');
    const outName = `${folder}_${baseName}.txt`;
    await writeFile(join(outputDir, outName), lines.join('\n'), 'utf8');

    totalFiles++;
    console.log(`✔ ${outName}  (${centroid.x.length} peaks)`);
  }
}

console.log(
  `\nDone — ${totalFiles} centroid file(s) written to centroidSpectra/`,
);
