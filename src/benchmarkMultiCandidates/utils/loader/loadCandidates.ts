/**
 * Load candidate molecules from a directory of `.mol` files.
 *
 * Each `.mol` file becomes one candidate. The candidate name is derived
 * from the filename (without the `.mol` extension).
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Molecule } from 'openchemlib';

/** A candidate structure loaded from a `.mol` file. */
export interface CandidateEntry {
  /** Candidate name (filename without `.mol`). */
  name: string;
  /** Raw molfile content (needed for serialization to workers). */
  molfile: string;
  /** Parsed OpenChemLib molecule instance. */
  molecule: Molecule;
}

/**
 * Load all `.mol` files from a directory as candidate entries.
 * @param dirPath - Absolute path to the candidates directory.
 * @returns Array of candidate entries sorted by name.
 */
export async function loadCandidates(
  dirPath: string,
): Promise<CandidateEntry[]> {
  const files = await readdir(dirPath);
  const molFiles = files
    .filter((f) => f.toLowerCase().endsWith('.mol'))
    .toSorted();

  const results = await Promise.all(
    molFiles.map(async (filename) => {
      const molfile = await readFile(join(dirPath, filename), 'utf8');
      const molecule = Molecule.fromMolfile(molfile);
      const name = filename.replace(/\.mol$/i, '');
      return { name, molfile, molecule } satisfies CandidateEntry;
    }),
  );

  return results;
}
