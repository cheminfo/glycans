# BenchmarkMultiCandidates — Multi-Candidate Glycan Identification

## 1. Overview

This benchmark evaluates the **identification power** of the glycan fragmentation engine: given a library of candidate molecules and an experimental MS2 spectrum of an unknown glycan, can the system correctly rank the true structure as the top candidate?

### What it evaluates

For every experimental dataset (molecule + MS2 spectra):

1. Fragments **all candidate molecules** in parallel using a lightweight masses-only pipeline. For each candidate, the engine runs a **two-stage pipeline** per adduct: first it applies an ionization reaction (from the DWAR) to produce a charged precursor (e.g., [M+H]⁺ or [M+Na]⁺), then it applies fragmentation reactions to that precursor to predict fragment m/z values.
2. Scores every candidate against each experimental spectrum using cosine similarity and Tanimoto coefficient.
3. Ranks candidates by score (descending) and reports the rank of the correct solution.
4. Provides post-hoc re-ranking by alternative metrics (Tanimoto) via a separate analysis script.

### Why it exists

- Measures whether the fragmentation engine produces **discriminative** fragments — not just correct ones, but ones unique enough to distinguish the true molecule from structurally similar alternatives.
- Benchmarks the system's practical utility for glycan identification from MS2 data.
- Reveals failure modes: when structurally related glycans (e.g., Maltopentaose vs. Maltoheptaose) produce near-identical fragmentation patterns.
- Enables comparison of different scoring metrics (cosine vs. Tanimoto) for identification accuracy.

### Project context

This benchmark lives inside the `glycans` package (`cheminfo/glycans`) alongside the sibling `benchmark/` system. It uses the same core libraries:

- **`mass-fragmentation`** — the fragmentation engine.
- **`openchemlib`** (OCL) — molecule parsing.
- **`ms-spectrum`** — spectral similarity computation.
- **`jcampconverter`** — JCAMP-DX spectrum parsing.

The reaction database is shared at `../reactions/glycansReactions.dwar`.

The key difference from `benchmark/` is that this system fragments **all candidates**, not just the known answer, and produces **ranking tables** instead of SVG visualizations.

---

## 2. System Architecture

### Execution Pipeline

```
┌──────────────────────────────────┐
│  Load Phase                      │
│  • Load candidates from          │
│    candidates/*.mol              │
│  • Load experimental data from   │
│    data/{molecule}/              │
│  • Load DWAR reaction database   │
└──────────────┬───────────────────┘
               ↓
┌──────────────────────────────────┐
│  Fragmentation Phase             │
│  • Fragment ALL candidates ×     │
│    ALL adducts in parallel       │
│  • Each worker runs the two-stage│
│    pipeline per (candidate ×     │
│    adduct):                      │
│    1. Ionize: M → [M+adduct]⁺   │
│    2. Fragment: apply reaction   │
│       rules → predicted masses   │
│  • Masses-only (no SVG/DOM)      │
└──────────────┬───────────────────┘
               ↓
┌──────────────────────────────────┐
│  Indexing Phase                   │
│  • Build Map<candidateName,      │
│    Map<adductLabel, masses[]>>   │
│  • Fast O(1) lookup by           │
│    (candidate, adduct)           │
└──────────────┬───────────────────┘
               ↓
┌──────────────────────────────────┐
│  Ranking Phase                   │
│  • For each (molecule × adduct   │
│    × spectrum):                  │
│    → Score ALL candidates        │
│    → Sort by cosine (descending) │
│    → Find rank of true solution  │
└──────────────┬───────────────────┘
               ↓
┌──────────────────────────────────┐
│  Output Phase                    │
│  • summary.txt (global)          │
│  • ranking_{adduct}_{spectrum}.  │
│    txt (per molecule)            │
└──────────────────────────────────┘
               ↓  (optional)
┌──────────────────────────────────┐
│  Post-Processing (printRanks.ts) │
│  • Re-rank by Tanimoto           │
│  • Pick best spectrum per        │
│    molecule                      │
│  • summary_cosine.txt            │
│  • summary_tanimoto.txt          │
└──────────────────────────────────┘
```

### Data Flow

