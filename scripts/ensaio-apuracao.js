#!/usr/bin/env node
// Ensaio de apuração: simula uma apuração sobre os municípios REAIS de 2022 e compara o que cada modelo de projeção
// diria em cada momento com o resultado "final" conhecido da simulação. Valida a mecânica dos modelos (e dá uma ideia
// de erro), mas não o comportamento do TSE ao vivo nem o do eleitorado de 2026.
//
//   node scripts/ensaio-apuracao.js [--swing 3] [--ruido 1.5] [--swing-uf 0] [--swing-porte 0] [--semente 1] [--uf sp]
//                                   [--ordem pequenos|aleatoria|grandes] [--brasil-media] [--sem-swing-grupo] [--ruido-secoes 2]
//                                   [--oscilacao]   (mede o zigue-zague: projeção a cada 1% de apuração, de 5% a 50%)
//
// A "verdade" de 2026 é montada a partir de 2022: o campo de A (13) ganha `--swing` pontos e o de B (22) perde, e os
// votos de 2022 sem herdeiro (Tebet, Ciro, Soraya) vão em parte para um candidato novo (55), em parte para A e B.
// Cada município recebe ainda um ruído próprio (`--ruido` pontos). Para o swing não ser uniforme (o que favoreceria o
// modelo de swing), `--swing-uf` dá a cada UF um swing próprio (desvio-padrão em pontos) e `--swing-porte` faz as
// cidades grandes variarem diferente das pequenas (diferença em pontos). A ordem de chegada imita a real: municípios
// pequenos fecham antes; os grandes demoram mais.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarAnterior } from '../src/anterior.js';
import { projetarBrasil, projetarEstratificado, projetarIngenuo, projetarUf, tamanhoUf } from '../src/projecao.js';
import { projetarUfSwing } from '../src/swing.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? process.argv[i + 1] : padrao;
};
const SWING = Number(arg('swing', 3)) / 100;
const RUIDO = Number(arg('ruido', 1.5)) / 100;
const SEMENTE = Number(arg('semente', 1));
const RUIDO_SECOES = Number(arg('ruido-secoes', 2)) / 100; // desvio-padrão da fatia de UMA seção em torno do município (pontos)
const SO_UF = arg('uf', null);
const SWING_UF = Number(arg('swing-uf', 0)) / 100;
const SWING_PORTE = Number(arg('swing-porte', 0)) / 100;
const ORDEM = arg('ordem', 'pequenos');
const SWING_GRUPO = !process.argv.includes('--sem-swing-grupo'); // swing separado: municípios grandes × resto do estado
const BRASIL_MEDIA = process.argv.includes('--brasil-media'); // UFs zeradas pela média das apuradas (comportamento antigo)
const MOMENTOS = [0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75];

const historico = JSON.parse(readFileSync(path.join(raiz, 'dados-historicos/presidente-2022-t1.json'), 'utf8'));
const mapeamento = JSON.parse(readFileSync(path.join(raiz, 'dados-historicos/mapeamento-presidente.json'), 'utf8'));
const anterior = criarAnterior(historico, mapeamento);

function aleatorio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = aleatorio(SEMENTE);
const normal = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

const CAND = [
  ['13', 'LULA', 'PT'], ['22', 'FLAVIO', 'PL'], ['55', 'CAIADO', 'PSD'], ['30', 'ZEMA', 'NOVO'], ['21', 'EDMILSON', 'PCB'],
  ['80', 'SAMARA', 'UP'], ['16', 'HERTZ', 'PSTU'], ['27', 'CLARIANA', 'DC'], ['70', 'CURY', 'AVANTE'], ['14', 'RENAN', 'MISSAO'],
  ['35', 'WILSON', 'DEMOCRATA'], ['29', 'RUI', 'PCO'],
];

