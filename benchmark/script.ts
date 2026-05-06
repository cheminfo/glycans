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
 *   node --watch benchmark/script.ts
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { stringify } from 'ml-spectra-processing';

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

const annotationBaseDir = join(import.meta.dirname, 'annotation');

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

    const annotationMolDir = join(annotationBaseDir, sanitize(moleculeName));
    // eslint-disable-next-line no-await-in-loop
    await mkdir(annotationMolDir, { recursive: true });

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

    // ── Load raw JCAMP-DX and centroid data for debug output ───────────
    const dataFolderPath = join(import.meta.dirname, 'data', moleculeName);
    const originalDataPath = join(dataFolderPath, 'originalData');
    const centroidsPath = join(dataFolderPath, 'centroids');

    const jcampContents: Record<string, string> = {};
    for (const spectrum of datum.spectra) {
      // eslint-disable-next-line no-await-in-loop
      jcampContents[spectrum.name] = await readFile(
        join(originalDataPath, spectrum.name),
        'utf8',
      );
    }

    const centroidContents: Record<string, string> = {};
    // eslint-disable-next-line no-await-in-loop
    const centroidFiles = await readdir(centroidsPath).catch(
      () => [] as string[],
    );
    for (const centroidFile of centroidFiles) {
      // eslint-disable-next-line no-await-in-loop
      centroidContents[centroidFile] = await readFile(
        join(centroidsPath, centroidFile),
        'utf8',
      );
    }

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

    /** Debug output: per-spectrum, per-adduct data for the JSON file. */
    interface DebugAdduct {
      name: string;
      svg: string;
      trees: object[];
      scores: {
        cosine: number;
        tanimoto: number;
        nbCommonPeaks: number;
        nbPeaks1: number;
        nbPeaks2: number;
      };
      annotations: Array<{
        peak: number;
        intensity: number;
        mechanisms: string[];
        isobaricPeakCount: number;
      }>;
    }

    interface DebugSpectrum {
      name: string;
      jcampDX: string;
      centroid: string;
      adducts: DebugAdduct[];
    }

    const debugSpectra: DebugSpectrum[] = [];

    // Initialize debug entries per spectrum.
    for (const spectrum of datum.spectra) {
      const centroidFileName = spectrum.name.replace(/\.jdx$/i, '.txt');
      debugSpectra.push({
        name: spectrum.name,
        jcampDX: jcampContents[spectrum.name] ?? '',
        centroid: centroidContents[centroidFileName] ?? '',
        adducts: [],
      });
    }

    for (const [
      adductLabel,
      { masses, svgs, trees, annotations },
    ] of massesByAdduct) {
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

        // Populate debug data for this adduct/spectrum combination.
        const debugEntry = debugSpectra.find(
          (entry) => entry.name === spectrum.name,
        );
        if (debugEntry) {
          debugEntry.adducts.push({
            name: adductLabel,
            svg: svgs[spectrum.name] ?? '',
            trees: trees[spectrum.name] ?? [],
            scores: {
              cosine: score.cosine,
              tanimoto: score.tanimoto,
              nbCommonPeaks: score.nbCommonPeaks,
              nbPeaks1: score.nbPeaks1,
              nbPeaks2: score.nbPeaks2,
            },
            annotations: annotations[spectrum.name] ?? [],
          });
        }

        // Write annotation file when there are matching entries.
        const annotationEntries = annotations[spectrum.name];
        if (annotationEntries && annotationEntries.length > 0) {
          const annotationLines = [
            'Peak | Intensity | Mechanisms | IsobaricPeakCount',
          ];
          for (const entry of annotationEntries) {
            annotationLines.push(
              `${String(entry.peak)} | ${String(entry.intensity)} | ${entry.mechanisms.join(',')} | ${String(entry.isobaricPeakCount)}`,
            );
          }
          const annotationPath = join(
            annotationMolDir,
            `${adductSafe}_${spectrumSafe}.txt`,
          );
          svgWrites.push(
            writeFile(annotationPath, annotationLines.join('\n'), 'utf8'),
          );
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

    // ── Write debug JSON ─────────────────────────────────────────────
    const outputDir = join(dataFolderPath, 'output');
    // eslint-disable-next-line no-await-in-loop
    await mkdir(outputDir, { recursive: true });

    const debugJson = {
      molecule: moleculeName,
      molfile: datum.molfile,
      spectra: debugSpectra,
    };

    const jsonPath = join(outputDir, 'debug.json');
    // eslint-disable-next-line no-await-in-loop
    await writeFile(jsonPath, stringify(debugJson, undefined, 2), 'utf8');
    console.log(`Wrote ${jsonPath}`);
  }
}

await processData();

console.log(`\nAll results written to ${resultsDir}`);
