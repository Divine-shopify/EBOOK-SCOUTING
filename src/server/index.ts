import { serve } from "@hono/node-server";
import { getDb } from "../db/db.js";
import { env } from "../config.js";
import { installProxyFromEnv } from "../adapters/fetch/http.js";
import { buildApp } from "./app.js";

installProxyFromEnv();
const e = env();
const db = getDb();
// Runs left "running" by a previous process are marked paused so they can be resumed from the dashboard.
db.prepare("UPDATE research_runs SET status = 'paused' WHERE status = 'running'").run();
serve({ fetch: buildApp(db).fetch, port: e.PORT, hostname: process.env.HOST ?? "127.0.0.1" });
console.log(`AuthorScout AI dashboard on http://${process.env.HOST ?? "127.0.0.1"}:${e.PORT}`);
