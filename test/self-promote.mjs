import assert from "node:assert/strict";
import { auditSelf, contradictory, coveredBy, similarity } from "../self-promote.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };
t("被卡片覆盖能查出来", () => {
  const hit = coveredBy("被冷落先问一句再自己找台阶", ["情绪有先后：被冷落先问一句再自己找台阶"]);
  assert.ok(hit.length >= 8);
});
t("没覆盖的不误报", () => {
  assert.equal(coveredBy("改木偶记忆源码后要同步 profile", ["【称呼】我叫雪风大人"]), "");
});
t("对立能识别", () => {
  assert.equal(contradictory("先给结论，再给依据", "先给依据，再给结论"), true);
  assert.equal(contradictory("先给依据，再给结论", "记具体的事"), false);
});
t("近似重复算相似度", () => {
  assert.ok(similarity("先给结论，再给依据。", "先给结论，再给依据") > 0.6);
  assert.ok(similarity("写小说别写成流程报告", "改源码后同步 profile") < 0.3);
});
t("审计能同时报覆盖与对立", () => {
  const rows = [
    { kind: "style", text: "先给结论，再给依据" },
    { kind: "style", text: "先给依据，再给结论——他要的和这条反过来" },
    { kind: "style", text: "被冷落先问一句再自己找台阶" },
  ];
  const out = auditSelf(rows, ["情绪有先后：被冷落先问一句再自己找台阶"]);
  assert.ok(out.some((x) => x.action === "void"));
  assert.ok(out.some((x) => x.action === "reconcile"));
});
console.log("\nself-promote：" + n + " 项全部通过");