/**
 * Quick MS3 analysis: fragment a molecule, locate the isolated precursor
 * node in the fragmentation tree, and score only its sub-fragments against
 * the experimental MS3 spectrum.
 *
 * Outputs two scores per adduct:
 * - **full-tree**: all predicted masses vs the MS3 spectrum (baseline).
 * - **subtree-{mz}**: only descendants of the precursor node (the MS3-
 *   correct approach — these are the fragments that could actually appear
 *   after isolating that specific ion).
 *
 * ── Configuration (edit the constants below) ────────────────────────────
 *  MOLECULE_FOLDER  — subfolder under data/ containing molecule.mol + ms3 jdx
 *  MS3_FILE         — filename of the MS3 JCAMP-DX spectrum
 *  PRECURSOR_MZ     — m/z of the ion isolated for MS3
 *  PRECURSOR_PPM    — accuracy (ppm) for matching the precursor node
 *
 * Usage:
 *   node --no-warnings src/benchmark/quickMs3.ts
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { convert } from 'jcampconverter';
// eslint-disable-next-line import/no-extraneous-dependencies
import { JSDOM } from 'jsdom';
import {
  getFragmentationSVG,
  reactionFragmentation,
} from 'mass-fragmentation';
import { Spectrum } from 'ms-spectrum';
import * as OCL from 'openchemlib';

import type { FragmentationOptions } from './utils/dwar/filterDwarIonization.ts';
import {
  filterDwarByIonization,
  getPositiveIonizationLabels,
} from './utils/dwar/filterDwarIonization.ts';
import {
  createComparator,
  formatTable,
  loadDwar,
  sanitize,
  scoreSpectrum,
} from './utils/index.ts';

// ── DOM setup (required by react-tree-svg inside getFragmentationSVG) ───
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.document = dom.window.document as unknown as Document;
globalThis.window = dom.window as unknown as Window & typeof globalThis;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

/* eslint-disable no-console */

// ═══════════════════════════════════════════════════════════════════════
// ── User-configurable parameters ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

/** Subfolder name inside data/ (also used for the results folder). */
const MOLECULE_FOLDER = 'Lactodifucotetraose';

/** MS3 JCAMP-DX filename inside the data subfolder. */
const MS3_FILE = 'ms3_512.00@cid24.00.jdx';

/** m/z of the ion isolated before MS3 fragmentation. */
const PRECURSOR_MZ = 511.1633;

/** Accuracy in ppm for matching the precursor node in the tree. */
const PRECURSOR_PPM = 20;

// ═══════════════════════════════════════════════════════════════════════

const dataDir = join(import.meta.dirname, 'data', MOLECULE_FOLDER);
const resultsDir = join(
  import.meta.dirname,
  'results',
  `${sanitize(MOLECULE_FOLDER)}-ms3`,
);
await mkdir(resultsDir, { recursive: true });

// ── Load molecule ───────────────────────────────────────────────────────
const molfile = await readFile(join(dataDir, 'molecule.mol'), 'utf8');
const molecule = OCL.Molecule.fromMolfile(molfile);

// ── Load MS3 spectrum ───────────────────────────────────────────────────
const jcamp = await readFile(join(dataDir, MS3_FILE), 'utf8');
const converted = convert(jcamp);
const entry = converted.flatten[0];
const spectrumData = entry?.spectra[0]?.data;
if (!spectrumData?.x || !spectrumData?.y) {
  throw new Error(`No spectrum data in ${MS3_FILE}`);
}
const ms3 = new Spectrum({
  x: spectrumData.x,
  y: spectrumData.y,
}).getPeaksAsDataXY({});

console.log(`MS3 spectrum: ${String(ms3.x.length)} peaks`);
console.log(
  `Precursor: ${String(PRECURSOR_MZ)} m/z (±${String(PRECURSOR_PPM)} ppm)\n`,
);

// ── Load DWAR ───────────────────────────────────────────────────────────
const dwar = await loadDwar(
  join(import.meta.dirname, '../reactions/glycansReactions.dwar'),
);

