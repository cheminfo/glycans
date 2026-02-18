/**
 * Sanitize a string for safe use as a filename component.
 *
 * Replaces every character that is not a word character (`\w`), a dot, or
 * a hyphen with an underscore.
 * @param name - Raw name string.
 * @returns Sanitized string safe for filenames.
 */
export function sanitize(name: string): string {
  return name.replaceAll(/[^\w.-]/g, '_');
}