// ---------- a "verdade" de cada município ----------
const municipios = [];
const swingDaUf = new Map();
for (const [codigo, m] of Object.entries(historico.municipios)) {
  if (SO_UF && m.uf !== SO_UF) continue;
  const pr = anterior.prior(codigo);
  if (!pr || pr.validos <= 0) continue;
  const p = new Map(CAND.map(([n]) => [n, (pr.herdados.get(n) ?? 0) / pr.validos]));
  const semHerdeiro = Math.max(0, 1 - [...p.values()].reduce((s, v) => s + v, 0));
  if (!swingDaUf.has(m.uf)) swingDaUf.set(m.uf, normal() * SWING_UF);
  const swingUf = SWING + swingDaUf.get(m.uf);
  const bruto = new Map(p);
  bruto.set('55', bruto.get('55') + semHerdeiro * 0.6);
  bruto.set('13', bruto.get('13') + semHerdeiro * 0.2 + swingUf);
  bruto.set('22', bruto.get('22') + semHerdeiro * 0.2 - swingUf);
  for (const n of ['13', '22', '55']) bruto.set(n, bruto.get(n) + normal() * RUIDO);
  const clamp = new Map([...bruto].map(([n, v]) => [n, Math.max(0, v)]));
  const total = [...clamp.values()].reduce((s, v) => s + v, 0);
  const share = new Map([...clamp].map(([n, v]) => [n, v / total]));
  const validos = Math.max(20, Math.round(pr.validos * (1.03 + normal() * 0.04)));
  const aptos = Math.round(validos / 0.77);
  const secoes = Math.max(1, Math.round(validos / 180));
  municipios.push({ codigo, uf: m.uf, share, validos, aptos, secoes });
}
municipios.sort((a, b) => a.validos - b.validos);
municipios.forEach((m, i) => {
  m.q = i / (municipios.length - 1);
  if (SWING_PORTE !== 0) { // cidades grandes (q alto) variam diferente das pequenas
    const d = SWING_PORTE * (m.q - 0.5);
    m.share.set('13', Math.max(0, m.share.get('13') + d));
    m.share.set('22', Math.max(0, m.share.get('22') - d));
    const t = [...m.share.values()].reduce((a, b) => a + b, 0);
    for (const [n, v] of m.share) m.share.set(n, v / t);
  }
});
const ufs = [...new Set(municipios.map((m) => m.uf))];
const deslocUf = new Map(ufs.map((u) => [u, rnd() * 0.12])); // cada UF começa num momento
for (const m of municipios) {
  const ruido = rnd() * 0.05;
  const base = { pequenos: 0.5 * m.q ** 0.8, grandes: 0.5 * (1 - m.q) ** 0.8, aleatoria: 0.5 * rnd() }[ORDEM];
  m.inicio = deslocUf.get(m.uf) + base + ruido;
  m.duracao = 0.2 + 0.25 * m.q;
  m.ruidoSecoes = new Map(CAND.map(([n]) => [n, normal()]));
}

const fracao = (m, t) => Math.min(1, Math.max(0, (t - m.inicio) / m.duracao));
const secoesApuradas = (m, t) => Math.round(fracao(m, t) * m.secoes);
const progresso = (t) => municipios.reduce((s, m) => s + secoesApuradas(m, t), 0) / municipios.reduce((s, m) => s + m.secoes, 0);

// Votos já apurados de um município: amostra de suas seções, com ruído que diminui com o nº de seções.
function apurado(m, t) {
  const n = secoesApuradas(m, t);
  if (n === 0) return { n, validos: 0, votos: new Map(CAND.map(([c]) => [c, 0])) };
  const validos = Math.round((m.validos * n) / m.secoes);
  const brutos = new Map(CAND.map(([c]) => [c, Math.max(0, m.share.get(c) + m.ruidoSecoes.get(c) * RUIDO_SECOES / Math.sqrt(n))]));
  const soma = [...brutos.values()].reduce((s, v) => s + v, 0);
  return { n, validos, votos: new Map([...brutos].map(([c, v]) => [c, Math.round((validos * v) / soma)])) };
}

