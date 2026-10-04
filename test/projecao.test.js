import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projetarIngenuo, projetarEstratificado, projetar, MODELOS } from '../src/projecao.js';

const dados = (extra = {}) => ({
  totalizacaoFinal: false,
  secoes: { total: 1000, totalizadas: 250 },
  votos: { validos: 1000 },
  candidatos: [
    { numero: '13', nomeUrna: 'A', partido: 'PT', votos: 600 },
    { numero: '22', nomeUrna: 'B', partido: 'PL', votos: 400 },
  ],
  ...extra,
});

test('extrapola o total de válidos pela fração de seções e mantém o percentual atual', () => {
  const r = projetarIngenuo(dados());
  assert.equal(r.disponivel, true);
  assert.equal(r.fracaoApurada, 0.25);
  assert.equal(r.validosProjetados, 4000);
  assert.equal(r.votosFaltantes, 3000);
  const [a, b] = r.candidatos;
  assert.equal(a.pctProjetado, 60);
  assert.equal(a.votosProjetados, 2400);
  assert.equal(b.votosProjetados, 1600);
});

test('limites são os extremos matemáticos dos votos faltantes', () => {
  const [a] = projetarIngenuo(dados()).candidatos;
  assert.equal(a.pctMinimo, 15); // 600 de 4000
  assert.equal(a.pctMaximo, 90); // (600 + 3000) de 4000
});

test('totalização final devolve o resultado como está', () => {
  const r = projetarIngenuo(dados({ totalizacaoFinal: true }));
  assert.equal(r.votosFaltantes, 0);
  assert.equal(r.candidatos[0].votosProjetados, 600);
  assert.equal(r.candidatos[0].pctMinimo, r.candidatos[0].pctMaximo);
});

test('sem seções totalizadas ou sem votos, não projeta', () => {
  assert.equal(projetarIngenuo(dados({ secoes: { total: 1000, totalizadas: 0 } })).disponivel, false);
  assert.equal(projetarIngenuo(dados({ votos: { validos: 0 } })).disponivel, false);
});

test('respeita o limite de candidatos', () => {
  assert.equal(projetarIngenuo(dados(), { limite: 1 }).candidatos.length, 1);
});

test('modelos sem implementação explicam o motivo', () => {
  assert.equal(projetar('bayesiano', dados()), null);
  const indisponiveis = MODELOS.filter((m) => !m.disponivel);
  assert.deepEqual(indisponiveis.map((m) => m.id), ['bayesiano']);
  assert.ok(indisponiveis.every((m) => m.motivo));
});

// ---------- modelo 2 ----------

const municipio = ({ total, totalizadas, aptos, votos, final = false }) => ({
  totalizacaoFinal: final,
  secoes: { total, totalizadas },
  eleitorado: { total: aptos },
  votos: { validos: Object.values(votos).reduce((s, v) => s + v, 0) },
  candidatos: [
    { sq: 'a', numero: '13', nomeUrna: 'A', partido: 'PT', votos: votos.a },
    { sq: 'b', numero: '22', nomeUrna: 'B', partido: 'PL', votos: votos.b },
  ],
});

test('estratificado corrige a miragem: município pequeno 100% apurado não representa a UF', () => {
  // Interior (pequeno) já apurado e favorável a B; capital (grande) só 10% apurada, favorável a A.
  const interior = municipio({ total: 10, totalizadas: 10, aptos: 1000, votos: { a: 100, b: 500 } });
  const capital = municipio({ total: 100, totalizadas: 10, aptos: 10000, votos: { a: 600, b: 200 } });
  const ingenuo = projetarIngenuo({
    totalizacaoFinal: false,
    secoes: { total: 110, totalizadas: 20 },
    votos: { validos: 1400 },
    candidatos: [{ numero: '22', nomeUrna: 'B', partido: 'PL', votos: 700 }, { numero: '13', nomeUrna: 'A', partido: 'PT', votos: 700 }],
  });
  assert.equal(ingenuo.candidatos[0].pctProjetado, 50);

  const r = projetarEstratificado([interior, capital]);
  const [a, b] = ['13', '22'].map((n) => r.candidatos.find((c) => c.numero === n));
  assert.equal(a.votosProjetados, 100 + 6000); // 100 do interior + 600 ÷ 10% da capital
  assert.equal(b.votosProjetados, 500 + 2000);
  assert.ok(a.pctProjetado > 70, 'a capital pesa pelo tamanho dela');
  assert.equal(r.validosProjetados, 8600);
});

test('estratificado: município sem apuração entra pelo eleitorado e pela média da UF', () => {
  const apurado = municipio({ total: 10, totalizadas: 10, aptos: 1000, votos: { a: 300, b: 100 } }); // 0,4 válido/eleitor
  const zerado = municipio({ total: 10, totalizadas: 0, aptos: 500, votos: { a: 0, b: 0 } });
  const r = projetarEstratificado([apurado, zerado], { totalMunicipios: 3 });
  assert.equal(r.validosProjetados, 600); // 400 + 500 × 0,4
  assert.equal(r.candidatos.find((c) => c.numero === '13').votosProjetados, 450); // 75% de 600
  assert.deepEqual(r.municipios, { total: 3, comVotos: 1, semVotos: 1, semArquivo: 1 });
  assert.ok(Math.abs(r.parteEstimadaPelaUf - 200 / 600) < 1e-9);
});

test('estratificado: sem nenhum município apurado, não projeta', () => {
  const r = projetarEstratificado([municipio({ total: 10, totalizadas: 0, aptos: 500, votos: { a: 0, b: 0 } })]);
  assert.equal(r.disponivel, false);
});
