import { test } from 'vitest';

import { fromIupacCondensed } from '../fromIupacCondensed.ts';

// eslint-disable-next-line vitest/expect-expect
test('NeuAc(α2-3)Gal(β1-4)GlcNAc', () => {
  const iupac = 'NeuAc(α2-3)Gal(β1-4)GlcNAc';
  const molecule = fromIupacCondensed(iupac);
  // eslint-disable-next-line no-console
  console.log(molecule.toSmiles());
});
