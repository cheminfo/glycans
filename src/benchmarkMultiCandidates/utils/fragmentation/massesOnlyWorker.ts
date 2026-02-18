/**
 * Lightweight worker thread for reaction fragmentation (masses only).
 *
 * Unlike `fragmentWorker.ts`, this worker does **not** set up a DOM,
 * does not filter trees, and does not render SVGs. It only computes
 * the predicted m/z values, making it much faster and lighter — ideal
 * for bulk candidate screening.
 *
 * Communication:
 * - **In** (`workerData`): molfile, filtered DWAR, fragmentation options,
 *   and ionization label.
 * - **Out** (`postMessage`): candidate name, ionization label, and sorted
 *   m/z array.
 */

import { parentPort, workerData } from 'node:worker_threads';

import { reactionFragmentation } from 'mass-fragmentation';
import * as OCL from 'openchemlib';

// ── Worker input types ──────────────────────────────────────────────────

interface WorkerInput {
  candidateName: string;
  molfile: string;
  filteredDwar: string;
  options: Record<string, unknown>;
  label: string;
}

// ── Main worker logic ───────────────────────────────────────────────────

const { candidateName, molfile, filteredDwar, options, label } =
  workerData as WorkerInput;

const molecule = OCL.Molecule.fromMolfile(molfile);

const fragments = reactionFragmentation(molecule, {
  ...options,
  dwar: filteredDwar,
}) as {
  masses: Array<{ mz: number }>;
};

const masses = fragments.masses
  .map((m) => m.mz)
  .toSorted((a, b) => a - b);

parentPort!.postMessage({ candidateName, label, masses });
