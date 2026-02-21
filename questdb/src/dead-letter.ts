import { existsSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join, dirname } from "node:path";

export class DeadLetterWriter {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async write(
    table: string,
    docs: Array<{ index: string; doc: object; error?: string }>,
  ): Promise<void> {
    if (docs.length === 0) return;

    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(this.baseDir, table, `${date}.ndjson`);

    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const lines = docs
      .map((d) =>
        JSON.stringify({
          _table: d.index,
          _error: d.error,
          _timestamp: new Date().toISOString(),
          ...d.doc,
        }),
      )
      .join("\n") + "\n";

    await appendFile(filePath, lines);
    console.warn(
      `Dead letter: ${docs.length} docs written to ${filePath}`,
    );
  }
}
