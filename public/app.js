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
        <div class="feed-title">${esc(s.title)}<span class="mod">${esc(s.module)}</span></div>
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
  const tick = e.target.closest('.todo-tick')
  if (tick) {
    tick.disabled = true
    try {
      await fetch('/api/todo', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: tick.dataset.todo, done: true }),
      })
      fetchData()
    } catch { tick.disabled = false }
    return
  }
  const t = e.target.closest('.act-btn')
  if (!t) return
  if (t.dataset.url) openTarget(t.dataset.url)
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
          ${t.doc ? `<button class="act-btn" data-doc="${esc(t.doc)}">GUIDE: ${esc(t.doc)}</button>` : ''}
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
  const open = (u.assignments || []).filter(a => a.status !== 'done')
  const rows = open.map(a => {
    const d = dueLabel(a.due)
    return `<div class="asg">
      <span class="asg-title"><span class="code">${esc(a.subject)}</span>${esc(a.title)}</span>
      <span class="asg-due ${d.cls}">${d.text}</span>
      <div class="asg-bar"><i style="width:${Math.min(100, a.progressPct ?? 0)}%"></i></div>
      ${a.nextAction ? `<span class="asg-next">next: ${esc(a.nextAction)}</span>` : ''}
    </div>`
  }).join('')
  const setup = u.setupNote ? `<div class="setup">${esc(u.setupNote)}</div>` : ''
  box.innerHTML = `<div class="subj-row">${subjects}</div>` + (rows || '<p class="empty">No open assignments. Semester break, or the feed needs a refresh.</p>') + setup
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

async function speak(text) {
  if (!text || !soundOn) return
  stopSpeech()
  try {
    const res = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    if (!res.ok) throw new Error('tts ' + res.status)
    const blob = await res.blob()
    stopSpeech() // a second request may have started while this one was rendering
    const el = new Audio(URL.createObjectURL(blob))
    el.crossOrigin = 'anonymous'
    currentSpeech = el
    el.addEventListener('ended', () => { if (currentSpeech === el) currentSpeech = null })
    pulseCoreFrom(el)
    await el.play()
  } catch (e) {
    console.warn('speak failed', e)
  }
}

// ---------- ask ----------

async function ask(question) {
  const panel = $('#answer'), body = $('#answer-body')
  panel.hidden = false
  body.innerHTML = 'Processing<span class="cursor"></span>'
  let j = null
  let streamedText = ''
  try {
    const res = await fetch('/api/ask' + (WORK_PARAM ? '?work=1' : ''), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, stream: true }),
    })
    if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
      // Words render as claude writes them; the done event carries the
      // authoritative final answer (interim tool narration gets replaced).
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let started = false
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
            if (!started) { started = true; body.textContent = '' }
            streamedText += data.text
            body.textContent = streamedText
            body.scrollTop = body.scrollHeight
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

$('#ask-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    const text = e.target.value.trim()
    const fb = text.match(/^(?:fb|feedback):\s*(.+)/i)
    const win = text.match(/^win:\s*(.+)/i)
    if (fb) sendFeedback(fb[1])
    else if (win) sendWin(win[1])
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

// ---------- conversation log ----------

async function toggleConvo() {
  const el = $('#convo')
  if (!el.hidden) { el.hidden = true; return }
  el.hidden = false
  const body = $('#convo-body')
  body.innerHTML = '<p class="empty">Loading the record...</p>'
  try {
    const j = await (await fetch('/api/conversations' + (WORK_PARAM ? '?work=1' : ''))).json()
    const stamp = at => new Date(at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    body.innerHTML = (j.entries || []).map(e => `
      <div class="convo-row">
        <div class="convo-q">${esc(e.q)}<span class="convo-at">${stamp(e.at)}</span></div>
        <div class="convo-a">${esc(e.a)}</div>
      </div>`).join('') || '<p class="empty">No conversations on record yet. Everything we say via the prompt is kept here.</p>'
    body.scrollTop = body.scrollHeight
  } catch {
    body.innerHTML = '<p class="empty">Log unavailable.</p>'
  }
}

$('#log-btn').addEventListener('click', toggleConvo)
$('#convo-close').addEventListener('click', () => { $('#convo').hidden = true })
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#convo').hidden) $('#convo').hidden = true
})

$('#voice-stop').addEventListener('click', stopSpeech)
addEventListener('keydown', e => {
  if (e.key === 'Escape') stopSpeech()
})

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
      music.volume = 1
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
  if (!music.paused) {
    // Let the track ride under the morning read, at a civilised level.
    const fade = setInterval(() => {
      music.volume = Math.max(0.35, music.volume - 0.05)
      if (music.volume <= 0.35) clearInterval(fade)
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
