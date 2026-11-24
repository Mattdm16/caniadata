const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const analytics = require('../analytics.js');

const csv = fs.readFileSync(path.join(__dirname, '..', 'datos.csv'), 'utf8');
const rows = analytics.parseCsv(csv);
assert.equal(rows.length, 691, 'official integrated CSV row count');

const all = analytics.analizar(rows, { ing: 'todos', zaf: 'todas', ind: 'rendimiento' });
assert.equal(all.tieneDatos, true);
assert.equal(all.ingenios, 58);
assert.equal(all.registros, 691);
assert.equal(all.parcialUsado, true, 'all-season summary includes and marks current crop');
assert.ok(Math.abs(all.promedio - 67.26) < 0.01, 'historical national mean is area weighted');
assert.equal(all.mejor.ingenio, 'Tamazula');
assert.equal(all.mejor.zafra, '2013-2014');
assert.equal(all.mejor.valor, 129.39);
assert.deepEqual(all.ranking.slice(0, 3).map((r) => r.ingenio), ['Atencingo', 'Casasano', 'Tamazula']);

const lastComplete = analytics.analizar(rows, { ing: 'todos', zaf: '2024-2025', ind: 'rendimiento' });
assert.equal(lastComplete.parcialUsado, false);
assert.equal(lastComplete.registros, 47);
assert.ok(Math.abs(lastComplete.promedio - 62.12) < 0.01);
assert.equal(lastComplete.ranking[0].ingenio, 'Casasano');

const currentProduction = analytics.analizar(rows, { ing: 'todos', zaf: '2025-2026', ind: 'produccion' });
assert.equal(currentProduction.tieneDatos, false, 'current crop zero production is treated as not reported');
assert.equal(currentProduction.registrosSeleccionados, 40);
assert.equal(currentProduction.registrosSinDato, 40);

console.log('OK: real-data checks passed');
console.log('All zafras weighted average:', all.promedio.toFixed(2), 't/ha');
console.log('All-zafra top ingenio averages:', all.ranking.map((r) => `${r.ingenio} ${r.valor.toFixed(2)}`).join(' · '));
console.log('2024-2025 weighted average:', lastComplete.promedio.toFixed(2), 't/ha');