```
candidates/*.mol ───→ loadCandidates() ───→ CandidateEntry[]
                                                  ↓
data/{molecule}/molecule.mol ──→┐        fragmentCandidatesParallel()
data/{molecule}/ms2_*.jdx ─────→ loadData()      ↓
                                     ↓      For each (candidate × adduct):
../reactions/glycansReactions.dwar   ↓      │ filterDwarByIonization(label)
  contains: ionization rows +        ↓      │ → keeps 1 ionization + all reactions
  reaction rows (cleavages, etc.)    ↓      │ massesOnlyWorker.ts:
        ↓                            ↓      │   Stage 1: ionize M → [M+adduct]⁺
   filterDwarByIonization()          ↓      │   Stage 2: fragment → masses[]
        ↓                            ↓      ↓
   1 ionization + all reactions      ↓      CandidateAdductMasses[]
                                     ↓            ↓
                                     ↓      massIndex: Map<name, Map<adduct, masses[]>>
                                     ↓            ↓
                                     ↓      scoreSpectrum(spectrum, masses)
                                     ↓            ↓
                                     ↓      ranked candidates[]
                                     ↓            ↓
                                     ↓      summary.txt + ranking_*.txt
                                     ↓            ↓
                                     └──→ printRanks.ts ──→ summary_cosine.txt
                                                           summary_tanimoto.txt
```

### Worker Thread Architecture

The fragmentation phase uses a **two-dimensional parallelism** model:

- Each (candidate × adduct) pair gets its own worker thread.
- With 10 candidates and 2 adducts, that's 20 tasks.
- Tasks are run through `withConcurrencyLimit()` capped at `maxConcurrency` (default: half of available CPU cores).
- Workers are **lightweight**: no JSDOM, no DOM setup, no SVG rendering, no tree filtering — just the two-stage `reactionFragmentation()` pipeline (ionize → fragment) → extract m/z values.

This makes the multi-candidate pipeline significantly faster than the full `benchmark/` pipeline per molecule.

---

## 3. Folder Structure

```
benchmarkMultiCandidates/
├── script.ts                             # Main benchmark runner
├── printRanks.ts                         # Post-processing: re-rank by Tanimoto
├── README.md                             # This file
├── candidates/                           # Input: candidate molecule library
│   ├── D-Panose.mol
│   ├── Lactodifucotetraose.mol
│   ├── Maltoheptaose.mol
│   ├── Maltohexose.mol
│   ├── Maltooctaose.mol
│   ├── Maltopentaose.mol
│   ├── Mannotriose.mol
│   ├── Penta-acetyl-chitopentaose.mol
│   ├── Tetra-acetyl-chitotetraose.mol
│   └── Triacetyl-chitotriose.mol
├── data/                                 # Input: experimental datasets
│   ├── D-Panose/
│   │   ├── molecule.mol                  # Ground truth structure
│   │   └── ms2_528.00@cid26.00.jdx      # Experimental spectrum
│   ├── Lactodifucotetraose/
│   │   ├── molecule.mol
│   │   ├── ms2_636.00@cid22.00.jdx
│   │   └── ms2_658.00@cid24.00.jdx
│   └── ... (10 molecules total)
├── results/                              # Output
│   ├── summary.txt                       # Global ranking table
│   ├── summary_cosine.txt                # Best-spectrum-per-molecule by cosine
│   ├── summary_tanimoto.txt              # Best-spectrum-per-molecule by Tanimoto
│   └── {molecule}/
│       └── ranking_{adduct}_{spectrum}.txt
└── utils/                                # Shared utilities (see §5)
    ├── index.ts                          # Barrel re-export
    ├── dwar/
    │   └── filterDwarIonization.ts
    ├── formatting/
    │   ├── formatTable.ts
    │   └── sanitize.ts
    ├── fragmentation/
    │   ├── fragmentParallel.ts           # Full pipeline (SVG) — present but unused by script.ts
    │   ├── fragmentWorker.ts             # Full worker — present but unused by script.ts
    │   ├── fragmentMassesParallel.ts     # Masses-only parallel orchestrator ← used
    │   └── massesOnlyWorker.ts           # Lightweight worker ← used
    ├── loader/
    │   ├── loadData.ts                   # Loads experimental datasets
    │   └── loadCandidates.ts             # Loads candidate .mol library
    └── scoring/
        └── scoring.ts
```

### File Roles

