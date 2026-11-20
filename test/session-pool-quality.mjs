// 回归：49 条被人判死的候选，新规则必须一条都不再收（2026-11-20 S3 判据）
import fs from 'node:fs'
import path from 'node:path'
import { classifySentence } from '../session-digest.js'

const HOME = process.env.USERPROFILE || process.env.HOME || ''
const file = path.join(HOME, '.dsh', 'memory', 'deep', 'session-candidates.jsonl')
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter((x) => x && x.status === 'dropped')

const still = rows.filter((r) => classifySentence(r.text))
console.log('被否候选 ' + rows.length + ' 条，新规则仍会收 ' + still.length + ' 条')
for (const r of still.slice(0, 5)) console.log('  ✗ ' + String(r.text).slice(0, 50))
process.exit(still.length === 0 ? 0 : 1)
