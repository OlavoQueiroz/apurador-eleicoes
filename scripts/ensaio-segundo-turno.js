#!/usr/bin/env node
// Ensaio do 2º turno com dados REAIS: pega o 1º turno de 2022 como base e o 2º turno de 2022 como "verdade" (Lula × Bolsonaro,
// município por município), simula só a ORDEM e o ruído da apuração e compara o que cada modelo diria em cada momento com o
// resultado final. É o teste mais honesto que existe antes do 2º turno de 2026: os votos finais são reais, só a ordem de chegada é
// simulada. Serve também para comparar premissas de transferência (o que fazer com os votos de Tebet, Ciro etc.).
//
//   node scripts/ensaio-segundo-turno.js [--semente 1] [--ruido-secoes 2] [--ordem pequenos|aleatoria|grandes] [--uf sp]
//                                        [--transf '{"15":{"13":0.6,"22":0.2},"12":{"13":0.7,"22":0.1}}']
//
// Os modelos comparados são os do painel: extrapolação simples, estratificação (grandes + resto) e swing com e sem premissas.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarAnterior } from '../src/anterior.js';
import { projetarBrasil, projetarIngenuo, projetarUf, tamanhoUf } from '../src/projecao.js';
import { projetarUfSwing } from '../src/swing.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? process.argv[i + 1] : padrao;
};
const SEMENTE = Number(arg('semente', 1));
const RUIDO_SECOES = Number(arg('ruido-secoes', 2)) / 100;
const ORDEM = arg('ordem', 'pequenos');
const SO_UF = arg('uf', null);
// Premissas de transferência: por padrão, as que o 2º turno de 2022 sugere olhando só para o campo (Tebet e Ciro mais para Lula).
const TRANSF = JSON.parse(arg('transf', '{"15":{"13":0.55,"22":0.2},"12":{"13":0.65,"22":0.15},"44":{"13":0.25,"22":0.45}}'));
const MOMENTOS = [0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75];

const t1 = JSON.parse(readFileSync(path.join(raiz, 'dados-historicos/presidente-2022-t1.json'), 'utf8'));
const t2 = JSON.parse(readFileSync(path.join(raiz, 'dados-historicos/presidente-2022-t2.json'), 'utf8'));
const mapa = { 13: [{ de: '13', peso: 1 }], 22: [{ de: '22', peso: 1 }] };
const base = criarAnterior(t1, mapa);
const comTransf = base.comTransferencias(TRANSF);

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
const CAND = [['13', 'LULA', 'PT'], ['22', 'BOLSONARO', 'PL']];

// A verdade de cada município é o 2º turno real de 2022.
const municipios = [];
for (const [codigo, m] of Object.entries(t2.municipios)) {
  if (SO_UF && m.uf !== SO_UF) continue;
  const v13 = m.votos['13'] ?? 0;
  const v22 = m.votos['22'] ?? 0;
  const validos = v13 + v22;
  if (validos < 20 || !base.prior(codigo)) continue;
  municipios.push({ codigo, uf: m.uf, share: new Map([['13', v13 / validos], ['22', v22 / validos]]), validos, aptos: Math.round(validos / 0.77), secoes: Math.max(1, Math.round(validos / 180)) });
}
municipios.sort((a, b) => a.validos - b.validos);
municipios.forEach((m, i) => { m.q = i / (municipios.length - 1); });
const ufs = [...new Set(municipios.map((m) => m.uf))];
const deslocUf = new Map(ufs.map((u) => [u, rnd() * 0.12]));
for (const m of municipios) {
  const ruido = rnd() * 0.05;
  const b = { pequenos: 0.5 * m.q ** 0.8, grandes: 0.5 * (1 - m.q) ** 0.8, aleatoria: 0.5 * rnd() }[ORDEM];
  m.inicio = deslocUf.get(m.uf) + b + ruido;
  m.duracao = 0.2 + 0.25 * m.q;
  m.ruidoSecoes = new Map(CAND.map(([n]) => [n, normal()]));
}
const secoesApuradas = (m, t) => Math.round(Math.min(1, Math.max(0, (t - m.inicio) / m.duracao)) * m.secoes);
const progresso = (t) => municipios.reduce((s, m) => s + secoesApuradas(m, t), 0) / municipios.reduce((s, m) => s + m.secoes, 0);

function apurado(m, t) {
  const n = secoesApuradas(m, t);
  if (n === 0) return { n, validos: 0, votos: new Map(CAND.map(([c]) => [c, 0])) };
  const validos = Math.round((m.validos * n) / m.secoes);
  const brutos = new Map(CAND.map(([c]) => [c, Math.max(0, m.share.get(c) + m.ruidoSecoes.get(c) * RUIDO_SECOES / Math.sqrt(n))]));
  const soma = [...brutos.values()].reduce((s, v) => s + v, 0);
  return { n, validos, votos: new Map([...brutos].map(([c, v]) => [c, Math.round((validos * v) / soma)])) };
}

