'use strict';
const $ = sel => document.querySelector(sel);

// Check-in checklist — defined once in /checklist-config.js.
const CHECKLIST = window.FLEET_CHECKLIST;

let vehiclesCache = [];
let scheduleByVehicle = {};
let damageCountByVehicle = {};
let currentVehicleId = null;

async function api(path, opts) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' }, ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${path}`);
  }
  return res.json();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// "in 3d" / "due today" / "overdue 5d"
function relDays(d) {
  if (d == null) return 'no data';
  if (d < 0)  return `overdue ${Math.abs(d)}d`;
  if (d === 0) return 'due today';
  return `in ${d}d`;
}

// How long a vehicle has been out, e.g. "45m" / "6h" / "2d"
function outFor(since) {
  if (!since) return '';
  const ms = Date.now() - since, h = ms / 3600000;
  if (h < 1)  return Math.round(ms / 60000) + 'm';
  if (h < 24) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
}

function locationCell(v) {
  if (v.location === 'jobsite') {
    return `<div class="loc out">🚧 Out on a job</div>
      <div class="loc-sub">out ${outFor(v.outSince)}</div>
      <button class="ghost loc-btn" data-return="${v.id}">Mark returned</button>`;
  }
  return `<div class="loc yard">🏢 At the yard</div>
    <button class="loc-btn" data-dispatch="${v.id}">Send out</button>`;
}

// ── Stat cards ─────────────────────────────────────────────────────────────
function renderStats(s, sched) {
  $('#stats').innerHTML = [
    { label: 'Vehicles',       num: s.vehicles },
    { label: 'Active',         num: s.active, cls: 'ok' },
    { label: 'In maintenance', num: s.maintenance, cls: 'soon' },
    { label: 'Out on jobsite', num: s.onJobsite },
    { label: 'Idle',           num: s.idle },
    { label: 'Service overdue', num: sched.overdue, cls: 'overdue' },
    { label: 'Service soon',   num: sched.soon, cls: 'soon' },
  ].map(c => `
    <div class="stat ${c.cls || ''}">
      <div class="num">${c.num}</div>
      <div class="label">${c.label}</div>
    </div>
  `).join('');
}

// ── Service-due list ───────────────────────────────────────────────────────
function renderDue(dueItems) {
  $('#dueSummary').textContent = dueItems.length
    ? `${dueItems.length} item${dueItems.length > 1 ? 's' : ''} need attention`
    : '';
  if (!dueItems.length) {
    $('#dueList').innerHTML = `<div class="all-clear">✅ All caught up — nothing due.</div>`;
    return;
  }
  $('#dueList').innerHTML = dueItems.map(d => `
    <div class="due-item ${d.status}" data-checkin="${d.vehicleId}">
      <span class="due-icon">${d.status === 'overdue' ? '⚠️' : '🕒'}</span>
      <span class="due-text"><b>${esc(d.vehicle)}</b> — ${esc(d.label)}</span>
      <span class="due-when">${relDays(d.daysUntil)}</span>
    </div>
  `).join('');
}

// ── Vehicle table ──────────────────────────────────────────────────────────
function nextPill(sv) {
  if (!sv || !sv.next) return `<span class="pill unknown">no check-ins yet</span>`;
  const n = sv.next;
  return `<span class="pill ${n.status}">${esc(n.label)} · ${relDays(n.daysUntil)}</span>`;
}

function renderVehicles(rows) {
  vehiclesCache = rows;
  const tb = $('#vehicles tbody');
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="8" class="empty">No vehicles yet — add one above.</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map(v => `
    <tr>
      <td>
        <div class="v-name">${esc(v.name)}${damageCountByVehicle[v.id]
          ? ` <span class="dmg-badge">📷 ${damageCountByVehicle[v.id]}</span>` : ''}</div>
        ${v.plate ? `<div class="v-sub">${esc(v.plate)}</div>` : ''}
      </td>
      <td>${esc([v.make, v.model, v.year].filter(Boolean).join(' ')) || '—'}</td>
      <td><span class="badge ${v.status || 'idle'}">${esc(v.status || 'idle')}</span></td>
      <td class="loc-cell">${locationCell(v)}</td>
      <td>${v.odometer != null ? esc(v.odometer) + ' mi' : '—'}</td>
      <td>${v.lastCheckIn ? new Date(v.lastCheckIn).toLocaleDateString() : '—'}</td>
      <td>${nextPill(scheduleByVehicle[v.id])}</td>
      <td class="row-actions">
        <button data-checkin="${v.id}">Check-in</button>
        <a class="btn-link" href="/v/${v.id}/print" target="_blank">QR</a>
        <button class="ghost" data-del="${v.id}">Delete</button>
      </td>
    </tr>
  `).join('');
}

