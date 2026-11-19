import assert from "node:assert/strict";
import { harvestTodo } from "../self-promote.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };
t("能捞出用户说的待办", () => {
  const got = harvestTodo("先这样。待办：GitHub 令牌 11-22 到期，记得换。");
  assert.ok(got.some((s) => s.includes("令牌")));
});
t("没有待办词就不收", () => {
  assert.equal(harvestTodo("今天天气不错，适合出门。").length, 0);
});
t("最多两条", () => {
  const got = harvestTodo("记得给猫喂饭。别忘了交电费。明天要早起。");
  assert.ok(got.length <= 2);
});
console.log("\ntodo：" + n + " 项全部通过");