| File                                            | Role                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `script.ts`                                     | Main entry point. Loads candidates + data, fragments all candidates, scores, ranks, writes results.                      |
| `printRanks.ts`                                 | Post-processor. Parses ranking files, re-ranks by Tanimoto, picks best spectrum per molecule, writes summary tables.     |
| `utils/index.ts`                                | Barrel file. Re-exports all utility functions and types, including both fragmentation variants and the candidate loader. |
| `utils/fragmentation/fragmentMassesParallel.ts` | Orchestrates masses-only parallel fragmentation across all (candidate × adduct) pairs.                                   |
| `utils/fragmentation/massesOnlyWorker.ts`       | Lightweight worker: `reactionFragmentation()` → extract m/z → post back. No DOM, no SVG.                                 |
| `utils/fragmentation/fragmentParallel.ts`       | Full pipeline with SVG rendering (carried over from `benchmark/` but unused by `script.ts`).                             |
| `utils/fragmentation/fragmentWorker.ts`         | Full worker with JSDOM + SVG (carried over, unused by `script.ts`).                                                      |
| `utils/loader/loadCandidates.ts`                | Reads `candidates/*.mol` and returns `CandidateEntry[]`.                                                                 |
| `utils/loader/loadData.ts`                      | Reads `data/` folder structure. Identical to `benchmark/` version.                                                       |
| `utils/dwar/filterDwarIonization.ts`            | DWAR parsing + per-ionization filtering. Identical to `benchmark/` version.                                              |
| `utils/formatting/formatTable.ts`               | Bordered Unicode text table renderer.                                                                                    |
| `utils/formatting/sanitize.ts`                  | Filename sanitization utility.                                                                                           |
| `utils/scoring/scoring.ts`                      | MSComparator wrapper for cosine + Tanimoto scoring.                                                                      |

---

## 4. Core Functions and Modules

### `script.ts` — Main Entry Point

**Purpose:** End-to-end multi-candidate benchmark pipeline.

**Execution flow:**

1. **Load phase** — `loadCandidates()`, `loadData()`, and `loadDwar()` run concurrently via `Promise.all()`.
2. **Fragmentation phase** — `fragmentCandidatesParallel(candidates, dwar, options)` fragments every candidate under every adduct using worker threads.
3. **Indexing phase** — Results are indexed into a two-level `Map<candidateName, Map<adductLabel, masses[]>>` for O(1) lookup.
4. **Ranking phase** — For each experimental dataset, all candidates are scored and sorted by cosine similarity. The rank of the true solution (where `candidate.name === datum.folderName`) is recorded.
5. **Output phase** — Writes `results/summary.txt` and per-molecule ranking files.

---

### `fragmentCandidatesParallel(candidates, dwar, options)`

**Location:** `utils/fragmentation/fragmentMassesParallel.ts`

**Purpose:** Mass-only parallel fragmentation for bulk candidate screening. The central function that makes multi-candidate benchmarking efficient.

**Parameters:**

| Name         | Type                    | Description                               |
| ------------ | ----------------------- | ----------------------------------------- |
| `candidates` | `CandidateEntry[]`      | Array of candidate molecules to fragment. |
| `dwar`       | `string`                | Raw DWAR reaction database content.       |
| `options`    | `MassesParallelOptions` | Configuration (see below).                |

`MassesParallelOptions`:

| Field            | Type                   | Description                                  |
| ---------------- | ---------------------- | -------------------------------------------- |
| `fragmentation`  | `FragmentationOptions` | Engine options (depth, limits, ionization).  |
| `maxConcurrency` | `number`               | Max simultaneous worker threads (default 3). |
| `excludeLabels`  | `string[]`             | Adduct labels to skip.                       |

**Returns:**

| Type                               | Description                                         |
| ---------------------------------- | --------------------------------------------------- |
| `Promise<CandidateAdductMasses[]>` | Flat array of `{ candidateName, label, masses[] }`. |

**Internal Logic:**

1. Discovers positive-mode ionization labels from DWAR.
2. **Pre-filters** the DWAR once per label via `filterDwarByIonization()` → `Map<label, filteredDwar>`. Each filtered DWAR contains exactly one ionization row + all reaction rows. This avoids redundant parsing of the DWAR for each candidate.
3. Builds one task per `(candidate × adduct)` — each task spawns a `massesOnlyWorker` that will run the full two-stage pipeline (ionize → fragment) for that specific candidate/adduct combination.
4. Runs all tasks through `withConcurrencyLimit()`.
5. Returns a flat array of results.

**Key optimization:** DWAR pre-filtering is O(labels), not O(candidates × labels).

---

### Worker: `massesOnlyWorker.ts`

**Location:** `utils/fragmentation/massesOnlyWorker.ts`