// ── Recent check-ins ───────────────────────────────────────────────────────
function renderRecent(logs, vehicles) {
  const nameById = Object.fromEntries(vehicles.map(v => [v.id, v.name]));
  const rows = logs.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  $('#recent').innerHTML = rows.length ? rows.map(l => `
    <div class="recent-row">
      <b>${esc(nameById[l.vehicleId] || 'Unknown vehicle')}</b>
      <span>· ${esc(l.employee)}</span>
      <span class="r-od">· ${esc(l.odometer)} mi · ${esc(l.oilStatus)}</span>
      <span class="r-when">${new Date(l.createdAt).toLocaleString()}</span>
    </div>
  `).join('') : `<div class="empty">No check-ins recorded yet.</div>`;
}

// ── Refresh everything ─────────────────────────────────────────────────────
async function refresh() {
  const [stats, vehicles, sched, logs, damage] = await Promise.all([
    api('/stats'), api('/vehicles'), api('/schedule'), api('/logs'), api('/damage'),
  ]);
  scheduleByVehicle = Object.fromEntries(sched.vehicles.map(v => [v.id, v]));
  damageCountByVehicle = {};
  for (const d of damage) {
    damageCountByVehicle[d.vehicleId] = (damageCountByVehicle[d.vehicleId] || 0) + 1;
  }
  renderStats(stats, sched.summary);
  renderDue(sched.dueItems);
  renderOut(vehicles);
  renderVehicles(vehicles);
  renderRecent(logs, vehicles);
}

