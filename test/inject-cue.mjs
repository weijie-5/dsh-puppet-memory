// v0.39（B-94）：接线测试——假宿主真跑 apply + pre-step，确认
//   ① 开着 cueprompt 时，命中重要库会注入 <puppet_cue>（不是贴资料，是一句提示）
//   ② 下一回合你说「对」→ 计成功、写回忆事件；说「不对」→ 记失败并写记错表
//   ③ 关着开关 → 一个字都不注入
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cue-inject-"));
process.env.DSH_MEMORY_DIR = TMP;
for (const d of ["behavior", "behavior/diary", "deep", "deep/workbook", "array", "state"]) {
  fs.mkdirSync(path.join(TMP, d), { recursive: true });
}
const J = (o) => JSON.stringify(o);
const write = (rel, lines) => fs.writeFileSync(path.join(TMP, rel), lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
const readJsonl = (rel) => {
  const p = path.join(TMP, rel);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
};

write("config.json", [
  J({
    enabled: true,
    backup: { enabled: false },
    inject: { maxChars: 2000, mode: "first-step" },
    cueprompt: { enabled: true, maxCandidates: 5 },
  }),
]);
write("behavior/persona.md", ["# 人设", "- 称呼：雪风"]);
write("behavior/relations.jsonl", [J({ kind: "relation", ts: new Date().toISOString(), keyword: "邮件", meaning: "他的邮件被批过两次", hash: "aaaa1111bbbb2222" })]);
write("deep/important.jsonl", [
  J({ id: "imp-1", topic: "邮件被批两次", refs: ["aaaa1111bbbb2222"], evidence: "10-21 他说邮件被批了两次", count: 1, fails: 0, state: "active" }),
]);

const mod = await import(new URL("../index.js", import.meta.url).href);

let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `（${extra}）` : ""));
}

// 假 llm：createLlmCaller 要 resolveCallConfig + prepareCall().stream()
const fakeLlm = {
  resolveCallConfig: async ({ provider, model, maxTokens }) => ({ provider, model, maxTokens }),
  prepareCall: async () => ({
    stream: async function* () {
      yield { type: "text-delta", text: '{"pick":1,"hint":"他之前说过邮件被批了两次","question":""}' };
      yield { type: "finish", reason: { kind: "stop" } };
    },
  }),
};

function makeCtx() {
  const tools = [];
  const handlers = new Map();
  return {
    handlers,
    toolList: tools,
    on(ev, fn) {
      if (!handlers.has(ev)) handlers.set(ev, []);
      handlers.get(ev).push(fn);
      return () => {};
    },
    tools: { register: (d) => tools.push(d) },
    effect(fn) {
      try {
        fn();
      } catch {
        /* 忽略 */
      }
    },
    inject() {},
    agentDefaultModel: { currentSelection: () => ({ provider: "fake", model: "fake-model" }) },
    get(name) {
      return name === "llm" ? fakeLlm : null;
    },
  };
}