**Purpose:** Lightweight worker thread. Runs the two-stage `reactionFragmentation()` pipeline (ionize the molecule → apply fragmentation reactions) and extracts only m/z values — no DOM, no SVG, no tree filtering.

**Input (workerData):**

| Field           | Type                      | Description                                       |
| --------------- | ------------------------- | ------------------------------------------------- |
| `candidateName` | `string`                  | Name of the candidate molecule.                   |
| `molfile`       | `string`                  | Serialized neutral molecule (MDL Molfile).        |
| `filteredDwar`  | `string`                  | DWAR with one ionization row + all reaction rows. |
| `options`       | `Record<string, unknown>` | Fragmentation engine options.                     |
| `label`         | `string`                  | Ionization label (e.g., `Ionization-Na`).         |

**Output (postMessage):**

| Field           | Type       | Description                          |
| --------------- | ---------- | ------------------------------------ |
| `candidateName` | `string`   | The candidate name (passed through). |
| `label`         | `string`   | The ionization label.                |
| `masses`        | `number[]` | Sorted predicted m/z values.         |

**Internal Logic:**

1. Deserializes the neutral molecule from `molfile`.
2. Calls `reactionFragmentation(molecule, { ...options, dwar: filteredDwar })`. Internally this executes the two-stage pipeline: first the ionization row is applied to produce a charged precursor ion (e.g., [M+Na]⁺), then the fragmentation reaction rows are applied to that precursor to build the fragmentation tree.
3. Extracts `.masses[].mz`, sorts ascending.
4. Posts `{ candidateName, label, masses }` back to the main thread.

**Performance difference vs. full worker:** No `JSDOM` setup, no `getFragmentationSVG()`, no tree walking for filtering or annotation. Typically 3–5× faster per invocation.

---

### `loadCandidates(dirPath)`

**Location:** `utils/loader/loadCandidates.ts`

**Purpose:** Loads all `.mol` files from a directory as candidate structures.

**Parameters:**

| Name      | Type     | Description                                   |
| --------- | -------- | --------------------------------------------- |
| `dirPath` | `string` | Absolute path to the `candidates/` directory. |

**Returns:**

| Type                        | Description                                            |
| --------------------------- | ------------------------------------------------------ |
| `Promise<CandidateEntry[]>` | Array of `{ name, molfile, molecule }` sorted by name. |

**Internal Logic:**

1. Lists directory contents, filters for `.mol` extension.
2. Sorts filenames alphabetically.
3. For each file, reads content, parses with `OCL.Molecule.fromMolfile()`, derives name from filename (minus `.mol`).

**Type: `CandidateEntry`**

| Field      | Type       | Description                                              |
| ---------- | ---------- | -------------------------------------------------------- |
| `name`     | `string`   | Filename without `.mol`. Used as unique identifier.      |
| `molfile`  | `string`   | Raw molfile content (serialized across worker boundary). |
| `molecule` | `Molecule` | Parsed OCL molecule.                                     |

---

### `scoreSpectrum(comparator, spectrum, masses)`

**Location:** `utils/scoring/scoring.ts`

**Purpose:** Computes similarity between predicted masses and an experimental spectrum.

_(Identical to `benchmark/` — see that README for full parameter and return documentation.)_

---

### `createComparator(options)`

**Location:** `utils/scoring/scoring.ts`

**Purpose:** Factory for `MSComparator` instances.

_(Identical to `benchmark/` — see that README for full documentation.)_

---

### `loadData(basePath)`

**Location:** `utils/loader/loadData.ts`

**Purpose:** Reads experimental data directories. Returns molecules + peak-picked spectra.

_(Identical to `benchmark/` — see that README for full documentation.)_

---

### `printRanks.ts` — Post-Processing Script

**Location:** `printRanks.ts` (standalone script)

**Purpose:** Re-analyzes the ranking files produced by `script.ts` to compare cosine vs. Tanimoto as ranking metrics. Picks the best spectrum per molecule and produces condensed summary tables.

**Execution flow:**

1. **Parse phase** — Scans `results/{molecule}/ranking_*.txt` files.
2. **Parse each file** — Extracts the bordered table rows, including `rank`, `candidate`, `cosine`, `tanimoto`, `nbCommonPeaks`, and the `✓` solution marker.
3. **Re-rank phase** — For each ranking file, re-sorts candidates by Tanimoto (the original is by cosine).
4. **Best-spectrum selection** — For each molecule, picks the (adduct × spectrum) combination where the true solution achieves the lowest rank, breaking ties by highest score. Skips entries where the best candidate score is zero.
5. **Output phase** — Writes `summary_cosine.txt` and `summary_tanimoto.txt`.

