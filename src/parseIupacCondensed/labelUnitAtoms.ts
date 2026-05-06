import { Molecule } from 'openchemlib';
import { applyFragmentLabels } from 'openchemlib-utils';

import { furanoseHexose } from './furanoseHexose.ts';
import { furanosePentose } from './furanosePentose.ts';
import { pyranoseHexose } from './pyranoseHexose.ts';

/**
 * Label the atoms of a single sugar unit with `<index>_<position>` custom
 * labels (e.g. `0_1`, `0_2`, ..., `0_6`) by matching the molecule against the
 * known pyranose-hexose, furanose-hexose, and furanose-pentose templates in
 * order. Mutates `molecule` in place.
 * @param molecule - Sugar unit whose atoms should be labeled.
 * @param index - Zero-based index of the unit in the parent glycan, used as
 *   the label prefix so atoms across different units stay distinguishable.
 * @returns Ring size of the matched template (5 or 6) and the label of the
 *   atom whose chirality is used as reference for α/β glycosidic bonds.
 * @throws {Error} If no pentose or hexose template matches.
 */
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

  throw new Error(
    `No pentose or hexose fragment found in unit ${index} (${molecule.toIsomericSmiles()})`,
  );
}
