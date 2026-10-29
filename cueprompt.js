/**
 * cueprompt.js — v0.39（B-94）：取词器 + 提词器
 *
 * 分工（丹阳 2026-10-29 定）：
 *   · 取词器只负责「取」——先重要库，再常规库；常规 0 结果可回扫重要库；带记错表跳过。
 *   · 提词器只负责「判断取来的算不算回忆」，以及**怎么说**（给一句自然语言的提示，不贴资料）。
 *
 * 计分（重要不是一次认定的，是被对方反复确认出来的）：
 *   对方说话 + 我回答 = 1 次。显式否认 = 失败；显式确认 = 成功；沉默**不加分**。
 *   同一 topic 成功 2 次 → 升「重要」；失败 2 次 → 降级进记错表。
 *
 * 存储（都在 <记忆目录>/deep/ 下，纯 JSONL，零依赖）：
 *   important.jsonl      重要记忆：topic / refs / count / fails / times
 *   recall-events.jsonl 每次回忆一条事件（成败都记，便于日后查）
 *   misrecall.jsonl      记错表：条目 × 话题，带 30 天过期，取词时跳过
 */
import fs from "node:fs";
import path from "node:path";

const DAY = 86400000;
const MISRECALL_TTL = 30 * DAY;

const readJsonl = (file) => {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* 坏行跳过，不让一行坏数据废掉整张表 */
    }
  }
  return out;
};

const appendJsonl = (file, row) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
  } catch {
    /* 写不进不致命：少记一次 */
  }
};

const rewriteJsonl = (file, rows) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
  } catch {
    /* 同上 */
  }
};

