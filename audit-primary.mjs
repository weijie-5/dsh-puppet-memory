// audit-primary.mjs v3 — 主/次体检（只读）。判据：读不到会不会做错。
// v3（2026-11-20）：不再把「事实句」「常言」当错位；先判「卡里已覆盖」，剩下的才算真待处理。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const MEM = process.env.DSH_MEMORY_DIR || path.join(os.homedir(), '.dsh', 'memory');
const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const jsonl = (p) => rd(p).split(/\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && !x.voided);
const baseKana = (s) => String(s).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
const RULE = /(别|不要|不许|禁止|必须|一律|只能|先.{1,6}再|默认|统一|优先|不得)/;
const FACT = /(有两个|不在运行|可以叫|这么叫|名字|别名|叫「|位于|住在|是低频|听不见|在桌宠)/;

let main = 0, info = 0;
const cardParts = [];
for (const f of ['core.md', 'core-rules.md', 'core-state.md']) {
  const t = rd(path.join(MEM, 'behavior', f));
  cardParts.push(t);
  for (const line of t.split(/\n+/)) { const s = line.replace(/^[-*\s]+/, '').trim(); if (s.length > 5) main++; }
}
const cardFlat = baseKana(cardParts.join('\n'));

function covered(text) {
  const s = baseKana(text);
  if (s.length < 10) return false;
  for (let i = 0; i + 10 <= s.length; i += 3) if (cardFlat.includes(s.slice(i, i + 10))) return true;
  return false;
}

for (const r of jsonl(path.join(MEM, 'behavior/self.jsonl'))) {
  if (['lesson', 'habit', 'style'].includes(r.kind)) main++; else info++;
}

let allowMap = {};
try { allowMap = JSON.parse(rd(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'audit-allow.json'))); } catch { /* 没 allowlist 就当空 */ }
const allowed = (t) => Object.keys(allowMap).some((k) => t.includes(k));

const coveredList = [], factList = [], sayingList = [], allowedList = [], realList = [];
for (const [file, src] of [['behavior/relations.jsonl', 'relation'], ['deep/sayings.jsonl', 'saying'], ['user/user.jsonl', 'user']]) {
  for (const r of jsonl(path.join(MEM, file))) {
    const t = String(r.meaning || r.text || '');
    info++;
    if (!RULE.test(t) || t.length >= 160) continue;
    if (src === 'saying') { sayingList.push({ src, text: t.slice(0, 60) }); continue; }
    if (FACT.test(t)) { factList.push({ src, text: t.slice(0, 60) }); continue; }
    if (allowed(t)) { allowedList.push({ src, text: t.slice(0, 60) }); continue; }
    if (covered(t)) { coveredList.push({ src, text: t.slice(0, 60) }); continue; }
    realList.push({ src, text: t.slice(0, 60) });
  }
}

console.log('主 ' + main + ' / 次 ' + info);
console.log('已被卡覆盖: ' + coveredList.length + ' ｜事实句: ' + factList.length + ' ｜常言(不计): ' + sayingList.length + ' ｜人工判定不算错位: ' + allowedList.length);
console.log('**真待处理: ' + realList.length + '**（判据：这一项必须是 0）');
for (const m of realList.slice(0, 10)) console.log('  [' + m.src + '] ' + m.text);
process.exit(realList.length === 0 ? 0 : 1);
