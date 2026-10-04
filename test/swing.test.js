import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projetarSwing, projetarUfSwing } from '../src/swing.js';
import { criarAnterior } from '../src/anterior.js';

// 2022: dois campos, A (candidato 13) e B (candidato 22); em 2026 A = 13, B = 22 (mesma numeração).
const historico = (municipios) => ({
  fonte: 'teste',
  candidatos: { 13: {}, 22: {} },
  municipios: Object.fromEntries(Object.entries(municipios).map(([c, [a, b]]) => [c, { uf: 'xx', votos: { 13: a, 22: b } }])),
});
const mapeamento = { 13: [{ de: '13', peso: 1 }], 22: [{ de: '22', peso: 1 }] };

const municipioAtual = (codigo, a, b, { total = 10, totalizadas = 10, aptos = 1000 } = {}) => ({
  codigoMunicipio: codigo,
  totalizacaoFinal: false,
  secoes: { total, totalizadas },
  eleitorado: { total: aptos },
  votos: { validos: a + b },
  candidatos: [{ sq: 'a', numero: '13', nomeUrna: 'A', partido: 'PT', votos: a }, { sq: 'b', numero: '22', nomeUrna: 'B', partido: 'PL', votos: b }],
});
const ufArquivo = ({ a, b, total, totalizadas, aptos }) => ({
  totalizacaoFinal: false,
  secoes: { total, totalizadas },
  eleitorado: { total: aptos },
  votos: { validos: a + b },
  candidatos: [{ sq: 'a', numero: '13', nomeUrna: 'A', partido: 'PT', votos: a }, { sq: 'b', numero: '22', nomeUrna: 'B', partido: 'PL', votos: b }],
});

test('anterior: traduz os votos de 2022 pelo mapeamento e avisa de herança acima de 100%', () => {
  const a = criarAnterior(historico({ m1: [60, 40] }), mapeamento);
  assert.deepEqual(a.avisos, []);
  assert.deepEqual([...a.prior('m1').herdados], [['13', 60], ['22', 40]]);
  assert.equal(a.prior('m1').validos, 100);
  assert.equal(a.prior('nao-existe'), null);
  const ruim = criarAnterior(historico({ m1: [60, 40] }), { 13: [{ de: '13', peso: 0.8 }], 22: [{ de: '13', peso: 0.5 }] });
  assert.match(ruim.avisos[0], /além de 100%/);
});

test('swing: o candidato A está 10 pontos acima de 2022 nos lugares apurados; isso vale para o que falta', () => {
  // 2022 em toda parte: A 50%, B 50%. Agora, nos dois municípios apurados: A 60%, B 40% → swing de +10 / −10.
  const anterior = criarAnterior(historico({ m1: [500, 500], m2: [500, 500], m3: [500, 500] }), mapeamento);
  const r = projetarSwing({
    completo: true,
    anterior,
    ufDados: ufArquivo({ a: 1200, b: 800, total: 30, totalizadas: 20, aptos: 3000 }),
    grandes: [municipioAtual('m1', 600, 400), municipioAtual('m2', 600, 400), municipioAtual('m3', 0, 0, { totalizadas: 0 })],
  });
  assert.equal(r.disponivel, true);
  const a = r.swing.find((s) => s.numero === '13');
  assert.ok(Math.abs(a.pontos - 10) < 1e-9);
  // m3 ainda sem votos: 2022 (50%) + swing (+10) → 60% de 1000 válidos (mesmo tamanho que 2022 × crescimento 1).
  assert.equal(r.validosProjetados, 3000);
  assert.equal(r.candidatos.find((c) => c.numero === '13').votosProjetados, 600 + 600 + 600);
  assert.ok(Math.abs(r.parteEstimadaPelaUf - 1 / 3) < 1e-9);
});

test('swing: um município sem apuração com histórico diferente recebe o swing em cima do histórico dele', () => {
  // m3 votou 80/20 em 2022 (reduto de A); o swing de +10 vale para ele também → 90/10, não 60/40.
  const anterior = criarAnterior(historico({ m1: [500, 500], m2: [500, 500], m3: [800, 200] }), mapeamento);
  const r = projetarSwing({
    completo: true,
    anterior,
    ufDados: ufArquivo({ a: 1200, b: 800, total: 30, totalizadas: 20, aptos: 3000 }),
    grandes: [municipioAtual('m1', 600, 400), municipioAtual('m2', 600, 400), municipioAtual('m3', 0, 0, { totalizadas: 0 })],
  });
  assert.equal(r.candidatos.find((c) => c.numero === '13').votosProjetados, 600 + 600 + 900);
});

