import { expect, test } from 'vitest';

import { fromIupacCondensed } from '../fromIupacCondensed.ts';

test('fromIupacCondensed is currently a stub returning an empty molecule', () => {
  const molecule = fromIupacCondensed('NeuAc(α2-3)Gal(β1-4)GlcNAc');

  expect(molecule.getAllAtoms()).toBe(0);
  expect(molecule.toSmiles()).toBe('');
});
