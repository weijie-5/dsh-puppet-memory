// knowledge.js — 知识指针（v0.48.0 / 2026-11-19）
//
// 约定（丹阳）：专业知识不必把原文抄进记忆库——存「原名 + 一句结论 + 出处」就够。
// 原名必须原样保存：术语是索引，记错名字就找不回正确的知识。
// 全文留在 dsh-library 里，按 term / aliases 去条目里找 library + documentId。

import fs from "node:fs";
import path from "node:path";

const file = (memDir) => path.join(memDir, "deep", "knowledge.jsonl");

export function readKnowledge(memDir) {
  try {
    return fs.readFileSync(file(memDir), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// term 原样保留（不再做大小写/空格规整）；aliases 用来兜住“我记得意思但叫法不确定”的情况
export function addKnowledge(memDir, { term, conclusion, library = "", doc = "", aliases = [], source = "" } = {}) {
  const t = String(term || "").trim();
  if (!t) return { ok: false, error: "缺 term（原名必须存）" };
  const rows = readKnowledge(memDir);
  const hit = rows.findIndex((r) => String(r.term || "") === t);
  const row = { term: t, conclusion: String(conclusion || "").trim(), library, doc, aliases: aliases.map((a) => String(a).trim()).filter(Boolean), source, updatedAt: new Date().toISOString() };
  if (hit >= 0) rows[hit] = row; else rows.push(row);
  fs.mkdirSync(path.dirname(file(memDir)), { recursive: true });
  fs.writeFileSync(file(memDir), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { ok: true, updated: hit >= 0, term: t, total: rows.length };
}

// 按原名/别名查；返回命中的指针（不含全文）
export function findKnowledge(memDir, query, { limit = 5 } = {}) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const rows = readKnowledge(memDir);
  const scored = [];
  for (const r of rows) {
    const keys = [r.term, ...(r.aliases || [])].map((k) => String(k || "").toLowerCase()).filter(Boolean);
    let score = 0;
    for (const k of keys) {
      if (k === q) score = Math.max(score, 3);
      else if (k.includes(q) || q.includes(k)) score = Math.max(score, 2);
    }
    if (score) scored.push({ ...r, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}