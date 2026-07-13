/* JARVIS HUD client. Vanilla JS, no build step. */
'use strict'

const $ = s => document.querySelector(s)
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
const WORK_PARAM = new URLSearchParams(location.search).get('work') === '1'

let DATA = null
let audioCtx = null
let analyser = null
let soundOn = true

// ---------- utilities ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function fmtDate(d) {
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()
}

function daysUntil(iso) {
  if (!iso) return null
  const due = new Date(iso)
  return (due - Date.now()) / 86400000
}

function dueLabel(iso) {
  const d = daysUntil(iso)
  if (d === null) return { text: 'no date', cls: '' }
  if (d < 0) return { text: 'OVERDUE', cls: 'critical' }
  if (d < 1) return { text: 'due today', cls: 'critical' }
  if (d < 3) return { text: `${Math.ceil(d)}d out`, cls: 'soon' }
  return { text: new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }), cls: '' }
}

async function typewrite(el, text, speed = 14) {
  if (REDUCED) { el.textContent = text; return }
  el.textContent = ''
  for (let i = 0; i < text.length; i++) {
    el.textContent += text[i]
    if (i % 2 === 0) await new Promise(r => setTimeout(r, speed))
  }
}

// ---------- clock + day cycle ----------

function tickClock() {
  const now = new Date()
  $('#clock-time').textContent = now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
  $('#clock-date').textContent = fmtDate(now) + ' SYDNEY'
  const start = 6, end = 23
  const h = now.getHours() + now.getMinutes() / 60
  const pct = Math.min(1, Math.max(0, (h - start) / (end - start)))
  const ring = $('#r-day')
  const C = 2 * Math.PI * 64
  ring.style.strokeDasharray = C
  ring.style.strokeDashoffset = C * (1 - pct)
  $('#day-cycle').textContent = Math.round(pct * 100) + '%'
}
setInterval(tickClock, 30000)

// reactor tick marks
;(function ticks() {
  const g = $('#r-ticks')
  let html = ''
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2
    const r1 = 96, r2 = i % 5 === 0 ? 88 : 92
    html += `<line x1="${110 + r1 * Math.cos(a)}" y1="${110 + r1 * Math.sin(a)}" x2="${110 + r2 * Math.cos(a)}" y2="${110 + r2 * Math.sin(a)}"/>`
  }
  g.innerHTML = html
})()

// ---------- particles ----------

function startParticles() {
  if (REDUCED) return
  const canvas = $('#particles')
  const ctx = canvas.getContext('2d')
  let W, H, pts
  function resize() {
    W = canvas.width = innerWidth
    H = canvas.height = innerHeight
    const n = Math.min(80, Math.floor(W * H / 26000))
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
    }))
  }
  resize()
  addEventListener('resize', resize)
  function frame() {
    if (document.hidden) { requestAnimationFrame(frame); return }
    ctx.clearRect(0, 0, W, H)
    for (const p of pts) {
      p.x = (p.x + p.vx + W) % W
      p.y = (p.y + p.vy + H) % H
      ctx.fillStyle = 'rgba(23,212,254,0.5)'
      ctx.fillRect(p.x, p.y, 1.6, 1.6)
    }
    ctx.strokeStyle = 'rgba(23,212,254,0.07)'
    ctx.lineWidth = 1
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y
        if (dx * dx + dy * dy < 12100) {
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke()
        }
      }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

// ---------- data ----------

async function fetchData() {
  const url = '/api/data' + (WORK_PARAM ? '?work=1' : '')
  const res = await fetch(url)
  DATA = await res.json()
  document.body.dataset.mode = DATA.mode === 'work' ? 'work' : 'full'
  renderAll()
}

function connectSSE() {
  const es = new EventSource('/api/stream')
  es.onmessage = e => { if (e.data === 'update') fetchData() }
  es.onerror = () => { es.close(); setTimeout(connectSSE, 5000) }
}

// ---------- renderers ----------

function renderAll() {
  renderRail()
  renderBriefing()
  renderCore()
  renderComms()
  renderCareer()
  renderUni()
  renderStudy()
  renderFitness()
  renderWork()
  renderAgents()
  tickClock()
}

function freshness() {
  const stamps = [DATA.briefing?.generatedAt, DATA.uni?.updatedAt, DATA.fitness?.updatedAt, DATA.work?.updatedAt, DATA.emails?.updatedAt]
    .filter(Boolean).map(s => new Date(s))
  if (!stamps.length) return 'NO FEED'
  const newest = new Date(Math.max(...stamps))
  const age = (Date.now() - newest) / 3600000
  if (age < 1) return 'SYNCED ' + newest.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (age < 24) return Math.round(age) + 'H OLD'
  return Math.round(age / 24) + 'D STALE'
}

function renderRail() {
  $('#freshness').textContent = freshness()
  const w = DATA.weather
  const wEl = $('#rail-weather')
  if (w?.current?.tempC != null) {
    const rain = w.today?.rainPct
    wEl.textContent = `SYD ${Math.round(w.current.tempC)}° ${(w.current.label || '').toUpperCase()}` +
      (rain != null && rain >= 20 ? ` · RAIN ${rain}%` : '')
    wEl.hidden = false
  } else {
    wEl.hidden = true
  }
  const pipes = DATA.system?.pipelines || []
  $('#rail-pipelines').innerHTML = pipes.map(p => {
    const cls = p.status === 'ok' ? 'ok' : p.status === 'error' ? 'err' : 'warn'
    return `<span class="led ${cls}" title="${esc(p.name)}: ${esc(p.status)}"></span>`
  }).join('')
  $('#stealth-dot').hidden = document.body.dataset.mode !== 'work'
}

function renderBriefing() {
  const b = DATA.briefing
  const head = $('#briefing-headline')
  const feed = $('#briefing-feed')
  $('#briefing-date').textContent = b?.date || ''
  if (!b) {
    head.textContent = 'No briefing on file.'
    feed.innerHTML = '<p class="empty">The morning run has not produced a briefing yet. It lands at 07:30 daily.</p>'
    return
  }
  const headKey = (b.generatedAt || '') + '|' + (DATA.mode || 'full')
  if (head.dataset.done !== headKey) {
    head.dataset.done = headKey
    typewrite(head, b.headline || '')
  }
  const runBtn = $('#run-briefing')
  if (runBtn) {
    const running = !!DATA.dailyJob?.running
    runBtn.disabled = running
    runBtn.textContent = running ? 'RUNNING' : 'RUN NOW'
  }
  const pcls = p => (p === 'high' ? 'p-high' : p === 'medium' ? 'p-med' : '')
  const overnight = DATA.evolution?.changed && DATA.evolution.summary
    ? `<div class="overnight">WHILE YOU SLEPT: ${esc(DATA.evolution.summary)}</div>`
    : ''
  const actionRow = s => {
    const btns = (s.actions || []).map(a => {
      if (a.url) return `<button class="act-btn" data-url="${esc(a.url)}">${esc(a.label || 'OPEN')} &#8599;</button>`
      if (a.draft) return `<button class="act-btn" data-draft="${esc(a.draft)}">${esc(a.label || 'VIEW DRAFT')}</button>`
      return ''
    }).join('')
    return btns ? `<div class="feed-actions">${btns}</div>` : ''
  }
  feed.innerHTML = ((b.sections || []).map(s => `
    <div class="feed-item ${pcls(s.priority)}">
      <div class="feed-rail"></div>
      <div>
        <div class="feed-title">${esc(s.title)}<span class="mod">${esc(s.module)}</span>${s.id ? `<button class="feed-dismiss" data-dismiss="${esc(s.id)}" title="Clear from today's feed">&times;</button>` : ''}</div>
        <div class="feed-body">${esc(s.body)}</div>
        ${actionRow(s)}
      </div>
    </div>`).join('') || '<p class="empty">Nothing needs your attention. Suspicious, but pleasant.</p>') + overnight
  renderProposals()
}

function renderProposals() {
  const box = $('#proposals')
  const open = (DATA.proposals || []).filter(p => !p.status)
  box.innerHTML = open.map(p => `
    <div class="proposal">
      <div class="prop-title">PROPOSAL: ${esc(p.title)}</div>
      <div class="prop-sum">${esc(p.summary || '')}</div>
      <div class="feed-actions">
        <button class="act-btn yes" data-prop="${esc(p.id)}" data-dec="accept">YES, BAKE IT IN</button>
        <button class="act-btn" data-prop="${esc(p.id)}" data-dec="later">LATER</button>
      </div>
    </div>`).join('')
}

// The Mac the server runs on opens tabs itself; a phone on the tailnet
// opens them locally instead. serverOnly suppresses remote fallback so the
// morning auto-open never sprays tabs on a machine you are not in front of.
function openTarget(url, serverOnly) {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname)
  if (local) {
    fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }).catch(() => {})
  } else if (!serverOnly) {
    window.open(url, '_blank', 'noopener')
  }
}

