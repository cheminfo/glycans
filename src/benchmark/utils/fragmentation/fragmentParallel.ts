/**
 * Parallel per-adduct fragmentation using worker threads.
 *
 * Spawns one worker per ionization label, capped by `maxConcurrency`.
 * Each worker runs `reactionFragmentation`, filters trees, and renders
 * SVGs. Only serializable data (masses + SVG strings) crosses the
 * thread boundary.
 */

import { Worker } from 'node:worker_threads';

import type { Molecule } from 'openchemlib';

import type {
  FragmentationOptions,
  SpectrumInput,
} from '../dwar/filterDwarIonization.ts';
import {
  filterDwarByIonization,
  getPositiveIonizationLabels,
} from '../dwar/filterDwarIonization.ts';

/** Result from parallel per-adduct fragmentation (includes SVGs). */
export interface ParallelAdductResult {
  /** Sorted array of predicted m/z values. */
  masses: number[];
  /** Map from spectrum name → rendered SVG string. */
  svgs: Record<string, string>;
}

/** Options controlling parallel fragmentation behaviour. */
export interface ParallelFragmentationOptions {
  /** Fragmentation engine options. */
  fragmentation: FragmentationOptions;
  /** Experimental spectra for tree filtering and SVG highlighting. */
  spectra: SpectrumInput[];
  /** Mass tolerance in ppm. */
  precision: number;
  /** Maximum concurrent worker threads (default 3). */
  maxConcurrency?: number;
  /**
   * Ionization labels to exclude from processing.
   * E.g. `['Ionization-K']` to skip potassium adducts.
   */
  excludeLabels?: string[];
}

// ── Concurrency helper ──────────────────────────────────────────────────

/**
 * Run async task factories with a concurrency limit.
 * @param tasks - Zero-argument async functions.
 * @param limit - Max tasks running simultaneously.
 * @returns Resolved values in the same order as input tasks.
 */
async function withConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length);
  let nextIndex = 0;

  async function lane(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]!();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => lane()),
  );
  return results;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Run fragmentation in parallel — one worker thread per adduct.
 * @param molecule - The OpenChemLib molecule to fragment.
 * @param dwar - Raw DWAR file content.
 * @param options - Parallel fragmentation options.
 * @returns A Map from adduct label → `{ masses, svgs }`.
 */
export async function fragmentByAdductParallel(
  molecule: Molecule,
  dwar: string,
  options: ParallelFragmentationOptions,
): Promise<Map<string, ParallelAdductResult>> {
  const {
    fragmentation,
    spectra,
    precision,
    maxConcurrency = 3,
    excludeLabels = [],
  } = options;

  const excludeSet = new Set(excludeLabels);
  const labels = getPositiveIonizationLabels(dwar).filter(
    (l) => !excludeSet.has(l),
  );

  const molfile = molecule.toMolfile();
  const workerUrl = new URL('./fragmentWorker.ts', import.meta.url);

  const tasks = labels.map((label) => {
    const filteredDwar = filterDwarByIonization(dwar, label);

    return () =>
      new Promise<{
        label: string;
        masses: number[];
        svgs: Record<string, string>;
      }>((resolve, reject) => {
        const worker = new Worker(workerUrl, {
          workerData: {
            molfile,
            filteredDwar,
            options: { ...fragmentation },
            spectra,
            precision,
            label,
          },
        });
        worker.on('message', (msg) => {
          resolve(
            msg as {
              label: string;
              masses: number[];
              svgs: Record<string, string>;
            },
          );
          void worker.terminate();
        });
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `Worker for ${label} exited with code ${String(code)}`,
              ),
            );
          }
        });
      });
  });

  const results = await withConcurrencyLimit(tasks, maxConcurrency);

  const map = new Map<string, ParallelAdductResult>();
  for (const { label, masses, svgs } of results) {
    map.set(label, { masses, svgs });
  }
  return map;
}
