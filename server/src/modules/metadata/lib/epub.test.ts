vi.mock('unzipper', () => ({ Open: { file: vi.fn() } }));
vi.mock('./opf-parser', () => ({ parseOpf: vi.fn() }));

import * as unzipper from 'unzipper';

import { parseOpf } from './opf-parser';
import { extractEpubMetadata } from './epub';

const mockOpenFile = (unzipper as any).Open.file as vi.Mock;
const mockParseOpf = parseOpf as MockedFunction<typeof parseOpf>;

function zipFile(path: string, content: string | Buffer) {
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  return {
    path,
    buffer: () => Promise.resolve(buf),
  };
}

describe('extractEpubMetadata', () => {
  beforeEach(() => vi.resetAllMocks());

  it('extracts OPF path from container.xml and parses metadata', async () => {
    const containerXml = `
      <container>
        <rootfiles>
          <rootfile full-path="OPS/content.opf" />
        </rootfiles>
      </container>
    `;

    mockOpenFile.mockResolvedValue({
      files: [zipFile('META-INF/container.xml', containerXml), zipFile('OPS/content.opf', '<package/>')],
    });

    mockParseOpf.mockReturnValue({
      title: 'Dune',
      subtitle: null,
      description: null,
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      authors: [],
      tags: [],
      spine: [],
      manifest: {},
      guide: {},
    });

    const result = await extractEpubMetadata('/books/dune.epub');
    expect(result).toEqual(expect.objectContaining({ title: 'Dune' }));
    expect(result).not.toHaveProperty('spine');
    expect(result).not.toHaveProperty('manifest');
    expect(result).not.toHaveProperty('guide');
  });

  it('handles container OPF path with leading slash', async () => {
    const containerXml = `<container><rootfiles><rootfile full-path="/OPS/content.opf" /></rootfiles></container>`;

    mockOpenFile.mockResolvedValue({
      files: [zipFile('META-INF/container.xml', containerXml), zipFile('OPS/content.opf', '<package/>')],
    });

    mockParseOpf.mockReturnValue({
      title: 'Leading Slash',
      subtitle: null,
      description: null,
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      authors: [],
      tags: [],
      spine: [],
      manifest: {},
      guide: {},
    });

    const result = await extractEpubMetadata('/books/x.epub');
    expect(result).toEqual(expect.objectContaining({ title: 'Leading Slash' }));
    expect(result).not.toHaveProperty('spine');
    expect(result).not.toHaveProperty('manifest');
    expect(result).not.toHaveProperty('guide');
  });

  it('returns null when EPUB internals are missing or invalid', async () => {
    mockOpenFile.mockResolvedValue({ files: [] });

    await expect(extractEpubMetadata('/broken.epub')).resolves.toBeNull();
  });

  it('populates isbn13 from fallback scan when metadata has no ISBN', async () => {
    const containerXml = `
      <container>
        <rootfiles>
          <rootfile full-path="OPS/content.opf" />
        </rootfiles>
      </container>
    `;

    const copyrightHtml = `
      <html><body>
        <p>Copyright \u00a9 2024 by Author Name</p>
        <p>ISBN: 978-0-441-01359-3</p>
      </body></html>
    `;

    mockOpenFile.mockResolvedValue({
      files: [
        zipFile('META-INF/container.xml', containerXml),
        zipFile('OPS/content.opf', '<package/>'),
        zipFile('OPS/copyright.xhtml', copyrightHtml),
      ],
    });

    mockParseOpf.mockReturnValue({
      title: 'No ISBN Book',
      subtitle: null,
      description: null,
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      authors: [],
      tags: [],
      spine: [],
      manifest: { 'copyright-id': 'copyright.xhtml' },
      guide: {},
    });

    const result = await extractEpubMetadata('/books/no-isbn.epub');
    expect(result).not.toBeNull();
    expect(result!.isbn13).toBe('9780441013593');
  });

  it('rejects ISBN candidates with invalid checksums', async () => {
    const containerXml = `
      <container>
        <rootfiles>
          <rootfile full-path="OPS/content.opf" />
        </rootfiles>
      </container>
    `;

    // Last digit changed from 3 to 4 — invalid ISBN-13 checksum
    const copyrightHtml = `
      <html><body>
        <p>ISBN: 978-0-441-01359-4</p>
      </body></html>
    `;

    mockOpenFile.mockResolvedValue({
      files: [
        zipFile('META-INF/container.xml', containerXml),
        zipFile('OPS/content.opf', '<package/>'),
        zipFile('OPS/copyright.xhtml', copyrightHtml),
      ],
    });

    mockParseOpf.mockReturnValue({
      title: 'Bad ISBN Book',
      subtitle: null,
      description: null,
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      authors: [],
      tags: [],
      spine: [],
      manifest: { 'copyright-id': 'copyright.xhtml' },
      guide: {},
    });

    const result = await extractEpubMetadata('/books/bad-isbn.epub');
    expect(result).not.toBeNull();
    expect(result!.isbn13).toBeNull();
    expect(result!.isbn10).toBeNull();
  });
});