function autoOpenActions() {
  if (document.body.dataset.mode === 'work') return
  const acts = (DATA?.briefing?.sections || []).flatMap(s => s.actions || []).filter(a => a.autoOpen && a.url)
  for (const a of acts) openTarget(a.url, true)
}

async function showDraft(name) {
  const panel = $('#answer'), body = $('#answer-body')
  panel.hidden = false
  body.textContent = 'Fetching draft...'
  try {
    const j = await (await fetch('/api/draft?file=' + encodeURIComponent(name))).json()
    body.innerHTML = `<pre class="draft-pre">${esc(j.text || j.error || 'No draft.')}</pre>`
  } catch {
    body.textContent = 'Draft unavailable.'
  }
}

document.addEventListener('click', async e => {
  const dis = e.target.closest('.feed-dismiss')
  if (dis) {
    dis.disabled = true
    try {
      await fetch('/api/dismiss', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: dis.dataset.dismiss }),
      })
      fetchData()
    } catch { dis.disabled = false }
    return
  }
  const tick = e.target.closest('.todo-tick')
  if (tick) {
    tick.disabled = true
    const isInbox = !!tick.dataset.inbox
    const isUni = !!tick.dataset.uni
    try {
      await fetch(isInbox ? '/api/capture' : isUni ? '/api/uni-done' : '/api/todo', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: tick.dataset.inbox || tick.dataset.uni || tick.dataset.todo,
          done: !tick.dataset.undone, // a ticked row's button restores instead
        }),
      })
      fetchData()
    } catch { tick.disabled = false }
    return
  }
  const t = e.target.closest('.act-btn')
  if (!t) return
  if (t.dataset.url) openTarget(t.dataset.url)
  else if (t.dataset.guide) openGuide(t.dataset.guide)
  else if (t.dataset.copy) {
    try {
      await navigator.clipboard.writeText(t.dataset.copy)
      t.textContent = 'COPIED'
      setTimeout(() => { t.textContent = 'COPY' }, 1200)
    } catch { t.textContent = 'SELECT IT' }
  }
  else if (t.dataset.draft) showDraft(t.dataset.draft)
  else if (t.dataset.doc) showDoc(t.dataset.doc)
  else if (t.dataset.prop) {
    t.disabled = true
    try {
      const r = await fetch('/api/proposal', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: t.dataset.prop, decision: t.dataset.dec }),
      })
      if (r.ok && t.dataset.dec === 'accept') speak('Done. It is in the daily plan from tomorrow, sir.')
      fetchData()
    } catch { t.disabled = false }
  }
})

