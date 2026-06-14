import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizeIsbn } from '../../common/utils/isbn-normalize.utils';
import type { BookSyncData } from './hardcover.repository';
import { HardcoverClientService } from './hardcover-client.service';
import { HardcoverRepository } from './hardcover.repository';

export interface HardcoverBookMatch {
  hardcoverBookId: number;
  hardcoverEditionId: number | null;
  editionPages: number | null;
  matchMethod: 'isbn' | 'title' | 'cached' | 'metadata_id';
}

const FIND_BOOK_BY_ISBN13_QUERY = `
query FindBookByISBN13($isbn: String!) {
  books(where: { editions: { isbn_13: { _eq: $isbn } } }, limit: 1) {
    id
    editions(where: { isbn_13: { _eq: $isbn } }, limit: 1) {
      id
      pages
    }
  }
}`;

const FIND_BOOK_BY_ISBN10_QUERY = `
query FindBookByISBN10($isbn: String!) {
  books(where: { editions: { isbn_10: { _eq: $isbn } } }, limit: 1) {
    id
    editions(where: { isbn_10: { _eq: $isbn } }, limit: 1) {
      id
      pages
    }
  }
}`;

const SEARCH_BOOKS_QUERY = `
query SearchBooks($query: String!) {
  search(
    query: $query
    query_type: "Book"
    per_page: 5
    page: 1
    fields: "title,author_names,alternative_titles"
    weights: "5,2,1"
  ) {
    ids
  }
}`;

const FIND_BOOKS_BY_IDS_QUERY = `
query FindBooksByIds($ids: [Int!]!) {
  books(where: { id: { _in: $ids } }, limit: 5) {
    id
    editions(limit: 50) {
      id
      pages
      isbn_10
      isbn_13
    }
  }
}`;

const FIND_BOOK_BY_HARDCOVER_ID_QUERY = `
query FindBookById($id: Int!) {
  books(where: { id: { _eq: $id } }, limit: 1) {
    id
    editions(limit: 50) {
      id
      pages
      isbn_10
      isbn_13
    }
  }
}`;

const FIND_BOOK_BY_HARDCOVER_SLUG_QUERY = `
query FindBookBySlug($slug: String!) {
  books(where: { slug: { _eq: $slug } }, limit: 1) {
    id
    editions(limit: 50) {
      id
      pages
      isbn_10
      isbn_13
    }
  }
}`;

const FIND_BOOK_EDITIONS_BY_HARDCOVER_ID_QUERY = `
query FindBookEditionsById($id: Int!) {
  books(where: { id: { _eq: $id } }, limit: 1) {
    id
    editions(limit: 50) {
      id
      pages
      isbn_10
      isbn_13
    }
  }
}`;

interface BooksQueryResult {
  books: Array<{
    id: number;
    editions?: Array<{ id: number; pages?: number | null; isbn_10?: string | null; isbn_13?: string | null }>;
  }>;
}

interface SearchBooksResult {
  search?: {
    ids?: number[];
  } | null;
}

@Injectable()
export class HardcoverBookMatchService {
  private readonly logger = new Logger(HardcoverBookMatchService.name);

  constructor(
    private readonly repo: HardcoverRepository,
    private readonly client: HardcoverClientService,
  ) {}

