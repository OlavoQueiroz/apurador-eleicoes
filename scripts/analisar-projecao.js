#!/usr/bin/env node
// Mede a estabilidade das projeções gravadas em dados/historico/*.jsonl: para cada abrangência e modelo, o salto da diferença
// projetada entre os dois primeiros a cada atualização, quantos "pulos" passaram do limiar, quantos coincidiram com troca de
// plano (plano B, UFs sem apuração) e, se a apuração acabou, o erro por faixa de apuração.
//
//   node scripts/analisar-projecao.js [arquivo.jsonl] [--limiar 1] [--chave 1:br] [--modelo swing]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analisarSerie } from '../src/analise-historico.js';
import { lerSerie } from '../src/historico.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nome, padrao) => { const i = process.argv.indexOf(`--${nome}`); return i > 0 ? process.argv[i + 1] : padrao; };
const dirHist = path.join(raiz, 'dados', 'historico');
const posicional = process.argv.slice(2).find((a, i, v) => !a.startsWith('--') && !v[i - 1]?.startsWith('--'));
const arquivo = posicional ?? (existsSync(dirHist) ? path.join(dirHist, readdirSync(dirHist).filter((f) => f.endsWith('.jsonl') && !f.includes('demo')).sort().at(-1) ?? '') : null);
if (!arquivo || !existsSync(arquivo)) { console.error('Nenhum histórico encontrado. Informe o arquivo: node scripts/analisar-projecao.js caminho.jsonl'); process.exit(1); }

const porChave = new Map();
for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
  if (!linha.trim()) continue;
  try { const p = JSON.parse(linha); if (!porChave.has(p.chave)) porChave.set(p.chave, []); porChave.get(p.chave).push(p); } catch { /* linha cortada */ }
}
const historico = { pontos: (chave) => porChave.get(chave) ?? [] };
const limiar = Number(arg('limiar', 1));
const soChave = arg('chave', null);
const soModelo = arg('modelo', null);
const pp = (n) => n.toFixed(2).padStart(6);

console.log(`Arquivo: ${arquivo}\nPulo = mudança de ${limiar} pp ou mais na diferença projetada entre os dois primeiros, de uma atualização para a seguinte.\n`);
for (const chave of [...porChave.keys()].sort()) {
  if (soChave && chave !== soChave) continue;
  for (const modelo of ['estratificado', 'swing', 'ingenuo']) { // 'ingenuo': só aparece nas gravações que o têm (comparação)
    if (soModelo && modelo !== soModelo) continue;
    const serie = lerSerie(historico, chave, modelo);
    const a = serie ? analisarSerie(serie.pontos, { limiar }) : null;
    if (!a) continue;
    console.log(`${chave} · ${modelo} · ${a.candidatos.join(' x ')}: ${a.pontos} pontos, salto mediano ${pp(a.saltoMediano)} pp, maior ${pp(a.maiorSalto)} pp, ${a.pulos} pulos`
      + (a.pulos ? ` (${a.pulosComTrocaDePlano} com troca de plano, ${a.pulosSemMudancaDoAtual} sem o % atual mexer)` : ''));
    for (const m of a.maiores) console.log(`    ${m.t} · ${m.secoes.toFixed(1)}% das seções · ${m.delta >= 0 ? '+' : ''}${m.delta.toFixed(2)} pp · plano ${m.plano ?? '—'}${m.trocouDePlano ? ' (trocou)' : ''}`);
    if (a.porFaixa.length) console.log(`    erro médio por faixa: ${a.porFaixa.map((f) => `${f.faixa} ${f.erroMedio.toFixed(2)}`).join(' · ')}`);
  }
}
