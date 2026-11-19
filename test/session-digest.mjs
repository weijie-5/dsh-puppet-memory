import assert from "node:assert/strict";
import { pickCandidates } from "../session-digest.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };
t("含「以后/别再」的句子能被筛出", () => {
  const got = pickCandidates([{ role: "user", text: "以后发文前先查一遍 issue，别再漏了" }]);
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, "约定");
});
t("纯语气词不算", () => {
  assert.equal(pickCandidates([{ role: "user", text: "好的好的……" }]).length, 0);
});
t("我的发言不当记忆源", () => {
  assert.equal(pickCandidates([{ role: "assistant", text: "以后我会先查 issue 再发" }]).length, 0);
});
t("过长过短都不收", () => {
  assert.equal(pickCandidates([{ role: "user", text: "以后" }]).length, 0);
});
console.log("\nsession-digest：" + n + " 项通过");