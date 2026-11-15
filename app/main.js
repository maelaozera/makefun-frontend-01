// make.fun lite: a fast, read-only make.fun frontend. One ES module, no
// framework, no build step. It reads make.fun's public API alone (GET, CORS
// open) and shows four surfaces, each by a link and by its own hash URL:
//
//   #/                          live bounty board
//   #/bounty/<slug>             one bounty's page
//   #/bounty/<slug>/leaderboard that bounty's leaderboard
//   #/profile/<handle>          an account's public profile
//
// API answers are cached in memory and revalidated with ETag /
// If-None-Match (a 304 costs nothing), views update in place, long lists
// page client-side, each view fetches one API answer. window.__shotReady
// is false while a route loads, true once it renders.

const API = 'https://make.fun/api';
const app = document.getElementById('app');

// ------------------------------------------------------------ API + cache

/** url -> {etag, body, at}: fresh for 60 s, then revalidated with ETag. */
const cache = new Map();

async function api(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < 60000) return hit.body;
  const headers = hit && hit.etag ? { 'If-None-Match': hit.etag } : {};
  const res = await fetch(API + path, { headers });
  if (res.status === 304 && hit) {
    hit.at = Date.now();
    return hit.body;
  }
  if (!res.ok) throw new Error(`make.fun answered ${res.status}`);
  const body = await res.json();
  cache.set(path, { etag: res.headers.get('etag'), body, at: Date.now() });
  return body;
}

const getBounties = () => api('/competitions?status=open&activity=times&limit=100');
const getBounty = (slug) => api(`/competitions/${encodeURIComponent(slug)}`);
const getLeaderboard = (slug) => api(`/competitions/${encodeURIComponent(slug)}/leaderboard?limit=100`);
const getProfile = (handle) => api(`/profiles/${encodeURIComponent(handle)}`);

// ------------------------------------------------------------ formatting

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(n) ? 0 : 2 });
}

