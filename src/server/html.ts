export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function link(url: unknown, label?: string): string {
  const u = String(url ?? "");
  if (!/^https?:\/\//i.test(u)) return esc(label ?? u);
  return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(label ?? u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48))}</a>`;
}

export function table(rows: Record<string, unknown>[], cols: { key: string; label: string; render?: (r: any) => string }[]): string {
  if (!rows.length) return `<p class="muted">No records.</p>`;
  return `<div class="tw"><table><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${cols.map((c) => `<td>${c.render ? c.render(r) : esc(r[c.key])}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

export function bars(items: { k: string; n: number }[]): string {
  if (!items.length) return `<p class="muted">No data.</p>`;
  const max = Math.max(...items.map((i) => i.n));
  return `<div class="bars">${items
    .map((i) => `<div class="bar"><span class="bl">${esc(i.k)}</span><span class="bt"><span class="bf" style="width:${(i.n / max) * 100}%"></span></span><span class="bn">${i.n}</span></div>`)
    .join("")}</div>`;
}

export function layout(title: string, body: string, active = ""): string {
  const nav = [
    ["/", "Overview"],
    ["/leads", "Lead explorer"],
    ["/books", "Book analysis"],
    ["/contacts", "Contacts"],
    ["/runs", "Research runs"],
    ["/settings", "Research controls"],
    ["/exports", "Export center"],
    ["/errors", "Errors"],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · AuthorScout AI</title>
<style>
:root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#e3e2dc;--acc:#2f5d8a;--accbg:#e8eef5;--hi:#1f7a4d;--q:#2f5d8a;--fr:#a86b00;--lo:#8a8a85}
@media (prefers-color-scheme: dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#9a9993;--card:#1f1f1d;--line:#33332f;--acc:#8fb4da;--accbg:#22303d;--hi:#5cc48d;--q:#8fb4da;--fr:#e0a640;--lo:#888}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--card)}
header b{margin-right:10px}header a{color:var(--muted);text-decoration:none;padding:4px 0}header a.on{color:var(--fg);border-bottom:2px solid var(--acc)}
main{padding:16px;max-width:1400px;margin:0 auto}h1{font-size:20px;margin:4px 0 12px}h2{font-size:15px;margin:18px 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}
.kpi .n{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}.kpi .l{color:var(--muted);font-size:12px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);white-space:nowrap}
td{max-width:380px;overflow-wrap:anywhere}a{color:var(--acc)}.muted{color:var(--muted)}
.bars .bar{display:grid;grid-template-columns:minmax(90px,38%) 1fr 34px;gap:8px;align-items:center;margin:3px 0}.bt{background:var(--accbg);border-radius:3px;height:10px}.bf{display:block;height:10px;background:var(--acc);border-radius:3px}.bn{text-align:right;font-variant-numeric:tabular-nums}.bl{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{display:inline-block;padding:1px 7px;border-radius:10px;font-size:12px;border:1px solid var(--line)}.p-High{color:var(--hi)}.p-Qualified{color:var(--q)}.p-Further{color:var(--fr)}.p-Low{color:var(--lo)}
form.f{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:0 0 12px}input,select,textarea,button{font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}button{cursor:pointer;background:var(--acc);color:var(--card);border-color:var(--acc)}
label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted)}pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);padding:10px;border-radius:8px}
</style></head><body><header><b>AuthorScout AI</b>${nav.map(([h, l]) => `<a href="${h}" class="${active === h ? "on" : ""}">${l}</a>`).join("")}</header><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

export function priorityPill(p: unknown): string {
  const s = String(p ?? "");
  return s ? `<span class="pill p-${esc(s.split(" ")[0])}">${esc(s)}</span>` : "";
}
