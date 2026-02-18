import { Molecule } from 'openchemlib';

import type { Sugar } from './Sugar.ts';
import { iupacCondensedObject, sugars } from './sugars.js';
/**
 * @see https://www.glycoforum.gr.jp/article/22A2.html#mokuji02
 * @param iupac
 */
export function fromIupacCondensed(iupac: string): string {
  const parts = getParts(iupac);

  console.log(parts);
  const mol = new Molecule();
}

function getParts(iupac: string) {
  const units = sugars.map((sugar: Sugar) => sugar.iupacCondensed);
  // sort by length to have the longest match first
  units.sort((a, b) => b.length - a.length);
  // use a regalar expression to split at all the units
  const regex = new RegExp(`(${units.join('|')})`, 'g');

  const parts = iupac
    .split(regex)
    .filter(Boolean)
    .map((part) => ({ part }));
  for (const part of parts) {
    part.isUnit = iupacCondensedObject.hasOwnProperty(part.part);
    part.isLink = !part.isUnit;
    if (part.isUnit) {
      const unit = iupacCondensedObject[part.part];
      part.units = unit;
    }
  }
  return parts;
}
