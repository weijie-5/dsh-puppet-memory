// session-pool-judge.js — 候选池二次判定（v0.49.0 / 2026-11-20 丹阳定）
//
// 设计：候选进池的第一道是正则（session-digest），分不清「这一次」和「以后」。
// 这里用本地小模型判一句：脱离这场对话还成立吗？成立→留 pending；不成立→标 dropped（不删）。
// 小模型不可用就什么都不改（fail-open），等压缩后再试——不攒、也不误杀。

import fs from 'node:fs'
import { readPool } from './session-pool.js'
import { callLocalEndpoint } from './conflict.js'

export const poolJudgeDefaults = {
  enabled: true,
  probeMs: 800,
  timeoutMs: 20000,
  batch: 8,
  model: '',
  endpoint: '',
};

function rewrite(file, rows) {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

async function probe(endpoint, probeMs) {
  const base = String(endpoint || '').replace(/\/+$/, '');
  if (!base) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(200, Number(probeMs) || 800));
  try {
    const res = await fetch(base + '/v1/models', { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

const PROMPT_HEAD = [
  '下面是从一段人机对话里切出来的短句，准备存进长期记忆。',
  '判断每一条：脱离当时的上下文，它是否仍然是一个**长期成立**的事实、约定或偏好？',
  '不算的：一次性操作（"明天再发""上一条发错了"）、只有当时才成立的话、复述过程、纯情绪吐槽。',
  '只输出 JSON 数组，每项 {"i":序号,"keep":true/false,"why":"不超过12字"}，不要任何其它文字。',
].join('\n');

export function buildPrompt(items) {
  const lines = items.map((r, i) => i + '. ' + String(r.text || '').slice(0, 80));
  return PROMPT_HEAD + '\n\n' + lines.join('\n');
}

export function parseVerdicts(raw, n) {
  const text = String(raw || '');
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  let arr = null;
  try { arr = JSON.parse(m[0]); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const out = new Array(n).fill(null);
  for (const it of arr) {
    const i = Number(it && it.i);
    if (!Number.isInteger(i) || i < 0 || i >= n) continue;
    out[i] = { keep: Boolean(it.keep), why: String(it.why || '').slice(0, 20) };
  }
  return out;
}

export async function judgePending(file, cfg = {}, { now = Date.now() } = {}) {
  const c = { ...poolJudgeDefaults, ...(cfg || {}) };
  const rows = readPool(file).filter((r) => r && r.status === 'pending');
  if (!rows.length) return { available: true, judged: 0, dropped: 0, skipped: 0, note: '没有待判候选' };
  const endpoint = String(c.endpoint || '').trim();
  if (!c.enabled || !endpoint) return { available: false, judged: 0, dropped: 0, skipped: rows.length, note: '没配本地端点，跳过' };
  const alive = await probe(endpoint, c.probeMs);
  if (!alive) return { available: false, judged: 0, dropped: 0, skipped: rows.length, note: '本地小模型没在跑，等压缩后再试' };
  const batch = rows.slice(0, Math.max(1, Number(c.batch) || 8));
  let verdicts = null;
  try {
    const raw = await callLocalEndpoint({ endpoint, model: c.model || 'local', prompt: buildPrompt(batch), timeoutMs: c.timeoutMs || 20000, apiKey: c.apiKey || '' });
    verdicts = parseVerdicts(raw, batch.length);
  } catch (e) {
    return { available: false, judged: 0, dropped: 0, skipped: rows.length, note: '调用失败：' + e.message };
  }
  if (!verdicts) return { available: true, judged: 0, dropped: 0, skipped: rows.length, note: '小模型输出没解析出来，保持原样' };
  const all = readPool(file);
  let judged = 0, dropped = 0;
  for (const r of all) {
    if (!r || r.status !== 'pending') continue;
    const idx = batch.findIndex((b) => b.key === r.key);
    if (idx < 0) continue;
    const v = verdicts[idx];
    if (!v) continue;
    judged += 1;
    r.judgedAt = new Date(now).toISOString();
    r.judgedBy = 'pool-judge';
    if (!v.keep) {
      r.status = 'dropped';
      r.droppedAt = new Date(now).toISOString().slice(0, 10);
      r.droppedBy = 'pool-judge';
      r.dropReason = '小模型判定：不是长期成立的事实/约定' + (v.why ? '｜' + v.why : '');
      dropped += 1;
    } else {
      r.keepReason = v.why || '长期成立';
    }
  }
  rewrite(file, all);
  return { available: true, judged, dropped, skipped: Math.max(0, rows.length - judged), note: '' };
}
