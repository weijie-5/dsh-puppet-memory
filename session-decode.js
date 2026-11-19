// session-decode.js — 会话原始文件解码（v0.48.0 / 2026-11-19）
//
// 背景：~/.dsh/sessions/<workspace>/<session>/session.v4.jsonl.zstd 是**多帧 zstd**
// （一条 95MB 的会话里 6.9 万个帧）。Node 的 zstdDecompressSync 只解第一帧，
// 于是所有会话都只读出 190 字节的 session 头——这就是“原文读不出来”的真正原因。
//
// 本模块按帧头切分，逐帧解；解不开就把下一段并进来重试（帧被切碎的情况）。
// 纯本地、零模型。

import fs from "node:fs";
import zlib from "node:zlib";

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

export function frameOffsets(buf) {
  const offs = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) offs.push(i);
  }
  return offs;
}

// 返回 { text, lines, frames, failed, merged }；failed 是真正解不开的帧数
export function decodeSessionBuffer(buf) {
  const offs = frameOffsets(buf);
  const parts = [];
  let failed = 0;
  let merged = 0;
  for (let i = 0; i < offs.length; i += 1) {
    let end = i + 1 < offs.length ? offs[i + 1] : buf.length;
    let ok = false;
    while (end <= buf.length) {
      try {
        parts.push(zlib.zstdDecompressSync(buf.subarray(offs[i], end)));
        ok = true;
        break;
      } catch {
        const next = offs.indexOf(end);
        const n2 = next >= 0 ? offs[next + 1] : buf.length;
        if (!n2 || n2 <= end) break;
        end = n2;
        merged += 1;
      }
    }
    if (!ok) failed += 1;
  }
  const text = Buffer.concat(parts).toString("utf8");
  return { text, lines: text.split("\n").filter(Boolean), frames: offs.length, failed, merged };
}

export function decodeSessionFile(file) {
  return decodeSessionBuffer(fs.readFileSync(file));
}

// 只取对话事件（user / assistant 文本），给“原文→记忆”用
// 事件形状（实测）：{ type, seq, time, data }
//   user/message      data.content[] = [{type:"text",text}]
//   assistant/message data.message.content[] = [{type:"text"|"reasoning",text}]
// 只取 text 段；reasoning 不算对话（那是我的思考，不该进记忆源）
// 用户消息里混着宿主/插件注入的“上下文”（system-reminder、Plugin context、时间行…），
// 那些不是他说的话，必须先剔掉，否则提取出来的记忆是拿注入块在自说自话。
// 实测：user/message 里还混着 <puppet_*> 注入块、后台任务通知、纯链接——都不是他说的话
const INJECTED = /^(<|\[Plugin context|Time sampled|【|Background (subagent|job)|Generated on|https?:\/\/)/;
export function isInjectedUserText(text) {
  const t = String(text || "").trim();
  return !t || INJECTED.test(t);
}

export function dialogueOf(lines) {
  const out = [];
  const textOf = (parts) => (Array.isArray(parts) ? parts : [])
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const d = e && e.data;
    if (!d) continue;
    if (e.type === "user/message") {
      const text = textOf(d.content) || (typeof d.text === "string" ? d.text.trim() : "");
      if (text && !isInjectedUserText(text)) out.push({ role: "user", text, time: e.time });
    } else if (e.type === "assistant/message") {
      const text = textOf(d.message && d.message.content);
      if (text) out.push({ role: "assistant", text, time: e.time });
    }
  }
  return out;
}