try {
  const ctx = makeCtx();
  let applyErr = "";
  try {
    mod.apply(ctx);
  } catch (err) {
    applyErr = err?.message || String(err);
  }
  ok("apply() 不抛异常", !applyErr, applyErr);
  ok("memory_cue 工具已注册", ctx.toolList.some((t) => t.name === "memory_cue"));

  const preStep = ctx.handlers.get("agent/pre-step")?.[0];
  ok("pre-step 注册上了", typeof preStep === "function");

  const agent = { session: { header: { id: "cue-s1", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const run = async (userText) => {
    const messages = [{ role: "user", content: [{ type: "text", text: userText }] }];
    const decision = await preStep({ agent }, async () => ({ kind: "enter", messages }));
    return (decision?.messages || [])
      .map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || "")))
      .join("\n");
  };

  // ---- 第一回合：命中重要库 → 注入 <puppet_cue>
  const first = await run("邮件那件事后来怎么样了");
  ok("注入里有 <puppet_cue>", first.includes("<puppet_cue>"), first.slice(0, 120));
  ok("提示是自然语言、不是资料块", first.includes("邮件被批了两次") && !first.includes("refs"), first.slice(-160));
  ok("没有把「重要」表原样倒出来", !first.includes("imp-1"));

  ok("cue 后待判回忆已落盘", fs.existsSync(path.join(TMP, "state", "cue-pending.json")), "state/cue-pending.json 不存在");

  // ---- 第二回合：你说「对」→ 计成功 + 写事件
  const confirm = await run("对，就是那次");
  const eventFiles = fs.existsSync(path.join(TMP, "deep", "recall-events"))
    ? fs.readdirSync(path.join(TMP, "deep", "recall-events")).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f))
    : [];
  const confirmedRows = eventFiles.flatMap((f) => readJsonl(path.join("deep", "recall-events", f)));
  ok("确认后写了回忆事件（按月分片）", confirmedRows.length >= 1, JSON.stringify(confirmedRows[0] || {}));
  ok("事件记的是成功", confirmedRows.some((e) => e.verdict === "confirmed"), JSON.stringify(confirmedRows.map((e) => e.verdict)));
  const imps = readJsonl("deep/important.jsonl");
  ok("成功次数 +1", Number(imps[0]?.count) === 2, JSON.stringify({ count: imps[0]?.count }));
  void confirm;

  // ---- 第三回合：说「不对」→ 记失败 + 写记错表
  await run("邮件那件事再说说");
  const deny = await run("不对，你记错了");
  void deny;
  const imps2 = readJsonl("deep/important.jsonl");
  ok("否认后失败次数 +1", Number(imps2[0]?.fails) >= 1, JSON.stringify({ fails: imps2[0]?.fails }));
  const mis = readJsonl("deep/misrecall.jsonl");
  ok("否认写进了记错表", mis.length >= 1, JSON.stringify(mis[0] || {}));

  ok("判定后待判回忆被清掉", !fs.existsSync(path.join(TMP, "state", "cue-pending.json")) || !Object.keys(JSON.parse(fs.readFileSync(path.join(TMP, "state", "cue-pending.json"), "utf8"))).includes("cue-s1"), "清理失败");

  // ---- ③④ 闭环：你说「不是这个」→ 本轮要摆出原文（或明说取不到），不能含糊过去
  const agent3 = { session: { header: { id: "cue-s3", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const run3 = async (userText) => {
    const messages = [{ role: "user", content: [{ type: "text", text: userText }] }];
    const decision = await preStep({ agent: agent3 }, async () => ({ kind: "enter", messages }));
    return (decision?.messages || [])
      .map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || "")))
      .join("\n");
  };
  const cueTurn = await run3("邮件那件事后来怎么样了");
  ok("第三会话：先取到回忆", cueTurn.includes("<puppet_cue>"), cueTurn.slice(0, 100));
  const objectedTurn = await run3("不是这个");
  ok("反对后注入 <puppet_verify>", objectedTurn.includes("<puppet_verify>"), objectedTurn.slice(0, 160));
  ok("verify 里有门牌说明", objectedTurn.includes("门牌："), objectedTurn.slice(0, 240));
  ok("取不到原文时明说、不许编", objectedTurn.includes("取不到") || objectedTurn.includes("位置未知"), objectedTurn.slice(0, 260));
  ok("verify 不给新的回忆提示（一回合只做一件事）", !objectedTurn.includes("<puppet_cue>"));
  const imps3 = readJsonl("deep/important.jsonl");
  ok("反对不算失败", Number(imps3[0]?.fails || 0) === 1, JSON.stringify({ fails: imps3[0]?.fails }));
  // 反对只在「这条来自重要库」时才可能挂到重要行上；这里候选来自常规库，所以看事件表
  const evDir = path.join(TMP, "deep", "recall-events");
  const evFiles = fs.existsSync(evDir) ? fs.readdirSync(evDir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)) : [];
  const evRows = evFiles.flatMap((f) => readJsonl(path.join("deep", "recall-events", f)));
  ok("反对记进了事件表", evRows.some((e) => e.verdict === "objected"), JSON.stringify(evRows.map((e) => e.verdict)));
  ok("反对没写进记错表", !readJsonl("deep/misrecall.jsonl").some((r) => r.hash === (evRows.find((e) => e.verdict === "objected") || {}).hash));

  // ---- 关掉开关 → 不注入
  fs.writeFileSync(
    path.join(TMP, "config.json"),
    J({ enabled: true, backup: { enabled: false }, inject: { maxChars: 2000, mode: "first-step" }, cueprompt: { enabled: false } }),
    "utf8",
  );
  const agent2 = { session: { header: { id: "cue-s2", cwd: "E:/tmp", origin: "web" }, snapshotEvents: () => [], events: [] }, ctx: { get: () => null } };
  const decision = await preStep({ agent: agent2 }, async () => ({ kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "邮件那件事" }] }] }));
  const text = (decision?.messages || []).map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : String(m.content || ""))).join("\n");
  ok("开关关着 → 不注入 <puppet_cue>", !text.includes("<puppet_cue>"), text.slice(0, 100));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`❌ inject-cue：${pass} 过，${fails.length} 失败`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ inject-cue：${pass} 项全过`);
