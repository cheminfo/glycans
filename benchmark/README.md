# Benchmark — Single-Molecule MS2 Spectral Matching

## 1. Overview

This benchmark validates the **glycan in-silico fragmentation engine** by comparing predicted fragment masses against experimental MS2 (and optionally MS3) tandem mass spectra for individual, known glycan molecules.

### What it evaluates

For each molecule in the dataset, the system:

1. Generates theoretical fragmentation trees using the `mass-fragmentation` library driven by a **DataWarrior (DWAR) reaction database**. The DWAR contains two types of rows: **ionization rows** (defining how to produce a charged precursor ion, e.g., [M+H]⁺ or [M+Na]⁺) and **reaction rows** (defining fragmentation reactions such as bond cleavages and eliminations). The engine runs a **two-stage pipeline** per adduct: first it applies the ionization to produce a charged precursor, then it applies fragmentation reactions to that precursor to build a tree of predicted fragment ions.
2. Compares the predicted fragment m/z values against experimentally acquired MS2 spectra.
3. Reports **cosine similarity**, **Tanimoto coefficient**, and peak overlap statistics.
4. Renders **SVG fragmentation trees** showing which predicted fragments match experimental peaks, providing visual explanations of fragmentation pathways.
5. Produces **annotation files** mapping each matched experimental peak to the reaction mechanisms that can produce it.

### Why it exists

- Validates that the reaction database and fragmentation engine produce chemically meaningful fragments.
- Provides a ground-truth validation suite: each molecule's experimental spectrum is compared against its own predicted fragments only.
- Produces visual artifacts (SVGs) and mechanistic annotations for manual inspection by domain experts.
- Serves as the baseline for evaluating fragmentation accuracy before running multi-candidate identification.

### Project context

This benchmark lives inside the `glycans` package (`cheminfo/glycans`) and uses:

- **`mass-fragmentation`** — the core fragmentation engine.
- **`openchemlib`** (OCL) — chemistry toolkit for molecule parsing and manipulation.
- **`ms-spectrum`** — spectral peak-picking and similarity computation.
- **`jcampconverter`** — JCAMP-DX spectrum file parser.
- **`jsdom`** — headless DOM for SVG rendering (required by `react-tree-svg` inside `getFragmentationSVG`).

The reaction database is shared with the sibling `benchmarkMultiCandidates/` system at `../reactions/glycansReactions.dwar`.

---

## 2. System Architecture

### Execution Pipeline

```
┌─────────────────────────────┐
│  Load Phase                 │
│  • Read molecules from      │
│    data/{molecule}/         │
│  • Parse .mol + .jdx files  │
│  • Load DWAR reaction DB    │
└────────────┬────────────────┘
             ↓
┌──────────────────────────────────┐
│  Fragmentation Phase             │
│  • For each molecule:            │
│    • For each adduct (H⁺,        │
│      Na⁺, …) in parallel:       │
│      → Filter DWAR (keep 1       │
│        ionization + all reactions)│
│      → reactionFragmentation:    │
│        1. Ionize: M → [M+adduct]⁺│
│        2. Fragment: apply reaction│
│           rules to ionized        │
│           precursor → tree        │
│      → Filter trees to           │
│        matched peaks             │
│      → Render SVGs               │
│      → Build annotations         │
└────────────┬─────────────────────┘
             ↓
┌─────────────────────────────┐
│  Scoring Phase              │
│  • For each (adduct ×       │
│    spectrum) combination:   │
│    → cosine similarity      │
│    → Tanimoto coefficient   │
│    → peak overlap counts    │
└────────────┬────────────────┘
             ↓
┌─────────────────────────────┐
│  Output Phase               │
│  • scores.txt per molecule  │
│  • SVG tree per adduct ×    │
│    spectrum                 │
│  • Annotation files per     │
│    adduct × spectrum        │
└─────────────────────────────┘
```

### Data Flow

```
data/{molecule}/molecule.mol  ──→  OCL.Molecule
data/{molecule}/ms2_*.jdx     ──→  peak-pick → {x[], y[]}

reactions/glycansReactions.dwar
  │  contains: ionization rows (H⁺, Na⁺, K⁺, …) + reaction rows (cleavages, eliminations, …)
  │
  ↓  filterDwarByIonization(label)
  │  keeps: 1 ionization row + all reaction rows
  ↓
reactionFragmentation(molecule, filteredDwar)
  │  Stage 1 — Ionization: applies the ionization row to produce [M+adduct]⁺
  │  Stage 2 — Fragmentation: applies reaction rows to the ionized precursor
  ↓
{ masses[], trees[], reactions }
  ↓
getFilteredReactions(matchFilter)  →  trees pruned to matched peaks
  ↓
getFragmentationSVG(filteredTrees)  →  SVG
  ↓
scoreSpectrum(spectrum, masses)  →  {cosine, tanimoto, …}
```

