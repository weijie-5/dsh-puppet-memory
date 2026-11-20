// agreement-watch.js — 约定书签的落盘后巡检（v0.49.0 / 2026-11-20 丹阳定）
//
// 规则（丹阳原话）：「同一个约定只能存在一个。只有在每一原文落盘后，书签才会去检查原文里有没有相似的内容。
// 没有就记录。有就反馈。」
// 补充（同日）：「书签是自动记录的，有约定黑名单，已经在其他地方记录的就不会在这里触发了。」
//
// 所以顺序是：抽约定句 → ①黑名单（规则册/核心卡/常言/习惯）命中就跳过 → ②书签相似就反馈 → ③都没有才记。
// 零模型、零 token；只加不删。

import fs from "node:fs";
import path from "node:path";

// 2026-11-20 丹阳（A 方案）：「明天十二点吃千斤顶」抽不到——SIGNAL 原来只认规矩类，
// 整类漏掉了「事件+时间」。这里补上时间/期限/承诺，抽取放宽，噪声交给下面的荒诞线与黑名单拦。
export const SIGNAL = /(以后|今后|下次|从今天起|一律|不许|不要|必须|统一|默认|只能|禁止|约定|记住|别再|别在|别再往|明天|后天|大后天|今晚|明早|下周|下星期|这周|本周|周[一二三四五六日天]|\d{1,2}\s*点|\d{1,2}\s*号|\d{1,2}\s*月\s*\d{1,2}|之前|截止|到期|约好|说好|定在|答应|别忘)/;

// 荒诞线（2026-11-20 丹阳：「B 这类记录应该也有荒诞线阻拦」）：
// 本地只抓「结构上就不可能」的——荒谬的吃/喝对象、荒谬的分量、明显梗词。
// 语义上荒诞的（比如一个不存在的计划）本地判不了，交给压缩后的小模型整理那一步否掉，
// 否掉的结果写进 agreement-rejected.jsonl，下次同句直接跳过（丹阳：「不对的你黑名单，下次就不会触发了」）。
const ABSURD = [
  { re: /(吃|喝|吞|咬|舔)[^，。；]{0,8}(千斤顶|混凝土|水泥|钢筋|螺丝钉|螺丝|汽油|柴油|尿素|扳手|铁钉|玻璃渣|马路|轮胎)/, why: "吃/喝的对象不是食物" },
  { re: /(千斤|万斤|百斤|吨)(顶)?[^，。；]{0,6}(吃|喝|吞)/, why: "分量荒谬（千斤/吨）" },
  { re: /(吃|喝|吞)[^，。；]{0,6}(千斤|万斤|百斤|一吨)/, why: "分量荒谬（千斤/吨）" },
  { re: /(42号混凝土|高能蛋白|俗称UFO|意大利面拌|意大利面.{0,4}拌|挖掘机.{0,6}扭距|螺丝钉.{0,6}扭距)/, why: "已知的胡说梗" },
];

// 危险线（2026-11-20 丹阳：「危险的问题会在开玩笑的时候出现」）：
// **独立于荒诞**——胡说梗记错了只是没意义；危险物记错了是会真出事的。
// 所以这里不看语气、不判「像不像玩笑」，命中就拦，连候选都不进。
const DANGER = [
  { re: /(吃|喝|吞|咬|舔|注射|吸)[^，。；]{0,8}(老鼠药|农药|敌敌畏|百草枯|砒霜|氰化物|毒药|水银|消毒水|洁厕灵|漂白剂|洗洁精|洗衣液|电池|碎玻璃|刀片|钉子)/, why: "毒物或危险物当食物" },
  { re: /(老鼠药|农药|敌敌畏|百草枯|砒霜|氰化物)[^，。；]{0,6}(吃|喝|吞|拌)/, why: "毒物当食物" },
  { re: /(吃|喝|吞)[^，。；]{0,4}(一整瓶|一瓶|一大把|十几片|几十片|一袋|一包)/, why: "剂量荒谬" },
  { re: /(自杀|去死|跳楼|上吊|割腕|烧炭|跳河|卧轨)/, why: "自伤" },
];

/** 危险线：命中返回原因，否则 null。优先级最高，不看语气。 */
export function dangerHint(sentence) {
  const s = String(sentence || "");
  for (const rule of DANGER) if (rule.re.test(s)) return rule.why;
  return null;
}

/** 荒诞线：命中返回一句原因，否则 null。只抓结构上不可能的，不判语义。 */
export function absurdHint(sentence) {
  const s = String(sentence || "");
  for (const rule of ABSURD) if (rule.re.test(s)) return rule.why;
  return null;
}

/**
 * 把一句话里的「什么时候」解析成日期（2026-11-20 丹阳：「带时间约定的可以转交给开幕表提醒」）。
 * 只认常见写法；**解析不出来返回 null**——null 就不转幕表，当普通 state 处理，不硬猜。
 * @returns {{date:string, at:string, hour:number, minute:number}|null}
 */
