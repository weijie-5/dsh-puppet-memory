// digest-sessions.mjs — 把最大的 N 个会话筛成候选，写进记忆候选池（零模型）
// 用法：node digest-sessions.mjs [N=3] [--dry]
import fs from "node:fs";
import path from "node:path";
import { decodeSessionFile, dialogueOf } from "./session-decode.js";
import { pickCandidates } from "./session-digest.js";
import { appendCandidates, mechanismCutoff } from "./session-pool.js";

const MEM = process.env.DSH_MEMORY_DIR || path.join(process.env.USERPROFILE || "C:/Users/Administrator", ".dsh", "memory");
const POOL = path.join(MEM, "deep", "session-candidates.jsonl");
const SESS = path.join(process.env.USERPROFILE || "C:/Users/Administrator", ".dsh", "sessions");
const dry = process.argv.includes("--dry");
const topN = Math.max(1, Number(process.argv.find((a) => /^\d+$/.test(a)) || 3));

const files = [];
for (const ws of fs.readdirSync(SESS)) {
  const d = path.join(SESS, ws);
  if (!fs.statSync(d).isDirectory()) continue;
  for (const sid of fs.readdirSync(d)) {
    const p = path.join(d, sid, "session.v4.jsonl.zstd");
    if (fs.existsSync(p)) files.push({ p, size: fs.statSync(p).size });
  }
}
files.sort((a, b) => b.size - a.size);
let all = [];
for (const f of files.slice(0, topN)) {
  const r = decodeSessionFile(f.p);
  const turns = dialogueOf(r.lines);
  const cands = pickCandidates(turns, { max: 20 });
  all = all.concat(cands.map((c) => ({ ...c, from: path.basename(path.dirname(f.p)), bornAt: fs.statSync(f.p).mtimeMs })));
  console.log(path.basename(path.dirname(f.p)).slice(0, 22), "对话", turns.length, "候选", cands.length);
}
console.log("合计候选", all.length);
if (dry) process.exit(0);
const cutoff = mechanismCutoff(MEM);
const res = appendCandidates(POOL, all, {
  source: "session-digest",
  bornAt: all.length ? Math.min(...all.map((c) => Number(c.bornAt) || Date.now())) : null,
  cutoff,
});
if (res.legacy) console.log("注意：这批候选出自机制成型之前（规则册建成之前），标记为 legacy");
console.log("入池新增", res.added, "| 池内待确认", res.total, "|", POOL);