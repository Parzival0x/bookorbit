import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { HardcoverClient } from './hardcover.client';
import { mapBestEditionForBook, mapBookWithEditions, mapSearchDocument } from './hardcover.mapper';
import { HardcoverSearchDocument } from './hardcover.types';
import { normalizeIsbn } from '../../../../common/utils/isbn-normalize.utils';

@Injectable()
export class HardcoverProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.HARDCOVER;
  readonly label = 'Hardcover';
  readonly identifiable = true as const;

  private readonly logger = new Logger(HardcoverProvider.name);

  constructor(
    private readonly client: HardcoverClient,
    private readonly providerConfig: ProviderConfigService,
  ) {}

  private async processSearchDocs(
    docs: HardcoverSearchDocument[],
    apiKey: string,
    params: MetadataSearchParams,
    signal?: AbortSignal,
  ): Promise<MetadataCandidate[]> {
    if (docs.length === 0) return [];

    const topDocs = docs.slice(0, 3);
    const books = await Promise.all(
      topDocs.map((doc) => (signal ? this.client.lookupBySlug(doc.slug, apiKey, signal) : this.client.lookupBySlug(doc.slug, apiKey))),
    );

    const candidates = books
      .filter((b) => b !== null)
      .map((book) => mapBestEditionForBook(book, params))
      .filter((c): c is MetadataCandidate => c !== null);

    if (candidates.length > 0) {
      return candidates;
    }

    return docs.map((doc) => {
      const candidate = mapSearchDocument(doc);
      // ISBNs from search documents are aggregated across all editions and may not
      // correspond to the user's specific edition. Remove them to avoid mismatches.
      delete candidate.isbn10;
      delete candidate.isbn13;
      return candidate;
    });
  }

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.hardcover);
    if (!enabled || !apiKey) return [];
    const signal = params.signal;

    if (params.isbn) {
      const cleanIsbn = normalizeIsbn(params.isbn);
      const books = signal ? await this.client.searchByIsbn(cleanIsbn, apiKey, signal) : await this.client.searchByIsbn(cleanIsbn, apiKey);
      if (books.length > 0) {
        const bestMatches = books
          .map((book) => mapBestEditionForBook(book, params))
          .filter((candidate): candidate is MetadataCandidate => candidate !== null);
        return bestMatches;
      }
    }

    if (!params.title) return [];

    if (params.author) {
      const docs = signal
        ? await this.client.searchBooks(`${params.title} ${params.author}`, apiKey, signal)
        : await this.client.searchBooks(`${params.title} ${params.author}`, apiKey);
      if (docs.length > 0) {
        return this.processSearchDocs(docs, apiKey, params, signal);
      }
      this.logger.debug(`Hardcover: no results for title+author, retrying with title only`);
    }

    const docs = signal ? await this.client.searchBooks(params.title, apiKey, signal) : await this.client.searchBooks(params.title, apiKey);
    return this.processSearchDocs(docs, apiKey, params, signal);
  }

  async lookupById(providerId: string, signal?: AbortSignal, params?: MetadataSearchParams): Promise<MetadataCandidate | null> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.hardcover);
    if (!enabled || !apiKey) return null;

    const book = signal ? await this.client.lookupBySlug(providerId, apiKey, signal) : await this.client.lookupBySlug(providerId, apiKey);
    if (!book) return null;

    if (params) {
      return mapBestEditionForBook(book, params);
    }

    // Fallback if no params
    return mapBookWithEditions(book)[0] ?? null;
  }
}
