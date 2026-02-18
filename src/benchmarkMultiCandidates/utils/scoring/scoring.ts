/**
 * MS2 spectral similarity scoring utilities.
 *
 * Wraps {@link MSComparator} from `ms-spectrum` and exposes a simple
 * function that scores predicted masses against an experimental spectrum.
 */

import { MSComparator } from 'ms-spectrum';

/** Parameters for the similarity comparator. */
export interface ScoringOptions {
  /** Weight given to mass in the cosine similarity vector. */
  massPower: number;
  /** Weight given to intensity in the cosine similarity vector. */
  intensityPower: number;
  /** Mass tolerance in ppm for peak alignment. */
  precision: number;
}

/** Result returned by {@link scoreSpectrum}. */
export interface ScoringResult {
  cosine: number;
  tanimoto: number;
  nbCommonPeaks: number;
  nbPeaks1: number;
  nbPeaks2: number;
}

/**
 * Create a reusable comparator instance from the given options.
 * @param options - Scoring options.
 * @returns An `MSComparator` instance.
 */
export function createComparator(options: ScoringOptions): MSComparator {
  return new MSComparator({
    delta: (mass: number) => mass * 1e-6 * options.precision,
    massPower: options.massPower,
    intensityPower: options.intensityPower,
  });
}

/**
 * Score predicted fragment masses against an experimental spectrum.
 * @param comparator - An `MSComparator` instance.
 * @param spectrum - Experimental spectrum as x/y arrays.
 * @param spectrum.x
 * @param masses - Sorted array of predicted m/z values.
 * @param spectrum.y
 * @returns Similarity metrics.
 */
export function scoreSpectrum(
  comparator: MSComparator,
  spectrum: { x: number[]; y: number[] },
  masses: number[],
): ScoringResult {
  return comparator.getSimilarityToMasses(spectrum, masses) as ScoringResult;
}
