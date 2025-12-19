import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Molecule } from 'openchemlib';

import { parseIupacCondensed } from './parseIupacCondensed.ts';

export function getMoleculeFromIupacCondensed(iupac: string): Molecule {
  const parsed = parseIupacCondensed(iupac);

  const molecule = new Molecule(0, 0);
  for (const unit of parsed.units) {
    molecule.addMolecule(unit.molecule);
  }

  molecule.inventCoordinates();

  for (const link of parsed.links) {
    addBond(molecule, link);
  }

  molecule.ensureHelperArrays(Molecule.cHelperAll);
  molecule.inventCoordinates();
  writeFileSync(join(import.meta.dirname, 'debug.mol'), molecule.toMolfile());
  console.log(molecule.toMolfile());

  return molecule;
}

function addBond(molecule: Molecule, link): void {
  const parts = link.type.match(/([^\d]+)([0-9]+)\-([0-9]+)$/).slice(1);

  const from = `${link.from}_${parts[1]}`;
  const to = `${link.to}_${parts[2]}`;
  const type = ['alpha', '⍺', 'α'].includes(parts[0]) ? 'alpha' : 'beta';

  const atom1 = findAtomByLabel(molecule, from);
  const linkedOxygen1 = getLinkedOxygenAtom(molecule, atom1);
  const atom2 = findAtomByLabel(molecule, to);
  const linkedOxygen2 = getLinkedOxygenAtom(molecule, atom2);

  const relativeStereoFromAtom = findAtomByLabel(
    molecule,
    link.relativeStereoFrom,
  );
  const relativeChirality = getChiralBondKind(molecule, relativeStereoFromAtom);

  const bond = molecule.addBond(atom1, linkedOxygen2);

  if (type === 'alpha') {
    molecule.setBondType(
      bond,
      Molecule.cBondTypeSingle |
        (relativeChirality === Molecule.cBondTypeUp
          ? Molecule.cBondTypeDown
          : Molecule.cBondTypeUp),
    );
  } else if (type === 'beta') {
    molecule.setBondType(bond, Molecule.cBondTypeSingle | relativeChirality);
  } else {
    console.error(`Unknown bond type: ${type}`);
    exit(1);
  }
  molecule.deleteAtom(linkedOxygen1);
}

function getChiralBondKind(molecule: Molecule, atom: number): number {
  const nbConnected = molecule.getAllConnAtoms(atom);
  for (let i = 0; i < nbConnected; i++) {
    const connectedAtom = molecule.getConnAtom(atom, i);
    const bond = molecule.getBond(atom, connectedAtom);
    const bondType = molecule.getBondType(bond);
    if ((bondType & Molecule.cBondTypeUp) === Molecule.cBondTypeUp) {
      return bondType & Molecule.cBondTypeUp;
    }
    if ((bondType & Molecule.cBondTypeDown) === Molecule.cBondTypeDown) {
      return bondType & Molecule.cBondTypeDown;
    }
  }
  console.error(`No chiral bond found for atom ${atom}`);
  exit(1);
}

function getLinkedOxygenAtom(molecule: Molecule, atom: number): number {
  const nbConnected = molecule.getAllConnAtoms(atom);
  for (let i = 0; i < nbConnected; i++) {
    const connectedAtom = molecule.getConnAtom(atom, i);
    if (
      molecule.getAtomicNo(connectedAtom) === 8 &&
      molecule.getAllHydrogens(connectedAtom) === 1
    ) {
      return connectedAtom;
    }
  }
  console.error(`No oxygen atom linked to atom ${atom}`);
  exit(1);
}

function findAtomByLabel(molecule: Molecule, label: string): number {
  const nbAtoms = molecule.getAllAtoms();
  for (let i = 0; i < nbAtoms; i++) {
    const atomLabel = molecule.getAtomCustomLabel(i);
    if (atomLabel === label) {
      return i;
    }
  }
  console.error(`Atom with label ${label} not found`);
  exit(1);
}
