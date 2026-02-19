/**
 * Extract cosine and tanimoto data from ranking files and print two
 * summary tables showing the solution's rank under each metric.
 *
 * For each (molecule × adduct × spectrum) combination the script:
 * 1. Parses the detailed ranking file.
 * 2. Re-ranks candidates by **tanimoto** (the original ranking is by cosine).
 * 3. Prints a "Cosine ranking" summary and a "Tanimoto ranking" summary.
 *
 * Usage:
 *   node --no-warnings src/benchmarkMultiCandidates/printRanks.ts
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { formatTable } from './utils/formatting/formatTable.ts';

/* eslint-disable no-console */

// ── Types ───────────────────────────────────────────────────────────────

interface CandidateRow {
  rank: number;
  candidate: string;
  cosine: number;
  tanimoto: number;
  nbCommonPeaks: number;
  isSolution: boolean;
}

interface RankingFile {
  molecule: string;
  adduct: string;
  spectrum: string;
  candidates: CandidateRow[];
}

// ── Parse one ranking file ──────────────────────────────────────────────

function parseRankingFile(content: string, molecule: string): RankingFile | null {
  // First line: "Ranking: <molecule> / <adduct> / <spectrum>"
  const headerMatch = content.match(
    /^Ranking:\s+(.+?)\s+\/\s+(.+?)\s+\/\s+(.+)$/m,
  );
  if (!headerMatch) return null;

  const adduct = headerMatch[2]!.trim();
  const spectrum = headerMatch[3]!.trim();

  // Parse table rows — data rows start with "│" and contain numbers.
  // Columns: rank │ candidate │ cosine │ tanimoto │ nbCommonPeaks │ nbPeaks1 │ nbPeaks2 │ solution
  const candidates: CandidateRow[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip borders and header row
    if (!line.startsWith('│')) continue;

    const cells = line
      .split('│')
      .slice(1, -1) // remove leading/trailing empty splits
      .map((c) => c.trim());

    // Need at least 8 columns; skip the header row (contains "rank")
    if (cells.length < 8 || cells[0] === 'rank') continue;

    const rank = Number.parseInt(cells[0]!, 10);
    if (Number.isNaN(rank)) continue;

    candidates.push({
      rank,
      candidate: cells[1]!,
      cosine: Number.parseFloat(cells[2]!),
      tanimoto: Number.parseFloat(cells[3]!),
      nbCommonPeaks: Number.parseInt(cells[4]!, 10),
      isSolution: cells[7]!.includes('✓'),
    });
  }

  if (candidates.length === 0) return null;

  return { molecule, adduct, spectrum, candidates };
}

// ── Collect all ranking files ───────────────────────────────────────────

const resultsDir = join(import.meta.dirname, 'results');

const topEntries = await readdir(resultsDir, { withFileTypes: true });
const moleculeDirs = topEntries
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .toSorted();

const allRankings: RankingFile[] = [];

for (const molecule of moleculeDirs) {
  const dir = join(resultsDir, molecule);
  const files = (await readdir(dir)).filter((f) => f.startsWith('ranking_'));

  for (const file of files) {
    const content = await readFile(join(dir, file), 'utf8');
    const parsed = parseRankingFile(content, molecule);
    if (parsed) allRankings.push(parsed);
  }
}

allRankings.sort((a, b) =>
  a.molecule.localeCompare(b.molecule) ||
  a.adduct.localeCompare(b.adduct) ||
  a.spectrum.localeCompare(b.spectrum),
);

// ── Build summary rows ──────────────────────────────────────────────────

interface SummaryEntry {
  molecule: string;
  adduct: string;
  spectrum: string;
  cosineRank: number;
  cosineScore: number;
  cosineBest: string;
  cosineBestScore: number;
  tanimotoRank: number;
  tanimotoScore: number;
  tanimotoBest: string;
  tanimotoBestScore: number;
  total: number;
}

