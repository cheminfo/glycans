import { Molecule } from 'openchemlib';
import { applyFragmentLabels } from 'openchemlib-utils';

import { numberedTemplates } from './numberedTemplates.ts';

/**
 * Label the ring atoms of a single sugar unit with their canonical position
 * numbers ('1', '2', ..., '6') by matching against the numbered templates in
 * `numberedTemplates`. The first template that matches wins; mutates
 * `molecule` in place by setting atom custom labels.
 * @param molecule - Sugar molecule whose atoms should be labeled.
 */
export function labelUnitAtoms(molecule: Molecule): void {
  for (const numberedTemplate of numberedTemplates) {
    const template = Molecule.fromIDCode(numberedTemplate.idCode);
    const nbMatch = applyFragmentLabels(molecule, template, {
      algorithm: 'firstMatch',
    });
    if (nbMatch > 0) {
      break;
    }
  }
}