// ── Fragmentation & scoring options ─────────────────────────────────────
const fragmentationOptions: FragmentationOptions = {
  ionizations: ['esi'] as Array<'esi' | 'ei'>,
  modes: ['positive'] as Array<'positive' | 'negative'>,
  maxDepth: 8,
  limitReactions: 800,
  minIonizations: 1,
  maxIonizations: 1,
  minReactions: 0,
  maxReactions: 5,
};

const massPower = 3;
const intensityPower = 0.6;
const precision = 20;
const comparator = createComparator({ massPower, intensityPower, precision });
const excludeLabels = new Set(['Ionization-K']);

// ── Tree-node helpers ───────────────────────────────────────────────────

interface MolInfo {
  mz: number;
  mw: number;
  em: number;
  mf: string;
  charge: number;
}

interface TreeNode {
  molecules: Array<{ info: MolInfo; idCode?: string }>;
  children?: TreeNode[];
  depth?: number;
  isValid?: boolean;
  reaction?: unknown;
  /** Stable identity assigned at tree-walk time (not part of the library). */
  uid?: number;
}

interface Reactions {
  trees: TreeNode[];
  getFilteredReactions: (opts: {
    filter: (node: TreeNode) => boolean;
  }) => { trees: TreeNode[] };
}

/**
 * Walk the tree and return all nodes whose m/z matches the target within ppm.
 * Once a match is found, its subtree is not searched further.
 * @param trees
 * @param mz
 * @param ppm
 */
function findPrecursorNodes(
  trees: TreeNode[],
  mz: number,
  ppm: number,
): TreeNode[] {
  const found: TreeNode[] = [];
  function walk(node: TreeNode): void {
    for (const mol of node.molecules) {
      const tolerance = mol.info.mz * 1e-6 * ppm;
      if (Math.abs(mol.info.mz - mz) <= tolerance) {
        found.push(node);
        return; // don't recurse — we want the subtree root
      }
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  }
  for (const tree of trees) {
    walk(tree);
  }
  return found;
}

/**
 * Recursively collect all descendant *node references* (children,
 * grandchildren, …) from a node. The node itself is NOT included.
 * @param node
 */
function collectDescendantNodes(node: TreeNode): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (const child of node.children ?? []) {
    nodes.push(child);
    nodes.push(...collectDescendantNodes(child));
  }
  return nodes;
}

/**
 * Build a Set of every tree-node *object reference* that is a
 * descendant of one of the given precursor nodes.
 *
 * Checking by reference (not by m/z value) ensures that a node at
 * e.g. m/z 365 reached via a path that does NOT pass through 511 is
 * correctly rejected, even though another path 511 → … → 365 exists.
 * @param precursorNodes
 */
function buildDescendantNodeSet(
  precursorNodes: TreeNode[],
): Set<TreeNode> {
  const nodeSet = new Set<TreeNode>();
  for (const precursor of precursorNodes) {
    for (const desc of collectDescendantNodes(precursor)) {
      nodeSet.add(desc);
    }
  }
  return nodeSet;
}

/**
 * Extract unique, sorted m/z values from a set of tree nodes.
 * @param nodes
 */
function extractMasses(nodes: Set<TreeNode> | TreeNode[]): number[] {
  const mzSet = new Set<number>();
  for (const node of nodes) {
    for (const mol of node.molecules) {
      mzSet.add(mol.info.mz);
    }
  }
  return [...mzSet].toSorted((a, b) => a - b);
}

// ── UID assignment & structural maps ────────────────────────────────────

let uidCounter = 0;

/**
 * Primary m/z of a node (first molecule), or '?' if no molecules.
 * @param node
 */
function nodeMz(node: TreeNode): string {
  const mz = node.molecules[0]?.info?.mz;
  return mz !== undefined ? mz.toFixed(4) : '?';
}

/**
 * Walk the original tree and:
 *  1. Assign a unique `.uid` to every node.
 *  2. Build parentMap  (childUid → parentUid).
 *  3. Build childrenMap (parentUid → Set<childUid>).
 *  4. Build uidToNode   (uid → original TreeNode ref).
 * @param trees
 */
