import { Molecule } from 'openchemlib';
import { expect, test } from 'vitest';

import { labelUnitAtoms } from '../labelUnitAtoms.ts';

test('labels the six ring atoms 1..6 on a sialic-acid-like fragment', () => {
  const molecule = Molecule.fromSmiles(
    'C[C@H]([C@H]([C@H]1[C@@H]([C@@H](C[C@](O1)(C(=O)O)O)O)N)N)O',
  );

  labelUnitAtoms(molecule);

  const labels: Array<string | undefined> = [];
  for (let i = 0; i < molecule.getAllAtoms(); i++) {
    labels.push(molecule.getAtomCustomLabel(i) ?? undefined);
  }

  expect(labels).toStrictEqual([
    undefined,
    undefined,
    '6',
    '5',
    '4',
    '3',
    '2',
    '1',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});
