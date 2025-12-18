import { exit } from 'node:process';

import { Molecule } from 'openchemlib';

import { labelUnitAtoms } from './labelUnitAtoms.ts';
import { sugarByAbbreviation } from './sugars.ts';

const units = [
  {
    index: 0,
    name: 'Glucose',
    molecule: Molecule.fromSmiles(sugarByAbbreviation.Glc?.smiles || ''),
  },
  {
    index: 1,
    name: 'Galactose',
    molecule: Molecule.fromSmiles(sugarByAbbreviation.Gal?.smiles || ''),
  },
];

const molecule = new Molecule(0, 0);
for (const unit of units) {
  labelUnitAtoms(unit);
  molecule.addMolecule(unit.molecule);
}

molecule.inventCoordinates();

addBond(molecule, '0_1', '1_4');

molecule.inventCoordinates();

console.log(molecule.toMolfile());

function addBond(molecule: Molecule, label1: string, label2: string): void {
  const atom1 = findAtomByLabel(molecule, label1);
  const linkedOxygen1 = getLinkedOxygenAtom(molecule, atom1);
  const atom2 = findAtomByLabel(molecule, label2);
  const linkedOxygen2 = getLinkedOxygenAtom(molecule, atom2);

  const bond = molecule.addBond(atom1, linkedOxygen2);
  molecule.ensureHelperArrays(Molecule.cHelperAll);
  molecule.setBondType(bond, Molecule.cBondTypeSingle | Molecule.cBondTypeUp);
  molecule.ensureHelperArrays(Molecule.cHelperAll);
  molecule.deleteAtom(linkedOxygen1);
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
