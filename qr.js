'use strict';
// Per-vehicle QR codes. Each QR encodes the LAN URL of that vehicle's
// service page, so an employee can scan a printed code and land straight on it.

const os     = require('os');
const QRCode = require('qrcode');

const PORT = parseInt(process.env.PORT || '12792', 10);

// The IPv4 address phones on the same Wi-Fi can reach. Prefer real private
// LAN ranges (192.168/10/172.16-31) over VPN/tunnel ranges like 100.64/10.
function lanIp() {
  const all = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) all.push(i.address);
    }
  }
  const isPrivate = a =>
    /^192\.168\./.test(a) || /^10\./.test(a) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  return all.find(isPrivate) || all[0] || '127.0.0.1';
}

function baseUrl()      { return `http://${lanIp()}:${PORT}`; }
function vehicleUrl(id) { return `${baseUrl()}/v/${id}`; }

// SVG QR for a vehicle's service-page URL (crisp at any print size).
function vehicleQrSvg(id) {
  return QRCode.toString(vehicleUrl(id), {
    type: 'svg', margin: 1, errorCorrectionLevel: 'M',
  });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0;
    background: #f4f5f7; color: #15171c; }
  .sheet { display: flex; flex-wrap: wrap; gap: 16px; padding: 24px; }
  .card { background: #fff; border: 1px solid #d8dbe2; border-radius: 14px;
    width: 320px; padding: 22px; text-align: center; page-break-inside: avoid; }
  .card .hd { font-size: 12px; letter-spacing: 1px; text-transform: uppercase;
    color: #6b7280; }
  .card h1 { font-size: 24px; margin: 4px 0 2px; }
  .card .sub { color: #6b7280; font-size: 13px; margin-bottom: 14px; }
  .card .qr { width: 240px; height: 240px; }
  .card .cta { margin-top: 12px; font-weight: 600; font-size: 14px; }
  .card .url { margin-top: 6px; font-size: 11px; color: #9099a8;
    word-break: break-all; }
  .toolbar { padding: 16px 24px; }
  .toolbar button { font: inherit; padding: 9px 16px; border-radius: 9px;
    border: 0; background: #4f9cf9; color: #fff; cursor: pointer; }
  @media print { .toolbar { display: none; } body { background: #fff; }
    .card { border-color: #bbb; } }
`;

function cardHtml(v) {
  const subParts = [v.plate, [v.make, v.model].filter(Boolean).join(' ')]
    .filter(Boolean);
  return `<div class="card">
    <div class="hd">🚚 FleetFinder</div>
    <h1>${esc(v.name)}</h1>
    <div class="sub">${esc(subParts.join('  ·  ')) || '&nbsp;'}</div>
    <img class="qr" src="/v/${esc(v.id)}/qr.svg" alt="QR code" />
    <div class="cta">📷 Scan to open this vehicle's service page</div>
    <div class="url">${esc(vehicleUrl(v.id))}</div>
  </div>`;
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title><style>${PRINT_CSS}</style></head>
<body>${body}</body></html>`;
}

// Printable single-vehicle QR card.
function printCardHtml(v) {
  return page(`QR — ${v.name}`,
    `<div class="toolbar"><button onclick="print()">🖨 Print this QR code</button></div>
     <div class="sheet">${cardHtml(v)}</div>`);
}

// Printable sheet of every vehicle's QR code.
function sheetHtml(vehicles) {
  const cards = vehicles.length
    ? vehicles.map(cardHtml).join('')
    : '<p style="padding:24px">No vehicles yet.</p>';
  return page('Fleet QR codes',
    `<div class="toolbar"><button onclick="print()">🖨 Print all QR codes</button></div>
     <div class="sheet">${cards}</div>`);
}

module.exports = {
  lanIp, baseUrl, vehicleUrl, vehicleQrSvg, printCardHtml, sheetHtml,
};
