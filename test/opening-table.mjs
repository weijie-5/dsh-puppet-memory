// v0.40（B-99）：开幕表——特殊日子每天第一次读一次；农历条目自动换算并「记下一次」
// 覆盖点：今天命中 / N 天后命中 / 超 lookahead 不出现 / 同一天第二次不重复 / 跨天恢复 / 关掉不注入 /
//         文件缺失不崩 / 农历条目按 map 自动补出当年与来年 / 补齐是幂等的
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-puppet-opening-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "array", "state"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
fs.writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ version: 1, enabled: true, inject: { maxChars: 3000 }, backup: { enabled: false }, opening: { enabled: true, lookaheadDays: 7, maxItems: 5 } }), "utf8");

const NL = "\n";
const TABLE = path.join(TMP, "deep", "opening-table.jsonl");
const MAP = path.join(TMP, "deep", "opening-lunar-map.json");
const writeTable = (rows) => fs.writeFileSync(TABLE, rows.map((r) => JSON.stringify(r)).join(NL) + NL, "utf8");
const readTable = () => fs.readFileSync(TABLE, "utf8").split(NL).filter(Boolean).map((l) => JSON.parse(l));

writeTable([
  { date: "2026-11-02", label: "丹阳生日", note: "农历 1997-09-16（身份证照填）" },
  { date: "2026-11-05", label: "纪念日 X" },
  { date: "2026-12-31", label: "很远的事" },
]);

const mod = await import(new URL("../index.js", import.meta.url).href);

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => (cond ? (pass += 1) : fails.push(name + (extra ? `（${extra}）` : "")));
const at = (s) => new Date(s + "T09:00:00+08:00").getTime();
const cfg = { opening: { enabled: true, lookaheadDays: 7, maxItems: 5 } };

try {
  // 1) 当天：今天 + 3 天后都出现，超窗口的不出现
  const t1 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2026-11-02") }));
  ok("今天命中的日子出现", t1.includes("今天：丹阳生日"), t1.slice(0, 120));
  ok("备注带出来", t1.includes("农历"), t1.slice(0, 120));
  ok("7 天内的日子出现（还有 3 天）", t1.includes("还有 3 天") && t1.includes("纪念日 X"), t1.slice(0, 200));
  ok("超出 lookahead 的不出现", !t1.includes("很远的事"), t1.slice(0, 200));
  ok("包在 <puppet_opening> 里", t1.includes("<puppet_opening>") && t1.includes("</puppet_opening>"));

  // 2) 同一天第二次不重复
  const t2 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2026-11-02") }));
  ok("同一天第二次不再注入", t2 === "", t2.slice(0, 80));

  // 3) 跨天恢复
  const t3 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2026-11-05") }));
  ok("跨天后重新注入", t3.includes("今天：纪念日 X"), t3.slice(0, 120));

  // 4) 关掉开关
  const t4 = String(mod.buildOpeningInjection({ opening: { enabled: false } }, { nowMs: at("2026-11-06") }));
  ok("关掉后不注入", t4 === "", t4.slice(0, 80));

  // 5) 没有命中的日子
  const t5 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2026-11-20") }));
  ok("没有命中的日子 → 空", t5 === "", t5.slice(0, 80));

  // 6) 农历条目：只写 lunar，日期由 map 自动补出来（并落盘）
  fs.writeFileSync(
    MAP,
    JSON.stringify({ "09-16": { "2027": "2027-10-15", "2028": "2028-11-02", "2029": "2029-10-23" } }),
    "utf8",
  );
  writeTable([{ lunar: "09-16", label: "丹阳生日", kind: "birthday", note: "农历 1997-09-16（身份证照填）" }]);
  const t6 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2027-10-10") }));
  ok("农历条目换算后进入 7 天窗口", t6.includes("还有 5 天") && t6.includes("2027-10-15"), t6.slice(0, 200));
  const rowsAfter = readTable();
  ok("具体日期已「记下一次」", rowsAfter.some((r) => r.date === "2027-10-15"), JSON.stringify(rowsAfter).slice(0, 160));
  ok("补齐包含明年与后年", rowsAfter.some((r) => r.date === "2028-11-02"), JSON.stringify(rowsAfter).slice(0, 200));

  // 7) 幂等：同一天再跑不会把行写两遍
  mod.buildOpeningInjection(cfg, { nowMs: at("2027-10-10"), persist: true });
  ok("补齐幂等（不重复写行）", readTable().filter((r) => r.date === "2027-10-15").length === 1);

  // 8) 文件缺失不崩
  fs.unlinkSync(TABLE);
  const t8 = String(mod.buildOpeningInjection(cfg, { nowMs: at("2027-10-15") }));
  ok("文件缺失返回空（不崩）", t8 === "", t8.slice(0, 80));
} catch (err) {
  fails.push(`异常：${err?.stack || err}`);
}

if (fails.length) {
  console.log(`✗ opening-table: ${pass} 通过，${fails.length} 失败`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`✓ opening-table: ${pass} 项全部通过`);
