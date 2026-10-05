import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Limitador } from '../src/limitador.js';

test('dado por UF passa na frente do município', async () => {
  const l = new Limitador({ altaMs: 5, baixaMs: 5 });
  const ordem = [];
  const municipio = l.vez('baixa').then(() => ordem.push('municipio'));
  const uf = l.vez('alta').then(() => ordem.push('uf'));
  await Promise.all([municipio, uf]);
  assert.deepEqual(ordem, ['uf', 'municipio']);
});

test('429 de um lado pausa e desacelera os dois', async () => {
  const l = new Limitador({ altaMs: 10, baixaMs: 20 });
  l.recuar(60);
  const antes = Date.now();
  await l.vez('alta');
  assert.ok(Date.now() - antes >= 50, 'a UF também espera a pausa');
  assert.equal(l.altaMs, 15);
  assert.equal(l.baixaMs, 40);
  assert.equal(l.estatisticas().limitadas, 1);
});

test('conta pedidos por prioridade e por minuto', async () => {
  const l = new Limitador({ altaMs: 0, baixaMs: 0 });
  await l.vez('alta');
  await l.vez('baixa');
  await l.vez('baixa');
  const e = l.estatisticas();
  assert.deepEqual([e.alta, e.baixa, e.porMinuto], [1, 2, 3]);
});

test('o ciclo principal usa o limitador e um 429 nele faz o município recuar', async () => {
  const { Apuracao } = await import('../src/apuracao.js');
  const l = new Limitador({ altaMs: 0, baixaMs: 10 });
  const fonte = { async obter() { throw Object.assign(new Error('HTTP 429'), { status: 429, esperarMs: 5 }); } };
  const a = new Apuracao({ alvos: [{ chave: '1:sp', cargo: 1, uf: 'sp' }], fonte, limitador: l });
  await a.ciclo();
  assert.equal(a.estado.get('1:sp').status, 'erro');
  assert.equal(l.estatisticas().limitadas, 1);
  assert.equal(l.baixaMs, 20, 'o município ficou mais lento');
});

import { comRecuo } from '../src/limitador.js';

test('o ritmo volta a acelerar aos poucos depois de um minuto sem 429, sem passar do configurado', async () => {
  let agora = 1_000_000;
  const l = new Limitador({ altaMs: 10, baixaMs: 20, agora: () => agora });
  l.recuar(0);
  l.recuar(0);
  assert.equal(l.altaMs, 23); // 10 → 15 → 23
  assert.equal(l.baixaMs, 80);
  agora += 30_000;
  await l.vez('alta');
  assert.equal(l.altaMs, 23, 'menos de um minuto: segue devagar');
  agora += 31_000; // passou 1 min desde o último recuo
  await l.vez('alta');
  assert.equal(l.altaMs, 18);
  assert.equal(l.baixaMs, 64);
  for (let i = 0; i < 20; i += 1) { agora += 61_000; await l.vez('alta'); }
  assert.equal(l.altaMs, 10);
  assert.equal(l.baixaMs, 20); // volta ao configurado e para aí
});

test('comRecuo tenta de novo no 429/503, avisa, e desiste no limite ou em erro que não é pedido de calma', async () => {
  const calmo = Object.assign(new Error('HTTP 429'), { status: 429, esperarMs: 5 });
  let n = 0;
  const avisos = [];
  const ok = await comRecuo(async () => { n += 1; if (n < 3) throw calmo; return 'ok'; }, { aviso: (m) => avisos.push(m), dormirMs: async () => {} });
  assert.equal(ok, 'ok');
  assert.equal(n, 3);
  assert.equal(avisos.length, 2);

  n = 0;
  await assert.rejects(comRecuo(async () => { n += 1; throw calmo; }, { tentativas: 2, dormirMs: async () => {} }), /429/);
  assert.equal(n, 3);

  n = 0;
  await assert.rejects(comRecuo(async () => { n += 1; throw Object.assign(new Error('HTTP 500'), { status: 500 }); }, { dormirMs: async () => {} }), /500/);
  assert.equal(n, 1);
});
