import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { convert } from 'jcampconverter';
import { Spectrum } from 'ms-spectrum';
import { Molecule } from 'openchemlib';

/** A peak-picked MS2 spectrum with its source filename. */
export interface SpectrumEntry {
  /** Original JCAMP-DX filename. */
  name: string;
  /** Peak-picked spectrum as x/y arrays. */
  value: { x: number[]; y: number[] };
}

/** Benchmark datum associating a molecule with its MS2 spectra. */
export interface MoleculeData {
  /** Name of the source data folder. */
  folderName: string;
  /** Raw molfile content. */
  molfile: string;
  /** Parsed OpenChemLib molecule instance. */
  molecule: Molecule;
  /** Associated MS2 spectra extracted from JCAMP-DX files. */
  spectra: SpectrumEntry[];
}

/**
 * Read a DataWarrior (DWAR) file as a UTF-8 string.
 * @param filePath - Absolute path to the `.dwar` file.
 * @returns The raw DWAR content.
 */
export async function loadDwar(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}

/**
 * Load benchmark data from a directory of molecule/spectra folders.
 *
 * Each subfolder is expected to contain exactly one `.mol` file and
 * optionally one or more MS2 JCAMP-DX (`.jdx`) spectra files.
 * Folders without exactly one `.mol` file are silently skipped.
 * @param basePath - Absolute path to the data directory.
 * @returns An array of molecule data with associated peak-picked MS2 spectra.
 */
export async function loadData(basePath: string): Promise<MoleculeData[]> {
  const dirEntries = await readdir(basePath, { withFileTypes: true });
  const folders = dirEntries
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  const results = await Promise.all(
    folders.map(async (folder): Promise<MoleculeData | null> => {
      const folderPath = join(basePath, folder);
      const files = await readdir(folderPath);

      const molfiles = files.filter((file) =>
        file.toLowerCase().endsWith('.mol'),
      );
      if (molfiles.length !== 1) return null;

      const molfileName = molfiles[0];
      if (!molfileName) return null;

      const molfile = await readFile(join(folderPath, molfileName), 'utf8');
      const molecule = Molecule.fromMolfile(molfile);

      // Collect MS2 JCAMP-DX spectra
      const jcampNames = files
        .filter((file) => file.toLowerCase().endsWith('.jdx'))
        .filter((file) => file.toLowerCase().includes('ms2'));

      const spectra: SpectrumEntry[] = await Promise.all(
        jcampNames.map(async (name): Promise<SpectrumEntry> => {
          const jcamp = await readFile(join(folderPath, name), 'utf8');
          const converted = convert(jcamp);

          const entry = converted.flatten[0];
          const spectrumData = entry?.spectra[0]?.data;
          if (!spectrumData?.x || !spectrumData?.y) {
            throw new Error(`No spectrum data found in ${name}`);
          }

          const spectrum = new Spectrum({
            x: spectrumData.x,
            y: spectrumData.y,
          }).getPeaksAsDataXY({});

          return { name, value: spectrum };
        }),
      );

      return { folderName: folder, molfile, molecule, spectra };
    }),
  );

  return results.filter((datum): datum is MoleculeData => datum !== null);
}
