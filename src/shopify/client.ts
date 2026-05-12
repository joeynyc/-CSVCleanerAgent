// Minimal Shopify Admin GraphQL client. Honors the cost-based throttle from
// the response extensions, so we never hit 429s under normal load.

export interface ShopifyConfig {
  store: string;          // "acme-store" (subdomain) or full myshopify.com host
  accessToken: string;
  apiVersion?: string;    // default 2025-01
}

export interface GraphQLError {
  message: string;
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
}

export class ShopifyError extends Error {
  constructor(message: string, public errors?: GraphQLError[]) {
    super(message);
    this.name = "ShopifyError";
  }
}

interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export class ShopifyClient {
  private endpoint: string;
  private headers: Record<string, string>;
  private throttle: ThrottleStatus | null = null;

  constructor(cfg: ShopifyConfig) {
    if (!cfg.store) throw new Error("ShopifyClient: store is required");
    if (!cfg.accessToken) throw new Error("ShopifyClient: accessToken is required");
    const host = cfg.store.includes(".myshopify.com") ? cfg.store : `${cfg.store}.myshopify.com`;
    const version = cfg.apiVersion ?? "2025-01";
    this.endpoint = `https://${host}/admin/api/${version}/graphql.json`;
    this.headers = {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": cfg.accessToken,
    };
  }

  static fromEnv(): ShopifyClient {
    const store = process.env["SHOPIFY_STORE"];
    const accessToken = process.env["SHOPIFY_ACCESS_TOKEN"];
    const apiVersion = process.env["SHOPIFY_API_VERSION"];
    if (!store || !accessToken) {
      throw new Error("SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN must be set to use --confirm.");
    }
    return new ShopifyClient({ store, accessToken, apiVersion });
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    await this.waitForBudget();
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ShopifyError(`HTTP ${res.status}: ${text || res.statusText}`);
    }
    const body = (await res.json()) as {
      data?: T;
      errors?: GraphQLError[];
      extensions?: { cost?: { throttleStatus?: ThrottleStatus } };
    };
    if (body.extensions?.cost?.throttleStatus) {
      this.throttle = body.extensions.cost.throttleStatus;
    }
    if (body.errors && body.errors.length > 0) {
      throw new ShopifyError(body.errors.map((e) => e.message).join("; "), body.errors);
    }
    if (!body.data) throw new ShopifyError("Empty response from Shopify");
    return body.data;
  }

  private async waitForBudget(): Promise<void> {
    if (!this.throttle) return;
    const { currentlyAvailable, restoreRate } = this.throttle;
    if (currentlyAvailable >= 100) return;
    const need = 100 - currentlyAvailable;
    const waitMs = Math.ceil((need / restoreRate) * 1000);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}