### Worker Thread Architecture (script.ts)

The main script delegates fragmentation to **worker threads** via `fragmentByAdductParallel()`:

- One worker per adduct label (e.g., `Ionization-H`, `Ionization-Na`). With `Ionization-K` excluded by default, this means **2 workers** run in parallel per molecule (H⁺ and Na⁺).
- Workers are capped by `maxConcurrency` (default: 4). The cap would only matter if the DWAR defined more than 4 positive-mode ionization labels.
- Each worker receives a serialized molfile + a **filtered DWAR** (containing one ionization row + all reaction rows). Inside the worker, `reactionFragmentation()` runs the two-stage pipeline: (1) ionize the molecule to produce the charged precursor, (2) apply fragmentation reactions to that precursor. The worker then filters trees, renders SVGs, builds annotations, and posts back `{ label, masses[], svgs{}, annotations{} }`.
- Workers set up their own JSDOM instance for SVG rendering.
- Molecules are processed **sequentially** (one at a time). The parallelism is across adducts within each molecule, not across molecules.

---

## 3. Folder Structure

```
benchmark/
├── script.ts                          # Main benchmark runner
├── convertToCentroid.ts               # Profile→centroid spectrum preprocessor
├── quickMs3.ts                        # MS3 subtree analysis tool
├── README.md                          # This file
├── data/                              # Input: molecules + experimental spectra
│   ├── D-Panose/
│   │   ├── molecule.mol               # Molecular structure file
│   │   └── ms2_528.00@cid26.00.jdx   # MS2 JCAMP-DX spectrum
│   ├── Lactodifucotetraose/
│   │   ├── molecule.mol
│   │   ├── ms2_636.00@cid22.00.jdx
│   │   ├── ms2_658.00@cid24.00.jdx
│   │   └── ms3_512.00@cid24.00.jdx   # MS3 spectrum (used by quickMs3.ts)
│   └── ... (10 molecules total)
├── annotation/                        # Output: peak-to-mechanism annotations
│   └── {molecule}/
│       └── {adduct}_{spectrum}.txt
├── centroidSpectra/                   # Output: centroid spectra from converter
│   └── {molecule}_{spectrum}.txt
├── results/                           # Output: scores + SVGs
│   ├── {molecule}/
│   │   ├── scores.txt                 # Bordered table of all scores
│   │   └── {adduct}_{spectrum}.svg    # SVG fragmentation tree
│   └── {molecule}-ms3/                # MS3 results (quickMs3.ts)
│       ├── scores.txt
│       ├── {adduct}_subtree-{mz}.svg
│       └── {adduct}_subtree-verification.log
└── utils/                             # Shared utilities (see §5)
    ├── index.ts                       # Barrel re-export
    ├── dwar/
    │   └── filterDwarIonization.ts
    ├── formatting/
    │   ├── formatTable.ts
    │   └── sanitize.ts
    ├── fragmentation/
    │   ├── fragmentParallel.ts
    │   └── fragmentWorker.ts
    ├── loader/
    │   └── loadData.ts
    └── scoring/
        └── scoring.ts
```

### File Roles

| File                                      | Role                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `script.ts`                               | Main benchmark entry point. Iterates molecules, fragments in parallel, scores, writes results.                                   |
| `convertToCentroid.ts`                    | Standalone preprocessing utility. Converts profile JCAMP spectra to centroid `.txt` files.                                       |
| `quickMs3.ts`                             | Specialized MS3 analysis. Locates a precursor ion in the fragmentation tree and scores only its subtree against an MS3 spectrum. |
| `utils/index.ts`                          | Barrel file re-exporting all utility functions and types.                                                                        |
| `utils/dwar/filterDwarIonization.ts`      | Parses DWAR files; filters by ionization label; discovers available adduct types.                                                |
| `utils/formatting/formatTable.ts`         | Renders bordered Unicode text tables.                                                                                            |
| `utils/formatting/sanitize.ts`            | Sanitizes strings for safe use as filenames.                                                                                     |
| `utils/fragmentation/fragmentParallel.ts` | Manages worker thread pool; one worker per adduct; concurrency-limited.                                                          |
| `utils/fragmentation/fragmentWorker.ts`   | Worker thread: runs fragmentation, filters trees, renders SVGs, collects annotations.                                            |
| `utils/loader/loadData.ts`                | Reads `data/` folder structure; parses `.mol` + `.jdx` files; auto-performs peak-picking.                                        |
| `utils/scoring/scoring.ts`                | Creates `MSComparator` instances and scores predicted masses against experimental spectra.                                       |

---

## 4. Core Functions and Modules