test('swing: município parcialmente apurado mistura o que já mostrou com o esperado, pela fração apurada', () => {
  const anterior = criarAnterior(historico({ m1: [500, 500], m2: [500, 500] }), mapeamento);
  const r = projetarSwing({
    completo: true,
    anterior,
    ufDados: ufArquivo({ a: 900, b: 600, total: 20, totalizadas: 15, aptos: 2000 }),
    // m1 fechado (A 60%); m2 com 50% das seções: 300 votos, A 50% → falta metade.
    grandes: [municipioAtual('m1', 600, 400), municipioAtual('m2', 150, 150, { totalizadas: 5 })],
  });
  // swing medido só no lugar com ≥50% apurado ponderado por tamanho: m1 (+10) e m2 (0) → +5 por esperado (1000 e 600)
  const a = r.swing.find((s) => s.numero === '13').pontos;
  assert.ok(a > 5 && a < 10, `swing intermediário (${a})`);
  // m2: vistos 300 de 600 esperados; restante = 300 × (0,5 × 50% visto + 0,5 × esperado)
  assert.equal(r.validosProjetados, 1600);
});

test('swing: grandes + resto — o resto é projetado com o histórico agregado dos municípios dele', () => {
  const anterior = criarAnterior(historico({ cap: [500, 500], p1: [300, 700], p2: [300, 700] }), mapeamento);
  const detalhes = new Map([
    ['cap', { aptos: 1000, secoes: { total: 10, totalizadas: 10 } }],
    ['p1', { aptos: 1000, secoes: { total: 10, totalizadas: 5 } }],
    ['p2', { aptos: 1000, secoes: { total: 10, totalizadas: 5 } }],
  ]);
  // UF: capital fechada A 600/B 400; resto com metade das seções: A 330, B 670 (soma UF: A 930, B 1070).
  const r = projetarSwing({
    anterior,
    detalhes,
    grandes: [municipioAtual('cap', 600, 400)],
    ufDados: ufArquivo({ a: 930, b: 1070, total: 30, totalizadas: 20, aptos: 3000 }),
  });
  assert.equal(r.disponivel, true);
  assert.equal(r.modo, 'grandes+resto');
  assert.equal(r.resto.municipios, 2);
  assert.equal(r.resto.fracao, 0.5);
  assert.equal(r.validosProjetados, 1000 + 2000, 'capital 1000 + resto 2000 (1000 vistos ÷ 0,5)');
});

test('swing: sem dados de 2022 para os lugares apurados, não projeta', () => {
  const anterior = criarAnterior(historico({}), mapeamento);
  const r = projetarSwing({
    completo: true,
    anterior,
    ufDados: ufArquivo({ a: 60, b: 40, total: 10, totalizadas: 10, aptos: 1000 }),
    grandes: [municipioAtual('m1', 60, 40)],
  });
  assert.equal(r.disponivel, false);
});

test('swing: arquivos fora de sincronia caem na extrapolação simples (plano B)', () => {
  const anterior = criarAnterior(historico({ cap: [500, 500], p1: [300, 700] }), mapeamento);
  const detalhes = new Map([
    ['cap', { aptos: 1000, secoes: { total: 10, totalizadas: 10 } }],
    ['p1', { aptos: 1000, secoes: { total: 10, totalizadas: 9 } }],
  ]);
  const foto = { completo: false, dados: [municipioAtual('cap', 600, 400)], detalhes };
  const r = projetarUfSwing({ foto, ufDados: ufArquivo({ a: 700, b: 500, total: 20, totalizadas: 11, aptos: 2000 }), anterior });
  assert.equal(r.disponivel, true);
  assert.equal(r.plano, 'extrapolacao');
  assert.equal(r.modelo, 'swing');
});

test('projetarUfSwing: sem dados de 2022 ou sem o arquivo da UF, explica o que falta', () => {
  assert.equal(projetarUfSwing({ foto: { completo: true, dados: [] }, ufDados: null, anterior: null }).disponivel, false);
  const anterior = criarAnterior(historico({}), mapeamento);
  assert.equal(projetarUfSwing({ foto: { completo: true, dados: [] }, ufDados: null, anterior }).disponivel, false);
});