/** 二字词（标签粒度：任何两个字都算，数字/英文不算——丹阳 2026-10-29 定） */
export function bigramsOf(text) {
  const out = new Set();
  for (const run of String(text || "").match(/[\u4e00-\u9fff]{2,}/g) || []) {
    for (let i = 0; i + 2 <= run.length; i += 1) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

// 三种反应分开（丹阳 2026-10-29：「可以否认或者反对，人也有记错的时候」）：
//   denied   = 否认这回事（记忆本身不对）→ 记失败 + 进记错表
//   objected = 反对说法（事有，但我讲偏了 / 看不出主语）→ 只记反对，不算失败、不进记错表
//   confirmed= 确认 → 成功 +1（同时撤掉这条身上的记错，见 applyVerdict）
//   silent   = 没表态 → 什么都不加
//
// 2026-10-29 实机踩到的两个坑（都在 diag.log 里有回执）：
//   ① 他发的话前面挂着 <system-reminder>，取词/判读把它当成了他说的话 → 用 stripInjected 剥掉；
//   ② 「那是我记错了」被他自己的话命中 记错 → 判成 denied，给一条正确的记忆记了 30 天错。
//      → 判读要认主语：我记错=他自己纠正（silent）；你记错/没这回事=否认；光一个「记错」看不出主语=objected（回原文，不罚款）。
const DENY = /没这回事|没有这事|根本没|没发生过|胡说|瞎编|编的|不存在这|没有的事|你记错|你搞错|你弄错|你瞎说|无中生有|你说错了|你错记/;
const OBJECT = /不是这个|不是那|不对|不是这样|说错|说反|搞错说法|不是指|讲偏|记错|错记/;
const POSITIVE = /^(对|是的|没错|就是|确实|嗯对|对的|正是|是这么回事)|^对的|^没错/;
// 他自己认错：主语是「我」的一类，不算否定我的回忆（他说「那是我记错了」就是这个）
const SELF_CORRECT = /(我|俺|自己)(也|好像|可能|大概|估计|确实|真的)?(记错|搞错|记混|记差|弄错|想岔)|是我记错|我的错|我错了/;

/** 把注入的噪音剥掉：system-reminder 和插件自己的 <puppet_*> 块都不是他说的话 */
export function stripInjected(text) {
  let t = String(text || "");
  if (!t) return "";
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ");
  t = t.replace(/<puppet_[a-z][a-z_]*>[\s\S]*?<\/puppet_[a-z][a-z_]*>/gi, " ");
  // 压缩截断时可能只剩半个块，尾巴一并去掉
  t = t.replace(/<system-reminder>[\s\S]*$/i, " ");
  t = t.replace(/<puppet_[a-z][a-z_]*>[\s\S]*$/i, " ");
  return t.replace(/[ \t]{2,}/g, " ").trim();
}

/** 从对方那句话判断「上一次回忆」的反应类型；沉默/其它 = silent（不加分） */
export function verdictOf(text) {
  const t = stripInjected(text);
  if (!t) return "silent";
  const said = t.slice(-400); // 只认他最后说的那句，注入块和长贴不算
  if (DENY.test(said)) return "denied";
  if (SELF_CORRECT.test(said)) return "silent"; // 「是我记错了」= 他自己纠正，不是否认我的回忆
  if (POSITIVE.test(said)) return "confirmed";
  if (OBJECT.test(said)) return "objected";
  return "silent";
}

export function createCuePrompter({ memDir, now = () => Date.now() } = {}) {
  const dir = path.join(memDir, "deep");
  const paths = {
    important: path.join(dir, "important.jsonl"),
    // v0.39（B-93 后续）：事件按月分片，外加一份月索引；旧的单文件仍兼容读取
    eventsDir: path.join(dir, "recall-events"),
    eventsIndex: path.join(dir, "recall-events", "index.jsonl"),
    legacyEvents: path.join(dir, "recall-events.jsonl"),
    misrecall: path.join(dir, "misrecall.jsonl"),
  };

  // v0.39：待判的回忆必须落盘——它原来只在内存 Map 里，宿主一重启就丢，闭环直接断。
  const pendingPath = path.join(memDir, "state", "cue-pending.json");
  const PENDING_TTL = 24 * 60 * 60 * 1000;
  const readPendingMap = () => {
    try {
      const doc = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
      return doc && typeof doc === "object" ? doc : {};
    } catch {
      return {};
    }
  };
  const writePendingMap = (map) => {
    try {
      fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
      fs.writeFileSync(pendingPath, JSON.stringify(map, null, 2), "utf8");
    } catch {
      /* 写不进就当没有待判 */
    }
  };
  function savePending(sessionId, value) {
    const ts = now();
    const map = readPendingMap();
    // 顺手清掉过期的
    for (const [k, v] of Object.entries(map)) {
      const at = Number(v?.at) || 0;
      if (!at || ts - at > PENDING_TTL) delete map[k];
    }
    map[String(sessionId)] = { ...value, at: ts };
    writePendingMap(map);
    return map[String(sessionId)];
  }
  function loadPending(sessionId) {
    const row = readPendingMap()[String(sessionId)];
    if (!row) return null;
    const at = Number(row.at) || 0;
    if (!at || now() - at > PENDING_TTL) return null;
    return row;
  }
  function clearPending(sessionId) {
    const map = readPendingMap();
    if (!(String(sessionId) in map)) return;
    delete map[String(sessionId)];
    writePendingMap(map);
  }

  const monthKeyOf = (ts) => {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };

  const importantAll = () => readJsonl(paths.important);
  // 本地诊断（和 index.js 的 diag 同一个文件，前缀区分来源）
  const note = (message) => {
    try {
      fs.mkdirSync(memDir, { recursive: true });
      fs.appendFileSync(path.join(memDir, "diag.log"), `${new Date(now()).toISOString()} [cueprompt] ${message}\n`, "utf8");
    } catch {
      /* 诊断不能把插件搞挂 */
    }
  };

  /** 记错表：只跳「条目 × 话题」，且带过期（默认 30 天） */
  function misrecallSet(ts = now()) {
    const set = new Set();
    for (const row of readJsonl(paths.misrecall)) {
      const exp = Date.parse(String(row.expiresAt || "")) || 0;
      if (exp && exp < ts) continue; // 过期了，允许再试
      set.add(`${row.hash}\u0000${row.topic || ""}`);
      if (!row.topic) set.add(String(row.hash));
    }
    return set;
  }

  function isBlocked(hash, topic, blocked) {
    if (!hash) return false;
    if (blocked.has(`${hash}\u0000${topic || ""}`)) return true;
    return blocked.has(String(hash));
  }

  /**
   * 取词器：先重要库，再常规库。
   * @param {{userText:string, searchFn?:Function, limit?:number}} opts
   * @returns {{candidates:Array<{hash:string,text:string,where:string,kind:string,importantId?:string}>, blocked:number, fromImportant:number, fromNormal:number}}
   */
  function pickCandidates({ userText, searchFn = null, limit = 7 } = {}) {
    const grams = new Set(bigramsOf(userText));
    const blocked = misrecallSet();
    const out = [];
    let blockedCount = 0;
    let fromImportant = 0;

    // ① 重要库优先：主题词/引用条目的关键词有重合就拿出来
    for (const imp of importantAll()) {
      if (String(imp.state || "active") !== "active") continue;
      const words = bigramsOf(`${imp.topic || ""} ${(imp.refs || []).join(" ")}`);
      const shared = words.some((g) => grams.has(g));
      if (!shared) continue;
      if ((imp.refs || []).some((h) => isBlocked(h, imp.topic, blocked))) {
        blockedCount += 1;
        continue;
      }
      out.push({
        hash: (imp.refs || [])[0] || imp.id,
        text: `[important] ${imp.topic || ""}｜${(imp.evidence || "").slice(0, 120)}`,
        where: "deep/important.jsonl",
        kind: "important",
        importantId: imp.id,
      });
      fromImportant += 1;
      if (out.length >= limit) break;
    }

    // ② 事件总结：我自己综合判断过、写进事件的回忆（丹阳 2026-10-29：
    //    「你自己的综合判断再回忆后就是以后的回忆部分」）——放在常规检索之前，
    //    因为它是有结论的，不是散条目；没总结的旧事件不参与。
    if (out.length < limit) {
      let groups = [];
      try {
        groups = groupEvents(readEvents(400));
      } catch {
        groups = [];
      }
      for (const g of groups) {
        if (out.length >= limit) break;
        const text = `${g.topic || ""} ${g.summary || ""}`;
        if (!String(g.summary || "").trim()) continue;
        const shared = bigramsOf(text).some((x) => grams.has(x));
        if (!shared) continue;
        out.push({
          hash: `ev:${g.key}`,
          text: `[event] ${g.topic || g.key}｜${String(g.summary).slice(0, 160)}`,
          where: "deep/recall-events",
          kind: "event",
          eventKey: g.key,
        });
      }
    }

    // ③ 常规库：调外部检索函数（工具里就是 memory_search 的那套）
    if (out.length < limit && typeof searchFn === "function") {
      let hits = [];
      try {
        hits = searchFn(userText, limit) || [];
      } catch {
        hits = [];
      }
      for (const h of hits) {
        if (out.length >= limit) break;
        if (!h || !h.hash) continue;
        if (out.some((c) => c.hash === h.hash)) continue;
        if (isBlocked(h.hash, "", blocked)) {
          blockedCount += 1;
          continue;
        }
        out.push({ hash: h.hash, text: String(h.text || "").slice(0, 200), where: String(h.where || "search"), kind: "normal" });
      }
    }
    // ④ 重要库兜底：常规也空 → 再扫一遍重要（丹阳 2026-10-29：「可以再取」）
    if (!out.length) {
      for (const imp of importantAll()) {
        if (String(imp.state || "active") !== "active") continue;
        out.push({
          hash: (imp.refs || [])[0] || imp.id,
          text: `[important] ${imp.topic || ""}｜${(imp.evidence || "").slice(0, 120)}`,
          where: "deep/important.jsonl",
          kind: "important",
          importantId: imp.id,
        });
        fromImportant += 1;
        if (out.length >= limit) break;
      }
    }
    const fromEvent = out.filter((c) => c.kind === "event").length;
    return { candidates: out, blocked: blockedCount, fromImportant, fromEvent, fromNormal: out.length - fromImportant - fromEvent };
  }

  /** 提词器：让模型判断「这批候选里哪几条构成回忆」，并给一句自然语言提示 */
  async function judge({ userText, candidates, callModel, maxHintChars = 140 }) {
    if (!candidates.length) return { pick: null, hint: "", question: "" };
    if (typeof callModel !== "function") return { pick: null, hint: "", question: "", error: "没有可用的小模型路由" };
    const sys = [
      "你是「提词器」。任务：从候选记忆里判断，哪一条与用户这句话构成**同一件具体的事**的回忆。",
      "判定要严：必须是同样的事实/约定/经历/细节；只是词面相似、通用常识、或用户其实在说别的事，都不算。",
      "若有把握：pick 填序号；confidence 填 0–1 的把握（这条和用户这句话真的是同一件事吗）；hint 写一句自然语言提示（≤80 字，像提醒自己「他提过 X」，不要罗列资料、不要写编号）。",
      "若不构成回忆：pick 填 0，hint 空。",
      "若有两三条都像、且时间跨度大：pick 填最可能的一条，question 写一句要问对方的话（≤40 字，如「你说的是上周那次还是更早？」）。",
      '只输出 JSON：{"pick":序号,"confidence":0.0,"hint":"…","question":"…"}',
    ].join("\n");
    const user = [
      `【现在的用户消息】${String(userText).slice(0, 400)}`,
      "【候选记忆】",
      ...candidates.map((c, i) => `${i + 1}. ${c.text}`),
    ].join("\n");
    let raw = "";
    try {
      raw = await callModel({ system: sys, user });
    } catch (err) {
      return { pick: null, hint: "", question: "", error: String(err?.message || err) };
    }
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (!m) return { pick: null, hint: "", question: "", error: "模型输出不是 JSON" };
    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return { pick: null, hint: "", question: "", error: "JSON 解析失败" };
    }
    const idx = Number(parsed.pick);
    if (!Number.isInteger(idx) || idx < 1 || idx > candidates.length) {
      return { pick: null, hint: "", question: "", confidence: 0, dismissed: true };
    }
    const confidence = Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : 0.7;
    // 置信度分级：低于 0.5 当作没回忆（宁可不提，也别糊弄）；0.5–0.7 说的时候带「不确定」
    if (confidence < 0.5) return { pick: null, hint: "", question: "", confidence, dismissed: true };
    let hint = String(parsed.hint || "").slice(0, maxHintChars);
    if (confidence < 0.7 && hint) hint = `（我不太确定）${hint}`;
    return {
      pick: candidates[idx - 1],
      hint,
      question: String(parsed.question || "").slice(0, 80),
      confidence,
    };
  }

  /** 记一次回忆事件（成败都记）：明细分月落盘，同时维护一行月索引 */
  function recordEvent({ session = "", scene = "private", candidates = [], pick = null, verdict = "silent", replyFingerprint = "", summary = "", topic = "" } = {}) {
    const ts = now();
    // 丹阳 2026-10-29：事件里要带一句**总结**（这条回忆到底讲的什么事），
    // 同话题的多次事件靠 topic 归并；总结不是分数，只给人看，也不参与取词排序。
    const row = {
      ts: new Date(ts).toISOString(),
      session,
      scene,
      hash: pick?.hash || "",
      importantId: pick?.importantId || "",
      topic: String(topic || pick?.topic || "").trim(),
      summary: String(summary || pick?.hint || "").trim().slice(0, 200),
      // 丹阳 2026-10-29：二步法——第一步我自己写总结，第二步双方确认。
      // by=ai（我的一步，未合意）/ both（他确认过，双方）；只做溯源标记，不参与取词打分。
      summaryBy: verdict === "confirmed" ? "both" : "ai",
      candidates: candidates.map((c) => c.hash).slice(0, 8),
      myTextFingerprint: replyFingerprint,
      verdict,
    };
    const month = monthKeyOf(ts);
    const file = path.join(paths.eventsDir, `${month}.jsonl`);
    appendJsonl(file, row);
    // 月索引：一行一个月，只存指针与计数（不存内容）
    try {
      const idx = readJsonl(paths.eventsIndex);
      let hit = idx.find((r) => r.month === month);
      if (!hit) {
        hit = { month, file: `${month}.jsonl`, count: 0, confirmed: 0, denied: 0, objected: 0, silent: 0, firstAt: row.ts, topics: [] };
        idx.push(hit);
      }
      hit.count = Number(hit.count || 0) + 1;
      const key = verdict === "confirmed" || verdict === "denied" || verdict === "objected" ? verdict : "silent";
      hit[key] = Number(hit[key] || 0) + 1;
      hit.lastAt = row.ts;
      const topic = String(pick?.topic || "").trim();
      if (topic && !(hit.topics || []).includes(topic)) hit.topics = [...(hit.topics || []), topic].slice(-8);
      rewriteJsonl(paths.eventsIndex, idx.slice(-60));
    } catch {
      /* 索引写不进不影响明细 */
    }
    return row;
  }

  /** 读最近的回忆事件（新→旧）：先看月索引挑月份，再读明细；旧的单文件当成最早的月份 */
  function readEvents(limit = 20) {
    const max = Math.max(1, Math.min(500, Number(limit) || 20));
    const out = [];
    let idx = [];
    try {
      idx = readJsonl(paths.eventsIndex).map((r) => String(r.month || "")).filter(Boolean);
    } catch {
      idx = [];
    }
    for (const month of [...idx].sort().reverse()) {
      if (out.length >= max) break;
      const rows = readJsonl(path.join(paths.eventsDir, `${month}.jsonl`));
      for (let i = rows.length - 1; i >= 0 && out.length < max; i -= 1) out.push(rows[i]);
    }
    if (out.length < max) {
      const legacy = readJsonl(paths.legacyEvents);
      for (let i = legacy.length - 1; i >= 0 && out.length < max; i -= 1) out.push(legacy[i]);
    }
    return out;
  }

  /** 把事件按话题归并（同 topic 优先，没 topic 就按 hash）：次数 + 最近时间 + 最后一句总结 */
  function groupEvents(rows = []) {
    const map = new Map();
    for (const r of rows) {
      const key = String(r.topic || "").trim() || String(r.hash || "").trim() || "(无主题)";
      const hit = map.get(key) || { key, topic: r.topic || "", hash: r.hash || "", count: 0, confirmed: 0, denied: 0, objected: 0, silent: 0, lastAt: "", summary: "", samples: [] };
      hit.count += 1;
      const v = ["confirmed", "denied", "objected"].includes(r.verdict) ? r.verdict : "silent";
      hit[v] += 1;
      // 行是「新→旧」，只有严格更近的才更新总结，否则同毫秒的旧行会把新总结盖掉
      const ts = String(r.ts || "");
      if (!hit.lastAt || ts > hit.lastAt) {
        hit.lastAt = ts;
        if (r.summary) {
          hit.summary = r.summary;
          hit.summaryBy = r.summaryBy || "ai";
        }
      }
      if (r.summary && hit.samples.length < 3 && !hit.samples.includes(r.summary)) hit.samples.push(r.summary);
      if (!hit.hash && r.hash) hit.hash = r.hash;
      map.set(key, hit);
    }
    return [...map.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  }

  /** 计分：确认 +1、否认 +1 fails、沉默不记；两次确认升重要 */
  function applyVerdict({ hash, importantId = "", topic = "", verdict, evidence = "", refs = [], session = "" } = {}) {
    const ts = now();
    const rows = importantAll();
    let row = rows.find((r) => (importantId && r.id === importantId) || (!importantId && hash && (r.refs || []).includes(hash)));

    if (verdict === "confirmed") {
      if (!row && hash) {
        row = {
          id: `imp-${ts}-${Math.random().toString(36).slice(2, 6)}`,
          topic: topic || "",
          refs: [hash],
          evidence: evidence || "",
          where: "",
          count: 0,
          fails: 0,
          firstAt: new Date(ts).toISOString(),
          lastAt: new Date(ts).toISOString(),
          state: "active",
        };
        rows.push(row);
      }
      if (row) {
        row.count = Number(row.count || 0) + 1;
        row.lastAt = new Date(ts).toISOString();
        row.sessions = [...new Set([...(row.sessions || []), session].filter(Boolean))].slice(-20);
        if (!row.topic && topic) row.topic = topic;
        if (!row.evidence && evidence) row.evidence = evidence;
        if (row.count >= 2) row.state = "active";
        // 撤销通道（丹阳 2026-10-29：「人也有记错的时候」）：我回过原文、他点头了，
        // 说明之前那次否认是他记岔了 → 把罚款退掉，别让正确的记忆背 30 天错。
        if (Number(row.fails || 0) > 0) row.fails = Number(row.fails) - 1;
        if (row.fails === 0 && row.state === "demoted") row.state = "active";
      }
      if (hash) {
        const mis = readJsonl(paths.misrecall);
        const kept = mis.filter((r) => r.hash !== hash);
        if (kept.length !== mis.length) {
          rewriteJsonl(paths.misrecall, kept);
          note(`撤销记错：#${String(hash).slice(0, 8)}（他认了原文）`);
        }
      }
    } else if (verdict === "objected") {
      // 「事有，但我讲偏了」：只记反对次数，不算失败、不进记错表
      if (row) {
        row.objections = Number(row.objections || 0) + 1;
        row.lastAt = new Date(ts).toISOString();
      }
    } else if (verdict === "denied") {
      if (row) {
        row.fails = Number(row.fails || 0) + 1;
        row.lastAt = new Date(ts).toISOString();
        if (row.fails >= 2 && Number(row.fails) >= Number(row.count || 0)) row.state = "demoted";
      }
      if (hash) {
        const mis = readJsonl(paths.misrecall);
        mis.push({
          hash,
          topic: topic || row?.topic || "",
          fails: 1,
          lastAt: new Date(ts).toISOString(),
          expiresAt: new Date(ts + MISRECALL_TTL).toISOString(),
        });
        rewriteJsonl(paths.misrecall, mis.slice(-500));
      }
    }
    // silent：什么都不改（丹阳 2026-10-29 定：沉默不加分）
    if (row) rewriteJsonl(paths.important, rows);
    return row || null;
  }

  function stats() {
    const imps = importantAll();
    let events = 0;
    try {
      for (const r of readJsonl(paths.eventsIndex)) events += Number(r.count || 0);
    } catch {
      events = 0;
    }
    events += readJsonl(paths.legacyEvents).length;
    const months = readJsonl(paths.eventsIndex).length;
    return {
      important: imps.length,
      active: imps.filter((r) => String(r.state || "active") === "active").length,
      events,
      eventMonths: months,
      misrecall: readJsonl(paths.misrecall).length,
    };
  }

  return { paths, pendingPath, pickCandidates, judge, recordEvent, readEvents, groupEvents, applyVerdict, misrecallSet, verdictOf, stats, importantAll, savePending, loadPending, clearPending };
}