### `processData()`

**Location:** `script.ts` (top-level async function)

**Purpose:** Main orchestration loop. Iterates over all loaded molecules, fragments each in parallel, scores results, and writes output files.

**Internal Logic:**

1. For each `MoleculeData` in the loaded dataset, creates output directories.
2. Calls `fragmentByAdductParallel()` passing the molecule, DWAR, and options.
3. Iterates over the returned `Map<adductLabel, ParallelAdductResult>`.
4. For each (adduct × spectrum) pair, calls `scoreSpectrum()`.
5. Accumulates table rows and writes `scores.txt`, SVGs, and annotation files.

---

### `fragmentByAdductParallel(molecule, dwar, options)`

**Location:** `utils/fragmentation/fragmentParallel.ts`

**Purpose:** Parallelizes the two-stage fragmentation pipeline (ionization → fragmentation reactions) across adduct types using Node.js worker threads. Each adduct requires its own pipeline run because the ionization step produces a different charged precursor (e.g., [M+H]⁺ vs [M+Na]⁺), which in turn yields a different fragmentation tree.

**Parameters:**

| Name       | Type                           | Description                         |
| ---------- | ------------------------------ | ----------------------------------- |
| `molecule` | `Molecule` (OCL)               | The parsed molecule to fragment.    |
| `dwar`     | `string`                       | Raw DWAR reaction database content. |
| `options`  | `ParallelFragmentationOptions` | See below.                          |

`ParallelFragmentationOptions`:

| Field            | Type                   | Description                                                 |
| ---------------- | ---------------------- | ----------------------------------------------------------- |
| `fragmentation`  | `FragmentationOptions` | Engine options (depth, limits, ionization mode).            |
| `spectra`        | `SpectrumInput[]`      | Experimental spectra for tree filtering + SVG highlighting. |
| `precision`      | `number`               | Mass tolerance in ppm.                                      |
| `maxConcurrency` | `number`               | Max simultaneous worker threads (default 3).                |
| `excludeLabels`  | `string[]`             | Adduct labels to skip (e.g., `['Ionization-K']`).           |

**Returns:**