// ── Vehicles currently out on jobsites ─────────────────────────────────────
function renderOut(vehicles) {
  const out = vehicles.filter(v => v.location === 'jobsite')
    .sort((a, b) => (a.outSince || 0) - (b.outSince || 0));
  $('#outSummary').textContent = out.length
    ? `${out.length} vehicle${out.length > 1 ? 's' : ''} out` : '';
  if (!out.length) {
    $('#outList').innerHTML = `<div class="all-clear">🏢 All vehicles are at the yard.</div>`;
    return;
  }
  $('#outList').innerHTML = out.map(v => `
    <div class="due-item" data-return="${v.id}" title="Click to mark returned">
      <span class="due-icon">🚧</span>
      <span class="due-text"><b>${esc(v.name)}</b> — out on a job</span>
      <span class="due-when">out ${outFor(v.outSince)}</span>
    </div>
  `).join('');
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

// ── Open check-in from a vehicle row or a due-list item ────────────────────
function handleCheckinClick(e) {
  const id = e.target.closest('[data-checkin]')?.dataset.checkin;
  if (!id) return;
  const v = vehiclesCache.find(x => x.id === id);
  if (v) openCheckin(v);
}
$('#vehicles').addEventListener('click', async e => {
  const delId  = e.target.dataset.del;
  const dispId = e.target.dataset.dispatch;
  const retId  = e.target.dataset.return;
  if (delId)  { await api('/vehicles/' + delId, { method: 'DELETE' }); refresh(); return; }
  if (dispId) { openDispatch(dispId); return; }
  if (retId)  { markReturned(retId); return; }
  handleCheckinClick(e);
});
$('#dueList').addEventListener('click', handleCheckinClick);
$('#outList').addEventListener('click', e => {
  const id = e.target.closest('[data-return]')?.dataset.return;
  if (id) markReturned(id);
});

// ── Dispatch / return ──────────────────────────────────────────────────────
let dispatchVehicleId = null;

function openDispatch(id) {
  const v = vehiclesCache.find(x => x.id === id);
  if (!v) return;
  dispatchVehicleId = id;
  $('#dispVehicle').textContent = `Sending out: ${v.name}`;
  $('#dispDriver').value = '';
  $('#dispBy').value = '';
  $('#dispatchModal').hidden = false;
  $('#dispDriver').focus();
}
function closeDispatch() { $('#dispatchModal').hidden = true; dispatchVehicleId = null; }

$('#dispClose').addEventListener('click', closeDispatch);
$('#dispatchModal').addEventListener('click', e => {
  if (e.target.id === 'dispatchModal') closeDispatch();
});
$('#dispConfirm').addEventListener('click', async () => {
  if (!dispatchVehicleId) return;
  $('#dispConfirm').disabled = true;
  try {
    await api(`/vehicles/${dispatchVehicleId}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({
        driver:       $('#dispDriver').value.trim(),
        dispatchedBy: $('#dispBy').value.trim(),
      }),
    });
    closeDispatch();
    refresh();
  } catch (e) {
    alert('Could not dispatch: ' + e.message);
  } finally {
    $('#dispConfirm').disabled = false;
  }
});

async function markReturned(id) {
  const v = vehiclesCache.find(x => x.id === id);
  if (!confirm(`Mark ${v ? v.name : 'this vehicle'} as back at the business?`)) return;
  try {
    await api(`/vehicles/${id}/return`, { method: 'POST' });
    refresh();
  } catch (e) {
    alert('Could not mark returned: ' + e.message);
  }
}

// ── Check-in modal ─────────────────────────────────────────────────────────
function renderModalSchedule(vehicleId) {
  const sv = scheduleByVehicle[vehicleId];
  if (!sv) { $('#ciSchedule').innerHTML = ''; return; }
  $('#ciSchedule').innerHTML = sv.items.map(it => `
    <div class="ci-svc ${it.status}">
      <div class="s-label">${esc(it.label)}</div>
      <div class="s-when">${it.status === 'unknown' ? 'no data' : relDays(it.daysUntil)}</div>
    </div>
  `).join('');
}

function renderChecklist(vehicle) {
  $('#checklist').innerHTML = CHECKLIST.map((it, i) => {
    let field = '', hint = '';
    if (it.type === 'miles') {
      const val = vehicle.odometer != null ? `value="${esc(vehicle.odometer)}"` : '';
      field = `<input type="number" min="0" data-key="${it.key}" placeholder="miles" ${val} />`;
      if (vehicle.odometer != null) hint = `Last recorded: ${esc(vehicle.odometer)} mi`;
    } else if (it.type === 'date') {
      const prev = it.key === 'lastTireRotation' ? vehicle.lastTireRotation
                 : it.key === 'lastWash'         ? vehicle.lastWash : '';
      field = `<input type="date" data-key="${it.key}" value="${esc(prev || '')}" />`;
      if (prev) hint = `Remembered from last check-in: ${esc(prev)} — update only if done again`;
    } else if (it.type === 'select') {
      field = `<select data-key="${it.key}">
        <option value="">— select —</option>
        ${it.options.map(o => `<option>${esc(o)}</option>`).join('')}
      </select>`;
    } else {
      field = `<input type="checkbox" data-key="${it.key}" />`;
    }
    return `<div class="ck-item" data-for="${it.key}">
      <span class="ck-dot"></span>
      <span class="ck-num">${i + 1}</span>
      <div class="ck-text">
        <span class="ck-label">${esc(it.label)}</span>
        ${hint ? `<span class="ck-hint">${hint}</span>` : ''}
      </div>
      <span class="ck-field">${field}</span>
    </div>`;
  }).join('');
}

function itemValue(it) {
  const el = $(`#checklist [data-key="${it.key}"]`);
  if (it.type === 'check') return el.checked;
  if (it.type === 'miles') return el.value === '' ? null : Number(el.value);
  return el.value || null;
}
function itemComplete(it) {
  const v = itemValue(it);
  if (it.type === 'check') return v === true;
  if (it.type === 'miles') return v != null && v >= 0;
  return v != null && v !== '';
}
function refreshChecklistState() {
  let allDone = true;
  for (const it of CHECKLIST) {
    const done = itemComplete(it);
    if (!done) allDone = false;
    $(`.ck-item[data-for="${it.key}"]`).classList.toggle('done', done);
  }
  const empOk = $('#ciEmployee').value.trim() !== '';
  $('#ciSubmit').disabled = !(allDone && empOk);
}

async function loadHistory(vehicleId) {
  const logs = await api('/logs?vehicleId=' + vehicleId);
  logs.sort((a, b) => b.createdAt - a.createdAt);
  $('#logHistory').innerHTML = logs.length ? logs.map(l => `
    <div class="log">
      <div class="log-head">${new Date(l.createdAt).toLocaleString()} · ${esc(l.employee)}</div>
      <div class="log-grid">
        <span>Odometer: <b>${esc(l.odometer)} mi</b></span>
        <span>Oil: <b>${esc(l.oilStatus)}</b></span>
        <span>Tires rotated: <b>${esc(l.lastTireRotation) || '—'}</b></span>
        <span>Washed: <b>${esc(l.lastWash) || '—'}</b></span>
        <span>Fluids checked: <b>${l.fluidsChecked ? '✓' : '✗'}</b></span>
        <span>Tires inspected: <b>${l.tiresInspected ? '✓' : '✗'}</b></span>
        <span>Lights tested: <b>${l.lightsTested ? '✓' : '✗'}</b></span>
      </div>
      ${l.notes ? `<div class="log-notes">${esc(l.notes)}</div>` : ''}
    </div>
  `).join('') : '<div class="empty">No check-ins recorded yet.</div>';
}

function openCheckin(vehicle) {
  currentVehicleId = vehicle.id;
  $('#modalTitle').textContent = `Check-in — ${vehicle.name}`;
  $('#ciEmployee').value = '';
  $('#ciNotes').value = '';
  renderModalSchedule(vehicle.id);
  renderChecklist(vehicle);
  refreshChecklistState();
  $('#damageForm').reset();
  $('#damageInfo').textContent = '';
  $('#damageSubmit').disabled = true;
  $('#modal').hidden = false;
  loadHistory(vehicle.id);
  loadDamage(vehicle.id);
}

// ── Damage photos ──────────────────────────────────────────────────────────
async function loadDamage(vehicleId) {
  const records = await api('/damage?vehicleId=' + vehicleId);
  records.sort((a, b) => b.createdAt - a.createdAt);
  $('#damageList').innerHTML = records.length ? records.map(d => `
    <div class="damage-card">
      <div class="damage-photos">
        ${(d.files || []).map(f => `<a href="/uploads/${esc(f)}" target="_blank">
          <img src="/uploads/${esc(f)}" alt="damage photo" /></a>`).join('')}
      </div>
      <div class="damage-meta">
        <span>${new Date(d.createdAt).toLocaleString()}${d.reportedBy ? ' · ' + esc(d.reportedBy) : ''}</span>
        <button class="ghost" data-deldmg="${d.id}">Delete</button>
      </div>
      ${d.note ? `<div class="damage-note">${esc(d.note)}</div>` : ''}
    </div>
  `).join('') : '<div class="empty">No damage photos for this vehicle.</div>';
}

$('#damageFiles').addEventListener('change', () => {
  const n = $('#damageFiles').files.length;
  $('#damageSubmit').disabled = n === 0;
  $('#damageInfo').textContent = n ? `${n} photo${n > 1 ? 's' : ''} selected` : '';
});

$('#damageForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentVehicleId || !$('#damageFiles').files.length) return;
  const fd = new FormData();
  for (const f of $('#damageFiles').files) fd.append('photos', f);
  fd.append('note', $('#damageNote').value.trim());
  $('#damageSubmit').disabled = true;
  $('#damageInfo').textContent = 'Uploading…';
  try {
    const res = await fetch(`/api/vehicles/${currentVehicleId}/damage`,
      { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
    $('#damageForm').reset();
    $('#damageInfo').textContent = '';
    loadDamage(currentVehicleId);
    refresh();
  } catch (err) {
    alert('Upload failed: ' + err.message);
    $('#damageInfo').textContent = '';
  }
});

$('#damageList').addEventListener('click', async e => {
  const id = e.target.dataset.deldmg;
  if (!id || !confirm('Delete this damage report and its photos?')) return;
  await api('/damage/' + id, { method: 'DELETE' });
  loadDamage(currentVehicleId);
  refresh();
});
function closeModal() {
  $('#modal').hidden = true;
  currentVehicleId = null;
}

$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
$('#checklist').addEventListener('input', refreshChecklistState);
$('#checklist').addEventListener('change', refreshChecklistState);
$('#ciEmployee').addEventListener('input', refreshChecklistState);

$('#ciSubmit').addEventListener('click', async () => {
  if (!currentVehicleId) return;
  const body = { employee: $('#ciEmployee').value.trim(), notes: $('#ciNotes').value.trim() };
  for (const it of CHECKLIST) body[it.key] = itemValue(it);
  $('#ciSubmit').disabled = true;
  try {
    await api(`/vehicles/${currentVehicleId}/checkin`, {
      method: 'POST', body: JSON.stringify(body),
    });
    closeModal();
    refresh();
  } catch (err) {
    alert('Check-in failed: ' + err.message);
    refreshChecklistState();
  }
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
  ws.onmessage = () => {
    refresh();
    if (currentVehicleId) {
      renderModalSchedule(currentVehicleId);
      loadHistory(currentVehicleId);
      loadDamage(currentVehicleId);
    }
  };
}

refresh().catch(err => { $('#conn').textContent = 'error'; console.error(err); });
connect();