const summaries: SummaryEntry[] = allRankings.map((r) => {
  // Cosine ranking (already sorted by cosine in the file).
  const byCosine = [...r.candidates].toSorted((a, b) => b.cosine - a.cosine);
  const cosineIdx = byCosine.findIndex((c) => c.isSolution);
  const cosineSolution = cosineIdx !== -1 ? byCosine[cosineIdx]! : undefined;

  // Tanimoto ranking (re-sort by tanimoto).
  const byTanimoto = [...r.candidates].toSorted(
    (a, b) => b.tanimoto - a.tanimoto,
  );
  const tanimotoIdx = byTanimoto.findIndex((c) => c.isSolution);
  const tanimotoSolution =
    tanimotoIdx !== -1 ? byTanimoto[tanimotoIdx]! : undefined;

  return {
    molecule: r.molecule,
    adduct: r.adduct,
    spectrum: r.spectrum,
    cosineRank: cosineIdx + 1,
    cosineScore: cosineSolution?.cosine ?? 0,
    cosineBest: byCosine[0]?.candidate ?? '',
    cosineBestScore: byCosine[0]?.cosine ?? 0,
    tanimotoRank: tanimotoIdx + 1,
    tanimotoScore: tanimotoSolution?.tanimoto ?? 0,
    tanimotoBest: byTanimoto[0]?.candidate ?? '',
    tanimotoBestScore: byTanimoto[0]?.tanimoto ?? 0,
    total: r.candidates.length,
  };
});

// ── Pick best spectrum per molecule (one row per molecule) ───────────────

/**
 * For a given metric, pick the entry with the best (lowest) rank,
 *  breaking ties by highest score. Skip entries where best score is 0.
 * @param entries
 * @param rankKey
 * @param scoreKey
 * @param bestScoreKey
 */
function pickBest(
  entries: SummaryEntry[],
  rankKey: 'cosineRank' | 'tanimotoRank',
  scoreKey: 'cosineScore' | 'tanimotoScore',
  bestScoreKey: 'cosineBestScore' | 'tanimotoBestScore',
): SummaryEntry[] {
  const byMolecule = new Map<string, SummaryEntry[]>();
  for (const e of entries) {
    if (e[bestScoreKey] <= 0) continue; // skip all-zero spectra
    const list = byMolecule.get(e.molecule) ?? [];
    list.push(e);
    byMolecule.set(e.molecule, list);
  }

  const best: SummaryEntry[] = [];
  for (const [, list] of byMolecule) {
    list.sort(
      (a, b) => a[rankKey] - b[rankKey] || b[scoreKey] - a[scoreKey],
    );
    best.push(list[0]!);
  }

  return best.toSorted((a, b) => a.molecule.localeCompare(b.molecule));
}

// ── Print Cosine summary ────────────────────────────────────────────────

const bestCosine = pickBest(summaries, 'cosineRank', 'cosineScore', 'cosineBestScore');

const cosineHeaders = [
  'molecule',
  'adduct',
  'spectrum',
  'rank',
  'total',
  'solutionCosine',
  'bestCandidate',
  'bestCosine',
];

const cosineRows = bestCosine.map((s) => [
  s.molecule,
  s.adduct,
  s.spectrum,
  String(s.cosineRank),
  String(s.total),
  s.cosineScore.toFixed(6),
  s.cosineBest,
  s.cosineBestScore.toFixed(6),
]);

const cosineContent = `═══ Solution ranking by COSINE ═══\n\n${formatTable(cosineHeaders, cosineRows)}\n`;
const cosinePath = join(resultsDir, 'summary_cosine.txt');
await writeFile(cosinePath, cosineContent, 'utf8');
console.log(`Wrote ${cosinePath}`);

// ── Print Tanimoto summary ──────────────────────────────────────────────

const bestTanimoto = pickBest(summaries, 'tanimotoRank', 'tanimotoScore', 'tanimotoBestScore');

const tanimotoHeaders = [
  'molecule',
  'adduct',
  'spectrum',
  'rank',
  'total',
  'solutionTanimoto',
  'bestCandidate',
  'bestTanimoto',
];

const tanimotoRows = bestTanimoto.map((s) => [
  s.molecule,
  s.adduct,
  s.spectrum,
  String(s.tanimotoRank),
  String(s.total),
  s.tanimotoScore.toFixed(6),
  s.tanimotoBest,
  s.tanimotoBestScore.toFixed(6),
]);

const tanimotoContent = `═══ Solution ranking by TANIMOTO ═══\n\n${formatTable(tanimotoHeaders, tanimotoRows)}\n`;
const tanimotoPath = join(resultsDir, 'summary_tanimoto.txt');
await writeFile(tanimotoPath, tanimotoContent, 'utf8');
console.log(`Wrote ${tanimotoPath}`);