export function parseWhen(text, now = Date.now()) {
  const s = String(text || "");
  const pad = (n) => String(n).padStart(2, "0");
  const base = new Date(now);
  let y = null, mo = null, d = null;

  const rel = /(大后天|后天|明天|今天)/.exec(s);
  if (rel) {
    const off = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }[rel[1]];
    const t = new Date(base.getFullYear(), base.getMonth(), base.getDate() + off);
    y = t.getFullYear(); mo = t.getMonth() + 1; d = t.getDate();
  }
  if (y === null) {
    const md = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(s);
    if (md) { y = base.getFullYear(); mo = Number(md[1]); d = Number(md[2]); }
  }
  if (y === null) {
    const dn = /(\d{1,2})\s*[日号]/.exec(s);
    if (dn) { y = base.getFullYear(); mo = base.getMonth() + 1; d = Number(dn[1]); }
  }
  if (y === null) {
    const wk = /(下)?周([一二三四五六日天])/.exec(s);
    if (wk) {
      const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
      const target = map[wk[2]];
      const cur = base.getDay();
      // 本周一为基准；下周X = 本周X + 7
      const mondayOffset = cur === 0 ? -6 : 1 - cur;
      const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() + mondayOffset);
      const add = (target === 0 ? 6 : target - 1) + (wk[1] ? 7 : 0);
      const t = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + add);
      y = t.getFullYear(); mo = t.getMonth() + 1; d = t.getDate();
    }
  }
  if (y === null) return null;

  // 「十二点」是中文数字，d 抓不到——两种写法都要认
  const D = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const cnHour = (t) => {
    if (!t) return null;
    if (t === "十") return 10;
    if (t.length === 1) return Object.prototype.hasOwnProperty.call(D, t) ? D[t] : null;
    if (t[0] === "十") return 10 + (D[t[1]] ?? 0);
    if (t[1] === "十" && t.length === 2) return (D[t[0]] ?? 0) * 10;
    if (t[1] === "十" && t.length === 3) return (D[t[0]] ?? 0) * 10 + (D[t[2]] ?? 0);
    return null;
  };
  const hm = /(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*[点时](?:\s*(\d{1,2}|[零一二三四五六七八九十]{1,3})\s*分)?/.exec(s);
  let hour = 0, minute = 0;
  if (hm) {
    const h = cnHour(hm[1]);
    hour = h !== null ? h : Number(hm[1]) || 0;
    const mi = hm[2] ? cnHour(hm[2]) : null;
    minute = mi !== null ? mi : Number(hm[2]) || 0;
    if (/下午|晚上|傍晚/.test(s) && hour < 12) hour += 12;
  }
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  return { date, at: hm ? `${date} ${pad(hour)}:${pad(minute)}` : date, hour, minute };
}

/** 读「被否掉的候选」黑名单（判错/荒诞的一句一条，永久跳过）。 */
export function collectRejected(memDir) {
  return readJsonl(path.join(memDir, "deep", "agreement-rejected.jsonl"))
    .map((r) => String(r.text || "").trim())
    .filter((t) => t.length >= 4);
}

const STOP = /(以后|今后|下次|从今天起|一律|不许|不要|必须|统一|默认|只能|禁止|别再|别在|记住|约定|我们|你们|他们|这个|那个|然后|就是|可以|还是|一个|什么)/g;

