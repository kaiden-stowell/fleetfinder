'use strict';
const $ = sel => document.querySelector(sel);

// ── The check-in checklist the employee must follow, in order ──────────────
// Every item must be completed before a check-in log can be submitted.
const CHECKLIST = [
  { key: 'odometer',         type: 'miles',
    label: 'Record current odometer reading (miles)' },
  { key: 'oilStatus',        type: 'select',
    label: 'Check oil & record oil-change status',
    options: ['Oil level OK', 'Oil change due soon', 'Oil changed today'] },
  { key: 'lastTireRotation', type: 'date',
    label: 'Tires rotated — enter date of last rotation' },
  { key: 'lastWash',         type: 'date',
    label: 'Vehicle washed — enter date of last wash' },
  { key: 'fluidsChecked',    type: 'check',
    label: 'All fluids checked (coolant, brake, washer, transmission)' },
  { key: 'tiresInspected',   type: 'check',
    label: 'Tire pressure & tread inspected' },
  { key: 'lightsTested',     type: 'check',
    label: 'Lights & turn signals tested' },
];

let vehiclesCache = [];
let currentVehicleId = null;

async function api(path, opts) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
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

// ── Dashboard rendering ────────────────────────────────────────────────────
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
  vehiclesCache = rows;
  const tb = $('#vehicles tbody');
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="8" class="empty">No vehicles yet — add one above.</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map(v => `
    <tr>
      <td>${esc(v.name)}</td>
      <td>${esc([v.make, v.model].filter(Boolean).join(' ')) || '—'}</td>
      <td>${esc(v.year) || '—'}</td>
      <td>${esc(v.plate) || '—'}</td>
      <td><span class="badge ${v.status || 'idle'}">${esc(v.status || 'idle')}</span></td>
      <td>${v.odometer != null ? esc(v.odometer) + ' mi' : '—'}</td>
      <td>${v.lastCheckIn ? new Date(v.lastCheckIn).toLocaleDateString() : '—'}</td>
      <td class="row-actions">
        <button data-checkin="${v.id}">Check-in</button>
        <button class="ghost" data-del="${v.id}">Delete</button>
      </td>
    </tr>
  `).join('');
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

// ── Vehicle row actions ────────────────────────────────────────────────────
$('#vehicles').addEventListener('click', async e => {
  const delId = e.target.dataset.del;
  const ciId  = e.target.dataset.checkin;
  if (delId) { await api('/vehicles/' + delId, { method: 'DELETE' }); refresh(); }
  if (ciId) {
    const v = vehiclesCache.find(x => x.id === ciId);
    if (v) openCheckin(v);
  }
});

// ── Check-in modal ─────────────────────────────────────────────────────────
function renderChecklist(vehicle) {
  $('#checklist').innerHTML = CHECKLIST.map((it, i) => {
    let field = '';
    if (it.type === 'miles') {
      const val = vehicle.odometer != null ? `value="${esc(vehicle.odometer)}"` : '';
      field = `<input type="number" min="0" data-key="${it.key}" placeholder="miles" ${val} />`;
    } else if (it.type === 'date') {
      const prev = it.key === 'lastTireRotation' ? vehicle.lastTireRotation
                 : it.key === 'lastWash'         ? vehicle.lastWash : '';
      field = `<input type="date" data-key="${it.key}" value="${esc(prev || '')}" />`;
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
      <span class="ck-label">${esc(it.label)}</span>
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
  renderChecklist(vehicle);
  refreshChecklistState();
  $('#modal').hidden = false;
  loadHistory(vehicle.id);
}

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
    if (currentVehicleId) loadHistory(currentVehicleId);
  };
}

refresh().catch(err => { $('#conn').textContent = 'error'; console.error(err); });
connect();
