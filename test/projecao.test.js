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

// ---------- modelo 2: municípios grandes + resto do estado ----------

import { projetarComResto, projetarUf, projetarBrasil } from '../src/projecao.js';

// UF com 100 seções: capital (grande, 20 seções) + resto (80 seções em municípios pequenos).
const detalhes = (extra = {}) => new Map(Object.entries({
  cap: { aptos: 10000, secoes: { total: 20, totalizadas: 20 } },
  p1: { aptos: 5000, secoes: { total: 40, totalizadas: 8 } },
  p2: { aptos: 5000, secoes: { total: 40, totalizadas: 8 } },
  ...extra,
}));
const grande = (votos, totalizadas = 20) => ({
  codigoMunicipio: 'cap',
  totalizacaoFinal: false,
  secoes: { total: 20, totalizadas },
  eleitorado: { total: 10000 },
  votos: { validos: votos.a + votos.b },
  candidatos: [
    { sq: 'a', numero: '13', nomeUrna: 'A', partido: 'PT', votos: votos.a },
    { sq: 'b', numero: '22', nomeUrna: 'B', partido: 'PL', votos: votos.b },
  ],
});
const ufArquivo = ({ a, b, totalizadas }) => ({
  totalizacaoFinal: false,
  secoes: { total: 100, totalizadas },
  eleitorado: { total: 20000 },
  votos: { validos: a + b },
  candidatos: [
    { sq: 'a', numero: '13', nomeUrna: 'A', partido: 'PT', votos: a },
    { sq: 'b', numero: '22', nomeUrna: 'B', partido: 'PL', votos: b },
  ],
});

test('grandes + resto: a capital fechada pesa pelo que é e o resto é projetado pela fração dele', () => {
  // Capital 100% apurada: A 600, B 200. Resto: 16 de 80 seções (20%), A 40, B 160 → 800 e 200 projetados.
  const r = projetarComResto({
    grandes: [grande({ a: 600, b: 200 })],
    ufDados: ufArquivo({ a: 640, b: 360, totalizadas: 36 }),
    detalhes: detalhes(),
  });
  assert.equal(r.disponivel, true);
  assert.equal(r.resto.fracao, 0.2);
  const [a, b] = ['13', '22'].map((n) => r.candidatos.find((c) => c.numero === n));
  assert.equal(a.votosProjetados, 600 + 200); // 40 ÷ 0,2
  assert.equal(b.votosProjetados, 200 + 800); // 160 ÷ 0,2
  assert.equal(r.validosProjetados, 1800);
  assert.equal(a.votosAtuais, 640, 'o atual vem do arquivo da UF');
  assert.deepEqual(r.municipios, { total: 3, grandes: 1, comVotos: 1, semVotos: 0, semArquivo: 0 });
});

test('grandes + resto: resto sem votos entra pelo eleitorado e pela média do que já foi medido', () => {
  const r = projetarComResto({
    grandes: [grande({ a: 600, b: 200 })],
    ufDados: ufArquivo({ a: 600, b: 200, totalizadas: 20 }),
    detalhes: detalhes({ p1: { aptos: 5000, secoes: { total: 40, totalizadas: 0 } }, p2: { aptos: 5000, secoes: { total: 40, totalizadas: 0 } } }),
  });
  assert.equal(r.resto.iniciado, false);
  // capital: 800 válidos em 10 mil eleitores = 0,08 por eleitor; resto: 10 mil eleitores → +800
  assert.equal(r.validosProjetados, 1600);
  assert.equal(r.candidatos.find((c) => c.numero === '13').votosProjetados, 1200);
  assert.ok(Math.abs(r.parteEstimadaPelaUf - 0.5) < 1e-9);
});

test('grandes + resto: capital sem votos mas resto iniciado usa o resto como referência', () => {
  const r = projetarComResto({
    grandes: [grande({ a: 0, b: 0 }, 0)],
    ufDados: ufArquivo({ a: 40, b: 160, totalizadas: 16 }),
    detalhes: detalhes({ cap: { aptos: 10000, secoes: { total: 20, totalizadas: 0 } } }),
  });
  assert.equal(r.disponivel, true);
  assert.equal(r.resto.iniciado, true);
  // resto: 200 em 20% → 1000 para 10 mil eleitores (0,1/eleitor); capital zerada: 10 mil × 0,1 = +1000
  assert.equal(r.validosProjetados, 2000);
});

