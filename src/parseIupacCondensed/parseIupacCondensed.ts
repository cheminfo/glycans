import { Molecule } from 'openchemlib';

import type { Sugar } from '../Sugar.ts';
import { sugarByIupacCondensed } from '../sugars.ts';

import { labelUnitAtoms } from './labelUnitAtoms.ts';

// use a regalar expression to split at all the units
const regex = new RegExp(
  `(${Object.keys(sugarByIupacCondensed).join('|')})`,
  'g',
);

// extend Sugar with Molecule
export type SugarUnit = Sugar & {
  molecule: Molecule;
  id: number;
  ringSize: number;
  relativeStereoAtom: string;
};
export interface ParsedIupacCondensed {
  units: SugarUnit[];
  links: Array<{ from: number; to: number; type: string; part: string }>;
}

export function parseIupacCondensed(iupac: string): ParsedIupacCondensed {
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

    const molecule = Molecule.fromSmiles(sugar.smiles);
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
