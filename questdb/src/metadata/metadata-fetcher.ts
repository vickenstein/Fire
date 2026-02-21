import type { TickerMetadata } from "../types";

const MASSIVE_API_BASE = "https://api.polygon.io";

export class MetadataFetcher {
  private readonly apiKey: string;
  private readonly delayMs: number;

  constructor(apiKey: string, delayMs = 250) {
    this.apiKey = apiKey;
    this.delayMs = delayMs;
  }

  async fetchOne(ticker: string): Promise<TickerMetadata> {
    const url = `${MASSIVE_API_BASE}/v3/reference/tickers/${ticker}?apiKey=${this.apiKey}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(
        `Failed to fetch metadata for ${ticker}: ${res.status} ${await res.text()}`,
      );
    }

    const data = (await res.json()) as {
      results: {
        ticker: string;
        name: string;
        sic_code?: string;
        sic_description?: string;
        primary_exchange?: string;
        market_cap?: number;
        share_class_shares_outstanding?: number;
        cik?: string;
        locale?: string;
        currency_name?: string;
        active?: boolean;
      };
    };

    const r = data.results;
    return {
      ticker: r.ticker,
      name: r.name,
      sic_code: r.sic_code ?? "",
      sic_desc: r.sic_description ?? "",
      exchange: r.primary_exchange ?? "",
      market_cap: r.market_cap ?? 0,
      shares_out: r.share_class_shares_outstanding ?? 0,
      cik: r.cik ?? "",
      locale: r.locale ?? "us",
      currency: r.currency_name ?? "usd",
      active: r.active ?? true,
      updated_at: new Date().toISOString(),
    };
  }

  async fetchMany(tickers: string[]): Promise<TickerMetadata[]> {
    const results: TickerMetadata[] = [];

    for (const ticker of tickers) {
      try {
        const metadata = await this.fetchOne(ticker);
        results.push(metadata);
        console.log(`  ${ticker}: ${metadata.name}`);
      } catch (e) {
        console.warn(
          `  ${ticker}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
    }

    return results;
  }
}
