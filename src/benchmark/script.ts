/**
 * Benchmark script for glycan mass fragmentation and MS2 spectral matching.
 *
 * Loads molecule/spectra pairs from the `data/` folder, performs in-silico
 * reaction fragmentation per adduct type **in parallel**, compares the
 * predicted fragment masses against experimental MS2 spectra, and writes
 * results to a `results/` folder:
 * - A human-readable scores table (bordered text) per molecule.
 * - An SVG fragmentation tree per adduct/spectrum combination (only when
 *   the tree is non-empty).
 *
 * Usage:
 *   node --watch src/benchmark/script.ts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FragmentationOptions } from './utils/dwar/filterDwarIonization.ts';
import {
  createComparator,
  formatTable,
  fragmentByAdductParallel,
  loadData,
  loadDwar,
  sanitize,
  scoreSpectrum,
} from './utils/index.ts';

/* eslint-disable no-console */

// ── Load benchmark data ─────────────────────────────────────────────────
const data = await loadData(join(import.meta.dirname, 'data'));

const dwar = await loadDwar(
  join(import.meta.dirname, '../reactions/glycansReactions.dwar'),
);

const resultsDir = join(import.meta.dirname, 'results');
await mkdir(resultsDir, { recursive: true });

// ── Scoring parameters ──────────────────────────────────────────────────
const massPower = 3;
const intensityPower = 0.6;
const precision = 20;

const comparator = createComparator({ massPower, intensityPower, precision });

// ── Fragmentation options ───────────────────────────────────────────────
const fragmentationOptions: FragmentationOptions = {
  ionizations: ['esi'] as Array<'esi' | 'ei'>,
  modes: ['positive'] as Array<'positive' | 'negative'>,
  maxDepth: 5,
  limitReactions: 500,
  minIonizations: 1,
  maxIonizations: 1,
  minReactions: 0,
  maxReactions: 3,
};

/**
 * Maximum number of worker threads for parallel fragmentation.
 * Each adduct (H⁺, Na⁺ …) is fragmented on its own thread.
 */
const maxConcurrency = 4;

/**
 * Ionization labels to skip entirely.
 * Add or remove entries here to control which adducts are processed.
 */
const excludeLabels = ['Ionization-K'];

// ── Run fragmentation per adduct & write results ────────────────────────
async function processData() {
  for (const datum of data) {
    // Use the data folder name as the result folder name.
    const moleculeName = datum.folderName;
    const moleculeDir = join(resultsDir, sanitize(moleculeName));
    // eslint-disable-next-line no-await-in-loop
    await mkdir(moleculeDir, { recursive: true });

    const spectraData = datum.spectra.map((s) => ({
      name: s.name,
      x: s.value.x,
      y: s.value.y,
    }));

    // eslint-disable-next-line no-await-in-loop
    const massesByAdduct = await fragmentByAdductParallel(
      datum.molecule,
      dwar,
      {
        fragmentation: fragmentationOptions,
        spectra: spectraData,
        precision,
        maxConcurrency,
        excludeLabels,
      },
    );

    // ── Build scores table ────────────────────────────────────────────
    const headers = [
      'molecule',
      'adduct',
      'spectrum',
      'cosine',
      'tanimoto',
      'nbCommonPeaks',
      'nbPeaks1',
      'nbPeaks2',
    ];
    const tableRows: string[][] = [];
    const svgWrites: Array<Promise<void>> = [];

    for (const [adductLabel, { masses, svgs }] of massesByAdduct) {
      const adductSafe = sanitize(adductLabel);
      console.log(
        `\n── ${moleculeName} / ${adductLabel} (${String(masses.length)} masses) ──`,
      );

      for (const spectrum of datum.spectra) {
        const spectrumSafe = sanitize(spectrum.name.replace(/\.jdx$/i, ''));

        const score = scoreSpectrum(comparator, spectrum.value, masses);
        console.log(
          `  ${spectrum.name}: cosine=${score.cosine.toFixed(4)}  tanimoto=${score.tanimoto.toFixed(4)}  common=${String(score.nbCommonPeaks)}`,
        );

        tableRows.push([
          moleculeName,
          adductLabel,
          spectrum.name,
          score.cosine.toFixed(6),
          score.tanimoto.toFixed(6),
          String(score.nbCommonPeaks),
          String(score.nbPeaks1),
          String(score.nbPeaks2),
        ]);

        // Write SVG only when the tree is non-empty.
        const svg = svgs[spectrum.name];
        if (svg) {
          const svgPath = join(
            moleculeDir,
            `${adductSafe}_${spectrumSafe}.svg`,
          );
          svgWrites.push(writeFile(svgPath, svg, 'utf8'));
        }
      }
    }

    // Write scores table and SVGs
    const tableContent = formatTable(headers, tableRows);
    const tablePath = join(moleculeDir, 'scores.txt');
    // eslint-disable-next-line no-await-in-loop
    await Promise.all([
      writeFile(tablePath, tableContent, 'utf8'),
      ...svgWrites,
    ]);
    console.log(`\nWrote ${tablePath}`);
  }
}

await processData();

console.log(`\nAll results written to ${resultsDir}`);
