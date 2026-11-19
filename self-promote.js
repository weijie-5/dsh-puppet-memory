// self-promote.js — 自我层的「升格 / 冲突」检查（v0.48.0 / 2026-11-19）
//
// 自我层（behavior/self.jsonl）攒的是我自己的风格/习惯/教训。它现在有三个毛病：
//   ① 已经被写进核心卡/规则卡的条目还在，重复占位；
//   ② 同一件事写了两条，措辞还对立（先结论 vs 先依据）；
//   ③ 谁都看不出来哪条该升格进卡。
// 这个模块只做「点名」，不改任何文件——升格与标废由人和 AI 决定。

const strip = (s) => String(s || "").replace(/[，。、；：！？\s\u201c\u201d\u2018\u2019]/g, "");

// 最长窗口重合：条目是否已被卡片文字覆盖
export function coveredBy(text, cards, { minWindow = 8, maxWindow = 12 } = {}) {
  const t = strip(text);
  if (t.length < minWindow) return "";
  const hay = (Array.isArray(cards) ? cards : [cards]).map(strip).join("\u0000");
  for (let w = maxWindow; w >= minWindow; w -= 2) {
    for (let i = 0; i + w <= t.length; i++) {
      const frag = t.slice(i, i + w);
      if (hay.includes(frag)) return frag;
    }
  }
  return "";
}

// 二元组 Jaccard：判断两条是否在说同一件事
export function similarity(a, b) {
  const grams = (s) => { const t = strip(s); const out = new Set(); for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2)); return out; };
  const A = grams(a); const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return inter / (A.size + B.size - inter);
}

// 对仗反义：同一主题、结论相反（先结论/先依据、多说/少说、问/不问…）
const OPPOSITES = [["先给结论", "先给依据"], ["先说", "先问"], ["加", "删"], ["多说", "少说"], ["问", "不问"]];
export function contradictory(a, b, { minSimilarity = 0.15 } = {}) {
  // 只对仗不算对立：得先证明两条在说同一件事（主题有重合），否则「先说错在哪」和「先问一句」会被误判
  if (similarity(a, b) < minSimilarity) return false;
  const sa = strip(a); const sb = strip(b);
  for (const [x, y] of OPPOSITES) {
    if ((sa.includes(strip(x)) && sb.includes(strip(y))) || (sa.includes(strip(y)) && sb.includes(strip(x)))) return true;
  }
  return false;
}

// 总检查：返工建议清单（不改数据）
export function auditSelf(rows, cards) {
  const out = [];
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  list.forEach((r, i) => {
    const text = String(r.text || "");
    if (!text.trim()) return;
    const hit = coveredBy(text, cards);
    if (hit) out.push({ i, kind: r.kind || "?", action: "void", why: "已被卡片覆盖：" + hit, text });
  });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = String(list[i].text || ""); const b = String(list[j].text || "");
      if (!a.trim() || !b.trim()) continue;
      const sim = similarity(a, b);
      if (contradictory(a, b)) out.push({ i, j, action: "reconcile", why: "两条对立", text: a, other: b });
      else if (sim >= 0.6) out.push({ i, j, action: "merge", why: "近乎重复 sim=" + sim.toFixed(2), text: a, other: b });
    }
  }
  return out;
}// ---- 自我改进的两条腿（v0.48.0）----
// ① 收候选：从这一轮/日记里捞「像是教训」的句子，进候选池（不直接写自我层）
// ② 淘汰：importance 低且很久没更新的条目，建议标废——只有进没有出，不叫改进
const LESSON_RE = /(下次|教训|别再|不要再|不要|注意|记住|以后先|别把|别拿|别只)/;
export function harvestCandidates(texts, { minLen = 14, maxLen = 90, max = 5 } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(texts) ? texts : [texts]) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    for (const piece of text.split(/[。！？!?\n]/)) {
      const s = piece.trim();
      if (s.length < minLen || s.length > maxLen) continue;
      if (!LESSON_RE.test(s)) continue;
      const key = strip(s).slice(0, 12);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= max) return out;
    }
  }
  return out;
}

// importance ≤ minImportance 且超过 days 天没更新 → 建议淘汰
export function decayCheck(rows, { now = Date.now(), days = 180, minImportance = 1 } = {}) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.voided) continue;
    const imp = Number(r.importance == null ? 1 : r.importance);
    if (imp > minImportance) continue;
    const at = Date.parse(String(r.updated || r.created || ""));
    if (!Number.isFinite(at)) continue;
    const idle = Math.round((now - at) / 86400000);
    if (idle < days) continue;
    out.push({ id: r.id, kind: r.kind || "?", idle, text: String(r.text || "") });
  }
  return out;
}
// ---- ⑤ 待办：用户话里明确的「事还没办」→ 状态卡待办（v0.48）----
// 只认用户亲口说的、带待办词的句子；不从我的回复里猜，避免自造任务。
const TODO_RE = /(待办|记得|别忘了|明天要|下次要|回头要|待实测|还没做|要记得)/;
export function harvestTodo(userText, { minLen = 6, maxLen = 70, max = 2 } = {}) {
  const out = [];
  const text = String(userText || "").replace(/\s+/g, " ").trim();
  if (!text) return out;
  for (const piece of text.split(/[。！？!?\n]/)) {
    const s = piece.trim();
    if (s.length < minLen || s.length > maxLen) continue;
    if (!TODO_RE.test(s)) continue;
    if (out.some((x) => x === s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
