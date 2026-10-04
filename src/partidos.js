// Eleitos de eleições passadas (governador, senador e deputado federal) por partido, para a aba de partidos e
// ideologia. Os dados vêm de dados-historicos/eleitos.json (scripts/gerar-eleitos.js); as siglas são traduzidas para o
// partido de hoje pela tabela dados-historicos/partidos-sucessao.json, para a bancada de 2022 poder ser comparada com a
// de 2026 mesmo depois de fusões e renomeações (PMDB → MDB, DEM → UNIÃO...).

import { readFileSync } from 'node:fs';

// Mesma chave de public/ideologia.js: "PC do B", "PCdoB" e "PC DO B" são o mesmo partido.
export const chaveSigla = (sigla) =>
  String(sigla ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// `sucessao`: { "PMDB": "MDB", ... } (chaves que começam com "_" são comentários).
export function criarTradutor(sucessao = {}) {
  const tabela = new Map(Object.entries(sucessao).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [chaveSigla(k), v]));
  return (sigla) => tabela.get(chaveSigla(sigla)) ?? String(sigla ?? '').trim().toUpperCase();
}

const somar = (mapa, sigla, n = 1) => { mapa[sigla] = (mapa[sigla] ?? 0) + n; };

// Devolve o conteúdo de /api/partidos: por ano, o partido de cada governador, os partidos dos senadores de cada UF e a
// bancada de deputados federais de cada UF (partido → cadeiras), todos já traduzidos.
export function criarPartidos(eleitos, sucessao) {
  const traduzir = criarTradutor(sucessao);
  const anos = {};
  for (const [ano, e] of Object.entries(eleitos.anos)) {
    const governador = {};
    for (const [uf, sigla] of Object.entries(e.governador)) governador[uf] = traduzir(sigla);
    const senador = {};
    for (const [uf, siglas] of Object.entries(e.senador)) senador[uf] = siglas.map(traduzir);
    const deputadoFederal = {};
    for (const [uf, porPartido] of Object.entries(e.deputadoFederal)) {
      const u = (deputadoFederal[uf] = {});
      for (const [sigla, n] of Object.entries(porPartido)) somar(u, traduzir(sigla), n);
    }
    anos[ano] = { governador, senador, deputadoFederal };
  }
  return { disponivel: true, fonte: eleitos.fonte, anos };
}

export function carregarPartidos(arquivoEleitos, arquivoSucessao) {
  const eleitos = JSON.parse(readFileSync(arquivoEleitos, 'utf8'));
  const sucessao = JSON.parse(readFileSync(arquivoSucessao, 'utf8'));
  return criarPartidos(eleitos, sucessao);
}
