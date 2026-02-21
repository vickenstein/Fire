import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { loadMassiveConfig, type MassiveConfig } from "./config";
import type { MinuteBar, FetchBarsOptions, FlatFileInfo } from "./types";
import { decompressAndParse } from "./utils/csv-parser";
import { getTradingDays } from "./utils/date";
import { join } from "node:path";

const CACHE_DIR = join(import.meta.dir, "..", ".cache");
const MAX_CONCURRENT_DOWNLOADS = 10;

export class S3Fetcher {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly cachePath: string;

  constructor(config?: MassiveConfig) {
    const cfg = config ?? loadMassiveConfig();

    this.client = new S3Client({
      endpoint: cfg.s3Endpoint,
      region: "us-east-1",
      credentials: {
        accessKeyId: cfg.apiId,
        secretAccessKey: cfg.apiKey,
      },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });

    this.bucket = cfg.s3Bucket;
    this.cachePath = CACHE_DIR;
  }

  /**
   * Stream MinuteBar objects for a symbol over a date range.
   * Pull-based: each pull fetches the next trading day's data.
   * Prefetches up to MAX_CONCURRENT_DOWNLOADS days ahead.
   */
  stream(options: FetchBarsOptions): ReadableStream<MinuteBar> {
    const days = getTradingDays(options.startDate, options.endDate);
    let dayIndex = 0;

    // Prefetch queue: resolved promises of bar arrays
    const prefetchQueue: Promise<MinuteBar[]>[] = [];

    const startPrefetch = () => {
      while (
        prefetchQueue.length < MAX_CONCURRENT_DOWNLOADS &&
        dayIndex < days.length
      ) {
        const date = days[dayIndex++];
        prefetchQueue.push(
          this.fetchDay(date, options.symbol).catch((err) => {
            console.warn(`s3-fetcher: failed to fetch ${date}: ${err.message}`);
            return [];
          }),
        );
      }
    };

    return new ReadableStream<MinuteBar>({
      start: () => {
        startPrefetch();
      },
      pull: async (controller) => {
        if (prefetchQueue.length === 0) {
          controller.close();
          return;
        }

        const bars = await prefetchQueue.shift()!;
        startPrefetch(); // refill prefetch queue

        for (const bar of bars) {
          controller.enqueue(bar);
        }

        // If no more days and queue drained, close
        if (prefetchQueue.length === 0 && dayIndex >= days.length) {
          // Don't close here — next pull will see empty queue and close
        }
      },
    });
  }

  /**
   * Fetch and parse a single day's minute aggregate file.
   * Downloads from S3 if not cached locally.
   */
  async fetchDay(
    date: string,
    filterSymbol?: string,
  ): Promise<MinuteBar[]> {
    const key = this.buildKey("minute_aggs_v1", date);
    const buffer = await this.downloadWithCache(key);
    return decompressAndParse(buffer, filterSymbol);
  }

  /**
   * List available flat files under a prefix.
   * @param prefix e.g. "us_stocks_sip/minute_aggs_v1/2024/01/"
   */
  async listFiles(prefix: string): Promise<FlatFileInfo[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    });

    const response = await this.client.send(command);
    return (response.Contents ?? []).map((obj) => ({
      key: obj.Key!,
      lastModified: obj.LastModified!,
      size: obj.Size!,
    }));
  }

  /** Build S3 key for a given data type and date. */
  private buildKey(dataType: string, date: string): string {
    const [year, month] = date.split("-");
    return `us_stocks_sip/${dataType}/${year}/${month}/${date}.csv.gz`;
  }

  /** Download from S3 with local file caching. */
  private async downloadWithCache(key: string): Promise<Buffer> {
    const localPath = join(this.cachePath, key);
    const cached = Bun.file(localPath);

    if (await cached.exists()) {
      return Buffer.from(await cached.arrayBuffer());
    }

    // Download directly — no HeadObject needed
    let response;
    try {
      response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
    } catch (err: unknown) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) {
        throw new Error(`S3 file not found: ${key}`);
      }
      if (status === 403) {
        throw new Error(`S3 access denied for ${key} (may be outside plan's date range)`);
      }
      throw new Error(`S3 error for ${key}: ${err}`);
    }

    if (!response.Body) {
      throw new Error(`S3 returned empty body for ${key}`);
    }

    const data = Buffer.from(await response.Body.transformToByteArray());

    // Cache locally
    await Bun.write(localPath, data);

    return data;
  }
}
