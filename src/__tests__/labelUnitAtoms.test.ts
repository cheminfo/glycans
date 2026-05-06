import { Molecule } from 'openchemlib';
import { test } from 'vitest';

import { labelUnitAtoms } from '../labelUnitAtoms.ts';

// eslint-disable-next-line vitest/expect-expect
test('C[C@H]([C@H]([C@H]1[C@@H]([C@@H](C[C@](O1)(C(=O)O)O)O)N)N)O', () => {
  const smiles = 'C[C@H]([C@H]([C@H]1[C@@H]([C@@H](C[C@](O1)(C(=O)O)O)O)N)N)O';
  const molecule = Molecule.fromSmiles(smiles);

  labelUnitAtoms(molecule);

  // eslint-disable-next-line no-console
  console.log(molecule.toMolfile());
});