**Key function: `pickBest(entries, rankKey, scoreKey, bestScoreKey)`**

| Name           | Type                                       | Description                    |
| -------------- | ------------------------------------------ | ------------------------------ |
| `entries`      | `SummaryEntry[]`                           | All ranking entries.           |
| `rankKey`      | `'cosineRank' \| 'tanimotoRank'`           | Which rank to minimize.        |
| `scoreKey`     | `'cosineScore' \| 'tanimotoScore'`         | Tiebreaker (maximize).         |
| `bestScoreKey` | `'cosineBestScore' \| 'tanimotoBestScore'` | Filter out zero-score entries. |

**Returns:** `SummaryEntry[]` — one entry per molecule (best spectrum).

**Key function: `parseRankingFile(content, molecule)`**

Parses a single ranking file by:

1. Extracting molecule/adduct/spectrum from the header line via regex.
2. Parsing table rows delimited by `│` characters.
3. Detecting the solution row by the `✓` marker in the solution column.

---

### `formatTable(headers, rows)`

**Location:** `utils/formatting/formatTable.ts`

_(Identical to `benchmark/` — see that README for full documentation.)_

---

### `sanitize(name)`

**Location:** `utils/formatting/sanitize.ts`

_(Identical to `benchmark/` — see that README for full documentation.)_

---

### `getPositiveIonizationLabels(dwar)` / `filterDwarByIonization(dwar, keepLabel)`

**Location:** `utils/dwar/filterDwarIonization.ts`

_(Identical to `benchmark/` — see that README for full documentation.)_

---

### `withConcurrencyLimit(tasks, limit)`

**Location:** `utils/fragmentation/fragmentMassesParallel.ts` (and `fragmentParallel.ts`)

**Purpose:** Generic concurrency limiter for async task arrays.

**Parameters:**

| Name    | Type                      | Description                    |
| ------- | ------------------------- | ------------------------------ |
| `tasks` | `Array<() => Promise<T>>` | Zero-argument async factories. |
| `limit` | `number`                  | Maximum concurrent tasks.      |

**Returns:**

| Type           | Description                     |
| -------------- | ------------------------------- |
| `Promise<T[]>` | Results in original task order. |

**Internal Logic:** Creates `min(limit, tasks.length)` "lanes". Each lane pulls the next unstarted task from a shared index, awaits it, and loops until all tasks are done. Results are stored by original index.

---

## 5. Shared Infrastructure

Both `benchmark/` and `benchmarkMultiCandidates/` maintain independent copies of the `utils/` directory with identical core modules. This section documents what is shared and what differs.

### Identical Modules

| Module                         | Purpose                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `dwar/filterDwarIonization.ts` | DWAR parsing, ionization label discovery, per-ionization filtering. Produces DWAR with 1 ionization row + all reaction rows. |
| `formatting/formatTable.ts`    | Bordered Unicode text table renderer.                                                                                        |
| `formatting/sanitize.ts`       | Filename-safe string sanitization.                                                                                           |
| `scoring/scoring.ts`           | `MSComparator` factory + `scoreSpectrum()`.                                                                                  |
| `loader/loadData.ts`           | Loads molecule + spectra datasets from filesystem.                                                                           |

### Additional Modules in benchmarkMultiCandidates

| Module                                    | Purpose                                                        |
| ----------------------------------------- | -------------------------------------------------------------- |
| `loader/loadCandidates.ts`                | Loads `.mol` files from a flat directory as candidate entries. |
| `fragmentation/fragmentMassesParallel.ts` | Orchestrates lightweight masses-only parallel fragmentation.   |
| `fragmentation/massesOnlyWorker.ts`       | Worker thread: fragmentation → m/z extraction only.            |

### Carried-Over But Unused Modules

The `benchmarkMultiCandidates/` folder also contains `fragmentParallel.ts` and `fragmentWorker.ts` (the full SVG-capable pipeline). These are **not used** by `script.ts` — only `fragmentMassesParallel.ts` and `massesOnlyWorker.ts` are invoked. They exist for potential future use or if someone needs to generate SVGs for a specific candidate.

### Shared Configuration Defaults

