import { expect, test } from 'vitest';

import * as glycans from '../index.ts';

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