function renderCore() {
  const c = DATA.career, u = DATA.uni, st = DATA.study, f = DATA.fitness
  const stats = []
  if (c?.stats) stats.push([c.stats.appsSent, 'apps sent'], [c.stats.dsaStreak, 'dsa streak'])
  if (st?.queue) stats.push([st.queue.length, 'reviews due'])
  if (u?.assignments) stats.push([u.assignments.filter(a => a.status !== 'done').length, 'assignments'])
  if (f?.weight?.currentKg) stats.push([f.weight.currentKg + 'kg', 'weight'])
  $('#core-stats').innerHTML = stats.slice(0, 6).map(([v, l]) => `<div class="core-stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')
  renderCalendar()
}

function renderCalendar() {
  const box = $('#core-cal')
  const c = DATA.calendar // absent entirely in work mode
  if (!c || document.body.dataset.mode === 'work') { box.innerHTML = ''; return }
  if (c.status !== 'ok') {
    box.innerHTML = c.setupNote ? `<div class="setup">${esc(c.setupNote)}</div>` : ''
    return
  }
  const now = Date.now()
  const upcoming = (c.events || [])
    .filter(e => !e.allDay && new Date(e.end).getTime() > now)
    .slice(0, 4)
  if (!upcoming.length) { box.innerHTML = '<p class="empty">Calendar clear for the next two days.</p>'; return }
  const label = e => {
    const d = new Date(e.start)
    const time = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
    const today = new Date().toDateString() === d.toDateString()
    return (today ? '' : 'TMRW ') + time
  }
  box.innerHTML = upcoming.map(e => `
    <div class="list-line">
      <span class="l">${esc(e.title)}</span>
      <span class="r">${esc(label(e))}</span>
    </div>`).join('')
}

function renderComms() {
  const e = DATA.emails
  const box = $('#comms-accounts')
  if (!e?.accounts?.length) {
    box.innerHTML = '<p class="empty">No mail accounts wired in yet.</p>'
  } else {
    box.innerHTML = e.accounts.map(a => `
      <div class="acct ${a.connected ? '' : 'off'}">
        <span class="acct-name">${esc(a.label || a.address)}</span>
        <span class="acct-count">${a.connected ? esc(a.unread ?? '0') : 'OFFLINE'}</span>
        ${(a.topThreads || []).slice(0, 2).map(t => `<span class="acct-sub">${esc(t.from)}: ${esc(t.summary || t.subject)}</span>`).join('')}
      </div>`).join('')
  }
  const connected = (e?.accounts || []).filter(a => a.connected).length
  const chip = $('#comms-chip')
  chip.textContent = `${connected}/${(e?.accounts || []).length || 0} LIVE`
  chip.className = 'chip ' + (connected ? 'ok' : 'warn')
  const pipes = DATA.system?.pipelines || []
  $('#system-lines').innerHTML = pipes.map(p => {
    const cls = p.status === 'ok' ? 'ok' : p.status === 'error' ? 'err' : 'warn'
    return `<div><span class="led ${cls}"></span><b>${esc(p.name)}</b> ${esc(p.note || p.status)}</div>`
  }).join('') || '<div>No pipeline telemetry.</div>'
  renderTrend()
  renderOps()
  renderInbox()
}

function renderInbox() {
  const box = $('#inbox-box')
  const items = DATA.inbox // absent entirely in work mode
  if (!items || !items.length) { box.innerHTML = ''; return }
  const stamp = at => new Date(at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  box.innerHTML = `
    <header class="panel-head sub"><h2>Inbox</h2>
      <span class="chip warn">${items.length} CAPTURED</span>
    </header>
    ${items.slice().reverse().map(i => `
      <div class="todo">
        <button class="todo-tick" data-inbox="${esc(i.id)}" title="Clear">&#10003;</button>
        <div class="todo-main">
          <div class="todo-title">${esc(i.text)}</div>
          <div class="todo-detail">captured ${stamp(i.at)} · the morning run will place it</div>
        </div>
      </div>`).join('')}`
}

function renderOps() {
  const box = $('#ops-todos')
  const todos = DATA.todos || []
  if (!todos.length) { box.innerHTML = ''; return }
  const open = todos.filter(t => !t.done)
  const doneCount = todos.length - open.length
  const pOrder = { high: 0, medium: 1, low: 2 }
  open.sort((a, b) => (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3))
  const row = t => `
    <div class="todo ${t.priority === 'high' ? 'p-high' : ''}">
      <button class="todo-tick" data-todo="${esc(t.id)}" title="Mark done">&#10003;</button>
      <div class="todo-main">
        <div class="todo-title">${esc(t.title)}</div>
        <div class="todo-detail">${esc(t.detail || '')}</div>
        <div class="feed-actions">
          ${t.guide ? `<button class="act-btn yes" data-guide="${esc(t.guide)}">&#9654; WALKTHROUGH</button>` : ''}
          ${t.doc ? `<button class="act-btn" data-doc="${esc(t.doc)}">DOC: ${esc(t.doc)}</button>` : ''}
          ${t.url ? `<button class="act-btn" data-url="${esc(t.url)}">OPEN &#8599;</button>` : ''}
        </div>
      </div>
    </div>`
  box.innerHTML = `
    <header class="panel-head sub"><h2>Operator tasks</h2>
      <span class="chip ${open.length ? 'warn' : 'ok'}">${open.length ? open.length + ' OPEN' : 'ALL CLEAR'}</span>
    </header>
    ${open.map(row).join('') || '<p class="empty">Nothing on you right now. The machines have the rest.</p>'}
    ${doneCount ? `<div class="todo-donecount">${doneCount} done and archived in the file</div>` : ''}`
}

async function showDoc(name) {
  const panel = $('#answer'), body = $('#answer-body')
  panel.hidden = false
  body.textContent = 'Fetching guide...'
  try {
    const j = await (await fetch('/api/doc?file=' + encodeURIComponent(name))).json()
    body.innerHTML = `<pre class="draft-pre">${esc(j.text || j.error || 'No doc.')}</pre>`
  } catch {
    body.textContent = 'Guide unavailable.'
  }
}

function renderTrend() {
  const box = $('#system-trend')
  const days = DATA.metrics || []
  if (days.length < 2) { box.innerHTML = ''; return }
  const cells = days.map(m => {
    const statuses = Object.values(m.pipelines || {})
    const worst = statuses.includes('error') ? 'err' : statuses.every(s => s === 'ok') ? 'ok' : 'warn'
    const bad = Object.entries(m.pipelines || {}).filter(([, s]) => s !== 'ok').map(([k, s]) => `${k}: ${s}`).join(', ')
    const day = new Date(m.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
    return `<i class="trend-cell ${worst}" title="${esc(day)}${bad ? ' | ' + esc(bad) : ' | all ok'}"></i>`
  }).join('')
  box.innerHTML = `<span class="trend-label">${days.length}D</span>${cells}`
}

function renderCareer() {
  const c = DATA.career
  if (document.body.dataset.mode === 'work') return
  const pickBox = $('#career-pick')
  if (!c) {
    pickBox.innerHTML = '<p class="empty">AIOS feed not found at ~/Coding/AIOS/data/aios-data.json.</p>'
    $('#career-chip').textContent = 'NO FEED'
    return
  }
  $('#career-chip').textContent = 'AIOS ' + (c.generatedAt || '')
  const p = c.today?.pick
  if (p) {
    const score = Number(p.score) || 0
    pickBox.innerHTML = `
      <div class="pick-score">
        <svg class="score-ring" viewBox="0 0 64 64">
          <circle class="track" cx="32" cy="32" r="28"/>
          <circle class="val" cx="32" cy="32" r="28" style="stroke-dashoffset:${176 - (176 * score) / 100}"/>
          <text x="32" y="38">${score}</text>
        </svg>
        <div>
          <div class="pick-co">${esc(p.company)}</div>
          <div class="pick-role">${esc(p.role)}</div>
          <div class="pick-meta">${esc(p.location || '')}${p.salary ? ' | ' + esc(p.salary) : ''}</div>
        </div>
      </div>
      <p class="pick-why">${esc(p.why || '')}</p>`
  } else {
    pickBox.innerHTML = '<p class="empty">No pick today.</p>'
  }
  const s = c.stats || {}
  $('#career-stats').innerHTML = [
    [s.appsSent ?? 0, 'apps sent'],
    [(s.responseRate ?? 0) + '%', 'responses'],
    [s.jobsSurfaced ?? 0, 'surfaced'],
  ].map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')
  $('#career-windows').innerHTML = (c.today?.windows || []).slice(0, 5).map(w =>
    `<div class="win"><span class="what">${esc(w.what)}</span><span class="when">${esc(w.when)}</span></div>`).join('')
    || '<p class="empty">No closing windows logged.</p>'
  renderWins()
}

function renderWins() {
  const box = $('#career-wins')
  const w = DATA.wins
  if (!w?.count) {
    box.innerHTML = '<header class="panel-head sub"><h2>Impact log</h2><span class="chip">0 ON RECORD</span></header>' +
      '<p class="empty">Log review ammunition as it happens: type win: followed by what you did.</p>'
    return
  }
  box.innerHTML = `
    <header class="panel-head sub"><h2>Impact log</h2><span class="chip ok">${w.count} ON RECORD</span></header>
    ${w.entries.slice(-4).reverse().map(e => `
      <div class="list-line">
        <span class="l">${esc(e.text)}</span>
        <span class="r">${new Date(e.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
      </div>`).join('')}`
}

function renderUni() {
  const u = DATA.uni
  const box = $('#uni-body')
  const chip = $('#uni-chip')
  if (!u) { box.innerHTML = '<p class="empty">No uni feed.</p>'; return }
  chip.textContent = u.semester || ''
  const subjects = (u.subjects || []).map(s => `<span class="subj">${esc(s.code || s)} ${esc(s.name || '')}</span>`).join('')
  const all = u.assignments || []
  const open = all.filter(a => a.status !== 'done')
  const cleared = all.filter(a => a.status === 'done')
  const rows = open.map(a => {
    const d = dueLabel(a.due)
    return `<div class="asg tickable">
      <button class="todo-tick" data-uni="${esc(a.id)}" title="Tick it off the board">&#10003;</button>
      <span class="asg-title"><span class="code">${esc(a.subject)}</span>${esc(a.title)}</span>
      <span class="asg-due ${d.cls}">${d.text}</span>
      <div class="asg-bar"><i style="width:${Math.min(100, a.progressPct ?? 0)}%"></i></div>
      ${a.nextAction ? `<span class="asg-next">next: ${esc(a.nextAction)}</span>` : ''}
    </div>`
  }).join('')
  const clearedRows = cleared.map(a => `
    <div class="asg-done">
      <button class="todo-tick on" data-uni="${esc(a.id)}" data-undone="1" title="Put it back on the board">&#10003;</button>
      <span>${esc(a.title)}</span>
    </div>`).join('')
  const setup = u.setupNote ? `<div class="setup">${esc(u.setupNote)}</div>` : ''
  box.innerHTML = `<div class="subj-row">${subjects}</div>`
    + (rows || '<p class="empty">No open assignments. Semester break, or the feed needs a refresh.</p>')
    + clearedRows + setup
}

function renderStudy() {
  const st = DATA.study
  const box = $('#study-body')
  if (!st) { box.innerHTML = '<p class="empty">No study feed.</p>'; return }
  $('#study-chip').textContent = (st.stats?.streak ?? 0) + 'D STREAK'
  const due = st.queue || []
  box.innerHTML = `
    <div class="bignum"><b>${due.length}</b><span>reviews due today</span></div>
    ${due.slice(0, 5).map(q => `<div class="list-line"><span class="l">${esc(q.title)}</span><span class="r">${esc(q.module || '')}</span></div>`).join('')}
    ${due.length === 0 ? '<p class="empty">Queue clear. The vault grows when you feed it notes.</p>' : ''}
    ${st.setupNote ? `<div class="setup">${esc(st.setupNote)}</div>` : ''}`
}

function sparkline(series, key) {
  if (!series || series.length < 2) return ''
  const vals = series.map(p => p[key])
  const min = Math.min(...vals), max = Math.max(...vals)
  const W = 240, H = 40
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - 4 - ((v - min) / (max - min || 1)) * (H - 10)}`)
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <polygon class="area" points="0,${H} ${pts.join(' ')} ${W},${H}"/>
    <polyline points="${pts.join(' ')}"/></svg>`
}

function renderFitness() {
  const f = DATA.fitness
  const box = $('#fitness-body')
  if (!f) { box.innerHTML = '<p class="empty">No fitness feed.</p>'; return }
  $('#fitness-chip').textContent = (f.source || 'sample').toUpperCase()
  $('#fitness-chip').className = 'chip ' + (f.source === 'sample' ? 'warn' : 'ok')
  const w = f.weight || {}
  const n = f.nutrition || {}
  const macro = (label, val, target) => `
    <div class="macro"><span>${label}</span><div class="bar"><i style="width:${target ? Math.min(100, (val / target) * 100) : 0}%"></i></div><span>${val ?? '--'}g</span></div>`
  box.innerHTML = `
    <div class="bignum"><b>${w.currentKg ?? '--'}</b><span>kg ${w.goalKg ? '/ goal ' + w.goalKg : ''}</span></div>
    ${sparkline(w.series, 'kg')}
    <div class="macro"><span>KCAL</span><div class="bar"><i style="width:${n.targetKcal ? Math.min(100, (n.todayKcal / n.targetKcal) * 100) : 0}%"></i></div><span>${n.todayKcal ?? '--'}</span></div>
    ${macro('PROTEIN', n.proteinG, 180)}
    <div class="list-line"><span class="l">${esc(f.training?.lastSession || 'No session logged')}</span><span class="r">${esc(String(f.training?.weekSessions ?? 0))} this week</span></div>
    ${f.setupNote ? `<div class="setup">${esc(f.setupNote)}</div>` : ''}`
}

function renderWork() {
  const w = DATA.work
  const box = $('#work-body')
  if (!w) { box.innerHTML = '<p class="empty">No work feed.</p>'; return }
  $('#work-chip').textContent = 'TGS'
  box.innerHTML = `
    ${(w.projects || []).map(p => `<div class="list-line"><span class="l">${esc(p.client)}: ${esc(p.name)}</span><span class="r">${esc(p.status || '')}</span></div>`).join('')}
    ${(w.today || []).map(t => `<div class="list-line"><span class="l">${esc(t)}</span><span class="r">today</span></div>`).join('')}
    ${w.setupNote ? `<div class="setup">${esc(w.setupNote)}</div>` : ''}`
}

// ---------- voice ----------

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64
    analyser.connect(audioCtx.destination)
  }
  if (audioCtx.state === 'suspended') audioCtx.resume()
}

let currentSpeech = null

function stopSpeech() {
  if (currentSpeech) {
    currentSpeech.pause()
    currentSpeech.src = ''
    currentSpeech = null
  }
}

function pulseCoreFrom(el) {
  ensureAudioCtx()
  const src = audioCtx.createMediaElementSource(el)
  src.connect(analyser)
  const buf = new Uint8Array(analyser.frequencyBinCount)
  const core = $('#r-core')
  document.body.classList.add('speaking')
  $('#speak-briefing').textContent = 'STOP'
  function loop() {
    if (el.paused || el.ended) {
      // Only the active utterance may clear the speaking state; a stopped
      // one racing a new one must not strip the pulse mid-sentence.
      if (!currentSpeech || currentSpeech === el) {
        document.body.classList.remove('speaking')
        $('#speak-briefing').textContent = 'SPEAK'
        core.setAttribute('r', 26)
      }
      return
    }
    analyser.getByteFrequencyData(buf)
    const level = buf.reduce((a, b) => a + b, 0) / buf.length / 255
    core.setAttribute('r', 26 + level * 14)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}

// Which engine renders speech. 'el' spends ElevenLabs credits per new line,
// 'say' is free on this Mac; the server falls back to say if the key is absent.
function voiceEngine() { return localStorage.getItem('jarvis-voice-engine') === 'say' ? 'say' : 'el' }

async function speak(text, force = false) {
  if (!text || (!soundOn && !force)) return
  stopSpeech()
  try {
    const res = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, engine: voiceEngine() }) })
    if (!res.ok) throw new Error('tts ' + res.status)
    const blob = await res.blob()
    stopSpeech() // a second request may have started while this one was rendering
    const el = new Audio(URL.createObjectURL(blob))
    el.crossOrigin = 'anonymous'
    el.volume = vol.voice
    currentSpeech = el
    el.addEventListener('ended', () => { if (currentSpeech === el) currentSpeech = null })
    pulseCoreFrom(el)
    await el.play()
  } catch (e) {
    console.warn('speak failed', e)
  }
}

// ---------- ask ----------

// ---------- agent deck ----------
// Blue hologram figures, one per agent, projected from pads. Pure inline SVG:
// every silhouette shares the same userSpaceOnUse gradient (bright at the
// head, dissolving at the feet, the way a projection should). Duplicate
// gradient ids across figures are safe because the definitions are identical.

const HOLO_DEFS = `<defs><linearGradient id="hg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="118">
  <stop offset="0" stop-color="#8feaff" stop-opacity=".95"/>
  <stop offset=".55" stop-color="#17d4fe" stop-opacity=".72"/>
  <stop offset="1" stop-color="#17d4fe" stop-opacity="0"/>
</linearGradient></defs>`
const holoSvg = inner => `<svg viewBox="0 0 80 120" aria-hidden="true">${HOLO_DEFS}<g fill="url(#hg)">${inner}</g></svg>`
const BODY = '<circle cx="40" cy="14" r="8"/><path d="M28 30 Q40 25 52 30 L55 76 Q40 84 25 76 Z"/><path d="M33 78 L47 78 L42 108 L38 108 Z"/>'

const FIGURES = {
  butler: holoSvg(
    '<circle cx="40" cy="14" r="8"/>'
    + '<path d="M34 26 L40 29 L46 26 L46 33 L40 30 L34 33 Z"/>' // bowtie
    + '<path d="M28 30 Q40 25 52 30 L56 76 Q40 84 24 76 Z"/>'
    + '<path d="M26 76 L33 76 L28 106 Z"/><path d="M54 76 L47 76 L52 106 Z"/>' // tailcoat
    + '<path d="M52 36 L66 30 L67 34 L54 42 Z"/>' // tray arm
    + '<path d="M58 26 L80 26 L79 29 L59 29 Z"/><path d="M62 26 Q69 17 76 26 Z"/><circle cx="69" cy="15" r="1.8"/>' // tray + cloche
  ),
  herald: holoSvg(
    BODY
    + '<path d="M50 36 L60 18 L64 21 L54 42 Z"/>' // raised arm
    + '<circle cx="64" cy="12" r="5.5"/>'
    + '<path d="M64 2 V5.2 M64 18.8 V22 M54 12 H57.2 M70.8 12 H74 M57 5 L59.4 7.4 M68.6 16.6 L71 19 M71 5 L68.6 7.4 M59.4 16.6 L57 19" stroke="url(#hg)" stroke-width="1.8" stroke-linecap="round" fill="none"/>' // sun rays
  ),
  tinker: holoSvg(
    BODY
    + '<path d="M50 40 L60 42 L59 47 L49 46 Z"/>' // arm to gear
    + '<circle cx="66" cy="44" r="7"/>'
    + '<path d="M64 33 h4 v4 h-4 Z M64 51 h4 v4 h-4 Z M55 42 h4 v4 h-4 Z M73 42 h4 v4 h-4 Z"/>' // teeth
    + '<circle cx="66" cy="44" r="2.6" fill="#02060d"/>' // hub
  ),
  sprinter: holoSvg(
    '<circle cx="48" cy="16" r="8"/>'
    + '<path d="M38 30 Q50 24 60 32 L52 68 Q40 74 30 64 Z"/>' // leaning torso
    + '<path d="M44 66 L62 84 L58 89 L40 72 Z"/><path d="M34 62 L18 80 L22 85 L38 70 Z"/>' // legs
    + '<path d="M56 36 L70 44 L67 49 L54 42 Z"/>' // forward arm
    + '<path d="M6 36 H22 M2 48 H18 M8 60 H24" stroke="url(#hg)" stroke-width="2" stroke-linecap="round" fill="none" opacity=".6"/>' // speed lines
    + '<circle cx="14" cy="20" r="5.5"/><path d="M14 20 V16.4 M14 20 H17" stroke="#02060d" stroke-width="1.6" fill="none"/>' // clock
  ),
  scribe: holoSvg(
    '<path d="M30 17 Q40 2 50 17 Q50 25 40 25 Q30 25 30 17 Z"/>' // hood
    + '<circle cx="40" cy="18" r="4.5" fill="#02060d" opacity=".5"/>' // shadowed face
    + '<path d="M28 30 Q40 25 52 30 L55 76 Q40 84 25 76 Z"/><path d="M33 78 L47 78 L42 108 L38 108 Z"/>'
    + '<path d="M50 40 L58 44 L56 49 L48 45 Z"/>' // arm
    + '<rect x="54" y="44" width="20" height="5" rx="2.5"/><circle cx="54" cy="46.5" r="3"/><circle cx="74" cy="46.5" r="3"/>' // scroll
    + '<path d="M66 36 L74 22 L70 37 Z"/>' // quill
  ),
  researcher: holoSvg(
    BODY
    + '<path d="M50 36 L58 30 L61 34 L53 42 Z"/>' // raised arm
    + '<circle cx="65" cy="26" r="7" fill="none" stroke="url(#hg)" stroke-width="2.5"/>' // lens
    + '<path d="M69 32 L75 42 L71.5 44.5 L66 35 Z"/>' // handle
  ),
  coach: holoSvg(
    BODY
    + '<path d="M48 32 L52 24 L56 26 L52 36 Z"/>' // whistle arm
    + '<path d="M54 20 L62 18 L62 24 Q58 27 54 25 Z"/>' // whistle
    + '<path d="M30 40 L22 44 L24 49 L32 45 Z"/>' // watch arm
    + '<circle cx="19" cy="48" r="5.5"/><rect x="17.5" y="40.5" width="3" height="3"/><path d="M19 48 V44.4" stroke="#02060d" stroke-width="1.6" fill="none"/>' // stopwatch
  ),
  analyst: holoSvg(
    BODY
    + '<path d="M38 30 L42 30 L41.5 44 L40 48 L38.5 44 Z"/>' // tie
    + '<path d="M50 42 L58 52 L54.5 55.5 L47 47 Z"/>' // arm down
    + '<rect x="54" y="54" width="20" height="14" rx="2"/>'
    + '<path d="M60 54 v-4 h8 v4" fill="none" stroke="url(#hg)" stroke-width="2"/>' // handle
    + '<path d="M54 61 H74" stroke="#02060d" stroke-width="1" opacity=".5" fill="none"/>' // clasp
  ),
  spark: holoSvg(
    BODY
    + '<path d="M64 18 L68 23 L64 28 L60 23 Z"/>' // unassigned marker
  ),
}

let selectedAgent = null

function renderAgents() {
  const box = $('#agent-deck')
  const list = DATA.agents || []
  if (!list.length) {
    box.innerHTML = '<p class="empty">No agents reporting.</p>'
    $('#agents-chip').textContent = ''
    $('#agent-dossier').hidden = true
    return
  }
  $('#agents-chip').textContent = list.length + ' ONLINE'
  // JARVIS stands centre and taller; the rest fan out around him.
  const jarvis = list.find(a => a.id === 'jarvis')
  const rest = list.filter(a => a.id !== 'jarvis')
  const half = Math.ceil(rest.length / 2)
  const ordered = jarvis ? [...rest.slice(0, half), jarvis, ...rest.slice(half)] : rest
  box.innerHTML = ordered.map((a, i) => `
    <button class="holo ${a.id === 'jarvis' ? 'holo-main' : ''} ${a.id === selectedAgent ? 'sel' : ''}"
      data-agent="${esc(a.id)}" style="--d:-${(i * 0.7).toFixed(1)}s" title="${esc(a.name)}: ${esc(a.role)}">
      ${FIGURES[a.figure] || FIGURES.spark}
      <span class="holo-pad"></span>
      <span class="holo-name">${esc(a.name)}</span>
    </button>`).join('')
  renderDossier()
}

function renderDossier() {
  const el = $('#agent-dossier')
  const a = (DATA.agents || []).find(x => x.id === selectedAgent)
  if (!a) { el.hidden = true; el.innerHTML = ''; return }
  el.hidden = false
  el.innerHTML = `
    <div class="dossier-head">
      <span class="dossier-name">${esc(a.name)}</span>
      <span class="chip">${esc(a.role)}</span>
      <span class="chip">MODEL: ${esc(a.model)}</span>
    </div>
    <p class="dossier-desc">${esc(a.description)}</p>
    <div class="dossier-tools">${(a.tools || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>`
}

$('#agent-deck').addEventListener('click', e => {
  const b = e.target.closest('.holo')
  if (!b) return
  selectedAgent = selectedAgent === b.dataset.agent ? null : b.dataset.agent
  renderAgents()
  const a = (DATA.agents || []).find(x => x.id === selectedAgent)
  if (a) speak(a.id === 'jarvis' ? 'At your service, sir.' : `${a.name}. ${a.role}.`)
})

// Core /api/ask transport. POSTs the question, feeds accumulated text to
// onDelta as claude streams it, and returns { j, streamedText } where j is
// the authoritative final verdict (interim tool narration gets replaced).
async function askApi(question, onDelta) {
  let j = null
  let streamedText = ''
  try {
    const res = await fetch('/api/ask' + (WORK_PARAM ? '?work=1' : ''), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, stream: true }),
    })
    if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const ev = (chunk.match(/^event: (.+)$/m) || [])[1]
          const dataLine = (chunk.match(/^data: (.+)$/m) || [])[1]
          if (!ev || !dataLine) continue
          let data
          try { data = JSON.parse(dataLine) } catch { continue }
          if (ev === 'delta' && data.text) {
            streamedText += data.text
            if (onDelta) onDelta(streamedText)
          } else if (ev === 'done') {
            j = data
          }
        }
      }
      if (!j) j = streamedText ? { ok: true, answer: streamedText } : { ok: false, error: 'the stream went quiet' }
    } else {
      j = await res.json()
    }
  } catch (e) {
    j = { ok: false, error: e.message }
  }
  return { j, streamedText }
}

async function ask(question) {
  const panel = $('#answer'), body = $('#answer-body')
  panel.hidden = false
  body.innerHTML = 'Processing<span class="cursor"></span>'
  let started = false
  const { j, streamedText } = await askApi(question, text => {
    if (!started) { started = true; body.textContent = '' }
    body.textContent = text
    body.scrollTop = body.scrollHeight
  })
  const answer = j.ok ? (j.answer || streamedText) : 'Fault in the reasoning core: ' + (j.error || 'unknown')
  if (j.ok && streamedText && answer === streamedText) {
    body.textContent = answer // already on screen, do not retype
  } else {
    body.innerHTML = ''
    await typewrite(body, answer, 6)
  }
  if ($('#speak-answers').checked && j.ok) speak(answer)
}

async function sendWin(text) {
  const panel = $('#answer'), body = $('#answer-body')
  panel.hidden = false
  const res = await fetch('/api/win', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  })
  const j = res.ok ? await res.json() : null
  body.innerHTML = ''
  await typewrite(body, j?.ok
    ? `Logged, sir. That makes ${j.total} on the record for the review.`
    : 'The win did not save. Ironic.', 6)
}

async function sendFeedback(text) {
  const panel = $('#answer'), body = $('#answer-body')
  panel.hidden = false
  const res = await fetch('/api/feedback', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  })
  body.innerHTML = ''
  await typewrite(body, res.ok
    ? 'Noted, sir. I will factor that into tonight\'s improvement cycle.'
    : 'Feedback did not save. The server is being difficult.', 6)
}

async function sendCapture(text) {
  const panel = $('#answer'), body = $('#answer-body')
  panel.hidden = false
  const res = await fetch('/api/capture', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  })
  body.innerHTML = ''
  await typewrite(body, res.ok
    ? 'Captured, sir. The morning run will file it where it belongs.'
    : 'The capture did not save. Try again.', 6)
}

$('#ask-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    const text = e.target.value.trim()
    const fb = text.match(/^(?:fb|feedback):\s*(.+)/i)
    const win = text.match(/^win:\s*(.+)/i)
    const cap = text.match(/^in:\s*(.+)/i)
    if (fb) sendFeedback(fb[1])
    else if (win) sendWin(win[1])
    else if (cap) sendCapture(cap[1])
    else ask(text)
    e.target.value = ''
  }
  if (e.key === 'Escape') $('#answer').hidden = true
})
$('#answer-close').addEventListener('click', () => { $('#answer').hidden = true })

// mic: Web Speech API (Chrome). Click to talk, click again (or go quiet
// for a couple of seconds) to send. Chrome likes to end the session at the
// first breath, so we run continuous and restart it behind the scenes.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition
if (SR) {
  const rec = new SR()
  rec.lang = 'en-AU'
  rec.continuous = true
  rec.interimResults = true
  let live = false
  let finalText = ''
  let silenceTimer = null
  const SILENCE_MS = 2200

  function submitDictation() {
    const text = ($('#ask-input').value || finalText).trim()
    stopDictation()
    if (text) {
      $('#ask-input').value = text
      ask(text)
      $('#ask-input').value = ''
    }
  }

  function stopDictation() {
    live = false
    clearTimeout(silenceTimer)
    $('#mic').classList.remove('live')
    try { rec.stop() } catch { /* already stopped */ }
  }

  $('#mic').addEventListener('click', () => {
    if (live) { submitDictation(); return }
    live = true
    finalText = ''
    $('#ask-input').value = ''
    $('#ask-input').placeholder = 'Listening, sir...'
    $('#mic').classList.add('live')
    try { rec.start() } catch { /* start() while pending throws; ignore */ }
  })

  rec.onresult = e => {
    if (!live) return
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else interim += r[0].transcript
    }
    $('#ask-input').value = (finalText + interim).trim()
    clearTimeout(silenceTimer)
    if ((finalText + interim).trim()) silenceTimer = setTimeout(submitDictation, SILENCE_MS)
  }

  // Chrome ends continuous sessions on its own schedule; while the mic is
  // meant to be live, quietly start a new one and keep the transcript.
  rec.onend = () => {
    if (live) {
      try { rec.start() } catch { stopDictation() }
    } else {
      $('#ask-input').placeholder = 'Ask me anything, sir.'
    }
  }
  rec.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return // onend handles the restart
    stopDictation()
    $('#ask-input').placeholder = e.error === 'not-allowed' ? 'Mic blocked in browser settings.' : 'Ask me anything, sir.'
  }

  addEventListener('keydown', e => {
    if (e.key === 'Escape' && live) { $('#ask-input').value = ''; finalText = ''; stopDictation() }
  })
} else {
  $('#mic').disabled = true
  $('#mic').title = 'Speech recognition needs Chrome'
}

// ---------- stealth ----------

async function setMode(mode) {
  await fetch('/api/mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) })
  await fetchData()
}

let clicks = []
$('#wordmark').addEventListener('click', () => {
  const now = Date.now()
  clicks = clicks.filter(t => now - t < 2000)
  clicks.push(now)
  if (clicks.length >= 5) {
    clicks = []
    setMode(document.body.dataset.mode === 'work' ? 'full' : 'work')
  }
})
addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'j') {
    e.preventDefault()
    setMode(document.body.dataset.mode === 'work' ? 'full' : 'work')
  }
})

// ---------- sound toggle ----------

$('#audio-toggle').addEventListener('click', () => {
  soundOn = !soundOn
  $('#audio-toggle').textContent = soundOn ? 'SND ON' : 'SND OFF'
  const boot = $('#boot-audio')
  if (!soundOn) {
    if (!boot.paused) boot.pause()
    stopSpeech()
  }
})

$('#speak-briefing').addEventListener('click', () => {
  if (currentSpeech) { stopSpeech(); return }
  const script = DATA?.briefing?.voiceScript
  if (script) {
    speak(script)
    autoOpenActions()
  }
})

$('#run-briefing').addEventListener('click', async () => {
  const btn = $('#run-briefing')
  btn.disabled = true
  const panel = $('#answer'), body = $('#answer-body')
  try {
    const r = await fetch('/api/run-briefing', { method: 'POST' })
    const j = await r.json().catch(() => ({}))
    panel.hidden = false
    body.innerHTML = ''
    if (r.ok) {
      btn.textContent = 'RUNNING'
      await typewrite(body, 'On it, sir. The agent is rebuilding the briefing now; it lands here in ten to fifteen minutes and the panel refreshes itself.', 6)
    } else if (r.status === 409) {
      btn.textContent = 'RUNNING'
      await typewrite(body, 'Already mid-run, sir. It will arrive shortly.', 6)
    } else {
      btn.disabled = false
      await typewrite(body, 'Could not start the run: ' + (j.error || r.status), 6)
    }
  } catch {
    btn.disabled = false
  }
})

// ---------- conversation log ----------

let convoEntries = []

async function toggleConvo() {
  const el = $('#convo')
  if (!el.hidden) { el.hidden = true; return }
  el.hidden = false
  const body = $('#convo-body')
  body.innerHTML = '<p class="empty">Loading the record...</p>'
  try {
    const j = await (await fetch('/api/conversations' + (WORK_PARAM ? '?work=1' : ''))).json()
    const stamp = at => new Date(at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    convoEntries = j.entries || []
    body.innerHTML = convoEntries.map((e, i) => `
      <div class="convo-row">
        <div class="convo-q">${esc(e.q)}<span class="convo-meta"><button class="convo-play" data-ci="${i}" title="Hear this reply">&#9654;</button><span class="convo-at">${stamp(e.at)}</span></span></div>
        <div class="convo-a">${esc(e.a)}</div>
      </div>`).join('') || '<p class="empty">No conversations on record yet. Everything we say via the prompt is kept here.</p>'
    body.scrollTop = body.scrollHeight
  } catch {
    body.innerHTML = '<p class="empty">Log unavailable.</p>'
  }
}

$('#log-btn').addEventListener('click', toggleConvo)
$('#convo-body').addEventListener('click', e => {
  const btn = e.target.closest('.convo-play')
  if (!btn) return
  const entry = convoEntries[Number(btn.dataset.ci)]
  if (entry?.a) speak(entry.a, true) // an explicit play outranks the SND toggle
})
$('#convo-close').addEventListener('click', () => { $('#convo').hidden = true })
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#convo').hidden) $('#convo').hidden = true
})

$('#voice-stop').addEventListener('click', stopSpeech)
addEventListener('keydown', e => {
  if (e.key === 'Escape') stopSpeech()
})

// ---------- command palette ----------
// In work mode only innocuous actions appear; the mode toggle stays on its
// unlabelled paths so the palette never advertises that a switch exists.

function paletteActions() {
  const work = document.body.dataset.mode === 'work'
  const preset = t => () => { const i = $('#ask-input'); i.value = t; i.focus() }
  const acts = [
    { name: 'Speak the briefing', run: () => $('#speak-briefing').click() },
    { name: 'Silence', run: () => stopSpeech() },
    { name: 'Conversation log', run: () => toggleConvo() },
    { name: 'Focus mode', run: () => setFocusMode(document.body.dataset.focus !== '1') },
    { name: 'Play or pause music', run: () => $('#player-play').click() },
    { name: 'Next track', run: () => $('#player-next').click() },
    { name: 'Volume mixer', run: () => $('#vol-btn').click() },
    { name: 'Switch voice engine (ElevenLabs / Mac)', run: () => $('#mix-engine').click() },
    { name: 'Ask JARVIS...', run: () => $('#ask-input').focus() },
    { name: 'Capture a thought (in:)', run: preset('in: ') },
    { name: 'File feedback (fb:)', run: preset('fb: ') },
    { name: 'Shortcut help', run: () => showHelp() },
  ]
  if (!work) {
    acts.push(
      { name: 'Run the briefing now', run: () => $('#run-briefing').click() },
      { name: 'Log a win (win:)', run: preset('win: ') },
      { name: 'Open AIOS dashboard', run: () => window.open('/aios/', '_blank', 'noopener') },
      { name: 'Enter work mode', run: () => setMode('work') },
    )
  }
  const panels = ['briefing', 'core', 'comms', 'uni', 'study', 'fitness', 'work']
  if (!work) panels.splice(2, 0, 'career')
  for (const p of panels) {
    acts.push({ name: 'Jump to ' + (p === 'core' ? 'reactor' : p), run: () => document.getElementById('panel-' + p)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) })
  }
  return acts
}

let paletteSel = 0

function paletteMatches() {
  const q = $('#palette-input').value.trim().toLowerCase()
  return paletteActions().filter(a => !q || a.name.toLowerCase().includes(q))
}

function renderPalette() {
  const list = $('#palette-list')
  const matches = paletteMatches()
  paletteSel = Math.min(paletteSel, Math.max(0, matches.length - 1))
  list.innerHTML = matches.map((a, i) =>
    `<div class="palette-item ${i === paletteSel ? 'sel' : ''}" data-pi="${i}">${esc(a.name)}</div>`).join('')
    || '<div class="palette-empty">Nothing matches that, sir.</div>'
}

function togglePalette(open) {
  const el = $('#palette')
  const show = open ?? el.hidden
  el.hidden = !show
  if (show) {
    $('#palette-input').value = ''
    paletteSel = 0
    renderPalette()
    $('#palette-input').focus()
  }
}

$('#palette-input').addEventListener('input', () => { paletteSel = 0; renderPalette() })
$('#palette-input').addEventListener('keydown', e => {
  const matches = paletteMatches()
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteSel = Math.min(paletteSel + 1, matches.length - 1); renderPalette() }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteSel = Math.max(paletteSel - 1, 0); renderPalette() }
  else if (e.key === 'Enter' && matches[paletteSel]) { togglePalette(false); matches[paletteSel].run() }
  else if (e.key === 'Escape') { e.stopPropagation(); togglePalette(false) }
})
$('#palette-list').addEventListener('click', e => {
  const item = e.target.closest('.palette-item')
  if (!item) return
  const matches = paletteMatches()
  const act = matches[Number(item.dataset.pi)]
  togglePalette(false)
  act?.run()
})

function showHelp() { $('#help').hidden = false }
$('#help-btn').addEventListener('click', showHelp)
$('#help-close').addEventListener('click', () => { $('#help').hidden = true })

addEventListener('keydown', e => {
  const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); togglePalette() }
  // One chord per rail/player control. Modifier chords cannot type into an
  // input, so these stay live even while the ask bar has focus.
  else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#focus-btn').click() }
  else if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); $('#log-btn').click() }
  else if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); $('#vol-btn').click() }
  else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); $('#audio-toggle').click() }
  else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); $('#player-play').click() }
  else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); $('#player-next').click() }
  else if (mod && e.key === '/') { e.preventDefault(); showHelp() }
  else if (e.key === '?' && !e.target.matches('input, textarea')) { e.preventDefault(); showHelp() }
  else if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.matches('input, textarea') && !$('#mic').disabled) { e.preventDefault(); $('#mic').click() }
  else if (e.key === 'Escape') {
    if (!$('#palette').hidden) togglePalette(false)
    if (!$('#help').hidden) $('#help').hidden = true
    if (!$('#guide').hidden) closeGuide()
  }
})

// ---------- guided walkthroughs ----------
// A play button on an operator task opens a step-at-a-time overlay: I speak
// each step, he does it, clicks NEXT. Progress survives a reload, and the
// ask box answers questions about the current step with full step context.

const guide = { slug: null, data: null, idx: 0 }
const guideKey = slug => 'jarvis-guide-' + slug

async function openGuide(slug) {
  let g
  try {
    const res = await fetch('/api/guide?id=' + encodeURIComponent(slug) + (WORK_PARAM ? '&work=1' : ''))
    if (!res.ok) throw new Error('guide ' + res.status)
    g = await res.json()
  } catch {
    const panel = $('#answer'), body = $('#answer-body')
    panel.hidden = false
    body.textContent = 'That walkthrough is unavailable right now.'
    return
  }
  guide.slug = slug
  guide.data = g
  const saved = parseInt(localStorage.getItem(guideKey(slug)) || '0', 10)
  guide.idx = Number.isFinite(saved) ? Math.max(0, Math.min(saved, g.steps.length)) : 0
  $('#guide').hidden = false
  renderGuide()
  const s = g.steps[guide.idx]
  if (guide.idx >= g.steps.length) speak(g.outro)
  else if (guide.idx === 0) speak([g.intro, s.voice].filter(Boolean).join(' '))
  else speak('Picking up where you left off. ' + s.voice)
}

function closeGuide() {
  $('#guide').hidden = true
  stopSpeech()
}

function renderGuide() {
  const g = guide.data
  if (!g) return
  const total = g.steps.length
  const finished = guide.idx >= total
  $('#guide-title').textContent = 'WALKTHROUGH: ' + g.title.toUpperCase()
  $('#guide-progress').innerHTML = finished
    ? '<span class="chip ok">COMPLETE</span>'
    : `<span class="chip">STEP ${guide.idx + 1} / ${total}</span>${g.est ? `<span class="chip">${esc(g.est)}</span>` : ''}`
  const block = (s, i) => `
    <div class="guide-step ${i < guide.idx ? 'done' : i === guide.idx ? 'current' : ''}">
      <div class="guide-step-head">${i < guide.idx ? '&#10003;' : (i + 1) + '.'} ${esc(s.title)}</div>
      ${i === guide.idx ? `
        <div class="guide-step-body">${esc(s.body)}</div>
        ${s.command ? `<div class="guide-cmd"><code>${esc(s.command)}</code><button class="act-btn" data-copy="${esc(s.command)}">COPY</button></div>` : ''}
        ${s.url ? `<div class="feed-actions"><button class="act-btn" data-url="${esc(s.url)}">OPEN &#8599;</button></div>` : ''}
        <div class="guide-qa" id="guide-qa"></div>` : ''}
    </div>`
  $('#guide-body').innerHTML = g.steps.slice(0, Math.min(guide.idx + 1, total)).map(block).join('')
    + (finished ? `<div class="guide-complete">All steps complete, sir.
        <div class="feed-actions">
          ${g.todoId ? '<button class="act-btn yes" id="guide-done-todo">MARK IT DONE ON THE BOARD</button>' : ''}
        </div></div>` : '')
  $('#guide-back').disabled = guide.idx === 0
  $('#guide-next').textContent = finished ? 'CLOSE' : guide.idx === total - 1 ? 'FINISH' : 'NEXT'
  const body = $('#guide-body')
  body.scrollTop = body.scrollHeight
  const doneBtn = document.getElementById('guide-done-todo')
  if (doneBtn) {
    doneBtn.addEventListener('click', async () => {
      doneBtn.disabled = true
      try {
        await fetch('/api/todo', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: g.todoId, done: true }),
        })
        fetchData()
        closeGuide()
      } catch { doneBtn.disabled = false }
    })
  }
}

