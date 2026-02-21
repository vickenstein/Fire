import { SQL } from "bun";

const sql = new SQL({
  hostname: process.env.QUESTDB_PG_HOST ?? "localhost",
  port: Number(process.env.QUESTDB_PG_PORT) || 8812,
  username: process.env.QUESTDB_PG_USER ?? "admin",
  password: process.env.QUESTDB_PG_PASSWORD ?? "quest",
  database: "qdb",
});

export { sql };