Both benchmarks use the same default parameters:

```typescript
// Scoring
massPower = 3;
intensityPower = 0.6;
precision = 20; // ppm

// Fragmentation
ionizations: ['esi'];
modes: ['positive'];
maxDepth: 5;
limitReactions: 500;
minIonizations: 1;
maxIonizations: 1;
minReactions: 0;
maxReactions: 3;

// Excluded adducts
excludeLabels = ['Ionization-K'];
```

The only difference: `benchmarkMultiCandidates/` uses `Math.floor(availableParallelism() / 2)` for concurrency (CPU-adaptive) while `benchmark/` uses a fixed `maxConcurrency = 4`.

---

## 6. Benchmark Methodology

### What is being benchmarked

The **discriminative power** of the two-stage fragmentation pipeline: given an experimental spectrum, the engine ionizes each candidate molecule (producing a charged precursor) and then applies fragmentation reactions to predict fragment masses. The benchmark measures whether these predicted fragments can uniquely identify the correct molecule from a library of candidates.

### How candidates are evaluated

For each experimental dataset `D` with known structure `S`:

```
For each adduct A:
  For each spectrum P in D:
    For each candidate C in library:
      score(C, A, P) = scoreSpectrum(comparator, P, predictedMasses(C, A))
    rank(S) = position of S in candidates sorted by score descending
```

### Correctness criteria

The solution is considered correctly identified when `rank = 1`. The further the rank diverges from 1, the worse the identification.

### Metrics

| Metric                   | Definition                                                             | Range             | Usage                                                        |
| ------------------------ | ---------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| **Solution rank**        | 1-based position of the true molecule in the sorted candidate list.    | 1 to N candidates | Primary identification metric.                               |
| **Cosine similarity**    | Spectral similarity computed by `MSComparator`. Higher = better match. | 0–1               | Default ranking criterion.                                   |
| **Tanimoto coefficient** | Peak overlap similarity.                                               | 0–1               | Alternative ranking criterion (analyzed by `printRanks.ts`). |
| **nbCommonPeaks**        | Number of experimental peaks matched by at least one predicted mass.   | integer           | Diagnostic.                                                  |
| **nbPeaks1**             | Total experimental peaks.                                              | integer           | Context.                                                     |
| **nbPeaks2**             | Total predicted masses.                                                | integer           | Context.                                                     |

### Solution matching

The "correct solution" is determined by **name matching**: `candidate.name === datum.folderName`. This requires that the candidate `.mol` filenames exactly match the data folder names.

### Best-spectrum selection (printRanks.ts)

For the condensed summaries, the script picks one (adduct × spectrum) per molecule by:

1. Filtering out entries where the best candidate has a score of 0 (no useful information).
2. Sorting by rank ascending, then by score descending (tiebreaker).
3. Taking the first entry.

---

## 7. Benchmark Execution

### Running the main benchmark

```bash
node --no-warnings src/benchmarkMultiCandidates/script.ts
```

### Running the post-processor

```bash
node --no-warnings src/benchmarkMultiCandidates/printRanks.ts
```

> **Note:** `printRanks.ts` must be run **after** `script.ts` because it reads the ranking files from `results/`.

### Required input files

| Input                  | Location                             | Format                  |
| ---------------------- | ------------------------------------ | ----------------------- |
| Candidate structures   | `candidates/*.mol`                   | MDL Molfile V2000/V3000 |
| Experimental molecules | `data/{molecule}/molecule.mol`       | MDL Molfile             |
| Experimental spectra   | `data/{molecule}/ms2_*.jdx`          | JCAMP-DX                |
| Reaction database      | `../reactions/glycansReactions.dwar` | DataWarrior DWAR        |

### Naming convention requirement

**Critical:** Each candidate `.mol` filename (without extension) must match the corresponding `data/` folder name. This mapping is how the system determines the "correct answer" for ranking.

Example:

```
candidates/D-Panose.mol  ↔  data/D-Panose/
```

### Expected runtime behavior

1. Console output starts immediately with timing:
   ```
   Loading candidates and experimental data…
     10 candidates, 10 data entries  [0.3s]
   Fragmenting 10 candidates × adducts (concurrency=12)…
     20 (candidate × adduct) results  [45.2s]
   Scoring and ranking…
     D-Panose: done
     Lactodifucotetraose: done
     ...
   Wrote results/summary.txt
   All results written to results  [48.1s]
   ```
