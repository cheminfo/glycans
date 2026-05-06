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
 * @see https://www.glycoforum.gr.jp/article/22A2.html#mokuji02
 * @param iupac
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
