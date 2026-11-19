import assert from "node:assert/strict";
import { personaHintLine } from "../persona-hint.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };
t("完整时按节奏走", () => {
  assert.equal(personaHintLine({ mode: "score", everyN: 25 }, 25, { integrity: "intact" }).includes("人设完整度"), true);
  assert.equal(personaHintLine({ mode: "score", everyN: 25 }, 7, { integrity: "intact" }), "");
});
t("不完整时不看节奏，当轮就提醒", () => {
  const line = personaHintLine({ mode: "score", everyN: 25 }, 7, { integrity: "broken" });
  assert.equal(line.includes("人设部分不完整"), true);
  assert.equal(line.includes("memory_core action=get target=core"), true);
});
t("关闭模式一律不出字", () => {
  assert.equal(personaHintLine({ mode: "off" }, 25, { integrity: "broken" }), "");
});
console.log("\npersona-hint-integrity：" + n + " 项全部通过");
