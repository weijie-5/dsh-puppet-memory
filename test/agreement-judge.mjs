// 活日记小模型整理：判约定 / 荒诞（2026-11-20 丹阳：「有小模型用小模型处理，没有才是你」）
import { buildPrompt, parseVerdicts, judgeInbox } from '../agreement-judge.js'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  x ' + n) } }

ok('prompt 带进句子', buildPrompt([{ text: '明天十二点吃千斤顶' }]).includes('明天十二点吃千斤顶'))
ok('prompt 要求只输出 JSON', buildPrompt([{ text: 'x' }]).includes('只输出 JSON 数组'))

const raw = '好的，结果如下：\n[{"i":0,"keep":false,"absurd":true,"event":"","content":"","state":"","why":"吃千斤顶"},{"i":1,"keep":true,"absurd":false,"event":"复查","content":"下周三下午三点去医院复查","state":"11-25 15:00","why":"有明确时间"}]\n以上。'
const v = parseVerdicts(raw, 2)
ok('解析出两条', Array.isArray(v) && v.length === 2)
ok('荒诞那条 keep=false', v[0].keep === false && v[0].absurd === true)
ok('约定那条带事件与状态', v[1].keep === true && v[1].event === '复查' && v[1].state === '11-25 15:00')
ok('解析不了就返回 null', parseVerdicts('没有数组', 1) === null)
ok('数组里缺项留 null 槽位', parseVerdicts('[{"i":0,"keep":true}]', 2)[1] === null)

const empty = await judgeInbox([])
ok('空输入 available=true 且没判', empty.available === true && empty.judged === 0)

const noEndpoint = await judgeInbox([{ text: '明天十二点吃千斤顶' }], { endpoint: '' })
ok('没配端点 = 不可用（fail-open）', noEndpoint.available === false && noEndpoint.verdicts.length === 0)

console.log('活日记小模型整理：' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''))
process.exit(fail ? 1 : 0)