function assignUidsAndBuildMaps(trees: TreeNode[]) {
  const parentMap = new Map<number, number>();
  const childrenMap = new Map<number, Set<number>>();
  const uidToNode = new Map<number, TreeNode>();

  function walk(node: TreeNode, parentUid: number | null): void {
    const uid = uidCounter++;
    node.uid = uid;
    uidToNode.set(uid, node);
    childrenMap.set(uid, new Set());

    if (parentUid !== null) {
      parentMap.set(uid, parentUid);
      childrenMap.get(parentUid)!.add(uid);
    }

    for (const child of node.children ?? []) {
      walk(child, uid);
    }
  }

  for (const root of trees) {
    walk(root, null);
  }

  return { parentMap, childrenMap, uidToNode };
}

/**
 * Build the full ancestor path (uid chain) from a node uid back to a root.
 * Returns an array from root → … → uid.
 * @param uid
 * @param parentMap
 */
function getAncestorPath(
  uid: number,
  parentMap: Map<number, number>,
): number[] {
  const path: number[] = [uid];
  let current = uid;
  while (parentMap.has(current)) {
    current = parentMap.get(current)!;
    path.unshift(current);
  }
  return path;
}

/**
 * Verify every edge in the filtered tree against the original structural
 * maps and return verification log lines.
 * @param filteredTrees
 * @param originalChildrenMap
 * @param originalParentMap
 * @param uidToNode
 * @param precursorUids
 * @param experimentalPeaks
 * @param ppm
 */
function verifyFilteredTree(
  filteredTrees: TreeNode[],
  originalChildrenMap: Map<number, Set<number>>,
  originalParentMap: Map<number, number>,
  uidToNode: Map<number, TreeNode>,
  precursorUids: Set<number>,
  experimentalPeaks: Array<{ mass: number; intensity: number }>,
  ppm: number,
): string[] {
  const lines: string[] = [];
  let edgeCount = 0;
  let validEdges = 0;
  let invalidEdges = 0;

  // Walk filtered tree, verify each parent→child edge.
  function walkFiltered(node: TreeNode, parentNode: TreeNode | null): void {
    const uid = node.uid!;
    if (parentNode !== null) {
      const parentUid = parentNode.uid!;
      const exists = originalChildrenMap.get(parentUid)?.has(uid) ?? false;
      edgeCount++;
      if (exists) {
        validEdges++;
      } else {
        invalidEdges++;
      }
      lines.push(
        `EDGE uid${String(parentUid)}(${nodeMz(parentNode)}) -> uid${String(uid)}(${nodeMz(node)}) existsInOriginal=${String(exists)}`,
      );
    }
    for (const child of node.children ?? []) {
      walkFiltered(child, node);
    }
  }

  for (const root of filteredTrees) {
    walkFiltered(root, null);
  }

  lines.push('');
  lines.push(`Edge summary: ${String(edgeCount)} edges, ${String(validEdges)} valid, ${String(invalidEdges)} INVALID`, '');

  // For each leaf node that matches an experimental peak, print ancestor path.
  function collectLeaves(node: TreeNode): TreeNode[] {
    if (!node.children || node.children.length === 0) return [node];
    return node.children.flatMap(collectLeaves);
  }

  // Actually, print paths for ALL nodes that match an experimental peak
  // (not just leaves — intermediate nodes can also match).
  const allFilteredNodes: TreeNode[] = [];
  function collectAll(node: TreeNode): void {
    allFilteredNodes.push(node);
    for (const child of node.children ?? []) {
      collectAll(child);
    }
  }
  for (const root of filteredTrees) {
    collectAll(root);
  }

  lines.push('── Ancestor paths for peak-matched nodes ──');
  const printedPeaks = new Set<number>();

  for (const node of allFilteredNodes) {
    const uid = node.uid!;
    const mz = node.molecules[0]?.info.mz ?? 0;

    // Check if this node matches an experimental peak.
    const error = (ppm / 1e6) * mz;
    const matchedPeak = experimentalPeaks.find(
      (p) => Math.abs(p.mass - mz) < error,
    );
    if (!matchedPeak || printedPeaks.has(uid)) continue;
    printedPeaks.add(uid);

    const ancestorUids = getAncestorPath(uid, originalParentMap);
    const pathStr = ancestorUids
      .map((u) => {
        const n = uidToNode.get(u);
        const m = n ? nodeMz(n) : '?';
        const marker = precursorUids.has(u) ? ' ★PRECURSOR' : '';
        return `uid${String(u)}(${m}${marker})`;
      })
      .join(' → ');

    const passes511 = ancestorUids.some((u) => precursorUids.has(u));
    lines.push(
      `peak ${matchedPeak.mass.toFixed(4)} matched node uid${String(uid)}(${mz.toFixed(4)}) passes_through_511=${String(passes511)}`, `  path: ${pathStr}`
    );
  }

  return lines;
}

