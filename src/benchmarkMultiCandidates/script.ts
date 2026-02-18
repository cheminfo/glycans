/**
 * Multi-candidate ranking benchmark for glycan mass fragmentation.
 *
 * For each experimental dataset in `data/`, this script:
 * 1. Loads **all** candidate molecules from `candidates/`.
 * 2. Fragments every candidate in parallel (masses only, no SVG).
 * 3. Scores every candidate against each experimental spectrum.
 * 4. Ranks candidates by cosine similarity (descending).
 * 5. Reports where the correct solution (matching folder name) falls
 *    in the ranking.
 *
 * Outputs:
 * - `results/summary.txt`  — one row per (molecule × adduct × spectrum)
 *   showing the solution's rank, cosine, and the best candidate.
 * - `results/{molecule}/ranking_{adduct}_{spectrum}.txt` — full ranking
 *   table for every combination.
 *
 * Usage:
 *   node --no-warnings src/benchmarkMultiCandidates/script.ts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';

import type { FragmentationOptions } from './utils/dwar/filterDwarIonization.ts';
import type { CandidateAdductMasses } from './utils/index.ts';
import {
  createComparator,
  formatTable,
  fragmentCandidatesParallel,
  loadCandidates,
  loadData,
  loadDwar,
  sanitize,
  scoreSpectrum,
} from './utils/index.ts';

/* eslint-disable no-console */

// ── Timing helper ───────────────────────────────────────────────────────
const t0 = performance.now();
const elapsed = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

