// Acesso aos arquivos públicos de resultado do TSE (resultados.tse.jus.br).
//
// Layout descoberto a partir do próprio app oficial de resultados:
//   {BASE}/{ciclo}/{eleição}/dados/{abrangência}/{abrangência}-c{cargo:4}-e{eleição:6}-u.json
// O sufixo "-u" é o "arquivo de resultado unificado". A abrangência é "br", uma UF
// em minúsculas ou "zz" (exterior).

import { normalizar } from './normalize.js';

export const BASE = 'https://resultados.tse.jus.br/oficial';
const USER_AGENT = 'apurador-local/0.1 (painel pessoal; GET condicional com ETag)';

export const UFS = [
  'ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt', 'pa',
  'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to',
];

// `pleito` diz em qual eleição do TSE o cargo está: a federal (presidente) ou a estadual
// (governador, senador e deputados). `turnos` são os turnos em que o cargo existe.
export const CARGOS = {
  1: { codigo: 1, nome: 'Presidente', pleito: 'federal', turnos: [1, 2], abrangencias: ['br', ...UFS, 'zz'] },
  3: { codigo: 3, nome: 'Governador', pleito: 'estadual', turnos: [1, 2], abrangencias: UFS },
  5: { codigo: 5, nome: 'Senador', pleito: 'estadual', turnos: [1], abrangencias: UFS },
  6: { codigo: 6, nome: 'Deputado Federal', pleito: 'estadual', turnos: [1], abrangencias: UFS },
  7: { codigo: 7, nome: 'Deputado Estadual', pleito: 'estadual', turnos: [1], abrangencias: UFS.filter((uf) => uf !== 'df') },
  8: { codigo: 8, nome: 'Deputado Distrital', pleito: 'estadual', turnos: [1], abrangencias: ['df'] },
};

// Deputado estadual fica de fora por padrão (são milhares de candidatos por UF e o painel
// não foi pensado para eles). Inclua com CARGOS=1,3,5,6,7,8.
export const CARGOS_PADRAO = [1, 3, 5, 6];

const pad = (valor, tamanho) => String(valor).padStart(tamanho, '0');

export const urlResultado = (ciclo, eleicao, abrangencia, cargo) =>
  `${BASE}/${ciclo}/${eleicao}/dados/${abrangencia}/${abrangencia}-c${pad(cargo, 4)}-e${pad(eleicao, 6)}-u.json`;

async function getJson(url, { signal } = {}) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

// Lê o índice de eleições do TSE e descobre os códigos de eleição do ciclo pedido
// (ex.: 2026 → federal 6257/6258, estadual 6259/6260), em vez de deixá-los fixos no código.
export async function descobrirEleicoes(ano, { signal } = {}) {
  const indice = await getJson(`${BASE}/comum/config/ele-c.json`, { signal });
  const ciclo = `ele${ano}`;
  for (const pleito of indice.pl ?? []) {
    if (pleito.c !== ciclo) continue;
    const eleicoes = {};
    for (const e of pleito.e ?? []) {
      if (e.t !== '1') continue;
      const tipo = e.tp === '8' ? 'federal' : e.tp === '1' ? 'estadual' : null;
      if (tipo && !eleicoes[tipo]) eleicoes[tipo] = { 1: e.cd, 2: e.cdt2 || null };
    }
    if (eleicoes.federal || eleicoes.estadual) return { ciclo, pleito: pleito.cd, eleicoes };
  }
  throw new Error(`O índice do TSE não lista eleições federais/estaduais para ${ano}.`);
}

// Uma "meta" por arquivo a ser acompanhado: cargo × abrangência.
export function montarAlvos({ ciclo, eleicoes, turno = 1, cargos = CARGOS_PADRAO }) {
  const alvos = [];
  for (const codigo of cargos) {
    const cargo = CARGOS[codigo];
    if (!cargo || !cargo.turnos.includes(turno)) continue;
    const eleicao = eleicoes[cargo.pleito]?.[turno];
    if (!eleicao) continue;
    for (const uf of cargo.abrangencias) {
      alvos.push({ chave: `${codigo}:${uf}`, cargo: codigo, uf, eleicao, url: urlResultado(ciclo, eleicao, uf, codigo) });
    }
  }
  return alvos;
}

// Fonte real: baixa o arquivo com GET condicional (If-None-Match) e já devolve normalizado.
// Contrato compartilhado com a fonte de demonstração:
//   obter(alvo, anterior) → { status: 'novo', dados, etag } | { status: 'inalterado' } | { status: 'indisponivel' }
export function criarFonteTse({ signal } = {}) {
  return {
    demo: false,
    async obter(alvo, anterior) {
      const headers = { 'user-agent': USER_AGENT, accept: 'application/json' };
      if (anterior?.etag) headers['if-none-match'] = anterior.etag;
      const res = await fetch(alvo.url, { headers, signal });
      if (res.status === 304) return { status: 'inalterado' };
      // Antes da apuração, ou fora do turno/UF, o TSE responde 404 (NoSuchKey).
      if (res.status === 404) return { status: 'indisponivel' };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bruto = await res.json();
      return { status: 'novo', dados: normalizar(bruto), etag: res.headers.get('etag') };
    },
  };
}
