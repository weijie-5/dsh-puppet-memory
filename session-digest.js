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
// 脱离上下文就说不通的句子：带这层指代的一律不收（2026-11-20 依 49 条被判死的候选得出）
const CONTEXTUAL = /(给你|跟你说|跟你说啊|跟你说过|这个|那个|这些|那些|这样|那样|刚才|等下|上面|下面|一下|要不要|你觉得|你说)/;
// 一次性操作（只在那一场成立）：带即时态词的不进池
const LOCAL = /(上一条|上一句|发过去|发错了|还没|明天|今天|这次|先记住|等一下|稍后|刚发|已经发)/;
// 工作文档痕迹：markdown 标记、列表符号、代码/路径格式——这类是工作内容，不该进记忆
const MD_JUNK = /(\*\*|__|^[-*•]\s|^\d+\.\s|^#{1,6}\s|\||```|`[^`]+`|^>\s|AGENTS\.md)/;

// 单句判定：收不收、算什么 kind。抽出来是为了能拿历史候选做回归测试。
export function classifySentence(s) {
  const t = String(s || "").trim();
  if (t.length < 8 || t.length > 80) return null;
  if (NOISE.test(t)) return null;
  if (MD_JUNK.test(t)) return null;
  if (CONTEXTUAL.test(t)) return null;
  if (LOCAL.test(t)) return null;
  const hit = RULES.find((r) => r.re.test(t));
  return hit ? { kind: hit.kind, text: t } : null;
}

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
      const hit = classifySentence(s);
      if (!hit) continue;
      const key = s.replace(/\s+/g, "").slice(0, 14);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
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