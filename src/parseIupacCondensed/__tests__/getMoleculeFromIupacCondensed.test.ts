import * as OCL from 'openchemlib';
import { expect, test } from 'vitest';

import { getMoleculeFromIupacCondensed } from '../getMoleculeFromIupacCondensed.ts';

test('Glc(β1-4)Glc → cellobiose', () => {
  const molecule = getMoleculeFromIupacCondensed(OCL, 'Glc(β1-4)Glc');

  expect(molecule.getMolecularFormula().formula).toBe('C12H22O11');
  expect(molecule.getIDCode()).toBe(
    'fncAh@@XDkSoQsUnRJJIQISFJF[TeDmUUUUUUUThQDHjKddcJrC@@',
  );
});

test('Glc(α1-3)Glc(β1-4)Glc trisaccharide', () => {
  const molecule = getMoleculeFromIupacCondensed(OCL, 'Glc(α1-3)Glc(β1-4)Glc');

  expect(molecule.getMolecularFormula().formula).toBe('C18H32O16');
  expect(molecule.getIDCode()).toBe(
    'edRP@`@@LAEMGOHbfnimo`X\\dTTRbRfLTVfTvTtrUDdUQuuUUUUUUUUUUUSdDPaBhWDdQblPTr`rVarnP@',
  );
});
