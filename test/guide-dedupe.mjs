// v0.40（B-99）：guide 衍生索引不再造成同一条重复返回
// 覆盖点：真条目+多条 guide 行 → 只回 1 条；只有 guide 行（条目在原文件被裁掉）→ 仍返回 1 条；不相干的不串味
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-guide-dedupe-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "array", "state"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ version: 1, enabled: true, inject: { maxChars: 3000 }, backup: { enabled: false }, brief: { enabled: false }, search: { engine: "scan" } }), "utf8");

const H1 = "aaaaaaaaaaaa1111";
const H2 = "bbbbbbbbbbbb2222";
const H3 = "cccccccccccc3333";

// 真条目：relations 里有一条（H1），diary 里有一条（H3）
fs.writeFileSync(
  path.join(TMP, "behavior", "relations.jsonl"),
  JSON.stringify({ hash: H1, kind: "relation", keyword: "木偶记忆", meaning: "自研记忆插件，包名 dsh-puppet-memory", tags: ["插件"], ts: "2026-10-20T00:00:00.000Z" }) + "\n",
  "utf8",
);
fs.writeFileSync(
  path.join(TMP, "behavior", "diary", "2026-10.jsonl"),
  JSON.stringify({ hash: H3, kind: "turn", text: "今天把检索改成字面兜底，BM25 之后追加单字覆盖率高的条目。", ts: "2026-11-02T00:00:00.000Z" }) + "\n",
  "utf8",
);

// guide：H1 有 5 行（同一 hash 多线索）、H3 有 2 行、H2 只有 guide（真条目不在被扫文件里）
const guide = [];
for (let i = 0; i < 5; i += 1) guide.push({ ts: `2026-10-2${i}T00:00:00.000Z`, kind: "relation", hash: H1, keywords: ["木偶记忆", "插件"], file: "behavior/relations.jsonl" });
for (let i = 0; i < 2; i += 1) guide.push({ ts: `2026-11-0${i + 1}T00:00:00.000Z`, kind: "turn", hash: H3, keywords: ["检索", "兜底"], file: "behavior/diary/2026-10.jsonl" });
guide.push({ ts: "2026-10-25T00:00:00.000Z", kind: "relation", hash: H2, keywords: ["旧关系", "已被裁掉"], file: "behavior/relations.jsonl" });
fs.writeFileSync(path.join(TMP, "deep", "guide.jsonl"), guide.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

const mod = await import(new URL("../index.js", import.meta.url).href);

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => (cond ? (pass += 1) : fails.push(name + (extra ? `（${extra}）` : "")));

try {
  const out1 = String(mod.searchMemory("木偶记忆", { layers: ["all"], limit: 10 }));
  const n1 = (out1.match(new RegExp("\"hash\":\"" + H1, "g")) || []).length; // 只数原始命中行，要点行里的 #hash 不算
  ok("真条目 + 5 条 guide 行 → 只出现 1 次", n1 === 1, `出现 ${n1} 次`);

  const out2 = String(mod.searchMemory("检索 兜底", { layers: ["all"], limit: 10 }));
  const n3 = (out2.match(new RegExp("\"hash\":\"" + H3, "g")) || []).length;
  ok("diary 条目 + 2 条 guide 行 → 只出现 1 次", n3 === 1, `出现 ${n3} 次`);

  const out3 = String(mod.searchMemory("旧关系 已被裁掉", { layers: ["all"], limit: 10 }));
  const n2 = (out3.match(new RegExp("\"hash\":\"" + H2, "g")) || []).length;
  ok("只有 guide 行的条目仍能搜到", n2 >= 1, `出现 ${n2} 次`);

  ok("命中数不超过 limit", String(mod.searchMemory("木偶记忆", { layers: ["all"], limit: 1 })).split("\n").filter((l) => l.includes('"hash":"' + H1)).length <= 1);
} catch (err) {
  fails.push(`异常：${err?.stack || err}`);
}

if (fails.length) {
  console.log(`✗ guide-dedupe: ${pass} 通过，${fails.length} 失败`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`✓ guide-dedupe: ${pass} 项全部通过`);