  async matchBook(userId: number, token: string, book: BookSyncData): Promise<HardcoverBookMatch | null> {
    const cached = await this.repo.findBookState(userId, book.bookId);
    if (cached?.hardcoverBookId && !cached.matchError) {
      const cachedMatch = await this.resolveCachedMatch(userId, token, book.bookId, cached.hardcoverBookId, cached.hardcoverEditionId ?? null);

      if ((cached.hardcoverEditionId ?? null) !== cachedMatch.hardcoverEditionId) {
        await this.repo.upsertBookState({
          userId,
          bookId: book.bookId,
          hardcoverBookId: cached.hardcoverBookId,
          hardcoverEditionId: cachedMatch.hardcoverEditionId,
          matchMethod: 'cached',
          matchError: null,
        });
      }

      return {
        hardcoverBookId: cached.hardcoverBookId,
        hardcoverEditionId: cachedMatch.hardcoverEditionId,
        editionPages: cachedMatch.editionPages,
        matchMethod: 'cached',
      };
    }

    let match: HardcoverBookMatch | null = null;

    if (book.hardcoverMetadataId) {
      const id = parseInt(book.hardcoverMetadataId, 10);
      if (!isNaN(id)) {
        match = await this.matchByHardcoverId(userId, token, id, book);
      } else {
        match = await this.matchByHardcoverSlug(userId, token, book.hardcoverMetadataId, book);
      }
    }

    if (!match && book.isbn13) {
      match = await this.matchByIsbn(userId, token, book.isbn13, book.bookId, 13);
    }

    if (!match && book.isbn10) {
      match = await this.matchByIsbn(userId, token, book.isbn10, book.bookId, 10);
    }

    if (!match && book.title && book.authorName) {
      match = await this.matchByTitleAuthor(userId, token, book.title, book.authorName, book);
    }

    if (match) {
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        hardcoverBookId: match.hardcoverBookId,
        hardcoverEditionId: match.hardcoverEditionId ?? null,
        matchMethod: match.matchMethod,
        matchError: null,
      });
    } else {
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        hardcoverBookId: null,
        matchError: 'no_match',
      });
    }

    return match;
  }

  private async matchByHardcoverId(userId: number, token: string, id: number, bookSync: BookSyncData): Promise<HardcoverBookMatch | null> {
    try {
      const data = await this.client.query<BooksQueryResult>(userId, token, FIND_BOOK_BY_HARDCOVER_ID_QUERY, { id });
      const book = data.books?.[0];
      if (!book) return null;
      const bestEdition = this.findBestEdition(book.editions ?? [], bookSync);
      return {
        hardcoverBookId: book.id,
        hardcoverEditionId: bestEdition.hardcoverEditionId,
        editionPages: bestEdition.editionPages,
        matchMethod: 'metadata_id',
      };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[hardcover.book_match] [fail] userId=${userId} bookId=${bookSync.bookId} method=metadata_id error="${error}" - metadata_id lookup failed`,
      );
      return null;
    }
  }

  private async matchByHardcoverSlug(userId: number, token: string, slug: string, bookSync: BookSyncData): Promise<HardcoverBookMatch | null> {
    try {
      const data = await this.client.query<BooksQueryResult>(userId, token, FIND_BOOK_BY_HARDCOVER_SLUG_QUERY, { slug });
      const book = data.books?.[0];
      if (!book) return null;
      const bestEdition = this.findBestEdition(book.editions ?? [], bookSync);
      return {
        hardcoverBookId: book.id,
        hardcoverEditionId: bestEdition.hardcoverEditionId,
        editionPages: bestEdition.editionPages,
        matchMethod: 'metadata_id',
      };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[hardcover.book_match] [fail] userId=${userId} bookId=${bookSync.bookId} method=metadata_slug error="${error}" - metadata_slug lookup failed`,
      );
      return null;
    }
  }

  private async matchByIsbn(userId: number, token: string, isbn: string, bookId: number, version: 10 | 13): Promise<HardcoverBookMatch | null> {
    const cleanIsbn = normalizeIsbn(isbn);
    const query = version === 13 ? FIND_BOOK_BY_ISBN13_QUERY : FIND_BOOK_BY_ISBN10_QUERY;
    try {
      const data = await this.client.query<BooksQueryResult>(userId, token, query, { isbn: cleanIsbn });
      const book = data.books?.[0];
      if (!book) return null;
      return {
        hardcoverBookId: book.id,
        hardcoverEditionId: book.editions?.[0]?.id ?? null,
        editionPages: book.editions?.[0]?.pages ?? null,
        matchMethod: 'isbn',
      };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(`[hardcover.book_match] [fail] userId=${userId} bookId=${bookId} method=isbn${version} error="${error}" - ISBN lookup failed`);
      return null;
    }
  }

  private async matchByTitleAuthor(
    userId: number,
    token: string,
    title: string,
    author: string,
    bookSync: BookSyncData,
  ): Promise<HardcoverBookMatch | null> {
    try {
      const searchData = await this.client.query<SearchBooksResult>(userId, token, SEARCH_BOOKS_QUERY, {
        query: `${title} ${author}`,
      });
      const ids = searchData.search?.ids?.filter((id) => Number.isInteger(id)).slice(0, 5) ?? [];
      if (ids.length === 0) return null;

      const data = await this.client.query<BooksQueryResult>(userId, token, FIND_BOOKS_BY_IDS_QUERY, { ids });
      const booksById = new Map((data.books ?? []).map((book) => [book.id, book]));
      const book = ids.map((id) => booksById.get(id)).find((candidate): candidate is BooksQueryResult['books'][number] => candidate != null);
      if (!book) return null;
      const bestEdition = this.findBestEdition(book.editions ?? [], bookSync);
      return {
        hardcoverBookId: book.id,
        hardcoverEditionId: bestEdition.hardcoverEditionId,
        editionPages: bestEdition.editionPages,
        matchMethod: 'title',
      };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[hardcover.book_match] [fail] userId=${userId} bookId=${bookSync.bookId} method=title_author error="${error}" - title lookup failed`,
      );
      return null;
    }
  }

  private async resolveCachedMatch(
    userId: number,
    token: string,
    bookId: number,
    hardcoverBookId: number,
    cachedEditionId: number | null,
  ): Promise<{ hardcoverEditionId: number | null; editionPages: number | null }> {
    try {
      const data = await this.client.query<BooksQueryResult>(userId, token, FIND_BOOK_EDITIONS_BY_HARDCOVER_ID_QUERY, {
        id: hardcoverBookId,
      });
      const hardcoverBook = data.books?.[0];
      if (!hardcoverBook) {
        return { hardcoverEditionId: cachedEditionId, editionPages: null };
      }

      const editions = hardcoverBook.editions ?? [];
      const cachedEdition = cachedEditionId != null ? editions.find((edition) => edition.id === cachedEditionId) : undefined;
      const cachedEditionPages = this.normalizeEditionPages(cachedEdition?.pages);

      return { hardcoverEditionId: cachedEditionId, editionPages: cachedEditionPages };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[hardcover.book_match] [fail] userId=${userId} bookId=${bookId} method=cached_pages error="${error}" - cached edition pages lookup failed`,
      );
      return { hardcoverEditionId: cachedEditionId, editionPages: null };
    }
  }

  private findBestEdition(
    editions: NonNullable<BooksQueryResult['books'][0]['editions']>,
    book: BookSyncData,
  ): { hardcoverEditionId: number | null; editionPages: number | null } {
    if (!editions || editions.length === 0) return { hardcoverEditionId: null, editionPages: null };

    if (book.isbn13) {
      const targetIsbn = normalizeIsbn(book.isbn13);
      const match = editions.find((e) => e.isbn_13 ? normalizeIsbn(e.isbn_13) === targetIsbn : false);
      if (match) return { hardcoverEditionId: match.id, editionPages: this.normalizeEditionPages(match.pages) };
    }

    if (book.isbn10) {
      const targetIsbn = normalizeIsbn(book.isbn10);
      const match = editions.find((e) => e.isbn_10 ? normalizeIsbn(e.isbn_10) === targetIsbn : false);
      if (match) return { hardcoverEditionId: match.id, editionPages: this.normalizeEditionPages(match.pages) };
    }

    if (book.pageCount != null && book.pageCount > 0) {
      const editionsWithPages = editions.filter((e) => this.normalizeEditionPages(e.pages) != null);
      if (editionsWithPages.length > 0) {
        let bestEdition = editionsWithPages[0]!;
        let minDiff = Math.abs(this.normalizeEditionPages(bestEdition.pages)! - book.pageCount);
        for (let i = 1; i < editionsWithPages.length; i++) {
          const e = editionsWithPages[i]!;
          const diff = Math.abs(this.normalizeEditionPages(e.pages)! - book.pageCount);
          if (diff < minDiff) {
            minDiff = diff;
            bestEdition = e;
          }
        }
        return { hardcoverEditionId: bestEdition.id, editionPages: this.normalizeEditionPages(bestEdition.pages) };
      }
    }

    const fallbackEdition = editions.find((e) => this.normalizeEditionPages(e.pages) != null);
    if (fallbackEdition) {
      return { hardcoverEditionId: fallbackEdition.id, editionPages: this.normalizeEditionPages(fallbackEdition.pages) };
    }

    return { hardcoverEditionId: editions[0]!.id, editionPages: null };
  }

  private normalizeEditionPages(pages: number | null | undefined): number | null {
    if (typeof pages !== 'number' || !Number.isFinite(pages) || pages <= 0) return null;
    return Math.round(pages);
  }
}