// ---------- o que o painel veria em cada momento ----------
const MINIMO = 30_000;
function insumos(uf, t) {
  const doUf = municipios.filter((m) => m.uf === uf);
  const maior = doUf.reduce((a, b) => (b.aptos > a.aptos ? b : a));
  const lista = doUf.map((m) => ({ m, a: apurado(m, t) }));
  const arquivoMunicipio = ({ m, a }) => ({
    codigoMunicipio: m.codigo,
    totalizacaoFinal: a.n === m.secoes,
    secoes: { total: m.secoes, totalizadas: a.n },
    eleitorado: { total: m.aptos },
    votos: { validos: a.validos },
    candidatos: CAND.map(([n, nome, partido]) => ({ sq: n, numero: n, nomeUrna: nome, partido, votos: a.votos.get(n) })),
  });
  const todos = lista.map(arquivoMunicipio);
  const grandes = lista.filter(({ m }) => m === maior || m.aptos >= MINIMO).map(arquivoMunicipio);
  const detalhes = new Map(lista.map(({ m, a }) => [m.codigo, { aptos: m.aptos, secoes: { total: m.secoes, totalizadas: a.n } }]));
  const validos = lista.reduce((s, { a }) => s + a.validos, 0);
  const ufDados = {
    totalizacaoFinal: lista.every(({ m, a }) => a.n === m.secoes),
    secoes: { total: doUf.reduce((s, m) => s + m.secoes, 0), totalizadas: lista.reduce((s, { a }) => s + a.n, 0) },
    eleitorado: { total: doUf.reduce((s, m) => s + m.aptos, 0) },
    votos: { validos },
    candidatos: CAND.map(([n, nome, partido]) => ({ sq: n, numero: n, nomeUrna: nome, partido, votos: lista.reduce((s, { a }) => s + a.votos.get(n), 0) })),
  };
  return { ufDados, todos, grandes, detalhes, total: doUf.length };
}

// Projeções de cada modelo para uma UF (mesmas funções que o painel usa).
function projecoesUf(uf, t) {
  const { ufDados, todos, grandes, detalhes, total } = insumos(uf, t);
  const foto = { completo: false, dados: grandes, detalhes, total, erro: null };
  const fotoTodos = { completo: true, dados: todos, detalhes, total, erro: null };
  return {
    ufDados,
    simples: projetarIngenuo(ufDados, { limite: 50 }),
    municipio: projetarEstratificado(todos, { limite: 50, totalMunicipios: total }),
    grandes: projetarUf({ foto, ufDados, limite: 50 }),
    swing: projetarUfSwing({ foto, ufDados, anterior, limite: 50, swingPorGrupo: SWING_GRUPO }),
    swingTodos: projetarUfSwing({ foto: fotoTodos, ufDados, anterior, limite: 50 }),
    swingSeco: projetarUfSwing({ foto, ufDados, anterior, limite: 50, swingPorGrupo: SWING_GRUPO, pesoGradual: false }), // o corte seco de 50% antigo
  };
}

// ---------- comparação ----------
const verdade = new Map(CAND.map(([n]) => [n, 0]));
let validosFinal = 0;
for (const m of municipios) {
  validosFinal += m.validos;
  for (const [n] of CAND) verdade.set(n, verdade.get(n) + m.validos * m.share.get(n));
}
const pctVerdade = new Map([...verdade].map(([n, v]) => [n, (100 * v) / validosFinal]));

function achar(r, n) {
  if (!r?.disponivel) return null;
  const c = r.candidatos.find((x) => x.numero === n);
  return c ? c.pctProjetado : 0;
}
const modelos = [
  ['simples', 'Extrapolação simples'],
  ['municipio', 'Todos os municípios'],
  ['grandes', 'Grandes + resto'],
  ['swing', 'Swing (grandes+resto)'],
  ['swingSeco', 'Swing (corte seco)'],
  ['swingTodos', 'Swing (todos)'],
];

