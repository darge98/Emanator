import { randomUUID } from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Capability } from '../domain/capability.ts';
import type { CapabilityStore } from './capability-store.ts';

/** An authorization the Owner is going through in the browser, started from the dashboard. */
export interface BrowserAuthorization {
  state: string;
  codeVerifier?: string;
  /** Where the Owner must go to authorize, once the SDK has built it. */
  authorizationUrl?: URL;
}

/**
 * The Harness as the OAuth client of one Capability's server, keeping what the SDK hands it
 * in the store. Without a browser authorization, e.g. during a turn, an expired grant can
 * only be noted: nobody is there to log in, so `needsAuthorization` is set instead.
 */
export class CapabilityOAuthProvider implements OAuthClientProvider {
  needsAuthorization = false;

  constructor(
    private readonly capability: Capability,
    private readonly store: Pick<
      CapabilityStore,
      'credentials' | 'saveClientInformation' | 'saveTokens' | 'forgetCredentials'
    >,
    readonly redirectUrl: string,
    private readonly browser?: BrowserAuthorization,
  ) {}

  /** The scopes to ask for, or undefined to take those the server advertises. */
  get scope(): string | undefined {
    return this.capability.scopes.length > 0 ? this.capability.scopes.join(' ') : undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Emanator',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // Dynamically registered, the Harness is a public client protected by PKCE.
      token_endpoint_auth_method: 'none',
      ...(this.scope && { scope: this.scope }),
    };
  }

  state(): string {
    return this.browser?.state ?? randomUUID();
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const { clientSecret, clientInformation } = await this.store.credentials(this.capability.id);
    if (this.capability.clientId) {
      return {
        client_id: this.capability.clientId,
        ...(clientSecret && { client_secret: clientSecret }),
      };
    }
    return clientInformation as OAuthClientInformationMixed | undefined;
  }

  async saveClientInformation(information: OAuthClientInformationMixed): Promise<void> {
    // A pre-registered client is the Owner's to change, from the dashboard.
    if (this.capability.clientId) return;
    await this.store.saveClientInformation(
      this.capability.id,
      { ...information },
      this.capability.updatedAt,
    );
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.credentials(this.capability.id)).tokens as OAuthTokens | undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    // Tokens for settings the Owner has since changed must not land on the new ones.
    await this.store.saveTokens(this.capability.id, { ...tokens }, this.capability.updatedAt);
  }

  saveCodeVerifier(codeVerifier: string): void {
    if (this.browser) this.browser.codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.browser?.codeVerifier) throw new Error('No authorization is in progress.');
    return this.browser.codeVerifier;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // The address comes from the server's metadata, and the dashboard will open it.
    if (authorizationUrl.protocol !== 'https:' && authorizationUrl.protocol !== 'http:') {
      throw new Error('The server named an authorization page that is not a web address.');
    }
    if (!this.browser) {
      this.needsAuthorization = true;
      return;
    }
    // Google issues a refresh token only when asked, and again only with a fresh consent.
    if (authorizationUrl.hostname === 'accounts.google.com') {
      authorizationUrl.searchParams.set('access_type', 'offline');
      authorizationUrl.searchParams.set('prompt', 'consent');
    }
    this.browser.authorizationUrl = authorizationUrl;
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    if (scope === 'all' || scope === 'client') {
      await this.store.forgetCredentials(this.capability.id, 'client');
    } else if (scope === 'tokens') {
      await this.store.forgetCredentials(this.capability.id, 'tokens');
    }
  }
}
