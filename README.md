# glycans

[![NPM version](https://img.shields.io/npm/v/glycans.svg)](https://www.npmjs.com/package/glycans)
[![npm download](https://img.shields.io/npm/dm/glycans.svg)](https://www.npmjs.com/package/glycans)
[![test coverage](https://img.shields.io/codecov/c/github/cheminfo/glycans.svg)](https://codecov.io/gh/cheminfo/glycans)
[![license](https://img.shields.io/npm/l/glycans.svg)](https://github.com/cheminfo/glycans/blob/main/LICENSE)

> **Work in progress.** This library is under active development. APIs may change without notice.

TypeScript library for working with glycans: parsing IUPAC condensed notation, building 2D molecular structures, and performing mass spectrometry fragmentation analysis.

## Features

- **IUPAC condensed parsing** — parse glycan sequences such as `Glc(β1-4)Glc` or `NeuAc(α2-3)Gal(β1-4)GlcNAc` into structured unit and link objects
- **Molecule assembly** — reconstruct a full glycan molecule (OpenChemLib `Molecule`) from parsed units with correct stereochemistry at glycosidic bonds (α/β)
- **Fragmentation benchmark tooling** — scripts for running MS² and MS³ fragmentation predictions against reference spectra, with parallel worker support and ranked candidate output

## Supported monosaccharides

Hexoses (pyranose and furanose forms), pentoses, and common derivatives including GlcNAc, GalNAc, NeuAc, Fuc, and others. See [`src/sugars.ts`](src/sugars.ts) for the full list.

## Installation

```console
npm install glycans
```

## Usage

### Parse IUPAC condensed notation

```ts
import { parseIupacCondensed } from 'glycans';

const parsed = parseIupacCondensed('Glc(β1-4)Glc');
// parsed.units — array of monosaccharide units with SMILES and atom labels
// parsed.links — array of glycosidic bond descriptors
```

### Get an OpenChemLib molecule

```ts
import { getMoleculeFromIupacCondensed } from 'glycans';

const molecule = getMoleculeFromIupacCondensed('Glc(β1-4)Glc');
console.log(molecule.toMolfile());
```

## Development

```console
npm install
npm test
```

Run the fragmentation benchmark (requires benchmark data in `src/benchmark/data/`):

```console
npm run benchmark
```

## License

[MIT](./LICENSE)
