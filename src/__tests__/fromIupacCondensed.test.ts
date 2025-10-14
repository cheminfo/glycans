import { test } from 'vitest';

import { fromIupacCondensed } from '../fromIupacCondensed.ts';

test('NeuAc(α2-3)Gal(β1-4)GlcNAc', () => {
  const iupac = 'NeuAc(α2-3)Gal(β1-4)GlcNAc';
  const molecule = fromIupacCondensed(iupac);
  console.log(molecule.toSmiles());
});
