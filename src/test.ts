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
    name: 'Glucose',
    molecule: Molecule.fromSmiles(sugarByAbbreviation.Glc?.smiles || ''),
  },
  {
    index: 2,
    name: 'Glucose',
    molecule: Molecule.fromSmiles(sugarByAbbreviation.Glc?.smiles || ''),
  },
];

const molecule = new Molecule(0, 0);
for (const unit of units) {
  labelUnitAtoms(unit);
  molecule.addMolecule(unit.molecule);
}

molecule.inventCoordinates();

addBond(molecule, {
  from: '0_1',
  to: '1_4',
  type: 'beta',
  relativeTo: '0_5',
});

addBond(molecule, {
  from: '1_1',
  to: '2_4',
  type: 'beta',
  relativeTo: '1_5',
});

molecule.ensureHelperArrays(Molecule.cHelperAll);
molecule.inventCoordinates();

console.log(molecule.toMolfile());

function addBond(molecule: Molecule, options): void {
  const { from, to, type, relativeTo } = options;
  const atom1 = findAtomByLabel(molecule, from);
  const linkedOxygen1 = getLinkedOxygenAtom(molecule, atom1);
  const atom2 = findAtomByLabel(molecule, to);
  const linkedOxygen2 = getLinkedOxygenAtom(molecule, atom2);

  const relativeToAtom = findAtomByLabel(molecule, relativeTo);
  const relativeChirality = getChiralBondKind(molecule, relativeToAtom);

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
