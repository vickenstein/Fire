export interface MassiveConfig {
  apiKey: string;
  apiId: string;
  s3Endpoint: string;
  s3Bucket: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function loadMassiveConfig(): MassiveConfig {
  return {
    apiKey: requireEnv("MASSIVE_API_KEY"),
    apiId: requireEnv("MASSIVE_API_ID"),
    s3Endpoint: process.env.MASSIVE_S3_END_POINT ?? "https://files.massive.com",
    s3Bucket: process.env.MASSIVE_S3_BUCKET ?? "flatfiles",
  };
}
