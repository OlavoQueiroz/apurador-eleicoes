import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { criarRegistroRequisicoes, gravarRitmoAprendido, lerRitmoAprendido, linhaDoEvento, linhaDoMinuto } from '../src/metricas.js';

test('registro: uma linha JSON por chamada, criando a pasta', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'metricas-'));
  const r = criarRegistroRequisicoes(path.join(dir, 'a', 'b', 'x.jsonl'));
  await r.gravar(linhaDoMinuto({ porMinuto: 12, limitadas: 0 }, new Date('2026-10-25T20:00:00Z')));
  await r.gravar(linhaDoEvento({ em: Date.parse('2026-10-25T20:00:30Z'), tipo: 'limitado', ultimos1s: 9 }));
  const linhas = (await readFile(path.join(dir, 'a', 'b', 'x.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(linhas.length, 2);
  assert.deepEqual([linhas[0].tipo, linhas[0].porMinuto, linhas[0].t], ['minuto', 12, '2026-10-25T20:00:00.000Z']);
  assert.deepEqual([linhas[1].tipo, linhas[1].ultimos1s, linhas[1].t], ['limitado', 9, '2026-10-25T20:00:30.000Z']);
});

test('registro: pasta impossível não lança', async () => {
  const r = criarRegistroRequisicoes('/proc/nao-existe/x.jsonl');
  await r.gravar({ a: 1 });
});

test('piso aprendido: grava, lê e volta a 0 se o arquivo não existe', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'piso-'));
  const arq = path.join(dir, 'piso.json');
  assert.equal(await lerRitmoAprendido(arq), 0);
  await gravarRitmoAprendido(arq, 88);
  assert.equal(await lerRitmoAprendido(arq), 88);
});
