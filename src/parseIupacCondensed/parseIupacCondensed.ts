import type * as OCLNamespace from 'openchemlib';

import type { Sugar } from '../Sugar.ts';
import { iupacCondensedObject as sugarByIupacCondensed } from '../sugars.ts';

import { labelUnitAtoms } from './labelUnitAtoms.ts';

type OCLLibrary = typeof OCLNamespace;
type Molecule = OCLNamespace.Molecule;

// Sort by length descending so longer names like "GlcNAc" match before "Glc".
const regex = new RegExp(
  `(${Object.keys(sugarByIupacCondensed)
    .toSorted((a, b) => b.length - a.length)
    .join('|')})`,
  'g',
);

// extend Sugar with Molecule
export type SugarUnit = Sugar & {
  molecule?: Molecule;
  id: number;
  ringSize: number;
  relativeStereoAtom: string;
};
export interface ParsedLink {
  from: number;
  to: number;
  type: string;
  part: string;
  relativeStereoFrom?: string;
}

export interface ParsedIupacCondensed {
  units: SugarUnit[];
  links: ParsedLink[];
}

/**
 * Parse an IUPAC condensed glycan string into its sugar units and the
 * glycosidic links between them. Each unit is loaded from its reference
 * SMILES and labeled by `labelUnitAtoms`; each link captures the donor and
 * acceptor unit indices, the link part as written (e.g. `(α1-3)`), and the
 * relative-stereo reference atom from the donor unit.
 * @param OCL - The OpenChemLib library, passed in by the caller so this
 *   package never imports `openchemlib` at runtime (avoids version
 *   duplication).
 * @param iupac - IUPAC condensed glycan, e.g. `Glc(α1-3)Glc(β1-4)Glc`.
 * @returns The parsed units and links, ready to be assembled into a single
 *   molecule.
 * @throws {Error} If a substring is not a known sugar unit.
 */
export function parseIupacCondensed(
  OCL: OCLLibrary,
  iupac: string,
): ParsedIupacCondensed {
  const parts = iupac.split(regex).filter(Boolean);

  const units = [];
  const links = [];
  let index = 0;
  for (const part of parts) {
    if (part.match(/\d-\d/)) {
      links.push({
        relativeStereoFrom: units[index - 1]?.relativeStereoAtom,
        from: index - 1,
        to: index,
        type: part.replace(/^\(/, '').replace(/\)$/, ''),
        part,
      });
      continue;
    }

    const sugar = getSugar(part);

    const molecule = OCL.Molecule.fromSmiles(sugar.smiles);
    const result = {
      id: index,
      ...labelUnitAtoms(molecule, index),
      ...sugar,
      molecule,
    };
    index++;
    units.push(result);
  }

  return { units, links };
}

function getSugar(part: string): Sugar {
  const sugar = sugarByIupacCondensed[part];
  if (!sugar) {
    throw new Error(`Unknown sugar unit: ${part}`);
  }
  return sugar;
}
