'use strict';
// The check-in checklist an employee must complete, in order.
// Shared by the dashboard (app.js) and the per-vehicle QR page (vehicle.js)
// so there is a single source of truth.
window.FLEET_CHECKLIST = [
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
