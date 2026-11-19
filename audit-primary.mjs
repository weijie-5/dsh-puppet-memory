// audit-primary.mjs v2 — 主/次体检（只读）。判据：读不到会不会做错。
import fs from 'node:fs';
import path from 'node:path';
const MEM = process.env.DSH_MEMORY_DIR || path.join(process.env.USERPROFILE || 'C:/Users/Administrator', '.dsh', 'memory');
const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const jsonl = (p) => rd(p).split(/\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && !x.voided);
const RULE = /(别|不要|不许|禁止|必须|一律|只能|先.{1,6}再|默认|统一|优先|禁止|不得)/;
const missRules = [], missedInfo = [];
let main = 0, info = 0;
// 1) 卡：core / rules / state 一律主
for (const f of ['core.md', 'core-rules.md', 'core-state.md']) {
  const t = rd(path.join(MEM, 'behavior', f));
  for (const line of t.split(/\n+/)) { const s = line.replace(/^[-*\s]+/, '').trim(); if (s.length > 5) main++; }
}
// 2) 自我层：lesson/habit/style 主，fact/other 次
for (const r of jsonl(path.join(MEM, 'behavior/self.jsonl'))) {
  if (['lesson', 'habit', 'style'].includes(r.kind)) main++; else info++;
}
// 3) 关系/常言/用户：默认次；但里面写着硬规矩的 → 记进 missRules
for (const [file, src] of [['behavior/relations.jsonl', 'relation'], ['deep/sayings.jsonl', 'saying'], ['user/user.jsonl', 'user']]) {
  for (const r of jsonl(path.join(MEM, file))) {
    const t = String(r.meaning || r.text || '');
    info++;
    if (RULE.test(t) && t.length < 120) missRules.push({ src, text: t.slice(0, 70) });
  }
}
console.log('主 ' + main + ' / 次 ' + info);
console.log('次里藏着硬规矩（该升主或已重复）: ' + missRules.length);
for (const m of missRules.slice(0, 6)) console.log('  [' + m.src + '] ' + m.text);