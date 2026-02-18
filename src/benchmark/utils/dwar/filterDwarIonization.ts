/**
 * Utility to filter a DataWarrior (DWAR) file so that only one specific
 * positive-mode ionization label is kept at a time.
 *
 * The DWAR format is a tab-separated text file with a header section,
 * column properties section, data rows, and trailing metadata. The data
 * rows include a `label` and a `kind` column. Ionization rows in positive
 * mode have labels like `Ionization-H`, `Ionization-Na`, `Ionization-K`.
 *
 * This module exposes:
 * - {@link getPositiveIonizationLabels} — discover which ionization labels
 *   exist in a DWAR string.
 * - {@link filterDwarByIonization} — return a copy of the DWAR keeping
 *   only one ionization label (other ionization rows are removed).
 * - {@link fragmentByAdduct} — iterate over every adduct and return a
 *   Map of adduct label → fragment masses (synchronous).
 */

import { reactionFragmentation } from 'mass-fragmentation';
import type { Molecule } from 'openchemlib';

/** Result of {@link reactionFragmentation} with typed `masses`. */
export interface FragmentationResult {
  masses: Array<{ mz: number }>;
  trees: object[];
  validNodes: object[];
  /** The {@link Reactions} instance used to filter/inspect the tree. */
  reactions: {
    getFilteredReactions: (options?: {
      filter?: (node: {
        molecules: Array<{ info: { mz: number } }>;
      }) => boolean;
    }) => { trees: object[] };
    trees: object[];
  };
}

/** Per-adduct fragmentation result including both masses and trees. */
export interface AdductFragmentationResult {
  /** Sorted array of predicted m/z values. */
  masses: number[];
  /** Fragmentation trees (used by `getFragmentationSVG`). */
  trees: object[];
  /**
   * The Reactions instance returned by `reactionFragmentation`.
   * Call `reactions.getFilteredReactions({ filter })` to prune trees to
   * only nodes matching experimental peaks before SVG rendering.
   */
  reactions: FragmentationResult['reactions'];
}

/** Options forwarded to {@link reactionFragmentation}. */
export interface FragmentationOptions {
  ionizations: Array<'esi' | 'ei'>;
  modes: Array<'positive' | 'negative'>;
  maxDepth: number;
  limitReactions: number;
  minIonizations: number;
  maxIonizations: number;
  minReactions: number;
  maxReactions: number;
}

/** Experimental spectrum data passed to workers for tree filtering. */
export interface SpectrumInput {
  name: string;
  x: number[];
  y: number[];
}

// ── DWAR parsing helpers ────────────────────────────────────────────────

/**
 * Split a DWAR string into its three logical parts:
 * 1. Everything before the data rows (header + column properties + column names).
 * 2. The data rows themselves.
 * 3. Everything after the data rows (hitlist data, datawarrior properties …).
 * @param dwar - Raw DWAR file content as a string.
 * @returns An object with column names, preamble, data rows, and epilogue.
 */
function splitDwar(dwar: string): {
  columnNames: string[];
  preamble: string;
  rows: string[];
  epilogue: string;
} {
  const lines = dwar.split('\n');

  // Find the end of <column properties> block and start of data rows.
  let dataStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.startsWith('</column properties>')) {
      dataStart = i + 1;
      break;
    }
  }
  if (dataStart === -1) {
    throw new Error('Could not find </column properties> in DWAR');
  }

  // The first data line is the column header row.
  const headerLine = lines[dataStart];
  if (!headerLine) {
    throw new Error('Missing column header row in DWAR');
  }
  const columnNames = headerLine.split('\t');

  // Find the end of data rows: first line starting with '<' after header.
  let dataEnd = lines.length;
  for (let i = dataStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line?.startsWith('<')) {
      dataEnd = i;
      break;
    }
  }

  const preamble = lines.slice(0, dataStart + 1).join('\n'); // includes column header
  const rows = lines.slice(dataStart + 1, dataEnd);
  const epilogue = lines.slice(dataEnd).join('\n');

  return { columnNames, preamble, rows, epilogue };
}

