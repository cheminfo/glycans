import { test } from 'vitest';

import { parseIupacCondensed } from '../parseIupacCondensed.ts';

test('NeuAc(α2-3)Gal(β1-4)GlcNAc', () => {
  const result = parseIupacCondensed('NeuAc(α2-3)Gal(β1-4)GlcNAc');
  console.log(result);
});