function guideGo(dir) {
  const g = guide.data
  if (!g) return
  const total = g.steps.length
  if (dir > 0 && guide.idx >= total) { closeGuide(); return } // CLOSE once finished
  guide.idx = Math.max(0, Math.min(guide.idx + dir, total))
  localStorage.setItem(guideKey(guide.slug), String(guide.idx))
  renderGuide()
  if (guide.idx >= total) speak(g.outro)
  else speak(g.steps[guide.idx].voice)
}

$('#guide-close').addEventListener('click', closeGuide)
$('#guide-back').addEventListener('click', () => guideGo(-1))
$('#guide-next').addEventListener('click', () => guideGo(1))
$('#guide-restart').addEventListener('click', () => {
  if (!guide.data) return
  guide.idx = 0
  localStorage.setItem(guideKey(guide.slug), '0')
  renderGuide()
  speak([guide.data.intro, guide.data.steps[0].voice].filter(Boolean).join(' '))
})

$('#guide-ask').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return
  const g = guide.data
  if (!g) return
  const q = e.target.value.trim()
  e.target.value = ''
  const i = Math.min(guide.idx, g.steps.length - 1)
  const s = g.steps[i]
  const qa = document.getElementById('guide-qa') || $('#guide-body')
  const row = document.createElement('div')
  row.className = 'guide-qa-row'
  row.innerHTML = `<div class="guide-q">${esc(q)}</div><div class="guide-a">Processing<span class="cursor"></span></div>`
  qa.appendChild(row)
  const aEl = row.querySelector('.guide-a')
  const context = `He is mid-walkthrough on the HUD: "${g.title}", step ${i + 1} of ${g.steps.length}, titled "${s.title}". `
    + `The step instructions: ${s.body}${s.command ? ' The step command: ' + s.command : ''} `
    + 'Answer his question about THIS step concretely and briefly; no preamble.'
  const { j, streamedText } = await askApi(context + '\n\nHis question: ' + q, text => {
    aEl.textContent = text
    $('#guide-body').scrollTop = $('#guide-body').scrollHeight
  })
  const answer = j.ok ? (j.answer || streamedText) : 'Fault in the reasoning core: ' + (j.error || 'unknown')
  aEl.textContent = answer
  $('#guide-body').scrollTop = $('#guide-body').scrollHeight
  if (j.ok) speak(answer)
})

