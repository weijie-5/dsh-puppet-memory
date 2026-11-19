// session-pool.js — 会话候选池（v0.48.0）
// 只负责落盘/去重/过期/出生证明，不做判断：候选留给人（或整理任务）确认。

import fs from "node:fs";
import path from "node:path";

export function readPool(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// 机制分界线：规则册成型的时间（读不到就返回 null，不猜）
export function mechanismCutoff(memDir) {
  const f = path.join(memDir, "deep", "workbook", "10-规则册.md");
  try { return fs.statSync(f).birthtimeMs || fs.statSync(f).mtimeMs; } catch { return null; }
}

// bornAt：候选所出会话的时间；早于 cutoff 的标 legacy（“那时的做法，后来才有机制”）
export function appendCandidates(file, cands, { now = Date.now(), ttlDays = 60, source = "", bornAt = null, cutoff = null } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ttl = ttlDays * 86400000;
  const rows = readPool(file).filter((r) => r && r.status === "pending" && now - Date.parse(String(r.ts || "")) < ttl);
  const seen = new Set(rows.map((r) => String(r.key || "")));
  const legacy = Boolean(bornAt && cutoff && Number(bornAt) < Number(cutoff));
  let added = 0;
  for (const c of Array.isArray(cands) ? cands : []) {
    const text = String(c && c.text || "").trim();
    if (!text) continue;
    const key = text.replace(/\s+/g, "").slice(0, 16);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, kind: c.kind || "?", text, status: "pending", source, bornAt: bornAt ? new Date(Number(bornAt)).toISOString() : "", legacy, ts: new Date(now).toISOString() });
    added += 1;
  }
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  return { added, total: rows.length, legacy };
}

export function splitByLegacy(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return { current: list.filter((r) => !r.legacy), legacy: list.filter((r) => r.legacy) };
}