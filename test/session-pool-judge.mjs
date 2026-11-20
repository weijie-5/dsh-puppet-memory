// 候选池二次判定：本地不可用不改数据；可用时按判定标 dropped（2026-11-20 S3）
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { judgePending, parseVerdicts, buildPrompt } from '../session-pool-judge.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  x ' + name) } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-'))
const file = path.join(tmp, 'pool.jsonl')
const seed = () => {
  const rows = [
    { key: 'a1', kind: '约定', text: '下次发现是小黑盒的链接直接提醒我就行', status: 'pending', ts: new Date().toISOString() },
    { key: 'a2', kind: '约定', text: '明天再发，稿子先记住', status: 'pending', ts: new Date().toISOString() },
  ]
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

seed()
const r1 = await judgePending(file, { endpoint: '' })
ok('无端点 available=false', r1.available === false)
ok('无端点仍是 pending', fs.readFileSync(file, 'utf8').includes('"status":"pending"'))

seed()
const r2 = await judgePending(file, { endpoint: 'http://127.0.0.1:1', probeMs: 300 })
ok('探活失败 available=false', r2.available === false)
ok('探活失败不标 dropped', !fs.readFileSync(file, 'utf8').includes('"status":"dropped"'))

const srv = http.createServer((req, res) => {
  if (req.url.endsWith('/v1/models')) { res.writeHead(200); return res.end('{}') }
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    const payload = { choices: [{ message: { content: '[{"i":0,"keep":true,"why":"长期偏好"},{"i":1,"keep":false,"why":"一次性"}]' } }] }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  })
})
await new Promise((res) => srv.listen(0, '127.0.0.1', res))
const port = srv.address().port
seed()
const r3 = await judgePending(file, { endpoint: 'http://127.0.0.1:' + port, probeMs: 800 })
const after = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
ok('判了 2 条', r3.judged === 2)
ok('丢 1 条', r3.dropped === 1)
ok('保留的仍 pending', after.find((x) => x.key === 'a1').status === 'pending')
ok('丢弃的带 droppedBy', after.find((x) => x.key === 'a2').droppedBy === 'pool-judge')
srv.close()

ok('parse 容忍解释', JSON.stringify(parseVerdicts('好的：[{"i":0,"keep":false}]', 1)) === JSON.stringify([{ keep: false, why: '' }]))
ok('parse 乱码返回 null', parseVerdicts('看不懂', 2) === null)
ok('prompt 带序号', buildPrompt([{ text: 'x' }]).includes('0. x'))

console.log('候选池判定：' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''))
process.exit(fail ? 1 : 0)