function mediana(v) { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

console.log(`Ensaio: ${municipios.length} municípios, ${ufs.length} UFs · swing real ${SWING * 100 >= 0 ? '+' : ''}${SWING * 100} pp para o 13 (UF ±${SWING_UF * 100}, porte ${SWING_PORTE * 100}) · ruído ${RUIDO * 100} pp · ordem ${ORDEM}`);
console.log(`Verdade (válidos): ${CAND.slice(0, 4).map(([n, nome]) => `${nome} ${pctVerdade.get(n).toFixed(2)}%`).join(' · ')}`);
console.log('Erro do candidato 13 e da diferença 13−22, em pontos percentuais (projetado − verdade). Brasil = soma das UFs.\n');

// Acha, por busca binária, o instante em que o país chega a cada nível de apuração.
function instante(alvo) {
  let a = -1; let b = 3;
  for (let i = 0; i < 40; i += 1) { const meio = (a + b) / 2; if (progresso(meio) < alvo) a = meio; else b = meio; }
  return b;
}

const cab = ['apurado', ...modelos.map(([, nome]) => nome)];
const linhasErro13 = [];
const linhasLead = [];
const dispon = [];
for (const alvo of MOMENTOS) {
  const t = instante(alvo);
  const porUf = ufs.map((uf) => ({ uf, p: projecoesUf(uf, t) }));
  const e13 = [alvo, ...[]];
  const lead = [alvo];
  const verdadeLead = pctVerdade.get('13') - pctVerdade.get('22');
  const disp = [alvo];
  for (const [chave] of modelos) {
    const soma = projetarBrasil(porUf.map(({ uf, p }) => ({ uf, r: p[chave], ...tamanhoUf({ foto: { dados: [] }, ufDados: p.ufDados }) })), { limite: 50, anteriorPorUf: BRASIL_MEDIA ? null : anterior.porUf() });
    const a = achar(soma, '13');
    const b = achar(soma, '22');
    e13.push(a === null ? null : a - pctVerdade.get('13'));
    lead.push(a === null || b === null ? null : (a - b) - verdadeLead);
    disp.push(porUf.filter(({ p }) => p[chave].disponivel).length);
  }
  linhasErro13.push(e13);
  linhasLead.push(lead);
  dispon.push(disp);
}

const fmt = (v) => (v === null ? '   —  ' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`.padStart(7));
function tabela(titulo, linhas) {
  console.log(titulo);
  console.log(cab.map((c, i) => (i === 0 ? c.padEnd(8) : c.slice(0, 22).padStart(24))).join(''));
  for (const [alvo, ...v] of linhas) console.log(`${`${(alvo * 100).toFixed(0)}%`.padEnd(8)}${v.map((x) => fmt(x).padStart(24)).join('')}`);
  console.log('');
}
tabela('Erro do 13 (pontos percentuais):', linhasErro13);
tabela('Erro da diferença 13−22 (pontos percentuais):', linhasLead);
console.log('UFs com projeção disponível por modelo (de', ufs.length, '):');
console.log(cab.map((c, i) => (i === 0 ? c.padEnd(8) : c.slice(0, 22).padStart(24))).join(''));
for (const [alvo, ...v] of dispon) console.log(`${`${(alvo * 100).toFixed(0)}%`.padEnd(8)}${v.map((x) => String(x).padStart(24)).join('')}`);

// Oscilação: o quanto a projeção do Brasil (diferença 13−22) mexe de um instante para o seguinte, a cada 1% de apuração. Uma boa
// projeção converge sem zigue-zague; a média dos saltos e o maior salto medem a instabilidade, e o erro quadrático médio
// (RMSE) mostra o quanto ela fica longe da verdade nesse trecho.
if (process.argv.includes('--oscilacao')) {
  const verdadeLead = pctVerdade.get('13') - pctVerdade.get('22');
  const series = new Map(modelos.map(([chave]) => [chave, []]));
  for (let alvo = 0.05; alvo <= 0.5001; alvo += 0.01) {
    const t = instante(alvo);
    const porUf = ufs.map((uf) => ({ uf, p: projecoesUf(uf, t) }));
    for (const [chave] of modelos) {
      const soma = projetarBrasil(porUf.map(({ uf, p }) => ({ uf, r: p[chave], ...tamanhoUf({ foto: { dados: [] }, ufDados: p.ufDados }) })), { limite: 50, anteriorPorUf: BRASIL_MEDIA ? null : anterior.porUf() });
      const a = achar(soma, '13');
      const b = achar(soma, '22');
      if (a !== null && b !== null) series.get(chave).push(a - b);
    }
  }
  console.log('\nOscilação da projeção da diferença 13−22 (pontos percentuais), de 5% a 50% de apuração, a cada 1%:');
  console.log(['modelo'.padEnd(24), 'salto médio'.padStart(12), 'maior salto'.padStart(12), 'RMSE'.padStart(8)].join(''));
  for (const [chave, nome] of modelos) {
    const v = series.get(chave);
    const saltos = v.slice(1).map((x, i) => Math.abs(x - v[i]));
    const rmse = Math.sqrt(v.reduce((s, x) => s + (x - verdadeLead) ** 2, 0) / v.length);
    console.log([nome.padEnd(24), (saltos.reduce((s, x) => s + x, 0) / saltos.length).toFixed(3).padStart(12), Math.max(...saltos).toFixed(2).padStart(12), rmse.toFixed(2).padStart(8)].join(''));
  }
}
