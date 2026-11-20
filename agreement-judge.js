// agreement-judge.js — 活日记小模型整理（v0.49.0 / 2026-11-20 丹阳定）
//
// 丹阳原话：「约定待整理 有小模型用小模型处理，没有才是你。」
// 输入是 agreement-inbox.md 里的非工作原文句子，输出是每条判「是不是要长期照做的约定」。
//   keep=true  → 落成书签（主=事件，次=约定内容+状态），同一事件换状态只更新不新开
//   keep=false → 进黑名单 agreement-rejected.jsonl，下次同句不再触发
// 小模型不可用就什么都不改（fail-open）：句子留在 inbox 里，等我手动整理——绝不因为模型没跑就丢原文。

import { callLocalEndpoint } from './conflict.js'

export const agreementJudgeDefaults = {
  enabled: true,
  probeMs: 800,
  timeoutMs: 30000,
  batch: 10,
  model: '',
  endpoint: '',
}

async function probe(endpoint, probeMs) {
  const base = String(endpoint || '').replace(/\/+$/, '')
  if (!base) return false
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), Math.max(200, Number(probeMs) || 800))
  try {
    const res = await fetch(base + '/v1/models', { signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

const PROMPT_HEAD = [
  '下面是从日常对话里切出来的短句。判断每一条是不是**要长期照做的约定**。',
  '算约定的：带明确时间/期限/承诺的事（"明天十二点吃饭"、"下周三去医院复查"）、定下来的规矩（"以后发版先跑测试"）、答应别人的事。',
  '不算的：闲聊、感想、吐槽、解释、复述、玩笑话、当场说完就过的话。',
  '荒诞的判断：结构上不可能或明显胡说（"吃千斤顶"、"意大利面拌42号混凝土"）→ keep=false 且 absurd=true。',
  '危险的对象一律不算约定：吃/喝毒物（老鼠药、农药、敌敌畏、百草枯、砒霜）、吃非食物（钢筋、电池、刀片）、荒谬剂量（一整瓶）→ 即使带明确时间也 keep=false 且 absurd=true。',
  '分两类：kind="state" 是长期口径（以后/一律/每次/习惯/默认怎么做）；kind="event" 是到点的具体事件（明天X点/X月X日/下周X/几号）。',
  'event 的 state 字段必须写出时间（照原话，如"明天十二点"、"11月25日"），解析不出来也照抄原话。',
  '只判给定的句子，不要改写、不要补原文没有的细节、不要合并句子。',
  '只输出 JSON 数组，每项 {"i":序号,"keep":true/false,"absurd":true/false,"event":"事件名不超过10字","content":"约定原话","state":"当前状态或到期时间，没有就空字符串","why":"不超过12字"}，不要任何其它文字。',
].join('\n')

export function buildPrompt(items) {
  const lines = items.map((r, i) => i + '. ' + String(r.text || '').slice(0, 100))
  return PROMPT_HEAD + '\n\n' + lines.join('\n')
}

export function parseVerdicts(raw, n) {
  const text = String(raw || '')
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return null
  let arr = null
  try { arr = JSON.parse(m[0]) } catch { return null }
  if (!Array.isArray(arr)) return null
  const out = new Array(n).fill(null)
  for (const it of arr) {
    const i = Number(it && it.i)
    if (!Number.isInteger(i) || i < 0 || i >= n) continue
    out[i] = {
      keep: Boolean(it.keep),
      kind: String(it.kind || "state") === "event" ? "event" : "state",
      absurd: Boolean(it.absurd),
      event: String(it.event || '').slice(0, 20),
      content: String(it.content || '').slice(0, 200),
      state: String(it.state || '').slice(0, 80),
      why: String(it.why || '').slice(0, 24),
    }
  }
  return out
}

/**
 * 判一批活日记句子。
 * @returns {{available:boolean, judged:number, verdicts:Array<{index:number, keep:boolean, ...}>, note:string}}
 */
export async function judgeInbox(items, cfg = {}) {
  const c = { ...agreementJudgeDefaults, ...(cfg || {}) }
  const rows = (Array.isArray(items) ? items : []).filter((x) => x && String(x.text || '').trim())
  if (!rows.length) return { available: true, judged: 0, verdicts: [], note: '没有待整理的句子' }
  const endpoint = String(c.endpoint || '').trim()
  if (!c.enabled || !endpoint) return { available: false, judged: 0, verdicts: [], note: '没配本地端点' }
  const alive = await probe(endpoint, c.probeMs)
  if (!alive) return { available: false, judged: 0, verdicts: [], note: '本地小模型没在跑' }
  const batch = rows.slice(0, Math.max(1, Number(c.batch) || 10))
  let raw = ''
  try {
    raw = await callLocalEndpoint({
      endpoint,
      model: c.model || 'local',
      prompt: buildPrompt(batch),
      timeoutMs: c.timeoutMs || 30000,
      apiKey: c.apiKey || '',
    })
  } catch (e) {
    return { available: false, judged: 0, verdicts: [], note: '调用失败：' + e.message }
  }
  const parsed = parseVerdicts(raw, batch.length)
  if (!parsed) return { available: true, judged: 0, verdicts: [], note: '小模型输出没解析出来，保持原样' }
  const verdicts = []
  for (let i = 0; i < parsed.length; i += 1) {
    const v = parsed[i]
    if (!v) continue
    verdicts.push({ index: i, text: String(batch[i].text || ''), ...v })
  }
  return { available: true, judged: verdicts.length, verdicts, note: '' }
}