// ---------- focus mode + pomodoro ----------
// Timestamps, not tick counting: a laptop lid or backgrounded tab cannot
// drift the clock. Completed focus blocks land in the manual check-in log.

const pomo = {
  preset: Number(localStorage.getItem('jarvis-pomo-preset')) || 25,
  phase: 'idle', // idle | focus | break
  endAt: null,
  timer: null,
}

function pomoBreakFor(preset) { return preset === 50 ? 10 : 5 }

function pomoDoneKey() { return 'jarvis-pomo-done-' + new Date().toISOString().slice(0, 10) }

function setFocusMode(on) {
  document.body.dataset.focus = on ? '1' : '0'
  localStorage.setItem('jarvis-focus', on ? '1' : '0')
  $('#focus-btn').classList.toggle('on', on)
}

function pomoRender() {
  const remaining = pomo.endAt ? Math.max(0, pomo.endAt - Date.now()) : pomo.preset * 60000
  const mm = String(Math.floor(remaining / 60000)).padStart(2, '0')
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')
  $('#pomo-time').textContent = `${mm}:${ss}`
  const phaseEl = $('#pomo-phase')
  phaseEl.textContent = pomo.phase === 'focus' ? 'FOCUS' : pomo.phase === 'break' ? 'BREAK' : 'READY'
  phaseEl.className = 'pomo-phase ' + (pomo.phase === 'idle' ? '' : pomo.phase)
  $('#pomo-start').textContent = pomo.phase === 'idle' ? 'START' : 'STOP'
  $('#pomo-preset').textContent = pomo.preset === 50 ? '50/10' : '25/5'
  $('#focus-chip').textContent = pomo.phase.toUpperCase() === 'IDLE' ? 'IDLE' : pomo.phase.toUpperCase()
  const done = Number(localStorage.getItem(pomoDoneKey())) || 0
  $('#pomo-count').textContent = done ? `${done} block${done > 1 ? 's' : ''} banked today` : ''
  if (pomo.phase === 'focus') document.title = `${mm}:${ss} FOCUS · J.A.R.V.I.S.`
  else if (document.title !== 'J.A.R.V.I.S.') document.title = 'J.A.R.V.I.S.'
}

