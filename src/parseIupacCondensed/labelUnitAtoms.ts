import { Molecule } from 'openchemlib';
import { applyFragmentLabels } from 'openchemlib-utils';

import { furanoseHexose } from './furanoseHexose.ts';
import { furanosePentose } from './furanosePentose.ts';
import { pyranoseHexose } from './pyranoseHexose.ts';

export function labelUnitAtoms(
  molecule: Molecule,
  index: number,
): { ringSize: number; relativeStereoAtom: string } {
  const furanosePentoseFragment = Molecule.fromMolfile(furanosePentose);
  furanosePentoseFragment.setFragment(true);
  const furanoseHexoseFragment = Molecule.fromMolfile(furanoseHexose);
  furanoseHexoseFragment.setFragment(true);
  const pyranoseHexoseFragment = Molecule.fromMolfile(pyranoseHexose);
  pyranoseHexoseFragment.setFragment(true);

  const nbPyranoseHexose = applyFragmentLabels(
    molecule,
    pyranoseHexoseFragment,
    {
      prefix: `${index}_`,
    },
  );
  if (nbPyranoseHexose > 0) {
    return { ringSize: 6, relativeStereoAtom: `${index}_5` };
  }

  const nbFurnanoseHexose = applyFragmentLabels(
    molecule,
    furanoseHexoseFragment,
    {
      prefix: `${index}_`,
    },
  );
  if (nbFurnanoseHexose > 0) {
    return { ringSize: 6, relativeStereoAtom: `${index}_5` };
  }

  const nbFuranosePentose = applyFragmentLabels(
    molecule,
    furanosePentoseFragment,
    {
      prefix: `${index}_`,
    },
  );
  if (nbFuranosePentose > 0) {
    return { ringSize: 5, relativeStereoAtom: `${index}_4` };
  }

  console.warn(
    `No pentose or hexose fragment found in unit ${index} (${molecule.toSmiles()})`,
  );
  throw new Error('Unknown sugar unit');
}
