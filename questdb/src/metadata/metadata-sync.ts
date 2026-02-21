import type { TickerMetadata } from "../types";
import { ILPWriter } from "../ilp-writer";
import { QuestDBClient } from "../client";
import { MetadataFetcher } from "./metadata-fetcher";

export class MetadataSync {
  private readonly client: QuestDBClient;
  private readonly ilpWriter: ILPWriter;
  private readonly fetcher: MetadataFetcher;

  constructor(client: QuestDBClient, ilpWriter: ILPWriter, apiKey: string) {
    this.client = client;
    this.ilpWriter = ilpWriter;
    this.fetcher = new MetadataFetcher(apiKey);
  }

  async sync(tickers: string[]): Promise<void> {
    console.log(`Syncing metadata for ${tickers.length} tickers...`);

    const metadata = await this.fetcher.fetchMany(tickers);
    const sender = await this.ilpWriter.getSender();

    console.log(`Writing ${metadata.length} metadata docs...`);

    for (const doc of metadata) {
      sender.table("ticker_metadata");
      sender.symbol("ticker", doc.ticker);
      sender.stringColumn("name", doc.name);
      sender.stringColumn("sic_code", doc.sic_code);
      sender.stringColumn("sic_description", doc.sic_desc);
      sender.stringColumn("exchange", doc.exchange);
      sender.intColumn("market_cap", doc.market_cap);
      sender.intColumn("shares_outstanding", doc.shares_out);
      sender.stringColumn("cik", doc.cik);
      sender.stringColumn("locale", doc.locale);
      sender.stringColumn("currency", doc.currency);
      sender.booleanColumn("active", doc.active);
      sender.at(BigInt(new Date(doc.updated_at).getTime()) * 1000n, "us");

      this.ilpWriter.addPending();
      await this.ilpWriter.maybeFlush();
    }

    await this.ilpWriter.flush();

    console.log(
      `Metadata sync complete: ${metadata.length}/${tickers.length} tickers indexed.`,
    );
  }

  async getAll(): Promise<TickerMetadata[]> {
    return await this.client.query<TickerMetadata>(
      "SELECT * FROM ticker_metadata",
    );
  }
}
