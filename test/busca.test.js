import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarCandidatos, normalizarBusca } from '../src/busca.js';

const cand = (sq, nomeUrna, nome, numero, partido, votos) => ({ sq, nomeUrna, nome, numero, partido, votos, pct: 0, situacao: 'concorrendo' });
const item = (cargo, uf, candidatos) => ({ alvo: { cargo, uf }, dados: { candidatos } });
const apuracao = {
  estado: new Map([
    ['5:sp', item(5, 'sp', [cand(1, 'JOSÉ DA SILVA', 'JOSE DA SILVA', '123', 'PT', 900), cand(2, 'ANA SOUZA', 'ANA SOUZA', '456', 'PL', 800)])],
    ['6:pi', item(6, 'pi', [cand(3, 'JOSÉ ANTUNES', 'JOSE ANTUNES', '1234', 'PP', 50), cand(4, 'MARIA', 'MARIA JOSE', '1111', 'PT', 70)])],
  ]),
};

test('normaliza acentos e caixa', () => {
  assert.equal(normalizarBusca('  São  JOSÉ '), 'sao jose');
});

test('separa o cargo e UF abertos do resto e ignora acentos', () => {
  const r = buscarCandidatos(apuracao, 'jose', { cargo: 5, uf: 'sp' });
  assert.deepEqual(r.aqui.map((c) => c.sq), [1]);
  // "JOSÉ ANTUNES" (nome começa pelo termo) vem antes de "MARIA JOSE" (termo no meio do nome).
  assert.deepEqual(r.outros.map((c) => c.sq), [3, 4]);
  assert.equal(r.outros[0].cargo, 6);
});

test('acha por número e por partido', () => {
  assert.deepEqual(buscarCandidatos(apuracao, '456', { cargo: 5, uf: 'sp' }).aqui.map((c) => c.sq), [2]);
  assert.deepEqual(buscarCandidatos(apuracao, 'ana pl', { cargo: 5, uf: 'sp' }).aqui.map((c) => c.sq), [2]);
});

test('sem termo devolve os mais votados do cargo e UF abertos', () => {
  const r = buscarCandidatos(apuracao, '', { cargo: 5, uf: 'sp' });
  assert.deepEqual(r.aqui.map((c) => c.sq), [1, 2]);
  assert.deepEqual(r.outros, []);
});
