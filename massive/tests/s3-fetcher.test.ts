import { describe, it, expect } from "bun:test";
import { S3Fetcher } from "../src/s3-fetcher";

// Unit tests — no network required
describe("S3Fetcher", () => {
  describe("buildKey", () => {
    it("formats key path correctly", () => {
      // Access private method via any cast for testing
      const fetcher = new S3Fetcher({
        apiKey: "test",
        apiId: "test",
        s3Endpoint: "https://files.massive.com",
        s3Bucket: "flatfiles",
      });

      const key = (fetcher as any).buildKey("minute_aggs_v1", "2024-03-04");
      expect(key).toBe(
        "us_stocks_sip/minute_aggs_v1/2024/03/2024-03-04.csv.gz",
      );
    });

    it("handles year boundaries", () => {
      const fetcher = new S3Fetcher({
        apiKey: "test",
        apiId: "test",
        s3Endpoint: "https://files.massive.com",
        s3Bucket: "flatfiles",
      });

      const key = (fetcher as any).buildKey("minute_aggs_v1", "2023-12-29");
      expect(key).toBe(
        "us_stocks_sip/minute_aggs_v1/2023/12/2023-12-29.csv.gz",
      );
    });
  });

  describe("parseListXml", () => {
    it("parses S3 ListObjectsV2 XML", () => {
      const fetcher = new S3Fetcher({
        apiKey: "test",
        apiId: "test",
        s3Endpoint: "https://files.massive.com",
        s3Bucket: "flatfiles",
      });

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents>
    <Key>us_stocks_sip/minute_aggs_v1/2024/01/2024-01-02.csv.gz</Key>
    <LastModified>2024-01-03T00:00:00.000Z</LastModified>
    <Size>52428800</Size>
  </Contents>
  <Contents>
    <Key>us_stocks_sip/minute_aggs_v1/2024/01/2024-01-03.csv.gz</Key>
    <LastModified>2024-01-04T00:00:00.000Z</LastModified>
    <Size>48000000</Size>
  </Contents>
</ListBucketResult>`;

      const files = (fetcher as any).parseListXml(xml);
      expect(files).toHaveLength(2);
      expect(files[0].key).toBe(
        "us_stocks_sip/minute_aggs_v1/2024/01/2024-01-02.csv.gz",
      );
      expect(files[0].size).toBe(52428800);
      expect(files[0].lastModified).toBeInstanceOf(Date);
    });

    it("returns empty for no contents", () => {
      const fetcher = new S3Fetcher({
        apiKey: "test",
        apiId: "test",
        s3Endpoint: "https://files.massive.com",
        s3Bucket: "flatfiles",
      });

      const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult></ListBucketResult>`;
      const files = (fetcher as any).parseListXml(xml);
      expect(files).toHaveLength(0);
    });
  });

  describe("stream", () => {
    it("creates a ReadableStream", () => {
      const fetcher = new S3Fetcher({
        apiKey: "test",
        apiId: "test",
        s3Endpoint: "https://files.massive.com",
        s3Bucket: "flatfiles",
      });

      const stream = fetcher.stream({
        symbol: "AAPL",
        startDate: "2024-01-08",
        endDate: "2024-01-08",
      });

      expect(stream).toBeInstanceOf(ReadableStream);
    });
  });
});

// Integration tests — require live S3 access
const INTEGRATION = process.env.TEST_INTEGRATION === "true";

(INTEGRATION ? describe : describe.skip)("S3Fetcher integration", () => {
  it("fetches a real day's data", async () => {
    const fetcher = new S3Fetcher();
    const bars = await fetcher.fetchDay("2024-01-02", "AAPL");
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0].ticker).toBe("AAPL");
    expect(bars[0].open).toBeGreaterThan(0);
    expect(bars[0].volume).toBeGreaterThan(0);
  }, 30_000);

  it("streams bars for a date range", async () => {
    const fetcher = new S3Fetcher();
    const stream = fetcher.stream({
      symbol: "AAPL",
      startDate: "2024-01-02",
      endDate: "2024-01-03",
    });

    const bars: any[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bars.push(value);
    }

    expect(bars.length).toBeGreaterThan(0);
    expect(bars.every((b) => b.ticker === "AAPL")).toBe(true);
  }, 60_000);
});
