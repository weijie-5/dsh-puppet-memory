// 约定书签：主=事件、次=约定+状态；记录发生在自检/整理，不自动写（2026-11-20 丹阳定）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLorebook } from '../lorebook.js'
import { extractAgreements, keywordsOf, scanTurn, summarize, promote, hitsKnown, collectNonWork, renderInbox, classifyTurn, dangerHint, absurdHint, parseWhen } from '../agreement-watch.js'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  x ' + n) } }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-'))
const lore = createLorebook({ dir })
const count = () => lore.list({ includeDisabled: true }).length

ok('非约定句 checked=0', extractAgreements('今天天气不错，随便聊聊').length === 0)

const r1 = scanTurn(lore, '以后发版前必须先跑 preflight 再打标签')
ok('只出候选不落书签', r1.candidates.length === 1 && count() === 0)
ok('候选带关键词', String(r1.candidates[0].keywords).length > 0)

// 整理时落成书签：主=事件，次=内容+状态
const p1 = promote(lore, { name: '发版前体检', content: '先跑 preflight 再打标签', keywords: '发版,preflight', state: '已固定在发布脚本里' })
ok('promote 落一条', p1.ok && count() === 1)
ok('书签带状态', lore.list()[0].state === '已固定在发布脚本里')

const r2 = scanTurn(lore, '以后发版前必须先跑 preflight 再打标签')
ok('再扫同句是 dup', r2.dup.length === 1 && r2.candidates.length === 0)
ok('条数没变', count() === 1)

const r3 = scanTurn(lore, '以后发版之前必须先把 preflight 跑完再打标签')
ok('换说法仍 dup', r3.dup.length === 1 && count() === 1)

// 同一事件换状态：只更新，不新开
promote(lore, { name: '发版前体检', content: '先跑 preflight 再打标签', state: '改为 preflight+check 两步' })
ok('同事件不重复开条', count() === 1)
ok('状态被更新', lore.list()[0].state === '改为 preflight+check 两步')

const r4 = scanTurn(lore, '下次别在群里直接发原图')
ok('无关约定进候选', r4.candidates.length === 1 && count() === 1)

const known = [
  { text: '发版纪律：攒批 1–2 周一批，只有严重失误单独发', source: '规则册' },
  { text: '关心用祈使句，不说我在乎', source: '核心卡' },
]
const r5 = scanTurn(lore, '以后发版纪律还是攒批，别单独发', { known })
ok('黑名单命中不进候选', r5.candidates.length === 0)
ok('黑名单带出处', r5.skipped.length === 1 && r5.skipped[0].hit === '规则册')
ok('黑名单不误伤', scanTurn(lore, '下次记得先截屏再动手', { known }).skipped.length === 0)
ok('hitsKnown 4字判定', hitsKnown('以后发版纪律还是攒批', '发版纪律：攒批 1–2 周') === true)

const s2 = summarize({ candidates: [{ text: 'abc' }], dup: [{ name: 'b', score: 0.8 }], skipped: [{ hit: '规则册' }] })
ok('summarize 三类齐', s2.includes('待整理') && s2.includes('相似') && s2.includes('别处已记'))


// 9) 非工作原文：干活的话排掉，生活的话留下（压缩后归档到文件，不翻原文）
ok('工作句被滤掉', collectNonWork('这个插件报错了，看下日志和路径').length === 0)
ok('生活句保留', collectNonWork('明天想早点睡，别再熬夜了').length === 1)
ok('同句去重', collectNonWork('明天想早点睡，别熬了。明天想早点睡，别熬了').length === 1)
const box = renderInbox([{ at: '2026-11-20T10:00:00Z', text: 'a 句' }, { at: '2026-11-20T11:00:00Z', text: 'b 句' }])
ok('renderInbox 按天分组', box.includes('# 非工作原文') && box.includes('- a 句') && box.includes('- b 句'))


// 10) 工具/技能调动算工作；愉悦工具不算（2026-11-20 丹阳定）
ok('无工具 = 生活', classifyTurn([]) === 'leisure')
ok('调了 skill = 工作', classifyTurn(['skill']) === 'work')
ok('调了 bash = 工作', classifyTurn(['bash']) === 'work')
ok('只看视频 = 生活', classifyTurn(['video_index', 'bili_subtitle']) === 'leisure')
ok('视频+脚本 = 工作', classifyTurn(['video_index', 'bash']) === 'work')
ok('排除自己的回顾总结', collectNonWork('上次我们说到那个插件要发版，总结一下').length === 0)

