/**
 * Worker thread for running reaction fragmentation in parallel.
 *
 * Each worker handles one ionization type: it deserializes the molecule,
 * runs {@link reactionFragmentation}, filters trees against experimental
 * spectra via `getFilteredReactions`, generates SVG fragmentation trees,
 * and posts back the results.
 *
 * Communication:
 * - **In** (`workerData`): molfile, filtered DWAR, fragmentation options,
 *   experimental spectra, precision, and ionization label.
 * - **Out** (`postMessage`): ionization label, sorted masses, and a map
 *   of spectrum name → SVG string.
 */

import { parentPort, workerData } from 'node:worker_threads';

// eslint-disable-next-line import/no-extraneous-dependencies
import { JSDOM } from 'jsdom';
import { getFragmentationSVG, reactionFragmentation } from 'mass-fragmentation';
import * as OCL from 'openchemlib';

// ── DOM setup (required by react-tree-svg inside getFragmentationSVG) ───
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.document = dom.window.document as unknown as Document;
globalThis.window = dom.window as unknown as Window & typeof globalThis;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

// ── Worker input types ──────────────────────────────────────────────────

interface SpectrumData {
  name: string;
  x: number[];
  y: number[];
}

interface WorkerInput {
  molfile: string;
  filteredDwar: string;
  options: Record<string, unknown>;
  spectra: SpectrumData[];
  precision: number;
  label: string;
}

// ── Main worker logic ───────────────────────────────────────────────────

const { molfile, filteredDwar, options, spectra, precision, label } =
  workerData as WorkerInput;

const molecule = OCL.Molecule.fromMolfile(molfile);

const fragments = reactionFragmentation(molecule, {
  ...options,
  dwar: filteredDwar,
}) as {
  masses: Array<{ mz: number }>;
  trees: object[];
  reactions: {
    getFilteredReactions: (opts: {
      filter: (node: {
        molecules: Array<{ info: { mz: number } }>;
      }) => boolean;
    }) => { trees: object[] };
  };
};

const masses = fragments.masses
  .map((m) => m.mz)
  .toSorted((a, b) => a - b);

// For each spectrum: filter trees, build matched peaks, render SVG.
const svgs: Record<string, string> = {};

for (const spectrum of spectra) {
  const experimentalPeaks = spectrum.x.map((mass, i) => ({
    mass,
    intensity: spectrum.y[i] ?? 0,
  }));

  const processedMasses: number[] = [];
  const filteredReactions = fragments.reactions.getFilteredReactions({
    filter: (node) => {
      for (const mol of node.molecules) {
        const mass = mol.info.mz;
        if (processedMasses.includes(mass)) return false;
        processedMasses.push(mass);
        const error = (precision / 1e6) * mass;
        for (const peak of experimentalPeaks) {
          if (Math.abs(mass - peak.mass) < error) return true;
        }
      }
      return false;
    },
  });

  // Build matched peaks for SVG highlighting.
  const matchedPeaks: Array<{ mass: number; intensity: number }> = [];
  for (const mz of masses) {
    const tolerance = mz * 1e-6 * precision;
    for (let i = 0; i < spectrum.x.length; i++) {
      const expMz = spectrum.x[i];
      const expIntensity = spectrum.y[i];
      if (
        expMz !== undefined &&
        expIntensity !== undefined &&
        Math.abs(expMz - mz) <= tolerance
      ) {
        matchedPeaks.push({ mass: mz, intensity: expIntensity });
        break;
      }
    }
  }

  // Only render SVG when there are actual matched trees.
  if (filteredReactions.trees.length > 0) {
    svgs[spectrum.name] = getFragmentationSVG(filteredReactions.trees, {
      OCL,
      peaks: matchedPeaks,
      accuracy: precision,
    });
  }
}

parentPort!.postMessage({ label, masses, svgs });
