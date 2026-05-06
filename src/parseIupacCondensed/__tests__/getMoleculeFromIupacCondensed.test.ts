import { test } from 'vitest';

import { getMoleculeFromIupacCondensed } from '../getMoleculeFromIupacCondensed.ts';

// eslint-disable-next-line vitest/expect-expect
test('NeuAc(α2-3)Gal(β1-4)GlcNAc', () => {
  //const result = getMoleculeFromIupacCondensed('NeuAc(α2-3)Gal(β1-4)GlcNAc');
  getMoleculeFromIupacCondensed('Glc(α1-3)Glc(β1-4)Glc');

  //  console.log(result);
});
