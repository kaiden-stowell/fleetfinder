'use strict';
// Per-vehicle service page — the target of a scanned QR code.
// Phones on the LAN must supply the shared PIN; it is kept in localStorage.

const $ = sel => document.querySelector(sel);
const CHECKLIST = window.FLEET_CHECKLIST;
const vehicleId = location.pathname.split('/').filter(Boolean)[1]; // /v/<id>
let pin = localStorage.getItem('fleetPin') || '';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function relDays(d) {
  if (d == null) return 'no data';
  if (d < 0)  return `overdue ${Math.abs(d)}d`;
  if (d === 0) return 'due today';
  return `in ${d}d`;
}
function show(sel, on) { $(sel).hidden = !on; }

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(pin ? { 'X-Fleet-Pin': pin } : {}),
      ...(opts.headers || {}),
    },
    ...opts,
  });
  if (res.status === 401) { const e = new Error('PIN required'); e.pin = true; throw e; }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `${res.status}`);
  }
  return res.json();
}

// ── PIN gate ───────────────────────────────────────────────────────────────
async function submitPin() {
  const val = $('#pinInput').value.trim();
  if (!val) return;
  pin = val;
  try {
    await api('/vehicles/' + vehicleId);            // probe with the new PIN
    localStorage.setItem('fleetPin', pin);
    $('#pinErr').hidden = true;
    load();
  } catch (e) {
    if (e.pin) {
      $('#pinErr').hidden = false;
      localStorage.removeItem('fleetPin');
      pin = '';
    }
  }
}
$('#pinBtn').addEventListener('click', submitPin);
$('#pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitPin(); });

// ── Rendering ──────────────────────────────────────────────────────────────
function renderHeader(v) {
  const sub = [v.make, v.model, v.year].filter(Boolean).join(' ');
  $('#vHeader').innerHTML = `
    <div class="vh-name">${esc(v.name)}</div>
    <div class="vh-sub">
      <span class="badge ${v.status || 'idle'}">${esc(v.status || 'idle')}</span>
      ${sub ? `<span>${esc(sub)}</span>` : ''}
      ${v.plate ? `<span>· ${esc(v.plate)}</span>` : ''}
    </div>
    <div class="vh-meta">
      <span>Odometer: <b>${v.odometer != null ? esc(v.odometer) + ' mi' : '—'}</b></span>
      <span>Last check-in: <b>${v.lastCheckIn
        ? new Date(v.lastCheckIn).toLocaleDateString() : '—'}</b></span>
    </div>`;
}

function renderSchedule(sv) {
  if (!sv) { $('#vSchedule').innerHTML = '<p class="hint">No service data yet.</p>'; return; }
  $('#vSchedule').innerHTML = sv.items.map(it => `
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
      if (prev) hint = `Remembered: ${esc(prev)} — update only if done again`;
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
function refreshState() {
  let allDone = true;
  for (const it of CHECKLIST) {
    const done = itemComplete(it);
    if (!done) allDone = false;
    $(`.ck-item[data-for="${it.key}"]`).classList.toggle('done', done);
  }
  $('#ciSubmit').disabled = !(allDone && $('#ciEmployee').value.trim() !== '');
}

function renderHistory(logs) {
  logs.sort((a, b) => b.createdAt - a.createdAt);
  $('#logHistory').innerHTML = logs.length ? logs.map(l => `
    <div class="log">
      <div class="log-head">${new Date(l.createdAt).toLocaleString()} · ${esc(l.employee)}</div>
      <div class="log-grid">
        <span>Odometer: <b>${esc(l.odometer)} mi</b></span>
        <span>Oil: <b>${esc(l.oilStatus)}</b></span>
        <span>Tires rotated: <b>${esc(l.lastTireRotation) || '—'}</b></span>
        <span>Washed: <b>${esc(l.lastWash) || '—'}</b></span>
        <span>Fluids: <b>${l.fluidsChecked ? '✓' : '✗'}</b></span>
        <span>Tires inspected: <b>${l.tiresInspected ? '✓' : '✗'}</b></span>
        <span>Lights: <b>${l.lightsTested ? '✓' : '✗'}</b></span>
      </div>
      ${l.notes ? `<div class="log-notes">${esc(l.notes)}</div>` : ''}
    </div>
  `).join('') : '<div class="empty">No check-ins recorded yet.</div>';
}

$('#checklist').addEventListener('input', refreshState);
$('#checklist').addEventListener('change', refreshState);
$('#ciEmployee').addEventListener('input', refreshState);

$('#ciSubmit').addEventListener('click', async () => {
  const body = { employee: $('#ciEmployee').value.trim(), notes: $('#ciNotes').value.trim() };
  for (const it of CHECKLIST) body[it.key] = itemValue(it);
  $('#ciSubmit').disabled = true;
  try {
    await api('/vehicles/' + vehicleId + '/checkin', {
      method: 'POST', body: JSON.stringify(body),
    });
    $('#ciDone').hidden = false;
    $('#ciEmployee').value = '';
    $('#ciNotes').value = '';
    setTimeout(() => { $('#ciDone').hidden = true; load(); }, 1600);
  } catch (e) {
    alert('Check-in failed: ' + e.message);
    refreshState();
  }
});

// ── Damage photos ──────────────────────────────────────────────────────────
async function loadDamage() {
  try {
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
  } catch { /* schedule/PIN errors handled by load() */ }
}

$('#damageFiles').addEventListener('change', () => {
  const n = $('#damageFiles').files.length;
  $('#damageSubmit').disabled = n === 0;
  $('#damageInfo').textContent = n ? `${n} photo${n > 1 ? 's' : ''} selected` : '';
});

$('#damageForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!$('#damageFiles').files.length) return;
  const fd = new FormData();
  for (const f of $('#damageFiles').files) fd.append('photos', f);
  fd.append('note', $('#damageNote').value.trim());
  fd.append('reportedBy', $('#ciEmployee').value.trim());
  $('#damageSubmit').disabled = true;
  $('#damageInfo').textContent = 'Uploading…';
  try {
    const res = await fetch('/api/vehicles/' + vehicleId + '/damage', {
      method: 'POST',
      headers: pin ? { 'X-Fleet-Pin': pin } : {},
      body: fd,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
    $('#damageForm').reset();
    $('#damageInfo').textContent = '';
    loadDamage();
  } catch (err) {
    alert('Upload failed: ' + err.message);
    $('#damageInfo').textContent = '';
  }
});

$('#damageList').addEventListener('click', async e => {
  const id = e.target.dataset.deldmg;
  if (!id || !confirm('Delete this damage report and its photos?')) return;
  await api('/damage/' + id, { method: 'DELETE' });
  loadDamage();
});

// ── Load ───────────────────────────────────────────────────────────────────
async function load() {
  try {
    const [vehicle, sched, logs] = await Promise.all([
      api('/vehicles/' + vehicleId),
      api('/schedule'),
      api('/logs?vehicleId=' + vehicleId),
    ]);
    show('#pinGate', false);
    show('#vError', false);
    show('#vContent', true);
    document.title = `FleetFinder — ${vehicle.name}`;
    renderHeader(vehicle);
    renderSchedule(sched.vehicles.find(v => v.id === vehicleId));
    renderChecklist(vehicle);
    refreshState();
    renderHistory(logs);
    loadDamage();
  } catch (e) {
    if (e.pin) {
      show('#vContent', false);
      show('#vError', false);
      show('#pinGate', true);
      $('#pinInput').focus();
    } else {
      show('#vContent', false);
      show('#pinGate', false);
      show('#vError', true);
      $('#vError').textContent = e.message === '404'
        ? 'Vehicle not found — this QR code may be out of date.'
        : 'Could not load this vehicle: ' + e.message;
    }
  }
}

load();
