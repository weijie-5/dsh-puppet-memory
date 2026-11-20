import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeSessionFile, dialogueOf, frameOffsets } from "../session-decode.js";
let n = 0; const t = (name, fn) => { fn(); n += 1; console.log("  ✓ " + name); };
const dir = path.join(os.homedir(), ".dsh", "sessions");
const ws = fs.existsSync(dir) ? fs.readdirSync(dir).map((x) => dir + "/" + x).find((p) => { try { return fs.statSync(p).isDirectory() && fs.readdirSync(p).length } catch { return false } }) : "";
const sid = ws ? fs.readdirSync(ws).find((s) => fs.existsSync(ws + "/" + s + "/session.v4.jsonl.zstd")) : "";
const file = sid ? ws + "/" + sid + "/session.v4.jsonl.zstd" : "";
t("无帧数据返回空", () => {
  assert.deepEqual(frameOffsets(Buffer.from("hello")), []);
});
if (file) {
  const r = decodeSessionFile(file);
  t("真实会话能解出多帧（不是只有头）", () => {
    assert.ok(r.frames > 1, "帧数 " + r.frames);
    assert.ok(r.lines.length > 1, "行数 " + r.lines.length);
  });
  t("失败帧为 0", () => { assert.equal(r.failed, 0); });
  t("能取出对话（可能为 0 条，但不报错）", () => {
    const d = dialogueOf(r.lines);
    assert.ok(Array.isArray(d));
  });
} else {
  console.log("  - 跳过真实会话断言（本机没有可读会话文件）");
}
console.log("\nsession-decode：" + n + " 项通过");