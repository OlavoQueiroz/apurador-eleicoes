import test from 'node:test';
import assert from 'node:assert/strict';
import { quantosClassificam, semChanceMatematica, votosRestantes } from '../public/chances.js';

test('quantosClassificam: Senado = vagas; presidente e governador = 2 no 1º turno e 1 no 2º', () => {
  assert.equal(quantosClassificam({ cargo: 5, vagas: 2, turno: 1 }), 2);
  assert.equal(quantosClassificam({ cargo: 5, vagas: 1, turno: 1 }), 1);
  assert.equal(quantosClassificam({ cargo: 3, vagas: 1, turno: 1 }), 2);
  assert.equal(quantosClassificam({ cargo: 1, vagas: 1, turno: 2 }), 1);
});

test('votosRestantes: eleitores das seções que faltam; sem o total, não há teto', () => {
  assert.equal(votosRestantes({ total: 1000, comparecimento: 500, abstencao: 100 }), 400);
  assert.equal(votosRestantes({ total: 1000, comparecimento: 900, abstencao: 200 }), 0);
  assert.equal(votosRestantes({ total: 0, comparecimento: 0, abstencao: 0 }), null);
});

test('semChanceMatematica: só quem, com todos os votos que faltam, ainda fica atrás do k-ésimo', () => {
  // 2 classificam; faltam 100 votos: o 3º (300) alcança até 400 > 380 (2º) → ainda tem chance; o 4º (200) chega a 300 < 380 → fora
  assert.deepEqual(semChanceMatematica([500, 380, 300, 200], 2, 100), [false, false, false, true]);
  assert.deepEqual(semChanceMatematica([500, 380, 300, 200], 2, 0), [false, false, true, true]);
  // empate exato no limite ainda não elimina (ele pode igualar o k-ésimo)
  assert.deepEqual(semChanceMatematica([500, 380, 280], 2, 100), [false, false, false]);
  assert.deepEqual(semChanceMatematica([500, 380, 279], 2, 100), [false, false, true]);
  // sem teto confiável ou com menos candidatos que classificados: ninguém é eliminado
  assert.deepEqual(semChanceMatematica([500, 100], 2, null), [false, false]);
  assert.deepEqual(semChanceMatematica([500], 2, 0), [false]);
});