/**
 * Parse a single tab-separated DWAR data row into a record using the
 * provided column names.
 * @param row - A single tab-separated data row.
 * @param columnNames - Column names from the DWAR header.
 * @returns A record mapping column names to their values.
 */
function parseRow(
  row: string,
  columnNames: string[],
): Record<string, string> {
  const values = row.split('\t');
  const record: Record<string, string> = {};
  for (let i = 0; i < columnNames.length; i++) {
    const name = columnNames[i];
    if (name !== undefined) {
      record[name] = values[i] ?? '';
    }
  }
  return record;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Discover all distinct positive-mode ionization labels present in a DWAR.
 *
 * Scans data rows where `kind === 'ionization'` and `mode` contains
 * `'positive'`, collecting unique `label` values (e.g. `Ionization-H`).
 * @param dwar - Raw DWAR file content as a string.
 * @returns Array of ionization label strings found.
 */
export function getPositiveIonizationLabels(dwar: string): string[] {
  const { columnNames, rows } = splitDwar(dwar);
  const labels = new Set<string>();

  for (const row of rows) {
    if (row.trim() === '') continue;
    const record = parseRow(row, columnNames);
    if (
      record.kind === 'ionization' &&
      record.mode?.includes('positive') &&
      record.label
    ) {
      labels.add(record.label);
    }
  }

  return [...labels];
}

/**
 * Return a copy of the DWAR keeping only one specific ionization label.
 *
 * All ionization rows whose `label` does **not** match the given
 * `keepLabel` are removed. Reaction rows are left untouched.
 * The `<rowcount>` in the header is updated to reflect the new count.
 * @param dwar - Raw DWAR file content as a string.
 * @param keepLabel - The ionization label to keep (e.g. `'Ionization-H'`).
 * @returns A new DWAR string with only the specified ionization.
 */
export function filterDwarByIonization(
  dwar: string,
  keepLabel: string,
): string {
  const { columnNames, preamble, rows, epilogue } = splitDwar(dwar);

  const filteredRows = rows.filter((row) => {
    if (row.trim() === '') return false;
    const record = parseRow(row, columnNames);
    // Keep all non-ionization rows, and only the matching ionization row.
    if (record.kind === 'ionization') {
      return record.label === keepLabel;
    }
    return true;
  });

  // Update the rowcount in the preamble.
  const updatedPreamble = preamble.replace(
    /<rowcount="\d+">/,
    `<rowcount="${String(filteredRows.length)}">`,
  );

  return [updatedPreamble, ...filteredRows, epilogue].join('\n');
}

/**
 * Run fragmentation once per adduct type found in the DWAR.
 *
 * For each positive-mode ionization label (e.g. `Ionization-H`,
 * `Ionization-Na`, `Ionization-K`) a filtered copy of the DWAR is
 * created, fragmentation is run, and the resulting m/z array is stored
 * in the returned Map.
 * @param molecule - The OpenChemLib molecule to fragment.
 * @param dwar - Raw DWAR file content.
 * @param options - Fragmentation options (excluding `dwar`).
 * @returns A Map from adduct label to an object with sorted masses and trees.
 */
export function fragmentByAdduct(
  molecule: Molecule,
  dwar: string,
  options: FragmentationOptions,
): Map<string, AdductFragmentationResult> {
  const labels = getPositiveIonizationLabels(dwar);
  const result = new Map<string, AdductFragmentationResult>();

  for (const label of labels) {
    const filteredDwar = filterDwarByIonization(dwar, label);

    const fragments = reactionFragmentation(molecule, {
      ...options,
      dwar: filteredDwar,
    }) as FragmentationResult;

    const masses = fragments.masses
      .map((mass) => mass.mz)
      .toSorted((a, b) => a - b);

    result.set(label, {
      masses,
      trees: fragments.trees,
      reactions: fragments.reactions,
    });
  }

  return result;
}