// ── Load candidates & benchmark data ────────────────────────────────────
console.log('Loading candidates and experimental data…');
const [candidates, data, dwar] = await Promise.all([
  loadCandidates(join(import.meta.dirname, 'candidates')),
  loadData(join(import.meta.dirname, 'data')),
  loadDwar(
    join(import.meta.dirname, '../reactions/glycansReactions.dwar'),
  ),
]);
console.log(
  `  ${String(candidates.length)} candidates, ${String(data.length)} data entries  [${elapsed()}]`,
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
 * Use half of the available CPUs for worker threads.
 * E.g. on a 24-core machine this gives 12 concurrent workers.
 */
const maxConcurrency = Math.max(1, Math.floor(availableParallelism() / 2));

/**
 * Ionization labels to skip entirely.
 * Potassium adducts are excluded by default.
 */
const excludeLabels = ['Ionization-K'];

// ── Fragment ALL candidates in parallel ─────────────────────────────────
console.log(
  `Fragmenting ${String(candidates.length)} candidates × adducts (concurrency=${String(maxConcurrency)})…`,
);
const allMasses = await fragmentCandidatesParallel(candidates, dwar, {
  fragmentation: fragmentationOptions,
  maxConcurrency,
  excludeLabels,
});
console.log(
  `  ${String(allMasses.length)} (candidate × adduct) results  [${elapsed()}]`,
);

// ── Index masses by (candidateName, adductLabel) ────────────────────────
/** Map<candidateName, Map<adductLabel, masses[]>> */
const massIndex = new Map<string, Map<string, number[]>>();
for (const entry of allMasses) {
  let byAdduct = massIndex.get(entry.candidateName);
  if (!byAdduct) {
    byAdduct = new Map<string, number[]>();
    massIndex.set(entry.candidateName, byAdduct);
  }
  byAdduct.set(entry.label, entry.masses);
}

/** Sorted list of adduct labels actually computed. */
const adductLabels = [
  ...new Set(allMasses.map((e: CandidateAdductMasses) => e.label)),
].toSorted();

// ── Rank candidates per (dataEntry × adduct × spectrum) ────────────────

/** One row in the global summary table. */
interface SummaryRow {
  molecule: string;
  adduct: string;
  spectrum: string;
  solutionRank: number;
  total: number;
  solutionCosine: number;
  bestCandidate: string;
  bestCosine: number;
}

const summaryRows: SummaryRow[] = [];

console.log('\nScoring and ranking…');

for (const datum of data) {
  const moleculeName = datum.folderName;
  const moleculeDir = join(resultsDir, sanitize(moleculeName));
  // eslint-disable-next-line no-await-in-loop
  await mkdir(moleculeDir, { recursive: true });

  for (const adduct of adductLabels) {
    for (const spectrum of datum.spectra) {
      // Score every candidate against this spectrum under this adduct.
      const scored = candidates
        .map((c) => {
          const masses = massIndex.get(c.name)?.get(adduct) ?? [];
          const score = scoreSpectrum(comparator, spectrum.value, masses);
          return {
            candidate: c.name,
            cosine: score.cosine,
            tanimoto: score.tanimoto,
            nbCommonPeaks: score.nbCommonPeaks,
            nbPeaks1: score.nbPeaks1,
            nbPeaks2: score.nbPeaks2,
            isSolution: c.name === moleculeName,
          };
        })
        .toSorted((a, b) => b.cosine - a.cosine);

      // Find solution rank (1-based).
      const solutionIdx = scored.findIndex((s) => s.isSolution);
      const solutionRank = solutionIdx === -1 ? -1 : solutionIdx + 1;
      const solutionEntry = solutionIdx >= 0 ? scored[solutionIdx] : undefined;
      const bestEntry = scored[0];

      summaryRows.push({
        molecule: moleculeName,
        adduct,
        spectrum: spectrum.name,
        solutionRank,
        total: scored.length,
        solutionCosine: solutionEntry?.cosine ?? 0,
        bestCandidate: bestEntry?.candidate ?? '',
        bestCosine: bestEntry?.cosine ?? 0,
      });

      // ── Detailed ranking table per combination ──────────────────────
      const rankHeaders = [
        'rank',
        'candidate',
        'cosine',
        'tanimoto',
        'nbCommonPeaks',
        'nbPeaks1',
        'nbPeaks2',
        'solution',
      ];
      const rankRows = scored.map((s, i) => [
        String(i + 1),
        s.candidate,
        s.cosine.toFixed(6),
        s.tanimoto.toFixed(6),
        String(s.nbCommonPeaks),
        String(s.nbPeaks1),
        String(s.nbPeaks2),
        s.isSolution ? '  ✓' : '',
      ]);

      const adductSafe = sanitize(adduct);
      const spectrumSafe = sanitize(spectrum.name.replace(/\.jdx$/i, ''));
      const rankPath = join(
        moleculeDir,
        `ranking_${adductSafe}_${spectrumSafe}.txt`,
      );
      const rankContent = [
        `Ranking: ${moleculeName} / ${adduct} / ${spectrum.name}`,
        `Solution rank: ${String(solutionRank)} / ${String(scored.length)}`,
        '',
        formatTable(rankHeaders, rankRows),
      ].join('\n');
      // eslint-disable-next-line no-await-in-loop
      await writeFile(rankPath, rankContent, 'utf8');
    }
  }

  console.log(`  ${moleculeName}: done`);
}

// ── Write global summary table ──────────────────────────────────────────
const summaryHeaders = [
  'molecule',
  'adduct',
  'spectrum',
  'rank',
  'total',
  'solutionCosine',
  'bestCandidate',
  'bestCosine',
];
const summaryTableRows = summaryRows.map((r) => [
  r.molecule,
  r.adduct,
  r.spectrum,
  String(r.solutionRank),
  String(r.total),
  r.solutionCosine.toFixed(6),
  r.bestCandidate,
  r.bestCosine.toFixed(6),
]);

const summaryContent = formatTable(summaryHeaders, summaryTableRows);
const summaryPath = join(resultsDir, 'summary.txt');
await writeFile(summaryPath, summaryContent, 'utf8');

console.log(`\nWrote ${summaryPath}`);
console.log(`All results written to ${resultsDir}  [${elapsed()}]`);