function pomoSave() {
  localStorage.setItem('jarvis-pomo', JSON.stringify({ phase: pomo.phase, endAt: pomo.endAt, preset: pomo.preset }))
}

function pomoTick() {
  if (pomo.phase === 'idle') return
  const remaining = pomo.endAt - Date.now()
  if (remaining > 0) { pomoRender(); return }
  if (pomo.phase === 'focus') {
    const done = (Number(localStorage.getItem(pomoDoneKey())) || 0) + 1
    localStorage.setItem(pomoDoneKey(), String(done))
    fetch('/api/checkin', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'focus', minutes: pomo.preset }),
    }).catch(() => {})
    speak('Focus block banked, sir. Break time.')
    pomo.phase = 'break'
    pomo.endAt = Date.now() + pomoBreakFor(pomo.preset) * 60000
  } else {
    speak('Break over. When you are ready, sir.')
    pomo.phase = 'idle'
    pomo.endAt = null
    clearInterval(pomo.timer)
    pomo.timer = null
  }
  pomoSave()
  pomoRender()
}

function pomoStartStop() {
  if (pomo.phase === 'idle') {
    pomo.phase = 'focus'
    pomo.endAt = Date.now() + pomo.preset * 60000
    if (!pomo.timer) pomo.timer = setInterval(pomoTick, 500)
  } else {
    pomo.phase = 'idle'
    pomo.endAt = null
    clearInterval(pomo.timer)
    pomo.timer = null
  }
  pomoSave()
  pomoRender()
}

