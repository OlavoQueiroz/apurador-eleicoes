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
