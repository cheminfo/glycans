import { Molecule } from 'openchemlib';
import { applyFragmentLabels } from 'openchemlib-utils';
import { hexose } from './hexose.ts';
import { pentose } from './pentose.ts';

export function labelUnitAtoms(molecule, index): { ringSize?: number } {
  const pentoseFragment = Molecule.fromMolfile(pentose);
  pentoseFragment.setFragment(true);
  const hexoseFragment = Molecule.fromMolfile(hexose);
  hexoseFragment.setFragment(true);

  const nbPentose = applyFragmentLabels(molecule, pentoseFragment, {
    prefix: `${index}_`,
  });
  if (nbPentose > 0) {
    return { ringSize: 5 };
  }
  const nbHexose = applyFragmentLabels(molecule, hexoseFragment, {
    prefix: `${index}_`,
  });
  if (nbHexose > 0) {
    return { ringSize: 6 };
  }
  console.warn(
    `No pentose or hexose fragment found in unit ${index} (${molecule.toSmiles()})`,
  );
}
