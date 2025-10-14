import { Molecule } from 'openchemlib';
import { sugars } from './sugars.js';
import type { Sugar } from './Sugar.ts';
/**
 * @see https://www.glycoforum.gr.jp/article/22A2.html#mokuji02
 * @param iupac
 */
export function fromIupacCondensed(iupac: string): string {
  const parsed = parse(iupac);

  const units = sugars.map((sugar: Sugar) => sugar.iupacCondensed);
  // sort by length to have the longest match first
  units.sort((a, b) => b.length - a.length);
  // use a regalar expression to split at all the units
  const regex = new RegExp(`(${units.join('|')})`, 'g');
  const parts = iupac.split(regex).filter((part) => part);
  console.log(parts);
  const mol = new Molecule();
}

function parse(iupac: string) {
  // TODO
}
