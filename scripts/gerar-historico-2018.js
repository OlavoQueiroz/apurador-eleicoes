#!/usr/bin/env node
// Gera dados-historicos/presidente-2018-t1.json: votos de cada candidato a presidente em 2018 (1º turno) por
// município, a partir dos dados abertos do TSE. Usado pelo modelo de swing histórico.
//   node scripts/gerar-historico-2018.js              baixa só o arquivo da presidência (~2.4 MB) de dentro do zip
//   node scripts/gerar-historico-2018.js --csv arq    usa um CSV já baixado
// O zip completo tem 395 MB; este script lê só a entrada `..._BR.csv` por requisições de faixa (Range).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ZIP = 'https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2018.zip';
const ENTRADA = 'votacao_candidato_munzona_2018_BR.csv';
const saida = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dados-historicos/presidente-2018-t1.json');
const UA = 'apurador-local/0.1 (painel pessoal; leitura de uma entrada do zip)';

async function faixa(inicio, fim) {
  const res = await fetch(ZIP, { headers: { range: `bytes=${inicio}-${fim}`, 'user-agent': UA } });
  if (res.status !== 206) throw new Error(`HTTP ${res.status} ao pedir a faixa ${inicio}-${fim}`);
  return Buffer.from(await res.arrayBuffer());
}

// Lê uma entrada do zip remoto sem baixar o zip inteiro: fim do arquivo → diretório central → entrada.
async function lerEntradaZip(nome) {
  const head = await fetch(ZIP, { method: 'HEAD', headers: { 'user-agent': UA } });
  const tamanho = Number(head.headers.get('content-length'));
  const cauda = await faixa(Math.max(0, tamanho - 65_536), tamanho - 1);
  const fim = cauda.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fim < 0) throw new Error('Fim do zip não encontrado.');
  const tamCentral = cauda.readUInt32LE(fim + 12);
  const posCentral = cauda.readUInt32LE(fim + 16);
  const central = await faixa(posCentral, posCentral + tamCentral - 1);
  for (let p = 0; p < central.length && central.readUInt32LE(p) === 0x02014b50;) {
    const metodo = central.readUInt16LE(p + 10);
    const comprimido = central.readUInt32LE(p + 20);
    const nomeLen = central.readUInt16LE(p + 28);
    const extraLen = central.readUInt16LE(p + 30);
    const comentLen = central.readUInt16LE(p + 32);
    const local = central.readUInt32LE(p + 42);
    const atual = central.toString('utf8', p + 46, p + 46 + nomeLen);
    if (atual === nome) {
      const cab = await faixa(local, local + 29);
      const inicio = local + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
      const dados = await faixa(inicio, inicio + comprimido - 1);
      return metodo === 0 ? dados : inflateRawSync(dados);
    }
    p += 46 + nomeLen + extraLen + comentLen;
  }
  throw new Error(`Entrada ${nome} não encontrada no zip.`);
}

// CSV do TSE: separador ";" e campos entre aspas, em latin1.
function* linhas(texto) {
  for (const linha of texto.split('\n')) {
    if (!linha.trim()) continue;
    const campos = [];
    let atual = '';
    let aspas = false;
    for (const ch of linha.replace(/\r$/, '')) {
      if (ch === '"') aspas = !aspas;
      else if (ch === ';' && !aspas) { campos.push(atual); atual = ''; } else atual += ch;
    }
    campos.push(atual);
    yield campos;
  }
}

const i = process.argv.indexOf('--csv');
const bruto = i > 0 ? await readFile(process.argv[i + 1]) : await lerEntradaZip(ENTRADA);
const it = linhas(bruto.toString('latin1'));
const cab = it.next().value;
const col = Object.fromEntries(cab.map((c, k) => [c, k]));

const candidatos = {};
const municipios = {};
for (const c of it) {
  if (c[col.NR_TURNO] !== '1') continue;
  if (col.DS_CARGO !== undefined && c[col.DS_CARGO] !== 'Presidente') continue;
  if (col.NM_TIPO_DESTINACAO_VOTOS !== undefined && c[col.NM_TIPO_DESTINACAO_VOTOS] !== 'Válido') continue;
  const codigo = c[col.CD_MUNICIPIO].padStart(5, '0');
  const numero = c[col.NR_CANDIDATO];
  candidatos[numero] ??= { nomeUrna: c[col.NM_URNA_CANDIDATO], partido: c[col.SG_PARTIDO] };
  const m = (municipios[codigo] ??= { uf: c[col.SG_UF].toLowerCase(), votos: {} });
  m.votos[numero] = (m.votos[numero] ?? 0) + Number(c[col.QT_VOTOS_NOMINAIS]);
}

for (const m of Object.values(municipios)) {
  for (const n of Object.keys(candidatos)) {
    m.votos[n] ??= 0;
  }
}

const total = {};
for (const m of Object.values(municipios)) for (const [n, v] of Object.entries(m.votos)) total[n] = (total[n] ?? 0) + v;
await mkdir(path.dirname(saida), { recursive: true });
await writeFile(saida, JSON.stringify({
  fonte: 'TSE, dados abertos: votacao_candidato_munzona_2018 (entrada _BR.csv), 1º turno, votos nominais válidos',
  ano: 2018, turno: 1, cargo: 1, candidatos, municipios,
}));
console.log(`${Object.keys(municipios).length} municípios, ${Object.keys(candidatos).length} candidatos → ${path.relative(process.cwd(), saida)}`);
console.log('Totais:', Object.entries(total).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => `${candidatos[n].nomeUrna} ${v.toLocaleString('pt-BR')}`).join(' · '));
