import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { convert } from 'jcampconverter';
import { Spectrum } from 'ms-spectrum';
import { Molecule } from 'openchemlib';

export async function loadData(basePath: string) {
  const folders = (
    await readdir(basePath, {
      withFileTypes: true,
    })
  )
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
  const data = [];

  for (const folder of folders) {
    const files = await readdir(join(basePath, folder));
    const molfiles = (await readdir(join(basePath, folder))).filter((file) =>
      file.toLowerCase().endsWith('.mol'),
    );
    if (molfiles.length !== 1) continue;

    const molfile = await readFile(join(basePath, folder, molfiles[0]), 'utf8');
    const molecule = Molecule.fromMolfile(molfile);

    const datum = {
      molfile,
      molecule,
      spectra: [],
    };
    data.push(datum);

    const jcampNames = files
      .filter((file) => file.toLowerCase().endsWith('.jdx'))
      .filter((file) => file.toLowerCase().includes('ms2'));
    for (const name of jcampNames) {
      const jcamp = await readFile(join(basePath, folder, name), 'utf8');
      const converted = convert(jcamp);

      const spectrum = new Spectrum(
        converted.flatten[0].spectra[0].data,
      ).getPeaksAsDataXY({});

      datum.spectra.push({
        name,
        value: spectrum,
      });
    }
  }
  return data;
}
