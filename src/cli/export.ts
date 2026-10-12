import { getDb } from "../db/db.js";
import { exportAll } from "../export/exporter.js";

const dirIdx = process.argv.indexOf("--dir");
const { xlsx, csvs } = await exportAll(getDb(), dirIdx > 0 ? process.argv[dirIdx + 1] : "exports");
console.log(`Wrote ${xlsx}`);
for (const c of csvs) console.log(`Wrote ${c}`);
