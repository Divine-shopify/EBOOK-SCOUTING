import { openDb, SCHEMA_VERSION } from "../db/db.js";

const db = openDb();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all() as { name: string }[];
console.log(`Schema v${SCHEMA_VERSION} applied to ${process.env.DATABASE_PATH ?? "data/authorscout.db"}: ${tables.map((t) => t.name).join(", ")}`);
