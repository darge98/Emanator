import type { NewCapabilityInput } from '../domain/capability.ts';
import { CATALOG, type CatalogEntry } from '../domain/catalog.ts';

/** A catalog entry with what `.env` gives it. */
export interface CatalogOffer {
  entry: CatalogEntry;
  /** Variables still missing; the entry can't connect until they are set. */
  missing: string[];
  /** The Capability the entry makes, once nothing is missing. */
  input?: NewCapabilityInput;
}

/**
 * Reads the catalog's settings from the environment each time, so a change to `.env`
 * applies at the next start or connection without editing anything in the dashboard.
 */
export class CapabilityCatalog {
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly entries: readonly CatalogEntry[] = CATALOG,
  ) {}

  offers(): CatalogOffer[] {
    return this.entries.map((entry) => this.resolve(entry));
  }

  offer(id: string): CatalogOffer | undefined {
    const entry = this.entries.find((candidate) => candidate.id === id);
    return entry && this.resolve(entry);
  }

  private resolve(entry: CatalogEntry): CatalogOffer {
    const read = (variable: string) => this.env[variable]?.trim() || undefined;
    const base = read(entry.url.variable) ?? entry.url.base;
    const clientId = entry.client && read(entry.client.idVariable);
    const clientSecret = entry.client && read(entry.client.secretVariable);
    const missing = entry.client
      ? [
          ...(clientId ? [] : [entry.client.idVariable]),
          ...(clientSecret ? [] : [entry.client.secretVariable]),
        ]
      : [];
    if (missing.length > 0) return { entry, missing };
    return {
      entry,
      missing,
      input: {
        slug: entry.slug,
        title: entry.title,
        url: `${base.replace(/\/+$/, '')}${entry.url.path}`,
        scopes: [...entry.scopes],
        enabled: true,
        ...(clientId && { clientId }),
        ...(clientSecret && { clientSecret }),
      },
    };
  }
}