// ── Per-adduct processing ───────────────────────────────────────────────

const ionLabels = getPositiveIonizationLabels(dwar).filter(
  (l) => !excludeLabels.has(l),
);

console.log(`Fragmenting ${MOLECULE_FOLDER} for [${ionLabels.join(', ')}]…\n`);

const headers = [
  'adduct',
  'spectrum',
  'mode',
  'cosine',
  'tanimoto',
  'nbCommonPeaks',
  'nbPeaks1',
  'nbPeaks2',
];
const tableRows: string[][] = [];
const svgWrites: Array<Promise<void>> = [];

for (const adductLabel of ionLabels) {
  console.log(`── ${adductLabel} ──`);

  // ── Run fragmentation with per-adduct filtered DWAR ───────────────
  const filteredDwar = filterDwarByIonization(dwar, adductLabel);
  const fragments = reactionFragmentation(molecule, {
    ...fragmentationOptions,
    dwar: filteredDwar,
  }) as {
    masses: Array<{ mz: number }>;
    trees: TreeNode[];
    reactions: Reactions;
  };

  const allMasses = fragments.masses
    .map((m) => m.mz)
    .toSorted((a, b) => a - b);

  // ── Assign UIDs to the original tree ──────────────────────────────
  const { parentMap: origParentMap, childrenMap: origChildrenMap, uidToNode } =
    assignUidsAndBuildMaps(fragments.trees);

  // ── Find precursor nodes ──────────────────────────────────────────
  const precursorNodes = findPrecursorNodes(
    fragments.trees,
    PRECURSOR_MZ,
    PRECURSOR_PPM,
  );

  if (precursorNodes.length === 0) {
    console.log(
      `  Precursor ${String(PRECURSOR_MZ)} NOT FOUND in ${adductLabel} tree — skipping`,
    );
    tableRows.push([
      adductLabel,
      MS3_FILE,
      `subtree-${String(PRECURSOR_MZ)}`,
      'N/A',
      'N/A',
      '0',
      '0',
      '0',
    ]);
    continue;
  }

  const precursorUids = new Set(precursorNodes.map((n) => n.uid!));
  console.log(
    `  Found ${String(precursorNodes.length)} precursor node(s) at ${String(PRECURSOR_MZ)}` +
      ` — UIDs: [${[...precursorUids].join(', ')}]`,
  );

  // ── Collect descendant nodes by reference (products of 511) ────────
  //
  // Key rule: a fragment is valid only if it is a child/descendant of
  // the 511 precursor node.  Checking by object reference (not m/z
  // value) guarantees that a node reached via a path that does NOT
  // pass through 511 is rejected — even if the same m/z exists in a
  // valid path.
  const descendantNodeSet = buildDescendantNodeSet(precursorNodes);
  const descendantMasses = extractMasses(descendantNodeSet);
  console.log(`  Descendant nodes: ${String(descendantNodeSet.size)}, unique masses: ${String(descendantMasses.length)}`);

  // ── Score subtree masses against MS3 ──────────────────────────────
  const subtreeScore = scoreSpectrum(comparator, ms3, descendantMasses);
  console.log(
    `  Subtree score: cosine=${subtreeScore.cosine.toFixed(4)}  tanimoto=${subtreeScore.tanimoto.toFixed(4)}  common=${String(subtreeScore.nbCommonPeaks)}`,
  );
  tableRows.push([
    adductLabel,
    MS3_FILE,
    `subtree-${String(PRECURSOR_MZ)}`,
    subtreeScore.cosine.toFixed(6),
    subtreeScore.tanimoto.toFixed(6),
    String(subtreeScore.nbCommonPeaks),
    String(subtreeScore.nbPeaks1),
    String(subtreeScore.nbPeaks2),
  ]);

  // ── Build SVG: only descendants of precursor, matched to MS3 ──────
  //
  // The filter keeps a node if:
  //  1. It is an actual descendant of the 511 node (checked by object
  //     reference, NOT by m/z value — so paths that bypass 511 are
  //     rejected even if they produce the same m/z).
  //  2. AND it matches an experimental MS3 peak within tolerance.
  //
  // getFilteredReactions automatically preserves ancestors up to the
  // tree root, so the SVG shows the full path: molecule → … → 511 →
  // matched fragments.

  const experimentalPeaks = ms3.x.map((mass, i) => ({
    mass,
    intensity: ms3.y[i] ?? 0,
  }));

  const processedMasses: number[] = [];
  const filteredReactions = fragments.reactions.getFilteredReactions({
    filter: (node: TreeNode) => {
      // ① Must be an actual descendant of a precursor node (by ref).
      if (!descendantNodeSet.has(node)) return false;

      for (const mol of node.molecules) {
        const mass = mol.info.mz;
        if (processedMasses.includes(mass)) return false;
        processedMasses.push(mass);

        // ② Must match an experimental MS3 peak.
        const error = (precision / 1e6) * mass;
        for (const peak of experimentalPeaks) {
          if (Math.abs(mass - peak.mass) < error) return true;
        }
      }
      return false;
    },
  });

  // Build matched-peaks array for SVG highlighting.
  const matchedPeaks: Array<{ mass: number; intensity: number }> = [];
  for (const mz of descendantMasses) {
    const tolerance = mz * 1e-6 * precision;
    for (let i = 0; i < ms3.x.length; i++) {
      const expMz = ms3.x[i];
      const expIntensity = ms3.y[i];
      if (
        expMz !== undefined &&
        expIntensity !== undefined &&
        Math.abs(expMz - mz) <= tolerance
      ) {
        matchedPeaks.push({ mass: mz, intensity: expIntensity });
        break;
      }
    }
  }

  if (filteredReactions.trees.length > 0) {
    // ── Verify the filtered tree is a genuine induced subtree ──────
    const verifyLines = verifyFilteredTree(
      filteredReactions.trees,
      origChildrenMap,
      origParentMap,
      uidToNode,
      precursorUids,
      experimentalPeaks,
      precision,
    );

    const verifyContent = [
      `Subtree verification for ${adductLabel}`,
      `Precursor: ${String(PRECURSOR_MZ)} m/z (±${String(PRECURSOR_PPM)} ppm)`,
      `Precursor UIDs: [${[...precursorUids].join(', ')}]`,
      `Original tree total nodes: ${String(uidToNode.size)}`,
      `Descendant nodes of precursor: ${String(descendantNodeSet.size)}`,
      '',
      ...verifyLines,
    ].join('\n');

    // Print to console.
    console.log('');
    for (const line of verifyLines) {
      console.log(`  ${line}`);
    }

    // Write to file.
    const logPath = join(
      resultsDir,
      `${sanitize(adductLabel)}_subtree-verification.log`,
    );
    svgWrites.push(writeFile(logPath, verifyContent, 'utf8'));

    const svg = getFragmentationSVG(filteredReactions.trees, {
      OCL,
      peaks: matchedPeaks,
      accuracy: precision,
    });
    const svgPath = join(
      resultsDir,
      `${sanitize(adductLabel)}_subtree-${String(PRECURSOR_MZ)}.svg`,
    );
    svgWrites.push(writeFile(svgPath, svg, 'utf8'));
    console.log(
      `  SVG: ${String(filteredReactions.trees.length)} tree(s), ${String(matchedPeaks.length)} highlighted peak(s)`,
    );
  } else {
    console.log('  SVG: no matching trees to render');
  }
}

const tableContent = formatTable(headers, tableRows);
const tablePath = join(resultsDir, 'scores.txt');
await Promise.all([writeFile(tablePath, tableContent, 'utf8'), ...svgWrites]);
console.log(`\nWrote ${tablePath}`);
console.log(`Results in ${resultsDir}`);