function bigrams(s) {
  const t = String(s || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
  const out = new Set();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** 从约定句里挑 2~3 个关键词（去掉信号词与虚词后的实段）。挑不到就用前 6 字兜底。 */
export function keywordsOf(s) {
  const parts = String(s || "")
    .replace(STOP, " ")
    .split(/[\s，,、。；;：:（）()\[\]【】“”‘’!？?]+/)
    .filter((x) => x.length >= 2 && x.length <= 8);
  const uniq = [];
  for (const p of parts) if (!uniq.includes(p)) uniq.push(p);
  if (uniq.length) return uniq.slice(0, 3).join(",");
  return String(s || "").replace(/\s+/g, "").slice(0, 6);
}

export function extractAgreements(text, { minLen = 6, maxLen = 90 } = {}) {
  const out = [];
  const seen = new Set();
  for (const piece of String(text || "").split(/[。！？!?\n]/)) {
    const s = piece.trim();
    if (s.length < minLen || s.length > maxLen) continue;
    if (!SIGNAL.test(s)) continue;
    const key = s.replace(/\s+/g, "").slice(0, 16);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function readText(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}
function readJsonl(p) {
  return readText(p).split(/\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null } }).filter(Boolean);
}

/**
 * 约定黑名单：已经在别处记过的，不再进书签。
 * 覆盖 规则册（R 编号） / 三张核心卡 / 常言 / 习惯层。
 * @returns {Array<{text:string, source:string}>}
 */
export function collectKnown(memDir) {
  const out = [];
  const add = (text, source) => {
    const t = String(text || "").trim();
    if (t.length >= 6) out.push({ text: t, source });
  };
  const book = readText(path.join(memDir, "deep", "workbook", "10-规则册.md"));
  for (const line of book.split(/\n/)) {
    if (!/^\|\s*(R|N|M|P|X)-\d+/.test(line.trim())) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length >= 2) add(cells[1].replace(/\*\*/g, ""), "规则册");
  }
  for (const f of ["core.md", "core-rules.md", "core-state.md"]) {
    for (const line of readText(path.join(memDir, "behavior", f)).split(/\n+/)) {
      add(line.replace(/^[-*\s]+/, "").replace(/\*\*/g, ""), "核心卡");
    }
  }
  for (const r of readJsonl(path.join(memDir, "deep", "sayings.jsonl"))) {
    add(String(r.keyword || "") + " " + String(r.meaning || ""), "常言");
  }
  for (const r of readJsonl(path.join(memDir, "behavior", "habits.jsonl"))) {
    add(String(r.text || r.rule || ""), "习惯层");
  }
  return out;
}

/**
 * 巡检一段刚落盘的原文。
 * 2026-11-20 晚改：**不自动写书签**——记录发生在「自检原文 / 小模型整理」那一步。
 * 这里只产出 candidates（新事件句），由整理时用 promote() 落成书签（主=事件，次=约定+状态）。
 *
 * @returns {{checked:number, candidates:Array, dup:Array, skipped:Array}}
 *   skipped：别处已记录（黑名单命中）——不记也不重复提醒
 *   dup：已有相似书签——反馈，不重复记
 *   added：新记进书签的约定
 */
const flat = (s) => String(s || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");

/**
 * 黑名单命中：候选句的 4 字片段出现在已记录文本里就算。
 * 为什么不用 Jaccard——规则册里的规则是长句，新说法更短，词序一改分数就掉到 0.2（实测），会漏。
 * 4 字片段够具体（「发版纪律」），且方向是「宁可不记」，误伤只是少记一条，不会重复。
 */
export function hitsKnown(sentence, knownText) {
  const s = flat(sentence);
  const k = flat(knownText);
  if (s.length < 4 || k.length < 4) return false;
  for (let i = 0; i + 4 <= s.length; i += 1) {
    if (k.includes(s.slice(i, i + 4))) return true;
  }
  return false;
}

export function scanTurn(lore, text, { min = 0.5, knownMin = 0.35, source = "", known = [], rejected = [] } = {}) {
  const sentences = extractAgreements(text);
  const candidates = [];
  const dup = [];
  const skipped = [];
  const absurd = [];
  const danger = [];
  const rejectedHit = [];
  for (const s of sentences) {
    // ③前一步：上次判过是错的（荒诞/判错），这次直接不再进候选
    if ((Array.isArray(rejected) ? rejected : []).some((t) => hitsKnown(s, t) || similarity(s, t) >= knownMin)) {
      rejectedHit.push({ text: s });
      continue;
    }
    // ①危险线（最高优先）：不看语气、不管是不是玩笑，命中就不落候选
    const dangerWhy = dangerHint(s);
    if (dangerWhy) {
      danger.push({ text: s, why: dangerWhy });
      continue;
    }
    // ②荒诞线：结构上不可能的，不落候选
    const why = absurdHint(s);
    if (why) {
      absurd.push({ text: s, why });
      continue;
    }
    let bestKnown = null;
    for (const k of Array.isArray(known) ? known : []) {
      const score = similarity(s, k.text);
      const hit = hitsKnown(s, k.text) || score >= knownMin;
      if (hit && (!bestKnown || score > bestKnown.score)) bestKnown = { source: k.source, text: k.text, score };
    }
    if (bestKnown) {
      skipped.push({ text: s, hit: bestKnown.source, score: Number(bestKnown.score.toFixed(2)) });
      continue;
    }
    const near = typeof lore.findSimilar === "function" ? lore.findSimilar(s, { min }) : null;
    if (near) {
      dup.push({ text: s, name: near.row.name, id: near.row.id, score: Number(near.score.toFixed(2)) });
      continue;
    }
    candidates.push({ text: s, keywords: keywordsOf(s) });
  }
  return { checked: sentences.length, candidates, dup, skipped, absurd, danger, rejected: rejectedHit, source };
}

// 工作信号（词法兜底）：命中就不算「非工作原文」。
const WORK = /(代码|插件|发布|报错|bug|异常|文件|路径|提交|npm|git|测试|接口|工具|配置|日志|端口|函数|脚本|编译|仓库|版本号|issue|pr\b)/i;

// 2026-11-20 丹阳：「工具或者技能调动就是工作吧，工具和技能做黑白名单。看视频得出来的内容不一定是工作。」
// 规则：这一轮调过工具/技能 = 工作；**只有愉悦名单里的工具**（看视频/看图/听音频/表情包）不算工作。
export const PLEASURE_TOOLS = [
  /^video_/,
  /^bili_/,
  /^audio_/,
  /^read_image$/,
  /^generate_image/,
  /^generate_images$/,
  /^edit_image$/,
  /^view_canvas$/,
  /^canvas_state$/,
  /meme/,
  /^send_meme$/,
  /^search_meme_wiki$/,
  /^mcp__bili/,
];

/** 这一轮算什么：leisure（无工具，或只有愉悦工具）/ work（调了任何其它工具，含技能）。 */
export function classifyTurn(tools = []) {
  const names = (Array.isArray(tools) ? tools : []).map((t) => String(t || ""));
  if (!names.length) return "leisure";
  const work = names.filter((n) => !PLEASURE_TOOLS.some((re) => re.test(n)));
  return work.length ? "work" : "leisure";
}

// 自己写的回顾/总结不算原文（2026-11-20：「还要排除上次看记录的总结」）
const RECAP = /(上次|上一次|刚才|之前我们|总结|回顾|记录如下|以下是|上面说|前文提到)/;

/**
 * 抽「非工作」的原文句子（2026-11-20 丹阳：压缩后检查非工作状态的原文就行）。
 * 不要求信号词——生活里随口说的话往往才是约定/状态；只把明显在干活的句子排掉。
 */
export function collectNonWork(text, { minLen = 8, maxLen = 80, keepWorkTerms = false } = {}) {
  const out = [];
  const seen = new Set();
  for (const piece of String(text || "").split(/[。！？!?\n]/)) {
    const s = piece.trim();
    if (s.length < minLen || s.length > maxLen) continue;
    if (RECAP.test(s)) continue;
    if (!keepWorkTerms && WORK.test(s)) continue;
    const key = s.replace(/\s+/g, "").slice(0, 20);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * 把一条候选落成书签（整理时调用）：
 * 主 = 事件名（同一事件传同名就只更新状态，不新开），次 = 约定内容 + 状态。
 */
export function promote(lore, { name, content, keywords, state, stateAt, priority = 40 } = {}) {
  const n = String(name || "").trim();
  if (!n) return { ok: false, error: "event（主事件名）必填" };
  // 书签必须有触发词（否则 lorebook.add 会拒），没给就从句子里挑。
  const kw = String(keywords || "").trim() || keywordsOf(content || n);
  const exists = lore.list({ includeDisabled: true }).find((r) => r.name === n);
  if (exists) {
    return lore.update({ id: exists.id, content, keywords: kw, state, stateAt });
  }
  return lore.add({ name: n, content, keywords: kw, state, stateAt, priority });
}

/** 非工作原文归档成 markdown（压缩后写，平时不动）。 */
export function renderInbox(rows) {
  if (!rows || !rows.length) return "";
  const byDay = new Map();
  for (const r of rows) {
    const day = String(r.at || "").slice(0, 10) || "未知";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r.text);
  }
  const lines = ["# 非工作原文 · 活日记（压缩后归档；整理出的约定进书签，原文留在这里）", ""];
  for (const [day, items] of byDay) {
    lines.push("## " + day);
    for (const t of items) lines.push("- " + t);
    lines.push("");
  }
  return lines.join("\n");
}

/** 给当轮反馈用的一句话（没有发现就返回空串）。 */
export function summarize(result) {
  if (!result) return "";
  const parts = [];
  if (result.candidates && result.candidates.length) parts.push("待整理 " + result.candidates.length + " 条（" + result.candidates.map((x) => x.text.slice(0, 14)).join("；") + "）");
  if (result.dup && result.dup.length) parts.push("已有相似书签 " + result.dup.length + " 条，未重复记（" + result.dup.map((x) => x.name + " " + x.score).join("；") + "）");
  if (result.skipped && result.skipped.length) parts.push("别处已记 " + result.skipped.length + " 条（" + Array.from(new Set(result.skipped.map((x) => x.hit))).join("/") + "），跳过");
  if (result.danger && result.danger.length) parts.push("危险线拦下 " + result.danger.length + " 条（" + result.danger.map((x) => x.text.slice(0, 14) + "·" + x.why).join("；") + "），已进黑名单");
  if (result.absurd && result.absurd.length) parts.push("荒诞线拦下 " + result.absurd.length + " 条（" + result.absurd.map((x) => x.text.slice(0, 14) + "·" + x.why).join("；") + "）");
  if (result.rejected && result.rejected.length) parts.push("黑名单跳过 " + result.rejected.length + " 条");
  return parts.join("；");
}
