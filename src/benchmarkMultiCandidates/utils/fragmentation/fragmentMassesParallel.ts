/**
 * Parallel masses-only fragmentation for bulk candidate screening.
 *
 * Spawns one lightweight worker per (candidate × adduct) combination,
 * capped by `maxConcurrency`. Workers only compute predicted m/z values
 * (no SVG rendering), making this much faster than the full pipeline.
 */

import { Worker } from 'node:worker_threads';

import type { FragmentationOptions } from '../dwar/filterDwarIonization.ts';
import {
  filterDwarByIonization,
  getPositiveIonizationLabels,
} from '../dwar/filterDwarIonization.ts';
import type { CandidateEntry } from '../loader/loadCandidates.ts';

/** Masses-only result for one candidate × one adduct. */
export interface CandidateAdductMasses {
  candidateName: string;
  label: string;
  masses: number[];
}

/** Options controlling the parallel masses-only fragmentation. */
export interface MassesParallelOptions {
  /** Fragmentation engine options. */
  fragmentation: FragmentationOptions;
  /** Maximum concurrent worker threads. */
  maxConcurrency?: number;
  /**
   * Ionization labels to exclude.
   * E.g. `['Ionization-K']` to skip potassium adducts.
   */
  excludeLabels?: string[];
}

// ── Concurrency helper ──────────────────────────────────────────────────

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
 * Fragment all candidates in parallel — one worker per (candidate × adduct).
 *
 * Returns a flat array of `{ candidateName, label, masses }` entries.
 * @param candidates - Candidate molecules to fragment.
 * @param dwar - Raw DWAR file content.
 * @param options - Parallel fragmentation options.
 * @returns Array of per-candidate, per-adduct mass results.
 */
export async function fragmentCandidatesParallel(
  candidates: CandidateEntry[],
  dwar: string,
  options: MassesParallelOptions,
): Promise<CandidateAdductMasses[]> {
  const {
    fragmentation,
    maxConcurrency = 3,
    excludeLabels = [],
  } = options;

  const excludeSet = new Set(excludeLabels);
  const labels = getPositiveIonizationLabels(dwar).filter(
    (l) => !excludeSet.has(l),
  );

  const workerUrl = new URL('massesOnlyWorker.ts', import.meta.url);

  // Pre-filter the DWAR once per label.
  const filteredDwars = new Map<string, string>();
  for (const label of labels) {
    filteredDwars.set(label, filterDwarByIonization(dwar, label));
  }

  // Build one task per (candidate × adduct).
  const tasks: Array<() => Promise<CandidateAdductMasses>> = [];

  for (const candidate of candidates) {
    for (const label of labels) {
      const filteredDwar = filteredDwars.get(label)!;

      tasks.push(
        () =>
          new Promise<CandidateAdductMasses>((resolve, reject) => {
            const worker = new Worker(workerUrl, {
              workerData: {
                candidateName: candidate.name,
                molfile: candidate.molfile,
                filteredDwar,
                options: { ...fragmentation },
                label,
              },
            });
            worker.on('message', (msg) => {
              resolve(msg as CandidateAdductMasses);
              void worker.terminate();
            });
            worker.on('error', reject);
            worker.on('exit', (code) => {
              if (code !== 0) {
                reject(
                  new Error(
                    `Worker for ${candidate.name}/${label} exited with code ${String(code)}`,
                  ),
                );
              }
            });
          }),
      );
    }
  }

  return withConcurrencyLimit(tasks, maxConcurrency);
}
