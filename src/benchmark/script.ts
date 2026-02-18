import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { reactionFragmentation } from 'mass-fragmentation';
import { MSComparator } from 'ms-spectrum';

import { loadData } from './loadData.ts';

const data = await loadData(join(import.meta.dirname, 'data'));

const dwar = await readFile(
  join(import.meta.dirname, '../reactions/glycansReactions.dwar'),
  'utf8',
);

const massPower = 3;
const intensityPower = 0.6;
const precision = 10;

const msComparator = new MSComparator({
  delta: (mass) => mass * 1e-6 * precision,
  massPower,
  intensityPower,
});

const options = {
  ionizations: ['esi'],
  modes: ['positive'],
  dwar,
  maxDepth: 3,
  limitReactions: 2,
  minIonizations: 1,
  maxIonizations: 1,
  minReactions: 0,
  maxReactions: 3,
};

for (const datum of data) {
  const fragments = reactionFragmentation(datum.molecule, options);

  const masses = fragments.masses.map((mass) => mass.mz);
  // console.log(masses);

  for (const spectrum of datum.spectra) {
    console.log(spectrum.value);
    const score = msComparator.getSimilarityToMasses(spectrum.value, masses);
    console.log(score);
  }
}
//console.log(data);