// 11) A：SIGNAL 扩到事件/时间类（2026-11-20 丹阳：「A 先做了」）
ok('事件类约定能抽到', extractAgreements('下周三下午三点去医院复查').length === 1)
ok('期限类约定能抽到', extractAgreements('周五之前把文档写完').length === 1)
ok('闲聊不被抽', extractAgreements('今天天气不错，随便聊聊').length === 0)
ok('元指令不被抽', extractAgreements('我先试一下，我先发一堆消息，再压缩一次').length === 0)

// 12) B：荒诞线阻拦 + 黑名单（丹阳：「这类记录应该也有荒诞线阻拦」「不对的你黑名单，下次就不会触发了」）
const absurd1 = scanTurn(lore, '明天十二点吃千斤顶')
ok('荒诞线拦下吃千斤顶', absurd1.candidates.length === 0 && absurd1.absurd.length === 1)
const absurd2 = scanTurn(lore, '这个意大利面就应该拌42号混凝土')
ok('荒诞线拦下胡说梗', absurd2.absurd.length === 1)
const normal1 = scanTurn(lore, '明天十二点吃饭')
ok('荒诞线不误伤正常约定', normal1.candidates.length === 1 && normal1.absurd.length === 0)
const blk1 = scanTurn(lore, '明天十二点吃千斤顶', { rejected: ['明天十二点吃千斤顶'] })
ok('黑名单跳过不再进候选', blk1.candidates.length === 0 && blk1.rejected.length === 1)
ok('summarize 报荒诞', summarize(absurd1).includes('荒诞线拦下'))
ok('summarize 报黑名单', summarize(blk1).includes('黑名单跳过'))

// 14) 毒物类必须拦（2026-11-20 丹阳用「明天十二点吃老鼠药」测出漏洞）
const poison = scanTurn(lore, '明天十二点吃老鼠药')
ok('危险线拦下毒物', poison.candidates.length === 0 && poison.danger.length === 1)
const poison2 = scanTurn(lore, '明天吃敌敌畏拌饭')
ok('毒物当食物也拦', poison2.candidates.length === 0 && poison2.danger.length === 1)
const dose = scanTurn(lore, '明天喝一整瓶酱油')
ok('荒谬剂量拦下', dose.candidates.length === 0 && dose.danger.length === 1)
// 注意：extractAgreements 的 minLen=6，太短的句子抽不到，测不成——用 8 字句
const normal2 = scanTurn(lore, '后天早上记得吃药')
ok('正常吃药不误伤', normal2.candidates.length === 1 && normal2.absurd.length === 0)

// 15) 危险线独立于荒诞线（2026-11-20 丹阳：「危险的问题会在开玩笑的时候出现」）
ok('毒物走危险线', dangerHint('明天十二点吃老鼠药') !== null)
ok('自伤走危险线', dangerHint('想跳楼') !== null)
ok('胡说梗不算危险', dangerHint('意大利面拌42号混凝土') === null && absurdHint('意大利面拌42号混凝土') !== null)
const dz = scanTurn(lore, '明天十二点吃老鼠药')
ok('危险命中进 danger 桶不进候选', dz.danger.length === 1 && dz.candidates.length === 0)
ok('summarize 报危险线', summarize(dz).includes('危险线拦下'))

// 16) 时间解析（转幕表用）
const base = Date.parse('2026-11-20T20:00:00+08:00')
ok('明天十二点日期', parseWhen('明天十二点', base)?.date === '2026-11-21')
ok('明天十二点时刻', parseWhen('明天十二点', base)?.at === '2026-11-21 12:00')
ok('下周三', parseWhen('下周三', base)?.date === '2026-11-25')
ok('本周五就是今天', parseWhen('周五', base)?.date === '2026-11-20')
ok('11月30日', parseWhen('11月30日', base)?.date === '2026-11-30')
ok('解析不出返回 null', parseWhen('随时', base) === null)

// 13) 小模型整理落书签时不给 keywords，promote 要自己补（lorebook.add 缺词会拒）
const lore2 = createLorebook({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'lore2-')) })
const prom = promote(lore2, { name: '复查', content: '下周三下午三点去医院复查', state: '11-25 15:00' })
ok('promote 不给 keywords 也能落', prom && prom.ok !== false && lore2.list().length === 1)
const prom2 = promote(lore2, { name: '复查', content: '下周三下午三点去医院复查', state: '改期到周四' })
ok('同一事件换状态只更新', prom2 && prom2.ok !== false && lore2.list().length === 1)

console.log('约定书签：' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''))
process.exit(fail ? 1 : 0)
