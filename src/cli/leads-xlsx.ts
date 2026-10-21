/** Writes the canonical leads to an Excel workbook: all leads, recent releases, and a summary. */
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { parseCsv } from "../leads/canonical.js";

const out = process.argv[2] ?? "leads/author_leads.xlsx";
const [header, ...rows] = parseCsv(readFileSync("leads/canonical_leads.csv", "utf8").replace(/^﻿/, ""));
const notes = header.indexOf("Other Notes");
const recent = rows.filter((r) => /Recent release:/.test(r[notes] ?? ""));
const wb = new ExcelJS.Workbook();
const sheet = (name: string, data: string[][]) => {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  ws.addRow(header);
  for (const r of data) ws.addRow(r.map((v) => (v.length > 32000 ? v.slice(0, 32000) : v)));
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
  header.forEach((h, i) => (ws.getColumn(i + 1).width = /Body|Synops|Explanation|Notes|Observations/.test(h) ? 60 : 24));
};
sheet("All leads", rows);
sheet("Recent releases 2025-26", recent);
const s = wb.addWorksheet("Summary");
s.addRows([["Total verified leads", rows.length], ["Recent-release (2025+) leads", recent.length], ["Sender", "Roland Jacobs"], ["Generated", new Date().toISOString().slice(0, 10)]]);
await wb.xlsx.writeFile(out);
console.log(`Wrote ${out}: ${rows.length} leads, ${recent.length} recent`);
