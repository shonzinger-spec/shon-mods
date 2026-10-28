#!/usr/bin/env node
// autorank-pane collector: follow-ups due, first touches queued, replies and leads, as JSON.
//
// Truth, as the repo keeps it (HANDOFF.md is authoritative; Airtable was never live):
//   logs/sent-*.json        every send (touch, date, subject, bounced)
//   logs/do-not-send.json   suppression, read with the repo's own createDoNotSendMatcher
//   src/outreach/sequence.js  nextTouch() + TOUCH_SCHEDULE, the cadence itself
//   logs/queued-*.json / carry-*.json   first touches waiting to go
//   HANDOFF.md "### Leads and conversations"   replies and live leads (prose)
//
// Usage: autorank_status.mjs [--repo ~/AutoRank] [--today YYYY-MM-DD] [--text]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const repo = (opt('--repo', join(homedir(), 'AutoRank'))).replace(/^~/, homedir())
const torontoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())
const today = opt('--today', torontoToday())
const DAY = 86400000
const MAX_GAP_DAYS = 10 // src/outreach/send-pack.js MAX_FOLLOW_UP_GAP_DAYS

const { nextTouch, TOUCH_SCHEDULE } = await import(pathToFileURL(join(repo, 'src/outreach/sequence.js')).href)
const { createDoNotSendMatcher } = await import(pathToFileURL(join(repo, 'src/outreach/suppression.js')).href)

const readJson = p => JSON.parse(readFileSync(p, 'utf8'))
const asList = d => (Array.isArray(d) ? d : d && typeof d === 'object' ? Object.values(d).find(Array.isArray) ?? [] : [])
const norm = e => String(e ?? '').trim().toLowerCase()
// A full timestamp where one was logged; some rows carry only a clock time in sentAt.
const DATE_RE = /^\d{4}-\d{2}-\d{2}/
const whenOf = r => {
  for (const v of [r.sentAtUtc, r.sentAt]) if (typeof v === 'string' && DATE_RE.test(v)) return v
  if (typeof r.date === 'string' && DATE_RE.test(r.date)) {
    const t = typeof r.sentAt === 'string' && /^\d{1,2}:\d{2}/.test(r.sentAt) ? r.sentAt.slice(0, 5).padStart(5, '0') : '12:00'
    return `${r.date.slice(0, 10)}T${t}:00-04:00`
  }
  return ''
}

