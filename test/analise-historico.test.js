import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarSerie } from '../src/analise-historico.js';
import { planoDaProjecao } from '../src/historico.js';

const ponto = (t, secoes, lead, atual, plano = { plano: 'normal', planoB: 0 }) => ({
  t, plano, secoes: { pct: secoes },
  candidatos: [{ numero: '13', pct: 50 + atual / 2, projPct: 50 + lead / 2 }, { numero: '22', pct: 50 - atual / 2, projPct: 50 - lead / 2 }],
});

test('planoDaProjecao: normal, plano B na UF e resumo do Brasil', () => {
  assert.equal(planoDaProjecao(null), null);
  assert.deepEqual(planoDaProjecao({ disponivel: true }), { plano: 'normal', planoB: 0 });
  assert.deepEqual(planoDaProjecao({ disponivel: true, plano: 'extrapolacao' }), { plano: 'extrapolacao', planoB: 1 });
  assert.deepEqual(planoDaProjecao({ disponivel: true, ufs: { planoB: 3, semVotos: 2, comVotos: 20 } }), { plano: 'parcial', planoB: 3, semVotos: 2, comVotos: 20 });
});

test('analisarSerie: pulos acima do limiar, coincidência com troca de plano e erro por faixa', () => {
  const b = { plano: 'extrapolacao', planoB: 1 };
  const pontos = [
    ponto('t1', 10, 4, 10), ponto('t2', 20, 4.2, 10.1), ponto('t3', 30, 7, 10.2, b), ponto('t4', 40, 4.4, 10.2), ponto('t5', 100, 10, 10),
  ];
  const a = analisarSerie(pontos, { limiar: 1 });
  assert.equal(a.pontos, 5);
  assert.equal(a.pulos, 3); // 4,2→7 (+2,8), 7→4,4 (−2,6), 4,4→10 (+5,6)
  assert.equal(a.pulosComTrocaDePlano, 2); // entrada e saída do plano B
  assert.equal(a.pulosSemMudancaDoAtual, 3);
  assert.ok(Math.abs(a.maiorSalto - 5.6) < 1e-9);
  assert.equal(a.maiores[0].t, 't5');
  assert.deepEqual(a.porFaixa.map((f) => f.faixa), ['10-20%', '20-30%', '30-40%', '40-50%', '90-100%']);
  assert.ok(Math.abs(a.porFaixa[0].erroMedio - 6) < 1e-9); // |4 − 10|
  assert.equal(analisarSerie([ponto('t1', 10, 1, 1)]), null);
});