2. The fragmentation phase dominates runtime.
3. Scoring and I/O are fast relative to fragmentation.

### Configuration

Key parameters in `script.ts`:

| Parameter        | Default                      | Effect                                  |
| ---------------- | ---------------------------- | --------------------------------------- |
| `massPower`      | `3`                          | Heavier masses weighted more in cosine. |
| `intensityPower` | `0.6`                        | Sub-linear intensity weighting.         |
| `precision`      | `20`                         | 20 ppm tolerance for peak matching.     |
| `maxConcurrency` | `availableParallelism() / 2` | CPU-adaptive.                           |
| `excludeLabels`  | `['Ionization-K']`           | Potassium adducts excluded.             |
| `maxDepth`       | `5`                          | Maximum fragmentation depth.            |
| `limitReactions` | `500`                        | Max reactions per tree.                 |

---

## 8. Results and Output

### `script.ts` outputs

#### `results/summary.txt` — Global ranking table

One row per (molecule × adduct × spectrum) combination. Columns:

| Column           | Description                                    |
| ---------------- | ---------------------------------------------- |
| `molecule`       | Name of the experimental molecule.             |
| `adduct`         | Ionization label (e.g., `Ionization-Na`).      |
| `spectrum`       | JCAMP filename.                                |
| `rank`           | Solution's rank (1 = best).                    |
| `total`          | Number of candidates.                          |
| `solutionCosine` | Cosine similarity of the correct candidate.    |
| `bestCandidate`  | Name of the top-ranked candidate.              |
| `bestCosine`     | Cosine similarity of the top-ranked candidate. |

Example:

```
│ D-Panose   │ Ionization-Na │ ms2_528.00@cid26.00.jdx │ 5  │ 10 │ 0.965295 │ Lactodifucotetraose │ 0.996685 │
```

**Interpretation:** D-Panose is ranked 5th (out of 10) under Na⁺ adduct. Its cosine (0.965) is high, but Lactodifucotetraose scores even higher (0.997) — a false positive.

#### `results/{molecule}/ranking_{adduct}_{spectrum}.txt` — Detailed ranking

Contains:

1. Header: `Ranking: {molecule} / {adduct} / {spectrum}`
2. Solution rank summary: `Solution rank: {N} / {total}`
3. Full bordered table with all candidates, their cosine, tanimoto, peak counts, and a `✓` marker for the correct solution.

Example:

```
Ranking: D-Panose / Ionization-Na / ms2_528.00@cid26.00.jdx
Solution rank: 5 / 10

┌──────┬────────────────────┬──────────┬──────────┬───────────────┬──────────┬──────────┬──────────┐
│ rank │ candidate          │ cosine   │ tanimoto │ nbCommonPeaks │ nbPeaks1 │ nbPeaks2 │ solution │
├──────┼────────────────────┼──────────┼──────────┼───────────────┼──────────┼──────────┼──────────┤
│ 1    │ Lactodifucotetraose│ 0.996685 │ 0.800000 │ 12            │ 15       │ 12       │          │
│ ...  │                    │          │          │               │          │          │          │
│ 5    │ D-Panose           │ 0.965295 │ 0.800000 │ 12            │ 15       │ 12       │   ✓      │
└──────┴────────────────────┴──────────┴──────────┴───────────────┴──────────┴──────────┴──────────┘
```

### `printRanks.ts` outputs

#### `results/summary_cosine.txt` — Best-spectrum ranking by cosine

One row per molecule. Picks the (adduct × spectrum) where the solution achieves the best rank. Useful for the "best-case" identification performance.

Example:

```
═══ Solution ranking by COSINE ═══

│ D-Panose │ Ionization-Na │ ms2_528.00@cid26.00.jdx │ 5 │ 10 │ 0.965295 │ Lactodifucotetraose │ 0.996685 │
```

#### `results/summary_tanimoto.txt` — Best-spectrum ranking by Tanimoto

Same structure, but candidates are re-ranked by Tanimoto coefficient instead of cosine.

### Interpreting results

| Rank               | Interpretation                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- |
| 1                  | Perfect identification — correct molecule is ranked first.                               |
| 2–3                | Near-miss — structurally similar molecules outscore the true answer.                     |
| ≥ total/2          | Poor discrimination — fragmentation patterns are not distinctive enough.                 |
| rank with cosine 0 | No predicted fragments matched — likely wrong adduct type or spectrum acquisition issue. |

---

