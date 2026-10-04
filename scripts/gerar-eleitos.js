#!/usr/bin/env node
// Gera dados-historicos/eleitos.json: quem foi eleito (partido de cada eleito) para governador, senador e deputado
// federal em 2014, 2018 e 2022, a partir dos zips de candidatos dos dados abertos do TSE (~4,5 MB cada).
//   node scripts/gerar-eleitos.js                  baixa os três zips
//   node scripts/gerar-eleitos.js --dir pasta      usa consulta_cand_AAAA.zip já baixados na pasta
// As siglas ficam como o TSE publicou (PMDB, PR, PRB...). A tradução para o partido de hoje está em
// dados-historicos/partidos-sucessao.json e é aplicada pelo painel (src/partidos.js).

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ANOS = [2014, 2018, 2022];
const URL_ZIP = (ano) => `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${ano}.zip`;
const SAIDA = fileURLToPath(new URL('../dados-historicos/eleitos.json', import.meta.url));
const UA = 'apurador-local/0.1 (gerador de eleitos)';
// Cargo no TSE → chave no arquivo, e quantos eleitos devem existir (conferência).
const CARGOS = { GOVERNADOR: 'governador', SENADOR: 'senador', 'DEPUTADO FEDERAL': 'deputadoFederal', 'DEPUTADO ESTADUAL': 'deputadoEstadual' };
const ESPERADO = {
  2014: { governador: 27, senador: 27, deputadoFederal: 513, deputadoEstadual: 1035 },
  2018: { governador: 27, senador: 54, deputadoFederal: 513, deputadoEstadual: 1035 },
  2022: { governador: 27, senador: 27, deputadoFederal: 513, deputadoEstadual: 1035 },
};

// Lê uma entrada de um zip já em memória (diretório central → entrada local → inflate).
export function lerEntradaZip(zip, nome) {
  const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fim < 0) throw new Error('Fim do zip não encontrado.');
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  for (let i = 0; i < total; i += 1) {
    const metodo = zip.readUInt16LE(p + 10);
    const comprimido = zip.readUInt32LE(p + 20);
    const nomeLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const comentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    if (zip.toString('latin1', p + 46, p + 46 + nomeLen) === nome) {
      const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const dados = zip.subarray(inicio, inicio + comprimido);
      return metodo === 0 ? dados : inflateRawSync(dados);
    }
    p += 46 + nomeLen + extraLen + comentLen;
  }
  throw new Error(`Entrada ${nome} não está no zip.`);
}

// CSV do TSE: separador ";", campos entre aspas, latin1.
export function lerCsv(texto) {
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i += 1; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ';') { linha.push(campo); campo = ''; } else if (c === '\n') {
      linha.push(campo.replace(/\r$/, ''));
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas;
  return resto.filter((l) => l.length === cab.length).map((l) => Object.fromEntries(cab.map((k, j) => [k, l[j]])));
}

// Eleitos de um ano: governador { uf: sigla }, senador { uf: [siglas] }, deputadoFederal e deputadoEstadual { uf: { sigla: n } }.
// Só quem aparece como eleito. A eleição ordinária basta, com uma exceção: no Senado, uma suplementar vale quando
// ocupa a cadeira de quem teve a votação anulada (MT 2018: Selma Arruda, PSL, foi cassada e Carlos Fávaro, PSD, eleito
// em 2020). Nos outros cargos as suplementares repetem a UF (AM, GO e TO em 2014) e ficam de fora.
export function eleitosDoAno(linhas) {
  const saida = { governador: {}, senador: {}, deputadoFederal: {}, deputadoEstadual: {} };
  const vistos = new Set();
  for (const l of linhas) {
    const chave = CARGOS[l.DS_CARGO];
    if (!chave || !/^ELEITO/.test(l.DS_SIT_TOT_TURNO)) continue;
    if (!/ordin/i.test(l.NM_TIPO_ELEICAO) && chave !== 'senador') continue;
    if (vistos.has(l.SQ_CANDIDATO)) continue; // candidato de 2º turno aparece uma vez por turno
    vistos.add(l.SQ_CANDIDATO);
    const uf = l.SG_UF.toLowerCase();
    const sigla = l.SG_PARTIDO;
    if (chave === 'governador') saida.governador[uf] = sigla;
    else if (chave === 'senador') (saida.senador[uf] ??= []).push(sigla);
    else {
      const u = (saida[chave][uf] ??= {});
      u[sigla] = (u[sigla] ?? 0) + 1;
    }
  }
  return saida;
}

export const contar = (eleitos) => ({
  governador: Object.keys(eleitos.governador).length,
  senador: Object.values(eleitos.senador).reduce((s, a) => s + a.length, 0),
  deputadoFederal: Object.values(eleitos.deputadoFederal).reduce((s, u) => s + Object.values(u).reduce((x, n) => x + n, 0), 0),
  deputadoEstadual: Object.values(eleitos.deputadoEstadual).reduce((s, u) => s + Object.values(u).reduce((x, n) => x + n, 0), 0),
});

async function baixar(ano, dir) {
  if (dir) return readFile(path.join(dir, `consulta_cand_${ano}.zip`));
  const res = await fetch(URL_ZIP(ano), { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${URL_ZIP(ano)}`);
  return Buffer.from(await res.arrayBuffer());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--dir');
  const dir = i > 0 ? process.argv[i + 1] : null;
  const anos = {};
  for (const ano of ANOS) {
    const zip = await baixar(ano, dir);
    const csv = lerEntradaZip(zip, `consulta_cand_${ano}_BRASIL.csv`).toString('latin1');
    const eleitos = eleitosDoAno(lerCsv(csv));
    const n = contar(eleitos);
    for (const [cargo, esperado] of Object.entries(ESPERADO[ano])) {
      if (n[cargo] !== esperado) throw new Error(`${ano}: esperava ${esperado} eleitos de ${cargo}, vieram ${n[cargo]}.`);
    }
    anos[ano] = eleitos;
    console.log(`${ano}: ${n.governador} governadores, ${n.senador} senadores, ${n.deputadoFederal} deputados federais, ${n.deputadoEstadual} estaduais`);
  }
  await writeFile(SAIDA, `${JSON.stringify({ fonte: 'TSE, dados abertos (consulta_cand)', geradoEm: new Date().toISOString(), anos })}\n`);
  console.log(`Gravado em ${SAIDA}`);
}