$('#focus-btn').addEventListener('click', () => setFocusMode(document.body.dataset.focus !== '1'))
$('#pomo-start').addEventListener('click', pomoStartStop)
$('#pomo-reset').addEventListener('click', () => {
  pomo.phase = 'idle'
  pomo.endAt = null
  clearInterval(pomo.timer)
  pomo.timer = null
  pomoSave()
  pomoRender()
})
$('#pomo-preset').addEventListener('click', () => {
  if (pomo.phase !== 'idle') return
  pomo.preset = pomo.preset === 50 ? 25 : 50
  localStorage.setItem('jarvis-pomo-preset', String(pomo.preset))
  pomoSave()
  pomoRender()
})
addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.body.dataset.focus === '1'
    && $('#convo').hidden && $('#answer').hidden
    && $('#palette').hidden && $('#help').hidden && $('#mixer').hidden) setFocusMode(false)
})

;(function pomoRestore() {
  try {
    const saved = JSON.parse(localStorage.getItem('jarvis-pomo') || 'null')
    if (saved?.preset) pomo.preset = saved.preset
    if (saved?.phase && saved.phase !== 'idle' && saved.endAt > Date.now()) {
      pomo.phase = saved.phase
      pomo.endAt = saved.endAt
      pomo.timer = setInterval(pomoTick, 500)
    }
  } catch { /* fresh start */ }
  if (localStorage.getItem('jarvis-focus') === '1') setFocusMode(true)
  pomoRender()
})()