## 9. Differences Between Benchmarks

| Aspect                      | benchmark/                                            | benchmarkMultiCandidates/                          |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| **Primary question**        | "Are the predicted fragments correct?"                | "Can we identify the molecule from its spectrum?"  |
| **Candidate count**         | 1 (the known molecule)                                | N (entire candidate library)                       |
| **Output artifacts**        | SVG trees, annotations, scores                        | Ranking tables, summary statistics                 |
| **Fragmentation pipeline**  | Full: trees + SVG + annotations                       | Lightweight: masses-only                           |
| **Worker type**             | `fragmentWorker.ts` (JSDOM, SVG)                      | `massesOnlyWorker.ts` (bare minimum)               |
| **Parallelism granularity** | Per-adduct (1 molecule × N adducts)                   | Per-(candidate × adduct) (M molecules × N adducts) |
| **Concurrency default**     | Fixed at 4                                            | CPU-adaptive (`availableParallelism() / 2`)        |
| **Post-processing**         | None (all in main script)                             | `printRanks.ts` for metric comparison              |
| **Primary metric**          | Absolute cosine + Tanimoto values                     | Rank position of correct solution                  |
| **When to use**             | Validating fragmentation quality, debugging reactions | Evaluating identification discrimination           |

### Relationship between the two

The `benchmark/` system is typically used first to validate that the fragmentation engine works correctly. Once confident in fragmentation quality, `benchmarkMultiCandidates/` tests whether the predicted fragments are **discriminative enough** to identify molecules in a library setting.

A high cosine in `benchmark/` does not guarantee rank 1 in `benchmarkMultiCandidates/`: if structurally similar molecules produce similar fragments, the correct molecule may be outscored by a false positive.

---

## 10. Extending the Benchmark

### Adding new candidate molecules

1. Place the `.mol` file in `candidates/`:
   ```
   candidates/NewMolecule.mol
   ```
2. The name (without `.mol`) becomes the candidate identifier.
3. If this molecule should also be an experimental dataset, create:
   ```
   data/NewMolecule/
   ├── molecule.mol
   └── ms2_*.jdx
   ```
4. Re-run `script.ts`.

### Adding new experimental datasets without adding to candidates

1. Add the data folder `data/NewMolecule/` as above.
2. If `NewMolecule` is not in `candidates/`, the `solutionRank` will be `-1` (not found), indicating no candidate matches the dataset. This is valid for negative control testing.

### Modifying scoring metrics

#### Changing scoring parameters

Edit constants at the top of `script.ts`:

```typescript
const massPower = 5; // stronger mass weighting
const intensityPower = 1.0; // linear intensity
const precision = 10; // stricter tolerance
```

#### Adding a new ranking metric

1. If the metric comes from `ms-spectrum`, extend `ScoringResult` in `utils/scoring/scoring.ts` and update `scoreSpectrum()`.
2. In `script.ts`, include the metric in:
   - The `scored.map()` call (compute per candidate).
   - The `rankHeaders` / `rankRows` arrays for the ranking table.
   - The `summaryHeaders` / `summaryTableRows` for the summary.
3. In `printRanks.ts`, add a new re-ranking block (copy the Tanimoto section, adjust the sort key).

#### Adding a custom metric

For metrics not available in `ms-spectrum`:

```typescript
// In script.ts, inside the scored.map() block:
const scored = candidates.map((c) => {
  const masses = massIndex.get(c.name)?.get(adduct) ?? [];
  const score = scoreSpectrum(comparator, spectrum.value, masses);
  const myCustomMetric = computeMyMetric(spectrum.value, masses);
  return { ...score, candidate: c.name, myCustomMetric };
});
```

### Changing the ranking criterion

The default ranking is by cosine descending:

```typescript
.toSorted((a, b) => b.cosine - a.cosine);
```

To rank by another metric:

```typescript
.toSorted((a, b) => b.tanimoto - a.tanimoto);
```

Or a composite:

```typescript
.toSorted((a, b) => (b.cosine + b.tanimoto) - (a.cosine + a.tanimoto));
```

### Adjusting concurrency

```typescript
const maxConcurrency = availableParallelism(); // use all cores
```

Or for constrained environments:

```typescript
const maxConcurrency = 2; // conservative
```

### Using a different reaction database

```typescript
const dwar = await loadDwar(
  join(import.meta.dirname, '../reactions/myUpdatedReactions.dwar'),
);
```

---
