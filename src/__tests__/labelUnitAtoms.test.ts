import { Molecule } from 'openchemlib';
import { test } from 'vitest';

import { labelUnitAtoms } from '../labelUnitAtoms.ts';

test('C[C@H]([C@H]([C@H]1[C@@H]([C@@H](C[C@](O1)(C(=O)O)O)O)N)N)O', () => {
  const smiles = 'C[C@H]([C@H]([C@H]1[C@@H]([C@@H](C[C@](O1)(C(=O)O)O)O)N)N)O';
  const molecule = Molecule.fromSmiles(smiles);

  labelUnitAtoms(molecule);

  console.log(molecule.toMolfile());
});