const MINIMO = 30_000;
function insumos(uf, t) {
  const doUf = municipios.filter((m) => m.uf === uf);
  const maior = doUf.reduce((a, b) => (b.aptos > a.aptos ? b : a));
  const lista = doUf.map((m) => ({ m, a: apurado(m, t) }));
  const arquivo = ({ m, a }) => ({
    codigoMunicipio: m.codigo, totalizacaoFinal: a.n === m.secoes, secoes: { total: m.secoes, totalizadas: a.n }, eleitorado: { total: m.aptos },
    votos: { validos: a.validos }, candidatos: CAND.map(([n, nome, partido]) => ({ sq: n, numero: n, nomeUrna: nome, partido, votos: a.votos.get(n) })),
  });
  const grandes = lista.filter(({ m }) => m === maior || m.aptos >= MINIMO).map(arquivo);
  const detalhes = new Map(lista.map(({ m, a }) => [m.codigo, { aptos: m.aptos, secoes: { total: m.secoes, totalizadas: a.n } }]));
  const ufDados = {
    totalizacaoFinal: lista.every(({ m, a }) => a.n === m.secoes),
    secoes: { total: doUf.reduce((s, m) => s + m.secoes, 0), totalizadas: lista.reduce((s, { a }) => s + a.n, 0) },
    eleitorado: { total: doUf.reduce((s, m) => s + m.aptos, 0) },
    votos: { validos: lista.reduce((s, { a }) => s + a.validos, 0) },
    candidatos: CAND.map(([n, nome, partido]) => ({ sq: n, numero: n, nomeUrna: nome, partido, votos: lista.reduce((s, { a }) => s + a.votos.get(n), 0) })),
  };
  return { ufDados, foto: { completo: false, dados: grandes, detalhes, total: doUf.length, erro: null } };
}

function projecoesUf(uf, t) {
  const { ufDados, foto } = insumos(uf, t);
  return {
    ufDados,
    simples: projetarIngenuo(ufDados, { limite: 50 }),
    grandes: projetarUf({ foto, ufDados, limite: 50 }),
    swing: projetarUfSwing({ foto, ufDados, anterior: base, limite: 50 }),
    swingTransf: projetarUfSwing({ foto, ufDados, anterior: comTransf, limite: 50 }),
  };
}

const verdade = new Map(CAND.map(([n]) => [n, 0]));
let validosFinal = 0;
for (const m of municipios) {
  validosFinal += m.validos;
  for (const [n] of CAND) verdade.set(n, verdade.get(n) + m.validos * m.share.get(n));
}
const pct = (n) => (100 * verdade.get(n)) / validosFinal;
const leadVerdade = pct('13') - pct('22');
const modelos = [['simples', 'Extrapolação simples'], ['grandes', 'Por município'], ['swing', 'Swing sem premissas'], ['swingTransf', 'Swing com premissas']];
const achar = (r, n) => (r?.disponivel ? (r.candidatos.find((x) => x.numero === n)?.pctProjetado ?? 0) : null);

function instante(alvo) {
  let a = -1; let b = 3;
  for (let i = 0; i < 40; i += 1) { const meio = (a + b) / 2; if (progresso(meio) < alvo) a = meio; else b = meio; }
  return b;
}

console.log(`Ensaio do 2º turno de 2022 a partir do 1º: ${municipios.length} municípios, ${ufs.length} abrangências · ordem ${ORDEM} · ruído de seção ${RUIDO_SECOES * 100} pp`);
console.log(`Verdade: Lula ${pct('13').toFixed(2)}% · Bolsonaro ${pct('22').toFixed(2)}% · diferença ${leadVerdade.toFixed(2)} pp`);
console.log(`Premissas testadas: ${JSON.stringify(TRANSF)}\n`);
console.log('Erro da diferença Lula − Bolsonaro, em pontos percentuais (projetado − verdade):');
console.log(['apurado'.padEnd(9), ...modelos.map(([, nome]) => nome.padStart(24))].join(''));
for (const alvo of MOMENTOS) {
  const t = instante(alvo);
  const porUf = ufs.map((uf) => ({ uf, p: projecoesUf(uf, t) }));
  const linha = modelos.map(([chave]) => {
    const soma = projetarBrasil(porUf.map(({ uf, p }) => ({ uf, r: p[chave], ...tamanhoUf({ foto: { dados: [] }, ufDados: p.ufDados }) })), { limite: 50, anteriorPorUf: base.porUf() });
    const a = achar(soma, '13');
    const b = achar(soma, '22');
    return a === null || b === null ? '—'.padStart(24) : `${a - b - leadVerdade >= 0 ? '+' : ''}${(a - b - leadVerdade).toFixed(2)}`.padStart(24);
  });
  console.log([`${(alvo * 100).toFixed(0)}%`.padEnd(9), ...linha].join(''));
}
