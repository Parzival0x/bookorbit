/**
 * Strips hyphens, spaces, and non-ISBN characters from an ISBN string,
 * preserving only digits and the X check-digit character.
 */
export function normalizeIsbn(isbn: string): string {
  return isbn.replace(/[^0-9X]/gi, '');
}
