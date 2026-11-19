import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addKnowledge, findKnowledge } from "../knowledge.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };
const mem = fs.mkdtempSync(path.join(os.tmpdir(), "kn-"));
t("原名必须给", () => { assert.equal(addKnowledge(mem, { conclusion: "x" }).ok, false); });
t("写入后可查", () => {
  addKnowledge(mem, { term: "序列污染", conclusion: "被别家道统侵染，属性走样", library: "dsh-plugin-design", doc: "k1", aliases: ["污染"] });
  assert.equal(findKnowledge(mem, "序列污染").length, 1);
});
t("别名也能查", () => { assert.equal(findKnowledge(mem, "污染").length, 1); });
t("同名更新不重复", () => {
  addKnowledge(mem, { term: "序列污染", conclusion: "改过的结论" });
  assert.equal(findKnowledge(mem, "序列污染").length, 1);
});
t("存的是指针不是全文", () => {
  const r = findKnowledge(mem, "序列污染")[0];
  assert.ok(!("fullText" in r));
});
console.log("\nknowledge：" + n + " 项通过");