const logs = join(repo, 'logs')
const files = readdirSync(logs)
const sentFiles = files.filter(f => /^sent-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()

// ---- every send, grouped by address ----
const byEmail = new Map()
for (const f of sentFiles) {
  for (const r of asList(readJson(join(logs, f)))) {
    if (!r || !r.email) continue
    const k = norm(r.email)
    if (!byEmail.has(k)) byEmail.set(k, [])
    byEmail.get(k).push(r)
  }
}

// ---- replies and leads: HANDOFF.md is authoritative ----
const handoff = existsSync(join(repo, 'HANDOFF.md')) ? readFileSync(join(repo, 'HANDOFF.md'), 'utf8') : ''
const clean = s => s.replace(/\*\*/g, '').replace(/`/g, '').trim()
const leads = []
const sec = handoff.split('\n')
const at = sec.findIndex(l => /^#{2,4}\s+Leads and conversations/i.test(l))
if (at >= 0) {
  for (let i = at + 1; i < sec.length && !/^#{1,4}\s/.test(sec[i]); i++) {
    if (/^\s*-\s+/.test(sec[i])) leads.push(clean(sec[i].replace(/^\s*-\s+/, '')).slice(0, 260))
  }
}
const leadText = leads.join(' ').toLowerCase()
// A prospect HANDOFF talks about by name is a conversation, not a sequence touch.
const inConversation = name => {
  const words = String(name ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2)
  return words.length === 2 && leadText.includes(words.join(' '))
}

const dns = createDoNotSendMatcher(existsSync(join(logs, 'do-not-send.json')) ? readJson(join(logs, 'do-not-send.json')) : [], { today })
const now = new Date(`${today}T23:59:00-04:00`)

const followups = []
const totals = { prospects: byEmail.size, sends: 0, exhausted: 0, bounced: 0, suppressed: 0, waiting: 0, in_conversation: 0 }
for (const [email, recs] of byEmail) {
  recs.sort((a, b) => whenOf(a).localeCompare(whenOf(b)))
  totals.sends += recs.length
  const touches = recs.map(r => Number(r.touch)).filter(n => Number.isFinite(n) && n > 0)
  const touchesSent = touches.length ? Math.max(...touches) : 0
  const lastTouch = [...recs].reverse().find(r => Number(r.touch) === touchesSent) ?? recs[recs.length - 1]
  const lastAny = recs[recs.length - 1]
  const withSubject = [...recs].reverse().find(r => r.subject)
  if (recs.some(r => r.bounced)) {
    totals.bounced++
    continue
  }
  const block = dns.match({ email, website: lastAny.website })
  if (block) {
    totals.suppressed++
    continue
  }
  if (recs.some(r => typeof r.holdUntil === 'string' && r.holdUntil > today)) {
    totals.waiting++
    continue
  }
  if (inConversation(lastAny.name)) {
    totals.in_conversation++
    continue
  }
  const lastTouchAt = whenOf(lastTouch)
  const nt = nextTouch({ touchesSent, lastTouchAt, status: '' }, { now })
  if (nt.exhausted) {
    totals.exhausted++
    continue
  }
  if (!nt.due) {
    totals.waiting++
    continue
  }
  const sinceDays = Math.floor((now - new Date(lastTouchAt)) / DAY)
  const waitDays = TOUCH_SCHEDULE[touchesSent] ?? 0
  followups.push({
    name: lastAny.name || email.split('@')[1],
    metro: lastAny.metro || '',
    touch: nt.touch,
    last_date: String(lastTouchAt).slice(0, 10),
    last_subject: withSubject ? withSubject.subject : '',
    subject_is_older: Boolean(withSubject && withSubject !== lastTouch),
    last_any_date: String(whenOf(lastAny)).slice(0, 10),
    days_since: sinceDays,
    overdue_days: Math.max(0, sinceDays - waitDays),
    gap_flag: sinceDays > MAX_GAP_DAYS,
  })
}
followups.sort((a, b) => a.touch - b.touch || b.overdue_days - a.overdue_days || a.name.localeCompare(b.name))

// ---- first touches waiting: newest queued/carry file, minus anyone already sent or blocked ----
const queueFiles = files.filter(f => /^(queued|carry)-\d{4}-\d{2}-\d{2}.*\.json$/.test(f))
  .sort((a, b) => (a.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '').localeCompare(b.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''))
const qf = queueFiles[queueFiles.length - 1]
let first = { source: null, file_date: null, count: 0, names: [] }
if (qf) {
  const q = asList(readJson(join(logs, qf))).filter(r => r && r.email && !byEmail.has(norm(r.email)) && !dns.match({ email: r.email, website: r.website }))
  first = { source: `logs/${qf}`, file_date: qf.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, count: q.length, names: q.slice(0, 12).map(r => `${r.name ?? r.email}${r.metro ? ` (${r.metro})` : ''}`) }
}

const gmail = [...handoff.matchAll(/Gmail (\d{4}-\d{2}-\d{2}):([^\n]*)/g)].map(m => ({ date: m[1], text: clean(m[2]) }))
  .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
const lastSend = sentFiles.length ? sentFiles[sentFiles.length - 1].slice(5, 15) : null

const out = { today, last_send_date: lastSend, followups, first_touches: first, leads, gmail_status: gmail, totals, repo }
if (args.includes('--text')) {
  console.log(`AutoRank ${today} · last send ${lastSend} · ${followups.length} follow-ups due · ${first.count} first touches queued`)
  for (const f of followups.slice(0, 15)) console.log(`  T${f.touch} ${f.name} · last ${f.last_date} "${(f.last_subject || '').slice(0, 50)}" · overdue ${f.overdue_days}d${f.gap_flag ? ' GAP>10d' : ''}`)
  console.log(`first touches (${first.source}): ${first.names.slice(0, 5).join(', ')}`)
  for (const l of leads) console.log(`  lead: ${l.slice(0, 120)}`)
  console.log(`gmail: ${gmail ? `${gmail.date} ${gmail.text}` : 'none'}`)
  console.log(JSON.stringify(totals))
} else {
  console.log(JSON.stringify(out))
}
