import { expect, test } from 'vitest';

import { parseIupacCondensed } from '../parseIupacCondensed.ts';

test('Glc(β1-4)Glc maps smiles', () => {
  const result = parseIupacCondensed('Glc(β1-4)Glc');

  const smiles = result.units.map((unit) => unit.smiles);

  expect(smiles).toStrictEqual([
    'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O',
    'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O',
  ]);
});

test('NeuAc(α2-3)Gal(β1-4)GlcNAc', () => {
  const result = parseIupacCondensed('NeuAc(α2-3)Gal(β1-4)GlcNAc');
  for (const unit of result.units) {
    delete unit.molecule;
  }

  expect(result).toMatchSnapshot();
});