function date(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

function timeLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'ended';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

/** A score: judge win rate is micro-percent, PnL micro-USDC. */
function fmtScore(s) {
  if (s == null) return '—';
  if (typeof s === 'number' || typeof s === 'string') return esc(s);
  const col = s.column || {};
  const v = Number(s.value);
  if (!Number.isFinite(v)) return esc(s.display ?? '—');
  if (col.key === 'judge') return `${(v / 10000).toFixed(2)}%`;
  if (col.key === 'net_pnl') return money(v / 1000000);
  return v.toFixed(Number.isInteger(col.precision) ? col.precision : 2);
}

/** Live pot = prize + entry fees paid in. */
const potOf = (b) => Number(b.potUsd ?? b.rewardAmount ?? 0);
const feeOf = (b) => (b.entryFeeUsd == null ? null : Number(b.entryFeeUsd));
const openOf = (b) => new Date(b.deadline).getTime() > Date.now();

// ------------------------------------------------------------ shared bits

function fail(err) {
  app.innerHTML = `<div class="error" role="alert"><h1>Could not load this page</h1>
    <p>${esc(err.message || 'The make.fun API did not answer.')}</p>
    <p><a href="#/">Back to the board</a></p></div>`;
  document.title = 'Error | make.fun bounties';
  window.__shotReady = true;
}

/** Keep every "[data-deadline]" time-left label fresh without a re-render. */
setInterval(() => {
  for (const el of document.querySelectorAll('[data-deadline]')) el.textContent = timeLeft(el.dataset.deadline);
}, 30000);

// ------------------------------------------------------------ board

let boardItems = [];
let boardQuery = '';
let boardSort = 'pot';
let boardShown = 30;

const sorts = {
  pot: (a, b) => potOf(b) - potOf(a),
  deadline: (a, b) => new Date(a.deadline) - new Date(b.deadline),
  entries: (a, b) => (b.submissionCount || 0) - (a.submissionCount || 0),
  title: (a, b) => String(a.title).localeCompare(b.title),
};

function boardFiltered() {
  const q = boardQuery.trim().toLowerCase();
  return boardItems
    .filter((b) => openOf(b) && (!q || `${b.title} ${b.slug} ${b.category || ''}`.toLowerCase().includes(q)))
    .sort(sorts[boardSort] || sorts.pot);
}

function boardCard(b) {
  const fee = feeOf(b);
  return `<li class="card"><h2><a href="#/bounty/${encodeURIComponent(b.slug)}">${esc(b.title)}</a></h2>
    <p class="meta"><span class="pot">Pot <b>${money(potOf(b))}</b></span>
    <span>${fee == null ? 'Free to enter' : `${money(fee)} entry fee`}</span>
    <span data-deadline="${esc(b.deadline)}">${timeLeft(b.deadline)}</span>
    <span>${b.submissionCount ?? 0} entries</span><span>${esc(b.category || '')}</span></p>
    <p class="small"><a href="#/bounty/${encodeURIComponent(b.slug)}/leaderboard">Leaderboard</a></p></li>`;
}

function renderBoardList() {
  const list = boardFiltered();
  const el = document.getElementById('list');
  if (!el) return;
  el.innerHTML = list.slice(0, boardShown).map(boardCard).join('') || '<li class="card"><p>No open bounties match.</p></li>';
  document.getElementById('count').textContent = `${list.length} open ${list.length === 1 ? 'bounty' : 'bounties'}`;
  document.getElementById('more').hidden = list.length <= boardShown;
}

async function boardView() {
  document.title = 'make.fun bounties';
  app.innerHTML = `<h1>Open bounties</h1>
    <p class="muted" id="count" role="status">Loading…</p>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search bounties…  ( / )" aria-label="Search bounties" autocomplete="off">
      <select id="sort" aria-label="Sort bounties">
        <option value="pot">Largest pot</option>
        <option value="deadline">Ending soonest</option>
        <option value="entries">Most entries</option>
        <option value="title">Title A–Z</option>
      </select>
      <button type="button" id="refresh">Refresh</button>
    </div>
    <ul class="board" id="list"></ul>
    <p class="more"><button type="button" id="more" hidden>Show more</button></p>`;
  const q = document.getElementById('q');
  q.value = boardQuery;
  document.getElementById('sort').value = boardSort;
  q.addEventListener('input', () => {
    boardQuery = q.value;
    boardShown = 30;
    renderBoardList();
  });
  document.getElementById('sort').addEventListener('change', (e) => {
    boardSort = e.target.value;
    renderBoardList();
  });
  document.getElementById('more').addEventListener('click', () => {
    boardShown += 30;
    renderBoardList();
  });
  document.getElementById('refresh').addEventListener('click', async () => {
    cache.delete('/competitions?status=open&activity=times&limit=100');
    try {
      boardItems = (await getBounties()).items || [];
      renderBoardList();
    } catch (err) {
      fail(err);
    }
  });
  try {
    boardItems = (await getBounties()).items || [];
    renderBoardList();
  } catch (err) {
    fail(err);
    return;
  }
  window.__shotReady = true;
}

// ------------------------------------------------------------ bounty page

function rewardsTable(b) {
  const rows = b.rewardsNow || [];
  if (!rows.length && !b.rewards) return '';
  const body = rows.length
    ? rows.map((r) => `<tr><td>#${esc(r.place)}</td><td class="num">${money(r.amountUsd)}</td></tr>`).join('')
    : Object.entries(b.rewards).map(([p, amt]) => `<tr><td>#${esc(p)}</td><td class="num">${money(amt)}</td></tr>`).join('');
  return `<h2>Rewards</h2><table><thead><tr><th>Place</th><th class="num">Now</th></tr></thead><tbody>${body}</tbody></table>`;
}

async function bountyView(slug) {
  let b;
  try {
    b = await getBounty(slug);
  } catch (err) {
    fail(err);
    return;
  }
  const fee = feeOf(b);
  document.title = `${b.title} | make.fun bounties`;
  app.innerHTML = `<p><a href="#/">← All bounties</a></p>
    <h1>${esc(b.title)}</h1>
    <p class="muted">${esc(b.category || '')} · ${openOf(b) ? 'Open for entries' : 'Entries closed'} · by ${esc(b.sponsor?.name || 'make.fun')}</p>
    <p>${esc(b.summary || '')}</p>
    <div class="stats">
      <div class="stat"><div class="k">Live pot</div><div class="v pot">${money(potOf(b))}</div>
        <div class="small muted">${b.entryFeePayers ? `${money(b.entryFeesUsd || 0)} from ${b.entryFeePayers} entry fees` : 'prize only'}</div></div>
      <div class="stat"><div class="k">Entry fee</div><div class="v">${fee == null ? 'Free' : money(fee)}</div></div>
      <div class="stat"><div class="k">Time left</div><div class="v" data-deadline="${esc(b.deadline)}">${timeLeft(b.deadline)}</div>
        <div class="small muted">Ends ${date(b.deadline)}</div></div>
      <div class="stat"><div class="k">Entries</div><div class="v">${b.submissionCount ?? 0}</div></div>
    </div>
    <p><a href="#/bounty/${encodeURIComponent(b.slug)}/leaderboard">View leaderboard →</a> ·
    <a href="https://make.fun${esc(b.url || `/bounty/${b.slug}`)}">On make.fun ↗</a></p>
    ${rewardsTable(b)}
    <h2>Description</h2>
    <div class="desc">${esc(b.description || '')}</div>`;
  window.__shotReady = true;
}

// ------------------------------------------------------------ leaderboard

async function leaderboardView(slug) {
  let b;
  let data;
  try {
    [b, data] = await Promise.all([getBounty(slug), getLeaderboard(slug)]);
  } catch (err) {
    fail(err);
    return;
  }
  const rows = Array.isArray(data) ? data : data.entries || data.items || data.rows || data.leaderboard || [];
  const shown = rows.slice(0, 100);
  const key = data.rank_key || 'score';
  const col = (data.columns || []).find((c) => c.key === key) || {};
  const scoreTitle = col.title || 'Score';
  const hasCost = rows.some((r) => r.cost && r.cost.micro_usd != null);
  document.title = `Leaderboard: ${b.title} | make.fun bounties`;
  app.innerHTML = `<p><a href="#/bounty/${encodeURIComponent(b.slug)}">← ${esc(b.title)}</a></p>
    <h1>Leaderboard</h1>
    <p class="muted" role="status">${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}${data.phase && data.phase.placements_held && !data.phase.scores_visible ? ' · scores held until results publish' : ''}</p>
    ${rows.length ? `<table><thead><tr><th class="num">#</th><th>Entrant</th><th>Entry</th><th class="num">${esc(scoreTitle)}</th>${hasCost ? '<th class="num">Build cost</th>' : ''}</tr></thead>
    <tbody>${shown.map((r, i) => {
      const h = r.handle || r.username || r.account?.handle || r.owner?.handle || r.entrant?.handle || r.entrant || '';
      const rank = r.rank ?? r.place ?? r.position ?? i + 1;
      const raw = r.values ? r.values[key] : r.score?.value ?? r.score ?? r.value;
      const n = Number(raw ?? (r.display ? r.display[key] : undefined));
      const score = !Number.isFinite(n) ? '—' : key === 'judge' ? `${(n / 10000).toFixed(2)}%` : key === 'net_pnl' ? money(n / 1000000) : n.toFixed(Number.isInteger(col.precision) ? col.precision : 2);
      const cost = r.cost && r.cost.micro_usd != null ? money(Number(r.cost.micro_usd) / 1000000) : '—';
      return `<tr><td class="num">${esc(rank)}</td>
        <td>${h ? `<a href="#/profile/${encodeURIComponent(h)}">@${esc(h)}</a>` : '—'}</td>
        <td>${esc(r.title || r.submission_title || '')}${r.prize_rank ? ` · #${esc(r.prize_rank)} prize` : ''}</td>
        <td class="num">${score}</td>
        ${hasCost ? `<td class="num">${cost}</td>` : ''}</tr>`;
    }).join('')}</tbody></table>` : '<p>No entries on the leaderboard yet.</p>'}
    ${rows.length > 100 ? '<p class="small muted">Showing the top 100.</p>' : ''}`;
  window.__shotReady = true;
}

// ------------------------------------------------------------ profile

async function profileView(handle) {
  let p;
  try {
    p = await getProfile(handle);
  } catch (err) {
    fail(err);
    return;
  }
  const rec = p.record || {};
  const sols = p.solutions || [];
  const links = [];
  if (p.github_login) links.push(`<li><a href="https://github.com/${encodeURIComponent(p.github_login)}">GitHub @${esc(p.github_login)}</a></li>`);
  if (p.x?.username) links.push(`<li><a href="https://x.com/${encodeURIComponent(p.x.username)}">X @${esc(p.x.username)}</a></li>`);
  if (p.discord?.url) links.push(`<li><a href="${esc(p.discord.url)}">Discord ${esc(p.discord.username || p.discord.global_name || '')}</a></li>`);
  if (p.wallet?.explorer_url) links.push(`<li><a href="${esc(p.wallet.explorer_url)}">Wallet ${esc((p.wallet.address || '').slice(0, 8))}…</a></li>`);
  document.title = `@${p.handle} | make.fun bounties`;
  app.innerHTML = `<p><a href="#/">← All bounties</a></p>
    <div class="profile">
      ${p.image ? `<img src="${esc(p.image)}" alt="" crossorigin="anonymous" width="72" height="72">` : ''}
      <div><h1>@${esc(p.handle)}</h1>
      ${p.display_name ? `<p>${esc(p.display_name)}</p>` : ''}
      ${p.bio ? `<p>${esc(p.bio)}</p>` : ''}</div>
    </div>
    ${links.length ? `<ul class="links">${links.join('')}</ul>` : ''}
    <div class="stats">
      <div class="stat"><div class="k">Entered</div><div class="v">${rec.competitions_entered ?? 0}</div></div>
      <div class="stat"><div class="k">Won</div><div class="v">${rec.competitions_won ?? 0}</div></div>
      <div class="stat"><div class="k">Placed</div><div class="v">${rec.competitions_placed ?? 0}</div></div>
      <div class="stat"><div class="k">Best place</div><div class="v">${rec.best_placement ? `#${rec.best_placement}` : '—'}</div></div>
      <div class="stat"><div class="k">Prize money</div><div class="v">${money(rec.prize_usd)}</div></div>
    </div>
    <h2>Entries (${sols.length})</h2>
    ${sols.length ? `<table><thead><tr><th>Entry</th><th>Bounty</th><th class="num">Place</th><th class="num">Score</th></tr></thead>
    <tbody>${sols.slice(0, 20).map((s) => `<tr>
      <td>${esc(s.title || '')}</td>
      <td><a href="#/bounty/${encodeURIComponent(s.competition?.slug || '')}">${esc(s.competition?.title || '')}</a></td>
      <td class="num">${s.placement ? `#${esc(s.placement)}` : '—'}${s.prize_usd ? ` · ${money(s.prize_usd)}` : ''}</td>
      <td class="num">${fmtScore(s.score)}</td></tr>`).join('')}</tbody></table>` : '<p>No entries yet.</p>'}
    ${sols.length > 20 ? '<p class="small muted">Showing the latest 20.</p>' : ''}`;
  window.__shotReady = true;
}

// ------------------------------------------------------------ router

async function render() {
  window.__shotReady = false;
  const hash = location.hash || '#/';
  let m = hash.match(/^#\/bounty\/([^/?#]+)\/leaderboard\/?$/);
  if (m) return leaderboardView(decodeURIComponent(m[1]));
  m = hash.match(/^#\/bounty\/([^/?#]+)\/?$/);
  if (m) return bountyView(decodeURIComponent(m[1]));
  m = hash.match(/^#\/profile\/([^/?#]+)\/?$/);
  if (m) return profileView(decodeURIComponent(m[1]));
  return boardView();
}

window.addEventListener('hashchange', render);

/** "/" focuses the board search, from anywhere. */
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.target.matches('input, select, textarea')) return;
  const q = document.getElementById('q');
  if (q) {
    e.preventDefault();
    q.focus();
  }
});

render();
