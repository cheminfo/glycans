import { Molecule } from 'openchemlib';
import { applyFragmentLabels } from 'openchemlib-utils';

import { numberedTemplates } from './numberedTemplates.ts';

export function labelUnitAtoms(molecule: Molecule): void {
  for (const numberedTemplate of numberedTemplates) {
    const template = Molecule.fromIDCode(numberedTemplate.idCode);
    const nbMatch = applyFragmentLabels(molecule, template, {
      algorithm: 'firstMatch',
    });
    console.log(nbMatch);
    if (nbMatch > 0) {
      break;
    }
  }
}
