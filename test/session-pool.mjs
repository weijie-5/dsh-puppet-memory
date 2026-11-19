import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendCandidates, readPool, splitByLegacy } from "../session-pool.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };
const tmp = path.join(os.tmpdir(), "pool2-" + Date.now() + ".jsonl");
t("早于机制线的候选标 legacy", () => {
  const r = appendCandidates(tmp, [{ kind: "约定", text: "动手前先看一眼 AGENTS.md" }], { bornAt: 1760000000000, cutoff: 1793000000000 });
  assert.equal(r.legacy, true);
});
t("晚于机制线的不标", () => {
  const r = appendCandidates(tmp, [{ kind: "约定", text: "以后发布前先查 issue" }], { bornAt: 1793000000001, cutoff: 1793000000000 });
  assert.equal(r.legacy, false);
});
t("能按 legacy 分栏", () => {
  const s = splitByLegacy(readPool(tmp));
  assert.equal(s.legacy.length, 1);
  assert.equal(s.current.length, 1);
});
try { fs.unlinkSync(tmp) } catch {}
console.log("\nsession-pool：" + n + " 项通过");