import { file } from "bun";

// Load .env from project root
const envPath = new URL("../.env", import.meta.url).pathname;
const envText = await file(envPath).text();
for (const line of envText.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { loadMassiveConfig } from "./src/config";

const cfg = loadMassiveConfig();

console.log("endpoint:", cfg.s3Endpoint);
console.log("bucket:", cfg.s3Bucket);
console.log("accessKeyId:", cfg.apiId.slice(0, 8) + "...");

const client = new S3Client({
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

// Use a recent date (within 5-year lookback)
const recentKey = "us_stocks_sip/minute_aggs_v1/2025/02/2025-02-18.csv.gz";

// Test 1: List recent files
console.log("\n--- list files (recent) ---");
try {
  const res = await client.send(new ListObjectsV2Command({
    Bucket: cfg.s3Bucket,
    Prefix: "us_stocks_sip/minute_aggs_v1/2025/02/",
    MaxKeys: 5,
  }));
  console.log("count:", res.KeyCount);
  for (const obj of res.Contents ?? []) {
    console.log(" ", obj.Key, `(${(obj.Size! / 1024 / 1024).toFixed(1)} MB)`);
  }
} catch (err) {
  console.error("list error:", err);
}

// Test 2: Direct GetObject (recent date)
console.log("\n--- GetObjectCommand (recent) ---");
try {
  const res = await client.send(new GetObjectCommand({
    Bucket: cfg.s3Bucket,
    Key: recentKey,
  }));
  const bytes = await res.Body!.transformToByteArray();
  console.log(`OK: ${recentKey} — ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);
} catch (err: unknown) {
  const status = (err as any).$metadata?.httpStatusCode;
  console.error(`FAILED (${status}):`, (err as Error).message);
}

// Test 3: Bun S3Client (recent date) — test if native client also works now
console.log("\n--- Bun S3Client (recent) ---");
try {
  const { S3Client: BunS3 } = await import("bun");
  const bunClient = new BunS3({
    endpoint: cfg.s3Endpoint,
    bucket: cfg.s3Bucket,
    accessKeyId: cfg.apiId,
    secretAccessKey: cfg.apiKey,
    region: "us-east-1",
  });
  const exists = await bunClient.file(recentKey).exists();
  console.log("exists:", exists);
  if (exists) {
    const data = await bunClient.file(recentKey).arrayBuffer();
    console.log(`OK: ${(data.byteLength / 1024 / 1024).toFixed(1)} MB`);
  }
} catch (err) {
  console.error("FAILED:", (err as Error).message);
}
