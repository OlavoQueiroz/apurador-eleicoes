#!/usr/bin/env node
// Gera dados-historicos/presidente-2026-t1.json: votos de cada candidato a presidente no 1º turno de 2026 por
// município. É a base do modelo de swing e do comparativo do 2º turno (o 1º turno de 2026 é o "histórico" mais
// recente e mais parecido com o 2º).
//   node scripts/gerar-historico-2026-t1.js            baixa os ~5,7 mil municípios (uns 15 min) e pode ser interrompido:
//                                                      o que já veio fica em .cache/hist-2026-t1/ e não é baixado de novo
//   node scripts/gerar-historico-2026-t1.js --ritmo 200  ms entre pedidos (padrão 120)
// Os arquivos do 1º turno estão fechados: não mudam mais.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarFonteMunicipiosTse, descobrirEleicoes } from '../src/tse.js';
import { Limitador, comRecuo, pedeCalma, recuoDoErro } from '../src/limitador.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pasta = path.join(raiz, '.cache', 'hist-2026-t1');
const saida = path.join(raiz, 'dados-historicos', 'presidente-2026-t1.json');
const i = process.argv.indexOf('--ritmo');
const ritmo = i > 0 ? Number(process.argv[i + 1]) : 120;

const { ciclo, eleicoes } = await comRecuo(() => descobrirEleicoes(2026), { aviso: console.error });
const eleicao = eleicoes.federal[1];
const fonte = criarFonteMunicipiosTse();
const limitador = new Limitador({ altaMs: ritmo, baixaMs: ritmo });
await mkdir(pasta, { recursive: true });

const lista = await fonte.listar(ciclo, eleicao);
const alvos = [];
for (const [uf, muns] of lista) for (const m of muns) alvos.push({ uf, codigo: m.codigo, nome: m.nome });
console.log(`${alvos.length} municípios em ${lista.size} abrangências (eleição ${eleicao}).`);

const resultado = {};
let feitos = 0;
let faltam = 0;
const fila = [...alvos];

async function um(a) {
  const arq = path.join(pasta, `${a.uf}${a.codigo}.json`);
  try {
    resultado[a.codigo] = JSON.parse(await readFile(arq, 'utf8'));
    return;
  } catch { /* ainda não baixado */ }
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    await limitador.vez('alta');
    try {
      const r = await fonte.obter({ ciclo, eleicao, uf: a.uf, municipio: a.codigo, cargo: 1 }, null);
      if (r.status !== 'novo') { faltam += 1; return; }
      const votos = Object.fromEntries(r.dados.candidatos.map((c) => [c.numero, c.votos]));
      const item = { uf: a.uf, votos, candidatos: r.dados.candidatos.map((c) => ({ numero: c.numero, nomeUrna: c.nomeUrna, partido: c.partido })), final: r.dados.totalizacaoFinal };
      resultado[a.codigo] = item;
      await writeFile(arq, JSON.stringify(item));
      return;
    } catch (erro) {
      if (!pedeCalma(erro)) { console.error(`${a.uf}${a.codigo}: ${erro.message}`); await new Promise((r) => setTimeout(r, 2000)); continue; }
      const ms = recuoDoErro(erro, tentativa);
      limitador.recuar(ms);
      console.error(`TSE pediu calma (${erro.message}); esperando ${Math.round(ms / 1000)} s`);
    }
  }
  faltam += 1;
}

async function trabalhador() {
  while (fila.length) {
    await um(fila.shift());
    feitos += 1;
    if (feitos % 250 === 0) console.log(`${feitos}/${alvos.length}`);
  }
}
await Promise.all(Array.from({ length: 8 }, trabalhador));

const candidatos = {};
const municipios = {};
let abertos = 0;
for (const [codigo, m] of Object.entries(resultado)) {
  if (!m.final) abertos += 1;
  for (const c of m.candidatos) candidatos[c.numero] ??= { nomeUrna: c.nomeUrna, partido: c.partido };
  municipios[codigo] = { uf: m.uf, votos: m.votos };
}
await mkdir(path.dirname(saida), { recursive: true });
await writeFile(saida, JSON.stringify({
  fonte: 'TSE, arquivos de resultado por município (resultados.tse.jus.br), 1º turno de 2026, votos nominais válidos',
  ano: 2026, turno: 1, cargo: 1, candidatos, municipios,
}));

const total = {};
for (const m of Object.values(municipios)) for (const [n, v] of Object.entries(m.votos)) total[n] = (total[n] ?? 0) + v;
console.log(`${Object.keys(municipios).length} municípios, ${Object.keys(candidatos).length} candidatos → ${path.relative(process.cwd(), saida)}`);
console.log('Totais:', Object.entries(total).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => `${candidatos[n].nomeUrna} ${v.toLocaleString('pt-BR')}`).join(' · '));
if (faltam) console.log(`ATENÇÃO: ${faltam} municípios ficaram de fora (rode de novo para completar).`);
if (abertos) console.log(`ATENÇÃO: ${abertos} municípios não estavam com totalização final.`);
