import { Molecule } from 'openchemlib';

import type { ParsedLink } from './parseIupacCondensed.ts';
import { parseIupacCondensed } from './parseIupacCondensed.ts';

/**
 * Build an OpenChemLib `Molecule` from an IUPAC condensed glycan string.
 *
 * Each sugar unit is loaded from its SMILES, atoms are labeled with their
 * ring position, and units are then connected via α/β glycosidic bonds at
 * the positions encoded in the link parts (e.g. `(α1-3)`). The displaced
 * anomeric oxygen is removed at every junction.
 * @param iupac - IUPAC condensed glycan, e.g. `Glc(α1-3)Glc(β1-4)Glc`.
 * @returns The assembled molecule.
 */
export function getMoleculeFromIupacCondensed(iupac: string): Molecule {
  const parsed = parseIupacCondensed(iupac);

  const molecule = new Molecule(0, 0);
  for (const unit of parsed.units) {
    if (unit.molecule) molecule.addMolecule(unit.molecule);
  }

  molecule.inventCoordinates();

  for (const link of parsed.links) {
    addBond(molecule, link);
  }

  molecule.ensureHelperArrays(Molecule.cHelperAll);
  molecule.inventCoordinates();

  return molecule;
}

function addBond(molecule: Molecule, link: ParsedLink): void {
  const parts = link.type.match(/([^\d]+)([0-9]+-[0-9]+)$/)?.slice(1);
  if (!parts) throw new Error(`Invalid link type: ${link.type}`);

  const [rawType, positions] = parts;
  if (!positions) {
    throw new Error(`Invalid link type format: ${link.type}`);
  }
  const [fromPos, toPos] = positions.split('-');
  const from = `${String(link.from)}_${fromPos ?? ''}`;
  const to = `${String(link.to)}_${toPos ?? ''}`;
  const type = ['alpha', '⍺', 'α'].includes(rawType ?? '') ? 'alpha' : 'beta';

  const atom1 = findAtomByLabel(molecule, from);
  const linkedOxygen1 = getLinkedOxygenAtom(molecule, atom1);
  const atom2 = findAtomByLabel(molecule, to);
  const linkedOxygen2 = getLinkedOxygenAtom(molecule, atom2);

  if (!link.relativeStereoFrom) throw new Error('Missing relativeStereoFrom');
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
  } else {
    molecule.setBondType(bond, Molecule.cBondTypeSingle | relativeChirality);
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
  throw new Error(`No chiral bond found for atom ${atom}`);
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
  throw new Error(`No oxygen atom linked to atom ${atom}`);
}

function findAtomByLabel(molecule: Molecule, label: string): number {
  const nbAtoms = molecule.getAllAtoms();
  for (let i = 0; i < nbAtoms; i++) {
    const atomLabel = molecule.getAtomCustomLabel(i);
    if (atomLabel === label) {
      return i;
    }
  }
  throw new Error(`Atom with label ${label} not found`);
}
