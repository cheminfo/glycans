import { readFile, writeFile } from 'node:fs/promises';
import PapaParse from 'papaparse';
import { join } from 'node:path';
import { Molecule } from 'openchemlib';

const { parse } = PapaParse;

const text = await readFile(
  join(import.meta.dirname, 'SugarUnitsSMILES.tsv'),
  'utf8',
);

const headersMapping = {
  Abbreviation: 'abbreviation',
  'Short Name': 'shortName',
  'IUPAC Condensed name': 'iupacCondensed',
  SMILES: 'smiles',
};

const lines = parse(text, {
  delimiter: '\t',
  header: true,
  skipEmptyLines: true,
  transformHeader: (header) =>
    headersMapping[header as keyof typeof headersMapping] ?? header,
}).data;

appendICCode(lines);

function appendICCode(lines: any[]) {
  for (const line of lines) {
    const molecule = Molecule.fromSmiles(line.smiles);
    // todo number the atoms in the molecule
    line.idCode = molecule.getIDCode();
  }
}

await writeFile(
  join(import.meta.dirname, '../../src/sugars.ts'),
  `import { Sugar } from './Sugar.ts';
export const sugars: Sugar[] = ` +
    JSON.stringify(lines, null, 2) +
    ';',
  'utf8',
);