| Type                                         | Description                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Promise<Map<string, ParallelAdductResult>>` | Map from adduct label → `{ masses: number[], svgs: Record<string, string>, annotations: Record<string, AnnotationEntry[]> }`. |

**Internal Logic:**

1. Discovers positive-mode ionization labels from the DWAR.
2. Filters out excluded labels.
3. Pre-filters the DWAR once per label via `filterDwarByIonization()` — removes other ionization rows but **keeps all reaction rows**. The resulting DWAR contains exactly one ionization + all fragmentation reactions.
4. Creates one task per label: spawns a `Worker` with the filtered DWAR and molfile. Each worker will run the complete two-stage pipeline (ionize → fragment) independently.
5. Runs all tasks through `withConcurrencyLimit()`.
6. Collects results into a `Map`.

---

### Worker: `fragmentWorker.ts`

**Location:** `utils/fragmentation/fragmentWorker.ts`

**Purpose:** Runs inside a worker thread. Executes the full two-stage pipeline (ionization → fragmentation reactions) for a single adduct, then performs tree filtering, SVG generation, and annotation building.

**Input (workerData):**

| Field          | Type                      | Description                                               |
| -------------- | ------------------------- | --------------------------------------------------------- |
| `molfile`      | `string`                  | Serialized neutral molecule.                              |
| `filteredDwar` | `string`                  | DWAR content with one ionization row + all reaction rows. |
| `options`      | `Record<string, unknown>` | Fragmentation engine options.                             |
| `spectra`      | `SpectrumData[]`          | Experimental spectra `{name, x[], y[]}`.                  |
| `precision`    | `number`                  | Mass tolerance in ppm.                                    |
| `label`        | `string`                  | Ionization label (e.g., `Ionization-Na`).                 |

**Output (postMessage):**

| Field         | Type                                | Description                                        |
| ------------- | ----------------------------------- | -------------------------------------------------- |
| `label`       | `string`                            | The ionization label.                              |
| `masses`      | `number[]`                          | Sorted predicted m/z values.                       |
| `svgs`        | `Record<string, string>`            | Map from spectrum name → SVG string.               |
| `annotations` | `Record<string, AnnotationEntry[]>` | Map from spectrum name → matched peak annotations. |

**Internal Logic:**

1. Sets up a JSDOM instance (required by `react-tree-svg` inside `getFragmentationSVG`).
2. Deserializes the neutral molecule from `molfile` using `OCL.Molecule.fromMolfile()`.
3. Calls `reactionFragmentation(molecule, { ...options, dwar: filteredDwar })`. Internally this executes the two-stage pipeline: first the ionization row is applied to produce a charged precursor ion (e.g., [M+Na]⁺), then the fragmentation reaction rows are applied to that precursor to build the full fragmentation tree.
4. Collects all simulated fragments from unfiltered trees via `collectSimulatedFragments()` for annotation.
5. For each experimental spectrum:
   - Builds an `experimentalPeaks` array from `{x, y}`.
   - Calls `reactions.getFilteredReactions({ filter })` keeping only nodes whose m/z matches an experimental peak within `precision` ppm.
   - Builds `matchedPeaks` for SVG highlighting.
   - Renders SVG via `getFragmentationSVG()` if filtered trees are non-empty.
   - Builds annotation entries: for each experimental peak, finds all simulated fragments within tolerance and records their reaction mechanism labels and isobaric count.
6. Posts `{ label, masses, svgs, annotations }` back to the main thread.

---

### `collectSimulatedFragments(trees)`

**Location:** `utils/fragmentation/fragmentWorker.ts`

**Purpose:** Walks all fragmentation tree nodes and collects `(mz, mechanismLabel)` pairs, skipping root nodes that have no reaction.

**Parameters:**

| Name    | Type       | Description                                           |
| ------- | ---------- | ----------------------------------------------------- |
| `trees` | `object[]` | The fragmentation trees from `reactionFragmentation`. |

**Returns:**

| Type                  | Description                               |
| --------------------- | ----------------------------------------- |
| `SimulatedFragment[]` | Array of `{ mz: number, label: string }`. |

---

### `scoreSpectrum(comparator, spectrum, masses)`

**Location:** `utils/scoring/scoring.ts`

**Purpose:** Computes similarity metrics between predicted fragment masses and an experimental spectrum.

**Parameters:**

| Name         | Type                           | Description                        |
| ------------ | ------------------------------ | ---------------------------------- |
| `comparator` | `MSComparator`                 | Preconfigured comparator instance. |
| `spectrum`   | `{ x: number[], y: number[] }` | Experimental spectrum.             |
| `masses`     | `number[]`                     | Sorted predicted m/z values.       |

**Returns:**

| Type            | Description                                               |
| --------------- | --------------------------------------------------------- |
| `ScoringResult` | `{ cosine, tanimoto, nbCommonPeaks, nbPeaks1, nbPeaks2 }` |

**Internal Logic:** Delegates to `MSComparator.getSimilarityToMasses()` from the `ms-spectrum` library. The comparator is configured with a mass-dependent tolerance function `delta = mass × 1e-6 × precision`, and power weights for mass and intensity.

---

### `createComparator(options)`

**Location:** `utils/scoring/scoring.ts`

**Purpose:** Factory for `MSComparator` instances.

**Parameters:**

| Name                     | Type     | Description                                |
| ------------------------ | -------- | ------------------------------------------ |
| `options.massPower`      | `number` | Weight for mass in the cosine vector.      |
| `options.intensityPower` | `number` | Weight for intensity in the cosine vector. |
| `options.precision`      | `number` | Mass tolerance in ppm.                     |

**Returns:**

| Type           | Description                     |
| -------------- | ------------------------------- |
| `MSComparator` | Configured comparator instance. |

---

### `loadData(basePath)`

**Location:** `utils/loader/loadData.ts`

**Purpose:** Reads the `data/` directory and returns an array of `MoleculeData` objects, each containing a parsed molecule and its associated peak-picked MS2 spectra.

**Parameters:**

| Name       | Type     | Description                          |
| ---------- | -------- | ------------------------------------ |
| `basePath` | `string` | Absolute path to the data directory. |

**Returns:**

| Type                      | Description                                              |
| ------------------------- | -------------------------------------------------------- |
| `Promise<MoleculeData[]>` | Array of `{ folderName, molfile, molecule, spectra[] }`. |

**Internal Logic:**

1. Lists subdirectories of `basePath`.
2. For each subfolder, locates exactly one `.mol` file and all `ms2_*.jdx` files.
3. Parses the molfile with `OCL.Molecule.fromMolfile()`.
4. Converts each JCAMP spectrum to centroid peaks via `jcampconverter` → `ms-spectrum.Spectrum.getPeaksAsDataXY()`.
5. Returns an array of `MoleculeData`, silently skipping folders without exactly one `.mol` file.

---

### `loadDwar(filePath)`

**Location:** `utils/loader/loadData.ts`

**Purpose:** Reads a DataWarrior `.dwar` file as UTF-8 text.

**Parameters:**

| Name       | Type     | Description                        |
| ---------- | -------- | ---------------------------------- |
| `filePath` | `string` | Absolute path to the `.dwar` file. |

**Returns:**

| Type              | Description       |
| ----------------- | ----------------- |
| `Promise<string>` | Raw DWAR content. |

---

### `getPositiveIonizationLabels(dwar)`

**Location:** `utils/dwar/filterDwarIonization.ts`

**Purpose:** Discovers all positive-mode ionization labels in a DWAR file by scanning for rows where `kind === 'ionization'` and `mode` includes `'positive'`.

**Parameters:**

| Name   | Type     | Description       |
| ------ | -------- | ----------------- |
| `dwar` | `string` | Raw DWAR content. |

**Returns:**

| Type       | Description                                                |
| ---------- | ---------------------------------------------------------- |
| `string[]` | E.g., `['Ionization-H', 'Ionization-Na', 'Ionization-K']`. |

---

### `filterDwarByIonization(dwar, keepLabel)`

**Location:** `utils/dwar/filterDwarIonization.ts`

**Purpose:** Returns a copy of the DWAR string keeping only one ionization label. All ionization rows with a different label are removed. **Reaction rows (fragmentation rules) are left untouched.** The result is a DWAR containing exactly one ionization + all fragmentation reactions, ready for `reactionFragmentation()` to run its two-stage pipeline. The `<rowcount>` header is updated.

**Parameters:**

| Name        | Type     | Description                   |
| ----------- | -------- | ----------------------------- |
| `dwar`      | `string` | Raw DWAR content.             |
| `keepLabel` | `string` | The ionization label to keep. |

**Returns:**

| Type     | Description            |
| -------- | ---------------------- |
| `string` | Filtered DWAR content. |

---

### `formatTable(headers, rows)`

**Location:** `utils/formatting/formatTable.ts`

**Purpose:** Renders a bordered Unicode text table using box-drawing characters (┌─┬┐│├┼┤└┴┘).

**Parameters:**

| Name      | Type         | Description           |
| --------- | ------------ | --------------------- |
| `headers` | `string[]`   | Column header labels. |
| `rows`    | `string[][]` | Array of row arrays.  |

**Returns:**

| Type     | Description                 |
| -------- | --------------------------- |
| `string` | Multi-line formatted table. |

---

### `sanitize(name)`

**Location:** `utils/formatting/sanitize.ts`

**Purpose:** Replaces characters unsafe for filenames (anything not `\w`, `.`, or `-`) with underscores.

---

### `convertToCentroid.ts`

**Location:** `convertToCentroid.ts` (standalone script)

**Purpose:** Batch-converts profile MS2 spectra from JCAMP-DX format to centroid (peak-picked) tab-separated text files.

**Internal Logic:**

1. Scans `data/` for subdirectories.
2. For each folder, finds all `.jdx` files containing "ms2" in the name.
3. Parses each JCAMP file with `jcampconverter`.
4. Peak-picks via `new Spectrum({ x, y }).getPeaksAsDataXY({})`.
5. Writes `centroidSpectra/{molecule}_{spectrum}.txt` with `m/z\tintensity` columns.

**Usage:** `npx tsx benchmark/convertToCentroid.ts`

---

### `quickMs3.ts`

**Location:** `quickMs3.ts` (standalone script)

**Purpose:** MS3 subtree analysis — fragments a molecule, locates the isolated precursor node in the fragmentation tree by m/z, extracts only its descendants, and scores this subtree against an experimental MS3 spectrum.

**Configuration (edit constants in the file):**

| Constant          | Type     | Description                             |
| ----------------- | -------- | --------------------------------------- |
| `MOLECULE_FOLDER` | `string` | Subfolder name under `data/`.           |
| `MS3_FILE`        | `string` | MS3 JCAMP-DX filename.                  |
| `PRECURSOR_MZ`    | `number` | m/z of the isolated precursor ion.      |
| `PRECURSOR_PPM`   | `number` | Accuracy in ppm for precursor matching. |

**Key functions defined in this file:**

- `findPrecursorNodes(trees, mz, ppm)` — Walks the tree to find nodes whose m/z matches the precursor within tolerance.
- `collectDescendantNodes(node)` — Recursively collects all child/grandchild nodes.
- `buildDescendantNodeSet(precursorNodes)` — Builds a `Set<TreeNode>` of all descendants by object reference (not by m/z value — critical for correctness).
- `extractMasses(nodes)` — Gets unique sorted m/z values from a node set.
- `assignUidsAndBuildMaps(trees)` — Assigns unique integer IDs to every node; builds `parentMap`, `childrenMap`, and `uidToNode` lookup tables.
- `getAncestorPath(uid, parentMap)` — Returns the chain of UIDs from tree root to a given node.
- `verifyFilteredTree(...)` — Cross-checks every edge in the filtered tree against the original structural maps; logs valid/invalid edges and ancestor paths for peak-matched nodes with precursor verification.

**Output:**

- `results/{molecule}-ms3/scores.txt` — Table with subtree scores.
- `results/{molecule}-ms3/{adduct}_subtree-{mz}.svg` — SVG of the filtered subtree.
- `results/{molecule}-ms3/{adduct}_subtree-verification.log` — Detailed edge verification log.

**Usage:** `node --no-warnings benchmark/quickMs3.ts`

---

## 5. Shared Infrastructure

Both `benchmark/` and `benchmarkMultiCandidates/` maintain their own copy of the `utils/` directory. The modules are structurally identical but with minor differences:

| Module                              | benchmark/                         | benchmarkMultiCandidates/                                                         |
| ----------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| `dwar/filterDwarIonization.ts`      | Identical                          | Identical                                                                         |
| `formatting/formatTable.ts`         | Identical                          | Identical                                                                         |
| `formatting/sanitize.ts`            | Identical                          | Identical                                                                         |
| `scoring/scoring.ts`                | Identical                          | Identical                                                                         |
| `loader/loadData.ts`                | Identical                          | Identical                                                                         |
| `loader/loadCandidates.ts`          | —                                  | **Additional module** for loading `.mol` candidate libraries                      |
| `fragmentation/fragmentParallel.ts` | Full pipeline (SVGs + annotations) | Includes SVG version + **additional** `fragmentMassesParallel.ts` for masses-only |
| `fragmentation/fragmentWorker.ts`   | Includes annotation logic          | Simpler (no annotation)                                                           |
| `fragmentation/massesOnlyWorker.ts` | —                                  | **Additional** lightweight worker (no DOM, no SVG)                                |
| `index.ts`                          | Exports benchmark utilities        | Exports benchmark + candidate utilities                                           |

### Shared Scoring System

Both benchmarks use identical scoring parameters by default:

```typescript
massPower = 3; // m/z weighting in cosine vector
intensityPower = 0.6; // intensity weighting in cosine vector
precision = 20; // mass tolerance in ppm
```

The `MSComparator` from `ms-spectrum` computes:

- **Cosine similarity** — weighted dot product of aligned peak vectors.
- **Tanimoto coefficient** — Jaccard-like peak overlap metric.
- **Peak counts** — `nbCommonPeaks`, `nbPeaks1` (experimental), `nbPeaks2` (predicted).

### Shared DWAR Handling

The DWAR reaction database contains two kinds of data rows:

- **Ionization rows** (`kind === 'ionization'`) — define how to produce a charged precursor from the neutral molecule (e.g., `Ionization-H` adds H⁺ → [M+H]⁺, `Ionization-Na` adds Na⁺ → [M+Na]⁺).
- **Reaction rows** (`kind !== 'ionization'`) — define fragmentation reactions (bond cleavages, water eliminations, etc.) that are applied to the ionized precursor.

The DWAR parser (`filterDwarIonization.ts`) splits the file into:

1. **Preamble** — header + column properties + column names.
2. **Data rows** — tab-separated records with `kind`, `label`, `mode` columns.
3. **Epilogue** — trailing metadata (hitlist data, datawarrior properties).

This structure enables per-adduct filtering: `filterDwarByIonization(dwar, label)` removes all ionization rows except the target label while leaving all reaction rows intact. The resulting filtered DWAR is then passed to `reactionFragmentation()`, which uses the single ionization row to produce the precursor and the reaction rows to fragment it.

### Shared Fragmentation Parameters

```typescript
const fragmentationOptions: FragmentationOptions = {
  ionizations: ['esi'],
  modes: ['positive'],
  maxDepth: 5,
  limitReactions: 500,
  minIonizations: 1,
  maxIonizations: 1,
  minReactions: 0,
  maxReactions: 3,
};
```

> **Note:** `quickMs3.ts` uses more aggressive settings (`maxDepth: 8`, `limitReactions: 800`, `maxReactions: 5`) to explore deeper fragmentation paths.

---

## 6. Benchmark Methodology

### What is being benchmarked

The accuracy of the in-silico two-stage fragmentation pipeline: given a known glycan structure and adduct type, the engine first ionizes the neutral molecule to produce a charged precursor (e.g., [M+H]⁺ or [M+Na]⁺), then applies fragmentation reactions to that precursor. The benchmark measures how well the resulting predicted fragment m/z values match the experimentally observed MS2 peaks.

### How candidates are evaluated

There is only one "candidate" per molecule — the molecule itself. This is a **validation** benchmark, not an identification benchmark. The comparison is:

```
predicted fragments(molecule, adduct) vs. experimental MS2(molecule)
```

### Correctness criteria

- **Cosine > 0** indicates some spectral overlap. Higher values indicate better prediction.
- **Tanimoto > 0** indicates peak presence overlap regardless of intensity.
- **nbCommonPeaks** shows how many experimental peaks are explained by predictions.

### Metrics

| Metric                   | Definition                                                                                                                                                                                   | Range    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --- | -------- | -------------------------------------------------------- | --- |
| **Cosine similarity**    | Weighted dot product of matched peak vectors: $\cos\theta = \frac{\sum m_i^{p_m} \cdot I_i^{p_I}}{\|\mathbf{a}\| \cdot \|\mathbf{b}\|}$ where $p_m$ = `massPower`, $p_I$ = `intensityPower`. | 0–1      |
| **Tanimoto coefficient** | $T = \frac{                                                                                                                                                                                  | A \cap B | }{  | A \cup B | }$ where A and B are peak sets aligned within tolerance. | 0–1 |
| **nbCommonPeaks**        | Number of experimental peaks matched by at least one predicted mass within `precision` ppm.                                                                                                  | integer  |
| **nbPeaks1**             | Total peaks in the experimental spectrum.                                                                                                                                                    | integer  |
| **nbPeaks2**             | Total predicted masses from fragmentation.                                                                                                                                                   | integer  |

### Annotation metrics (per matched peak)

| Field               | Description                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `peak`              | Experimental m/z value.                                                                   |
| `intensity`         | Experimental intensity.                                                                   |
| `mechanisms`        | Unique reaction labels producing fragments at this m/z (e.g., "Ether/water elimination"). |
| `isobaricPeakCount` | Number of distinct simulated fragments collapsing to this m/z within tolerance.           |

---

## 7. Benchmark Execution

### Running the main benchmark

```bash
node --no-warnings benchmark/script.ts
```

Or with watch mode for development:

```bash
node --watch benchmark/script.ts
```

### Running the centroid converter

```bash
npx tsx benchmark/convertToCentroid.ts
```

### Running the MS3 analysis

Edit the configuration constants in `quickMs3.ts` first, then:

```bash
node --no-warnings benchmark/quickMs3.ts
```

### Required input files

| Input                  | Location                             | Format                  |
| ---------------------- | ------------------------------------ | ----------------------- |
| Molecule structures    | `data/{molecule}/molecule.mol`       | MDL Molfile V2000/V3000 |
| MS2 spectra            | `data/{molecule}/ms2_*.jdx`          | JCAMP-DX                |
| MS3 spectra (optional) | `data/{molecule}/ms3_*.jdx`          | JCAMP-DX                |
| Reaction database      | `../reactions/glycansReactions.dwar` | DataWarrior DWAR        |

### JCAMP-DX filename convention

Filenames encode acquisition parameters:

```
ms2_{precursorMz}@cid{collisionEnergy}.jdx
```

Example: `ms2_528.00@cid26.00.jdx` → MS2 of precursor 528.00 m/z at CID energy 26.00.

### Configuration

Key parameters are set as constants at the top of `script.ts`:

| Parameter        | Value              | Effect                                                            |
| ---------------- | ------------------ | ----------------------------------------------------------------- |
| `massPower`      | `3`                | Heavier masses weighted more in cosine scoring.                   |
| `intensityPower` | `0.6`              | Sub-linear intensity weighting (reduces dominance of high peaks). |
| `precision`      | `20`               | 20 ppm tolerance for peak matching.                               |
| `maxConcurrency` | `4`                | Max simultaneous fragmentation workers.                           |
| `excludeLabels`  | `['Ionization-K']` | Potassium adducts skipped.                                        |
| `maxDepth`       | `5`                | Maximum fragmentation tree depth.                                 |
| `limitReactions` | `500`              | Maximum reaction applications per tree.                           |

---

## 8. Results and Output

### Main benchmark (`script.ts`)

| Output       | Location                                        | Format                      |
| ------------ | ----------------------------------------------- | --------------------------- |
| Scores table | `results/{molecule}/scores.txt`                 | Bordered Unicode text table |
| SVG trees    | `results/{molecule}/{adduct}_{spectrum}.svg`    | SVG                         |
| Annotations  | `annotation/{molecule}/{adduct}_{spectrum}.txt` | Pipe-separated text         |

#### Scores table example

```
┌──────────┬───────────────┬─────────────────────────┬──────────┬──────────┬───────────────┬──────────┬──────────┐
│ molecule │ adduct        │ spectrum                │ cosine   │ tanimoto │ nbCommonPeaks │ nbPeaks1 │ nbPeaks2 │
├──────────┼───────────────┼─────────────────────────┼──────────┼──────────┼───────────────┼──────────┼──────────┤
│ D-Panose │ Ionization-Na │ ms2_528.00@cid26.00.jdx │ 0.965295 │ 0.800000 │ 12            │ 15       │ 12       │
│ D-Panose │ Ionization-H  │ ms2_528.00@cid26.00.jdx │ 0.000000 │ 0.000000 │ 0             │ 15       │ 0        │
└──────────┴───────────────┴─────────────────────────┴──────────┴──────────┴───────────────┴──────────┴──────────┘
```

#### Annotation file example

```
Peak | Intensity | Mechanisms | IsobaricPeakCount
365.107 | 13312859.0 | Ether/water elimination | 26
467.139 | 17581835.0 | Ether/water elimination,Water elimination | 86
```

**Interpreting results:**

- A cosine of `0.965` for Na⁺ adduct means near-perfect spectral match.
- A cosine of `0.000` for H⁺ adduct means no predicted fragments matched — likely the spectrum was acquired with a sodium adduct.
- High `isobaricPeakCount` means many distinct fragmentation pathways converge to the same m/z.

### MS3 analysis (`quickMs3.ts`)

| Output           | Location                                                   | Format                      |
| ---------------- | ---------------------------------------------------------- | --------------------------- |
| Scores table     | `results/{molecule}-ms3/scores.txt`                        | Bordered Unicode text table |
| Subtree SVG      | `results/{molecule}-ms3/{adduct}_subtree-{mz}.svg`         | SVG                         |
| Verification log | `results/{molecule}-ms3/{adduct}_subtree-verification.log` | Plain text                  |

The verification log contains:

- Edge-by-edge validation against the original tree structure.
- Ancestor paths for each peak-matched node, showing whether the path traverses the precursor node (marked with ★PRECURSOR).

---

## 9. Differences Between Benchmarks

| Aspect                             | benchmark/                                         | benchmarkMultiCandidates/                              |
| ---------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| **Goal**                           | Validate fragmentation quality for known molecules | Identify the correct molecule from a candidate library |
| **Number of molecules fragmented** | One at a time (the known answer)                   | All candidates (library screening)                     |
| **Visual output**                  | SVG fragmentation trees + annotations              | None (ranking tables only)                             |
| **Fragmentation mode**             | Full pipeline: trees + SVG + annotations           | Masses-only (lightweight)                              |
| **Worker type**                    | `fragmentWorker.ts` (JSDOM + SVG)                  | `massesOnlyWorker.ts` (no DOM overhead)                |
| **Parallelism unit**               | One worker per adduct                              | One worker per (candidate × adduct)                    |
| **Primary metric emphasis**        | Cosine + Tanimoto + visual inspection              | Candidate rank position                                |
| **Use case**                       | "Does the engine produce correct fragments?"       | "Can we identify the molecule from its spectrum?"      |

**When to use each:**

- Use `benchmark/` when tuning fragmentation parameters, debugging reaction rules, or validating new molecules.
- Use `benchmarkMultiCandidates/` when evaluating identification power against a library of candidates.

---

## 10. Extending the Benchmark

### Adding new datasets (molecules)

1. Create a new subfolder under `data/`:
   ```
   data/NewMolecule/
   ├── molecule.mol        # MDL Molfile
   └── ms2_XYZ.jdx         # One or more MS2 JCAMP-DX files
   ```
2. The filename must match `ms2_*.jdx` to be picked up by `loadData()`.
3. Re-run `script.ts`. Results will appear in `results/NewMolecule/`.

### Adding new adduct types

The system automatically discovers adduct labels from the DWAR file. To add a new adduct:

1. Add an ionization row in the DWAR reaction database with the new label (e.g., `Ionization-Li`).
2. Remove the label from `excludeLabels` if present.
3. The benchmark will automatically process it.

### Modifying scoring parameters

Edit the constants at the top of `script.ts`:

```typescript
const massPower = 3; // increase to weight heavier masses more
const intensityPower = 0.6; // increase toward 1.0 for proportional intensity weighting
const precision = 20; // decrease for tighter matching
```

### Adding new metrics

1. Extend the `ScoringResult` interface in `utils/scoring/scoring.ts`.
2. If the new metric comes from `MSComparator`, update `scoreSpectrum()`.
3. For custom metrics, compute them in `script.ts` after calling `scoreSpectrum()`.
4. Add the new column to the `headers` array and each row in `tableRows`.

### Adding a new reaction database

Replace the path in `script.ts`:

```typescript
const dwar = await loadDwar(
  join(import.meta.dirname, '../reactions/myNewReactions.dwar'),
);
```

The DWAR must follow the same format (tab-separated, with `kind`, `label`, and `mode` columns).

### Adjusting fragmentation depth

```typescript
const fragmentationOptions: FragmentationOptions = {
  maxDepth: 8, // increase for deeper trees (slower)
  limitReactions: 1000, // increase for broader exploration
  maxReactions: 5, // more reactions per branch
};
```

---