// ---------- music player ----------

const music = $('#boot-audio')
let tracks = []
let trackIdx = 0
let repeatOn = localStorage.getItem('jarvis-repeat') === '1'

function updatePlayer() {
  const t = tracks[trackIdx]
  $('#player-track').textContent = t ? t.name : 'no tracks'
  $('#player-play').innerHTML = music.paused ? '&#9654;' : '&#10074;&#10074;'
  $('#player-repeat').classList.toggle('on', repeatOn)
  $('#player-next').disabled = tracks.length < 2
  $('#player').classList.toggle('playing', !music.paused)
}

function playTrack(i) {
  if (!tracks.length) return
  trackIdx = ((i % tracks.length) + tracks.length) % tracks.length
  const abs = new URL(tracks[trackIdx].file, location.href).href
  if (music.src !== abs) music.src = tracks[trackIdx].file
  applyMusicVolume()
  if (soundOn) music.play().catch(() => {})
  updatePlayer()
}

async function loadPlaylist() {
  try {
    tracks = (await (await fetch('/api/music')).json()).tracks || []
  } catch {
    tracks = []
  }
  $('#player').hidden = tracks.length === 0
  updatePlayer()
}

$('#player-play').addEventListener('click', () => {
  if (!music.paused) { music.pause(); return }
  if (!music.currentSrc) { playTrack(0); return }
  if (soundOn) music.play().catch(() => {})
})
$('#player-next').addEventListener('click', () => playTrack(trackIdx + 1))
$('#player-repeat').addEventListener('click', () => {
  repeatOn = !repeatOn
  localStorage.setItem('jarvis-repeat', repeatOn ? '1' : '0')
  updatePlayer()
})
music.addEventListener('play', updatePlayer)
music.addEventListener('pause', updatePlayer)
music.addEventListener('ended', () => {
  if (repeatOn) { music.currentTime = 0; if (soundOn) music.play().catch(() => {}) }
  else if (tracks.length > 1) playTrack(trackIdx + 1)
  else updatePlayer()
})

// ---------- volume mixer ----------
// Two independent channels: the playlist element and the speech elements.
// Music defaults to 35 percent, the steady level the old post-boot fade
// always settled at; the slider is the truth at all times except the boot
// blast, which plays full and then fades down onto the slider value.

function storedVol(key, fallback) {
  const raw = localStorage.getItem(key)
  if (raw === null || raw === '') return fallback // Number(null) is 0, not NaN
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
}

const vol = { music: storedVol('jarvis-vol-music', 0.35), voice: storedVol('jarvis-vol-voice', 1) }
let bootFade = null

function applyMusicVolume() {
  clearInterval(bootFade)
  bootFade = null
  music.volume = Math.min(1, Math.max(0, vol.music))
}

function applyVoiceVolume() {
  if (currentSpeech) currentSpeech.volume = vol.voice
}

function renderMixer() {
  $('#mix-music').value = Math.round(vol.music * 100)
  $('#mix-voice').value = Math.round(vol.voice * 100)
  $('#mix-music-val').textContent = Math.round(vol.music * 100)
  $('#mix-voice-val').textContent = Math.round(vol.voice * 100)
  $('#mix-engine').textContent = voiceEngine() === 'say' ? 'MAC SAY (FREE)' : 'ELEVENLABS'
}

$('#mix-engine').addEventListener('click', () => {
  localStorage.setItem('jarvis-voice-engine', voiceEngine() === 'say' ? 'el' : 'say')
  renderMixer()
})

$('#mix-music').addEventListener('input', e => {
  vol.music = Number(e.target.value) / 100
  localStorage.setItem('jarvis-vol-music', String(vol.music))
  applyMusicVolume()
  renderMixer()
})
$('#mix-voice').addEventListener('input', e => {
  vol.voice = Number(e.target.value) / 100
  localStorage.setItem('jarvis-vol-voice', String(vol.voice))
  applyVoiceVolume()
  renderMixer()
})
$('#vol-btn').addEventListener('click', () => {
  const el = $('#mixer')
  el.hidden = !el.hidden
  if (!el.hidden) renderMixer()
})
$('#mixer-close').addEventListener('click', () => { $('#mixer').hidden = true })
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#mixer').hidden) $('#mixer').hidden = true
})
renderMixer()
applyMusicVolume()

// ---------- boot sequence ----------

function synthBootHum() {
  // Fallback when boot.mp3 is absent: a rising reactor hum, WebAudio only.
  try {
    ensureAudioCtx()
    const o1 = audioCtx.createOscillator(), o2 = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o1.type = 'sawtooth'; o2.type = 'sine'
    o1.frequency.setValueAtTime(38, audioCtx.currentTime)
    o2.frequency.setValueAtTime(76, audioCtx.currentTime)
    o1.frequency.exponentialRampToValueAtTime(96, audioCtx.currentTime + 3.2)
    o2.frequency.exponentialRampToValueAtTime(192, audioCtx.currentTime + 3.2)
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 1.2)
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 5.5)
    o1.connect(g); o2.connect(g); g.connect(audioCtx.destination)
    o1.start(); o2.start()
    o1.stop(audioCtx.currentTime + 6); o2.stop(audioCtx.currentTime + 6)
  } catch { /* silence is acceptable */ }
}

function bootLogLines() {
  const pipes = DATA?.system?.pipelines || []
  const lines = [
    ['> JARVIS OS v1.0 :: core online', 'ok'],
    ['> loading neural interface .......... OK', 'ok'],
    ['> arc reactor output ................ NOMINAL', 'ok'],
  ]
  for (const p of pipes) {
    const status = p.status === 'ok' ? 'ONLINE' : (p.status || 'unknown').toUpperCase()
    lines.push([`> ${(p.name || p.id).padEnd(24, ' ')} ${status}`, p.status === 'ok' ? 'ok' : 'warn'])
  }
  const greeting = DATA?.briefing?.greeting || 'Good morning, sir. Systems are yours.'
  lines.push(['> ' + greeting, ''])
  return lines
}

async function runBoot() {
  const btn = $('#boot-init')
  btn.disabled = true
  const music = $('#boot-audio')
  if (soundOn) {
    try {
      await music.play()
      music.volume = 1 // the boot blast; finishBoot fades onto the slider
    } catch {
      synthBootHum()
    }
  }
  const log = $('#boot-log')
  for (const [line, cls] of bootLogLines()) {
    const span = document.createElement('span')
    span.className = cls
    log.appendChild(span)
    await typewrite(span, line, 8)
    log.appendChild(document.createTextNode('\n'))
  }
  await new Promise(r => setTimeout(r, 500))
  finishBoot()
}

function finishBoot() {
  sessionStorage.setItem('jarvis-booted', '1')
  const boot = $('#boot')
  boot.classList.add('lift')
  setTimeout(() => boot.classList.add('gone'), 950)
  document.body.classList.add('ready')
  const music = $('#boot-audio')
  if (!music.paused && music.volume > vol.music) {
    // Let the track settle from the boot blast onto the mixer's level.
    // Touching the music slider cancels this and takes over directly.
    clearInterval(bootFade)
    bootFade = setInterval(() => {
      music.volume = Math.max(vol.music, music.volume - 0.05)
      if (music.volume <= vol.music + 0.001) {
        clearInterval(bootFade)
        bootFade = null
      }
    }, 200)
  }
  if (localStorage.getItem('jarvis-speak-boot') === '1') {
    const script = DATA?.briefing?.voiceScript
    if (script) setTimeout(() => speak(script), 1200)
  }
}

$('#boot-init').addEventListener('click', runBoot)
$('#boot-skip').addEventListener('click', () => {
  $('#boot-audio').pause()
  finishBoot()
})
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#boot').classList.contains('gone')) finishBoot()
})

// ---------- init ----------

;(async function init() {
  tickClock()
  startParticles()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
  await fetchData().catch(() => {
    $('#briefing-headline').textContent = 'Server unreachable. Run: node server.mjs'
  })
  connectSSE()
  loadPlaylist()
  const skip = sessionStorage.getItem('jarvis-booted') || new URLSearchParams(location.search).get('boot') === 'skip'
  if (skip) {
    $('#boot').classList.add('gone')
    document.body.classList.add('ready')
  }
})()