test('grandes + resto: arquivos fora de sincronia pedem o plano B', () => {
  // O arquivo da UF diz 36 seções, mas o acompanhamento (e a capital) já estão em 56: UF atrasada.
  const r = projetarComResto({
    grandes: [grande({ a: 600, b: 200 })],
    ufDados: ufArquivo({ a: 640, b: 360, totalizadas: 36 }),
    detalhes: detalhes({ p1: { aptos: 5000, secoes: { total: 40, totalizadas: 20 } }, p2: { aptos: 5000, secoes: { total: 40, totalizadas: 16 } } }),
  });
  assert.equal(r.disponivel, false);
  assert.equal(r.descompasso, true);
  assert.ok(r.conferencia.diferencaUfPct > 1);
});

test('grandes + resto: soma dos grandes maior que a UF (resto negativo) pede o plano B', () => {
  const r = projetarComResto({
    grandes: [grande({ a: 900, b: 300 })],
    ufDados: ufArquivo({ a: 640, b: 360, totalizadas: 36 }),
    detalhes: detalhes(),
  });
  assert.equal(r.descompasso, true);
});

test('projetarUf: com descompasso cai na extrapolação simples e avisa', () => {
  const foto = {
    completo: false,
    dados: [grande({ a: 600, b: 200 })],
    detalhes: detalhes({ p1: { aptos: 5000, secoes: { total: 40, totalizadas: 20 } } }),
  };
  const r = projetarUf({ foto, ufDados: ufArquivo({ a: 640, b: 360, totalizadas: 36 }) });
  assert.equal(r.disponivel, true);
  assert.equal(r.plano, 'extrapolacao');
  assert.ok(r.motivoPlano);
});

test('projetarUf: sem o acompanhamento ou sem o arquivo da UF, explica o que falta', () => {
  assert.equal(projetarUf({ foto: { completo: false, dados: [], detalhes: null }, ufDados: null }).disponivel, false);
  const semAcomp = projetarUf({ foto: { completo: false, dados: [grande({ a: 1, b: 1 })], detalhes: null }, ufDados: ufArquivo({ a: 1, b: 1, totalizadas: 1 }) });
  assert.equal(semAcomp.disponivel, false);
});

test('projetarBrasil: soma as UFs e usa a média nacional para a UF sem votos', () => {
  const uf = (validosProj, votosA, votosB) => ({
    disponivel: true, validosProjetados: validosProj, votosValidos: validosProj / 2, parteEstimadaPelaUf: 0,
    candidatos: [
      { numero: '13', nomeUrna: 'A', partido: 'PT', votosProjetados: votosA, votosAtuais: votosA / 2 },
      { numero: '22', nomeUrna: 'B', partido: 'PL', votosProjetados: votosB, votosAtuais: votosB / 2 },
    ],
  });
  const r = projetarBrasil([
    { uf: 'sp', r: uf(1000, 600, 400), aptos: 2000, secoes: { total: 100, totalizadas: 50 } },
    { uf: 'mg', r: uf(500, 100, 400), aptos: 1000, secoes: { total: 50, totalizadas: 25 } },
    { uf: 'ac', r: { disponivel: false }, aptos: 300, secoes: { total: 10, totalizadas: 0 } },
  ]);
  assert.equal(r.disponivel, true);
  assert.equal(r.validosProjetados, 1500 + 150); // 300 eleitores × 0,5 válido por eleitor
  assert.deepEqual(r.ufs, { total: 3, comVotos: 2, semVotos: 1, planoB: 0 });
  assert.equal(r.candidatos[0].numero, '22', 'B soma 800 contra 700 de A');
  assert.equal(r.candidatos.find((c) => c.numero === '13').votosProjetados, 700 + Math.round((700 / 1500) * 150));
});
