import { expect, test } from 'vitest';

import * as glycans from '../index.ts';
import { getMoleculeFromIupacCondensed } from '../index.ts';

test('exposes exactly the expected public API', () => {
  expect(Object.keys(glycans).toSorted()).toStrictEqual([
    'getMoleculeFromIupacCondensed',
    'iupacCondensedObject',
    'parseIupacCondensed',
    'sugars',
  ]);

  expect(typeof glycans.getMoleculeFromIupacCondensed).toBe('function');
  expect(typeof glycans.parseIupacCondensed).toBe('function');
  expect(Array.isArray(glycans.sugars)).toBe(true);
  expect(typeof glycans.iupacCondensedObject).toBe('object');
});

test('Glc(β1-4)Glc → cellobiose', () => {
  const molecule = getMoleculeFromIupacCondensed('Glc(β1-4)Glc');

  expect(molecule.getMolecularFormula().formula).toBe('C12H22O11');
  expect(molecule.getIDCode()).toBe(
    'fncAh@@XDkSoQsUnRJJIQISFJF[TeDmUUUUUUUThQDHjKddcJrC@@',
  );
});

test('Glc(α1-3)Glc(β1-4)Glc trisaccharide', () => {
  const molecule = getMoleculeFromIupacCondensed('Glc(α1-3)Glc(β1-4)Glc');

  expect(molecule.getMolecularFormula().formula).toBe('C18H32O16');
  expect(molecule.getIDCode()).toBe(
    'edRP@`@@LAEMGOHbfnimo`X\\dTTRbRfLTVfTvTtrUDdUQuuUUUUUUUUUUUSdDPaBhWDdQblPTr`rVarnP@',
  );
});
