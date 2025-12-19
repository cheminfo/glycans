import { expect, test } from 'vitest';

import { parseIupacCondensed } from '../parseIupacCondensed.ts';

test('NeuAc(α2-3)Gal(β1-4)GlcNAc', () => {
  const result = parseIupacCondensed('NeuAc(α2-3)Gal(β1-4)GlcNAc');
  for (const unit of result.units) {
    delete unit.molecule;
  }

  expect(result).toMatchSnapshot();
});
