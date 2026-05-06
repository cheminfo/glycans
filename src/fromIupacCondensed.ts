import { Molecule } from 'openchemlib';

import type { Sugar } from './Sugar.ts';
import { iupacCondensedObject, sugars } from './sugars.ts';

interface IupacPart {
  part: string;
  isUnit?: boolean;
  isLink?: boolean;
  units?: Sugar;
}

/**
 * Build an OpenChemLib `Molecule` from an IUPAC condensed glycan string.
 *
 * Stub implementation kept for reference — see
 * `getMoleculeFromIupacCondensed` for the working version.
 * @see https://www.glycoforum.gr.jp/article/22A2.html#mokuji02
 * @param iupac - IUPAC condensed glycan, e.g. `NeuAc(α2-3)Gal(β1-4)GlcNAc`.
 * @returns An (empty) molecule placeholder.
 */
export function fromIupacCondensed(iupac: string): Molecule {
  getParts(iupac);

  const mol = new Molecule(0, 0);
  return mol;
}

function getParts(iupac: string): IupacPart[] {
  const units = sugars.map((sugar: Sugar) => sugar.iupacCondensed);
  // sort by length to have the longest match first
  units.sort((a, b) => b.length - a.length);
  // use a regalar expression to split at all the units
  const regex = new RegExp(`(${units.join('|')})`, 'g');

  const parts = iupac
    .split(regex)
    .filter(Boolean)
    .map((part): IupacPart => ({ part }));
  for (const part of parts) {
    part.isUnit = Object.hasOwn(iupacCondensedObject, part.part);
    part.isLink = !part.isUnit;
    if (part.isUnit) {
      part.units = iupacCondensedObject[part.part];
    }
  }
  return parts;
}
