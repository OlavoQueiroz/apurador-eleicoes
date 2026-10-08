import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Apuracao } from '../src/apuracao.js';
import { criarAnterior } from '../src/anterior.js';
import { criarServidor } from '../src/servidor.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const primeiro = {
  fonte: 'teste', ano: 2026, turno: 1,
  candidatos: { 13: { nomeUrna: 'A', partido: 'PT' }, 22: { nomeUrna: 'B', partido: 'PL' }, 55: { nomeUrna: 'C', partido: 'PSD' } },
  municipios: { m1: { uf: 'sp', votos: { 13: 40, 22: 40, 55: 20 } } },
};
const mapa = { 13: [{ de: '13', peso: 1 }], 22: [{ de: '22', peso: 1 }] };
const anterior = criarAnterior(primeiro, mapa);

function subir(turno, extras = {}) {
  const apuracao = new Apuracao({ alvos: [{ chave: '1:br', cargo: 1, uf: 'br' }], fonte: { async obter() { return { status: 'indisponivel' }; } } });
  const servidor = criarServidor({
    apuracao, meta: { ano: 2026, turno, demo: false, intervalo: 60, cargos: [1] }, diretorioPublico: path.resolve(aqui, '../public'), ...extras,
  });
  return new Promise((resolve) => servidor.listen(0, '127.0.0.1', () => resolve({ apuracao, servidor, base: `http://127.0.0.1:${servidor.address().port}` })));
}
const fechar = async ({ apuracao, servidor }) => {
  apuracao.parar();
  servidor.closeAllConnections();
  await new Promise((resolve) => servidor.close(resolve));
};

let t2;
let t1;
before(async () => {
  t2 = await subir(2, { anterior, baseSwing: { ano: 2026, turno: 1, rotulo: '1º turno de 2026', curto: '1º turno', arquivo: 'x' }, historicos: { '2022t2': criarAnterior({ ...primeiro, ano: 2022, turno: 2 }, mapa) } });
  t1 = await subir(1, { anterior });
});
after(async () => {
  await fechar(t2);
  await fechar(t1);
});

test('meta do 2º turno: base do swing, nome do modelo e candidatos do 1º turno com o total de votos', async () => {
  const meta = await (await fetch(`${t2.base}/api/meta`)).json();
  assert.equal(meta.turno, 2);
  assert.equal(meta.baseSwing.rotulo, '1º turno de 2026');
  const swing = meta.modelos.find((m) => m.id === 'swing');
  assert.match(swing.nome, /1º turno de 2026/);
  assert.equal(swing.transferencias.candidatos['55'].votos, 20);
  const meta1 = await (await fetch(`${t1.base}/api/meta`)).json();
  assert.equal(meta1.baseSwing, null);
  assert.match(meta1.modelos.find((m) => m.id === 'swing').nome, /2022/);
});

test('comparativo: períodos do 2º turno só valem no 2º turno, e os de sempre só no 1º', async () => {
  const get = async (srv, periodo) => (await fetch(`${srv.base}/api/comparativo/presidente?periodo=${periodo}`)).json();
  const a = await get(t2, '2026t2x2026t1');
  assert.equal(a.disponivel, true);
  assert.equal(a.vivo, true);
  assert.equal(a.ufs.sp.herdados['22'], 40);
  assert.equal((await get(t2, '2026t2x2022t2')).disponivel, true);
  assert.equal((await get(t2, '2026x2022')).disponivel, false);
  const b = await get(t1, '2026t2x2026t1');
  assert.equal(b.disponivel, false);
  assert.match(b.motivo, /--turno 2/);
});
