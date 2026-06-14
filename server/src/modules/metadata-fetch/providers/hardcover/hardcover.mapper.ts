import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { HardcoverBookWithEditions, HardcoverCachedContributor, HardcoverEdition, HardcoverSearchDocument } from './hardcover.types';
import { MetadataSearchParams } from '../metadata-search-params';

function parseYear(releaseYear: number | undefined | null, releaseDate: string | undefined): number | undefined {
  if (releaseYear != null) {
    return releaseYear >= 1000 && releaseYear <= 2200 ? releaseYear : undefined;
  }
  if (!releaseDate) return undefined;
  const year = parseInt(releaseDate.substring(0, 4), 10);
  if (Number.isNaN(year) || year < 1000 || year > 2200) return undefined;
  return year;
}

function extractAuthorsFromContributors(contributors: HardcoverCachedContributor[] | undefined): string[] {
  if (!contributors) return [];
  return contributors.map((c) => c.author?.name).filter((n): n is string => n != null);
}

function pickIsbn(isbns: string[] | undefined): { isbn10?: string; isbn13?: string } {
  if (!isbns) return {};
  return {
    isbn13: isbns.find((i) => i.length === 13),
    isbn10: isbns.find((i) => i.length === 10),
  };
}

export function mapSearchDocument(doc: HardcoverSearchDocument): MetadataCandidate {
  const { isbn10, isbn13 } = pickIsbn(doc.isbns);

  return {
    provider: MetadataProviderKey.HARDCOVER,
    providerId: doc.slug,
    title: doc.title,
    subtitle: doc.subtitle,
    description: doc.description,
    authors: doc.author_names ?? [],
    pageCount: doc.pages,
    publishedYear: parseYear(doc.release_year, doc.release_date),
    isbn10,
    isbn13,
    genres: doc.genres,
    seriesName: doc.featured_series?.series?.name,
    seriesIndex: doc.featured_series?.position ?? undefined,
    coverUrl: doc.image?.url,
    sourceUrl: `https://hardcover.app/books/${doc.slug}`,
  };
}

export function mapBookWithEditions(book: HardcoverBookWithEditions): MetadataCandidate[] {
  if (!book.editions || book.editions.length === 0) return [];
  return book.editions.map((edition) => mapEdition(edition, book));
}

function mapEdition(edition: HardcoverEdition, book: HardcoverBookWithEditions): MetadataCandidate {
  const editionAuthors = extractAuthorsFromContributors(edition.cached_contributors);
  const authors = editionAuthors.length > 0 ? editionAuthors : extractAuthorsFromContributors(book.cached_contributors);
  const isAudiobook = edition.edition_format?.toLowerCase().includes('audio');

  return {
    provider: MetadataProviderKey.HARDCOVER,
    providerId: book.slug,
    title: edition.title ?? book.title,
    subtitle: edition.subtitle ?? book.subtitle,
    description: book.description,
    authors,
    publisher: edition.publisher?.name,
    language: edition.language?.code2,
    pageCount: isAudiobook ? edition.pages : (edition.pages ?? book.pages),
    publishedYear: parseYear(edition.release_year ?? book.release_year, edition.release_date ?? book.release_date),
    isbn10: edition.isbn_10,
    isbn13: edition.isbn_13,
    seriesName: book.featured_book_series?.series?.name,
    seriesIndex: book.featured_book_series?.position ?? undefined,
    coverUrl: edition.image?.url ?? book.image?.url,
    sourceUrl: `https://hardcover.app/books/${book.slug}`,
  };
}

export function mapBestEditionForBook(book: HardcoverBookWithEditions, params: MetadataSearchParams): MetadataCandidate | null {
  if (!book.editions || book.editions.length === 0) return null;

  const targetAudio = params.isAudiobook ?? false;
  const targetPages = params.pageCount;
  const targetIsbn = params.isbn?.replace(/[^0-9X]/gi, ''); // Normalize ISBN for comparison

  const sorted = [...book.editions].sort((a, b) => {
    // 0. Exact ISBN match (Strongest signal)
    if (targetIsbn) {
      const aIsbnMatch = (a.isbn_13?.replace(/[^0-9X]/gi, '') === targetIsbn) || (a.isbn_10?.replace(/[^0-9X]/gi, '') === targetIsbn);
      const bIsbnMatch = (b.isbn_13?.replace(/[^0-9X]/gi, '') === targetIsbn) || (b.isbn_10?.replace(/[^0-9X]/gi, '') === targetIsbn);
      if (aIsbnMatch !== bIsbnMatch) return aIsbnMatch ? -1 : 1;
    }

    const aAudio = a.edition_format?.toLowerCase().includes('audio') ?? false;
    const bAudio = b.edition_format?.toLowerCase().includes('audio') ?? false;

    // 1. Format match
    // 1. Format match
    const aFormatMatch = aAudio === targetAudio;
    const bFormatMatch = bAudio === targetAudio;
    if (aFormatMatch !== bFormatMatch) return aFormatMatch ? -1 : 1;

    // 2. Page count closeness
    if (targetPages) {
      const aPages = a.pages ?? (aAudio ? undefined : book.pages);
      const bPages = b.pages ?? (bAudio ? undefined : book.pages);
      
      if (aPages !== undefined && bPages !== undefined) {
        const aDiff = Math.abs(aPages - targetPages);
        const bDiff = Math.abs(bPages - targetPages);
        if (aDiff !== bDiff) return aDiff - bDiff;
      } else if (aPages !== undefined) {
        return -1;
      } else if (bPages !== undefined) {
        return 1;
      }
    }

    // 3. Has ISBN
    const aHasIsbn = !!(a.isbn_13 || a.isbn_10);
    const bHasIsbn = !!(b.isbn_13 || b.isbn_10);
    if (aHasIsbn !== bHasIsbn) return aHasIsbn ? -1 : 1;

    return 0;
  });

  return mapEdition(sorted[0], book);
}
