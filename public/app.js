'use strict';
const $ = sel => document.querySelector(sel);

async function api(path, opts) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

function renderStats(s) {
  $('#stats').innerHTML = [
    ['Vehicles', s.vehicles], ['Active', s.active],
    ['Maintenance', s.maintenance], ['Idle', s.idle],
    ['Drivers', s.drivers], ['Open jobs', s.openMaintenance],
  ].map(([label, num]) => `
    <div class="stat"><div class="num">${num}</div><div class="label">${label}</div></div>
  `).join('');
}

function renderVehicles(rows) {
  const tb = $('#vehicles tbody');
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="6" class="empty">No vehicles yet — add one above.</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map(v => `
    <tr>
      <td>${esc(v.name)}</td>
      <td>${esc([v.make, v.model].filter(Boolean).join(' ')) || '—'}</td>
      <td>${esc(v.year) || '—'}</td>
      <td>${esc(v.plate) || '—'}</td>
      <td><span class="badge ${v.status || 'idle'}">${esc(v.status || 'idle')}</span></td>
      <td><button class="ghost" data-del="${v.id}">Delete</button></td>
    </tr>
  `).join('');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function refresh() {
  const [stats, vehicles] = await Promise.all([api('/stats'), api('/vehicles')]);
  renderStats(stats);
  renderVehicles(vehicles);
}

// ── Add vehicle ────────────────────────────────────────────────────────────
$('#addBtn').addEventListener('click', () => {
  $('#addForm').hidden = !$('#addForm').hidden;
});
$('#addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries([...fd.entries()].filter(([, v]) => v !== ''));
  await api('/vehicles', { method: 'POST', body: JSON.stringify(body) });
  e.target.reset();
  e.target.hidden = true;
  refresh();
});

// ── Delete vehicle ─────────────────────────────────────────────────────────
$('#vehicles').addEventListener('click', async e => {
  const id = e.target.dataset.del;
  if (!id) return;
  await api('/vehicles/' + id, { method: 'DELETE' });
  refresh();
});

// ── Live updates over WebSocket ────────────────────────────────────────────
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen  = () => { $('#conn').textContent = 'live'; $('#conn').classList.add('live'); };
  ws.onclose = () => {
    $('#conn').textContent = 'reconnecting…';
    $('#conn').classList.remove('live');
    setTimeout(connect, 2000);
  };
  ws.onmessage = () => refresh();
}

refresh().catch(err => { $('#conn').textContent = 'error'; console.error(err); });
connect();
