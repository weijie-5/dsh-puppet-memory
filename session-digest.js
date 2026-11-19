// session-digest.js — 原始会话 → 记忆候选（v0.48.0 / 2026-11-19，第一步零模型）
//
// 只做“筛”，不做“写”：把会话里的对话按主题块切开，挑出像「约定 / 决定 / 事实 / 教训」的句子，
// 交给后续（人 or 模型）确认。零 token、可复跑、可对账。

export const RULES = [
  { kind: "约定", re: /(以后|今后|下次|从今天起|记住|约定|定了|就这么|不要再|别再|必须|统一用)/ },
  { kind: "决定", re: /(决定|改成|采用|换成|定用|选了|结论是|最终)/ },
  { kind: "事实", re: /(我是|我叫|我叫作|生日|住|在.*工作|爱好|喜欢|讨厌|不吃|过敏)/ },
  { kind: "教训", re: /(错了|教训|踩坑|下次别|应该先|不该|忘了|漏了)/ },
];

const NOISE = /^(好的|嗯+|哦+|行|收到|可以|哈+|草|草了|？+|！+|…+|\.{3,})$/;
// 工作文档痕迹：markdown 标记、列表符号、代码/路径格式——这类是工作内容，不该进记忆
const MD_JUNK = /(\*\*|__|^[-*•]\s|^\d+\.\s|^#{1,6}\s|\||```|`[^`]+`|^>\s|AGENTS\.md)/;

export function pickCandidates(turns, { minLen = 8, maxLen = 80, max = 40 } = {}) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(turns) ? turns : []) {
    if (!t || t.role !== "user") continue; // 只从用户侧收，避免把我的建议当事实
    for (const piece of String(t.text || "").split(/[。！？!?\n]/)) {
      const s = piece.trim();
      if (s.length < minLen || s.length > maxLen) continue;
      if (NOISE.test(s)) continue;
      if (MD_JUNK.test(s)) continue;
      const hit = RULES.find((r) => r.re.test(s));
      if (!hit) continue;
      const key = s.replace(/\s+/g, "").slice(0, 14);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: hit.kind, text: s });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// 按时间/轮次切块，方便“一个话题一段”地看
export function blocksOf(turns, { size = 40 } = {}) {
  const list = Array.isArray(turns) ? turns : [];
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}