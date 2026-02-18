/**
 * Format tabular data as a human-readable, bordered text table.
 *
 * Example output:
 * ```
 * ┌────────────────┬──────────────────────────┬──────────┬──────────┬───────────────┬──────────┬──────────┐
 * │ adduct         │ spectrum                 │   cosine │ tanimoto │ nbCommonPeaks │ nbPeaks1 │ nbPeaks2 │
 * ├────────────────┼──────────────────────────┼──────────┼──────────┼───────────────┼──────────┼──────────┤
 * │ Ionization-Na  │ ms2_52.00@cid25.00.jdx   │ 0.948700 │ 0.695700 │            16 │       23 │        8 │
 * └────────────────┴──────────────────────────┴──────────┴──────────┴───────────────┴──────────┴──────────┘
 * ```
 * @param headers - Column header labels.
 * @param rows - Array of row arrays (each row has the same length as headers).
 * @returns The formatted table as a multi-line string.
 */
export function formatTable(headers: string[], rows: string[][]): string {
  // Compute the max width for each column.
  const widths = headers.map((h, col) =>
    Math.max(
      h.length,
      ...rows.map((row) => (row[col] ?? '').length),
    ),
  );

  const pad = (text: string, width: number): string =>
    text + ' '.repeat(Math.max(0, width - text.length));

  // Box-drawing borders
  const topBorder =
    `┌${widths.map((w) => '─'.repeat(w + 2)).join('┬')}┐`;
  const midBorder =
    `├${widths.map((w) => '─'.repeat(w + 2)).join('┼')}┤`;
  const bottomBorder =
    `└${widths.map((w) => '─'.repeat(w + 2)).join('┴')}┘`;

  const formatRow = (cells: string[]): string =>
    `│ ${cells.map((cell, i) => pad(cell, widths[i] ?? 0)).join(' │ ')} │`;

  const lines: string[] = [
    topBorder,
    formatRow(headers),
    midBorder,
    ...rows.map((row) => formatRow(row)),
    bottomBorder,
  ];

  return lines.join('\n');
}
