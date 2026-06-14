import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

import { ParsedOpf, ParsedOpfResult, parseOpf } from './opf-parser';

const containerParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

async function readFileFromZip(zip: unzipper.CentralDirectory, filePath: string): Promise<string> {
  const file = zip.files.find((f) => f.path === filePath || f.path === filePath.replace(/^\//, ''));
  if (!file) throw new Error(`File not found in EPUB: ${filePath}`);
  const buf = await file.buffer();
  return buf.toString('utf-8');
}

async function findOpfPath(zip: unzipper.CentralDirectory): Promise<string> {
  const containerXml = await readFileFromZip(zip, 'META-INF/container.xml');
  const parsed = containerParser.parse(containerXml) as Record<string, unknown>;

  const container = parsed['container'] as Record<string, unknown>;
  const rootfiles = (container?.['rootfiles'] as Record<string, unknown>)?.['rootfile'];
  const rootfile: unknown = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;

  const opfPath = (rootfile as Record<string, unknown> | undefined)?.['@_full-path'];
  if (typeof opfPath !== 'string' || !opfPath) {
    throw new Error('Cannot locate OPF path in container.xml');
  }

  return opfPath;
}

/**
 * Open an EPUB file and extract metadata from its OPF.
 * Returns null if the file is not a valid EPUB or parsing fails.
 */
export async function extractEpubMetadata(absolutePath: string): Promise<ParsedOpf | null> {
  try {
    const zip = await unzipper.Open.file(absolutePath);
    const opfPath = await findOpfPath(zip);
    const opfXml = await readFileFromZip(zip, opfPath);
    const result = parseOpf(opfXml);

    if (!result.isbn13 && !result.isbn10) {
      await findFallbackIsbn(zip, result, opfPath);
    }

    // Strip structural fields — they are internal to EPUB extraction
    const { spine: _spine, manifest: _manifest, guide: _guide, ...metadata } = result;
    return metadata;
  } catch {
    return null;
  }
}

function isValidIsbn13(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const d = parseInt(digits[i], 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return sum % 10 === 0;
}

function isValidIsbn10(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = digits[i].toUpperCase();
    const d = ch === 'X' ? 10 : parseInt(ch, 10);
    sum += d * (10 - i);
  }
  return sum % 11 === 0;
}

function extractIsbnFromText(text: string): { isbn10: string | null; isbn13: string | null } | null {
  const isbnRegex = /ISBN(?:-1[03])?[\s:]*([0-9X\-\s]{10,17})/gi;
  let match;
  while ((match = isbnRegex.exec(text)) !== null) {
    const digits = match[1].replace(/[^\dX]/gi, '');
    if (digits.length === 13 && isValidIsbn13(digits)) return { isbn10: null, isbn13: digits };
    if (digits.length === 10 && isValidIsbn10(digits)) return { isbn10: digits, isbn13: null };
  }
  return null;
}

async function findFallbackIsbn(zip: unzipper.CentralDirectory, opf: ParsedOpfResult, opfPath: string): Promise<void> {
  const targetFiles = new Set<string>();

  const resolveHref = (href: string | undefined) => {
    if (!href) return null;
    const decoded = decodeURIComponent(href.split('#')[0]);
    const parts = opfPath.split('/');
    parts.pop();
    return parts.length === 0 ? decoded : parts.join('/') + '/' + decoded;
  };

  for (const [type, href] of Object.entries(opf.guide)) {
    if (['copyright', 'title-page', 'colophon'].includes(type.toLowerCase())) {
      const resolved = resolveHref(href);
      if (resolved) targetFiles.add(resolved);
    }
  }

  const spineHrefs = opf.spine.map((id) => opf.manifest[id]).filter(Boolean);
  const edges = [...spineHrefs.slice(0, 3), ...spineHrefs.slice(-2)];
  for (const href of edges) {
    const resolved = resolveHref(href);
    if (resolved) targetFiles.add(resolved);
  }

  for (const href of Object.values(opf.manifest)) {
    const lower = href.toLowerCase();
    if (lower.includes('copyright') || lower.includes('colophon') || lower.includes('frontmatter') || lower.includes('backmatter') || lower.includes('imprint')) {
      const resolved = resolveHref(href);
      if (resolved) targetFiles.add(resolved);
    }
  }

  for (const filePath of targetFiles) {
    try {
      const html = await readFileFromZip(zip, filePath);
      const text = html.replace(/<[^>]+>/g, ' ');
      const isbn = extractIsbnFromText(text);
      if (isbn) {
        if (!opf.isbn13 && isbn.isbn13) opf.isbn13 = isbn.isbn13;
        if (!opf.isbn10 && isbn.isbn10) opf.isbn10 = isbn.isbn10;
        if (opf.isbn13 || opf.isbn10) return;
      }
    } catch {
      // ignore
    }
  }
}
