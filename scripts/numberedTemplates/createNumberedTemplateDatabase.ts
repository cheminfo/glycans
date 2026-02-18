import { readdir, readFile, writeFile } from 'fs/promises';
import { Canonizer, Molecule } from 'openchemlib';
import { join } from 'path/posix';

const files = await readdir(join(import.meta.dirname, './templates'));

const database = [];

for (const file of files) {
  const molfile = await readFile(
    join(import.meta.dirname, './templates', file),
    'utf8',
  );
  const molecule = Molecule.fromMolfile(molfile);
  molecule.setFragment(true);
  const canonizer = new Canonizer(molecule, { encodeAtomCustomLabels: true });
  const idCode = canonizer.getIDCode();
  database.push({ file, idCode });
}

await writeFile(
  join(import.meta.dirname, '../../src/numberedTemplates.ts'),
  `export const numberedTemplates = ` + JSON.stringify(database, null, 2) + ';',
  'utf8',
);
