import assert from "node:assert/strict";
import { decayCheck, harvestCandidates } from "../self-promote.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };
t("能捞出教训句", () => {
  const got = harvestCandidates("这次错了。下次别信重启动作本身，先查加载的那份文件。别的都还好。");
  assert.ok(got.some((s) => s.includes("下次别信重启")));
});
t("捞不到的时候返回空", () => {
  assert.equal(harvestCandidates("今天天气不错。").length, 0);
});
t("重复句只留一条", () => {
  const got = harvestCandidates("下次别信重启动作本身，先查实际加载的那份文件。下次别信重启动作本身，先查实际加载的那份文件。");
  assert.equal(got.length, 1);
});
t("久未更新的低重要度条目会被淘汰", () => {
  const now = Date.parse("2026-11-19T00:00:00Z");
  const rows = [
    { id: "a", importance: 1, updated: "2026-01-01T00:00:00Z", text: "旧" },
    { id: "b", importance: 3, updated: "2026-01-01T00:00:00Z", text: "重要" },
    { id: "c", importance: 1, updated: "2026-11-01T00:00:00Z", text: "新" },
  ];
  const out = decayCheck(rows, { now });
  assert.deepEqual(out.map((x) => x.id), ["a"]);
});
console.log("\nself-improve：" + n + " 项全部通过");