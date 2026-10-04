// Acesso aos arquivos públicos de resultado do TSE (resultados.tse.jus.br).
//
// Layout descoberto a partir do próprio app oficial de resultados:
//   {BASE}/{ciclo}/{eleição}/dados/{abrangência}/{abrangência}-c{cargo:4}-e{eleição:6}-u.json
// O sufixo "-u" é o "arquivo de resultado unificado". A abrangência é "br", uma UF
// em minúsculas ou "zz" (exterior).

import { normalizar } from './normalize.js';

export const BASE = 'https://resultados.tse.jus.br/oficial';
const USER_AGENT = 'apurador-local/0.1 (painel pessoal; GET condicional com ETag)';

// Sem prazo, um socket que fica aberto sem enviar dados deixaria a requisição (e o worker do ciclo) presa para
// sempre. O prazo cobre cabeçalho e corpo e se combina com um `signal` de cancelamento, se houver.
export const TIMEOUT_MS = 15_000;
export const comPrazo = (signal, ms = TIMEOUT_MS) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

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
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: comPrazo(signal) });
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
      const res = await fetch(alvo.url, { headers, signal: comPrazo(signal) });
      if (res.status === 304) return { status: 'inalterado' };
      // Antes da apuração, ou fora do turno/UF, o TSE responde 404 (NoSuchKey).
      if (res.status === 404) return { status: 'indisponivel' };
      if (!res.ok) {
        const erro = new Error(`HTTP ${res.status}`);
        erro.status = res.status;
        const espera = Number(res.headers.get('retry-after'));
        erro.esperarMs = espera > 0 ? espera * 1000 : null; // o TSE pode pedir calma (429/503)
        throw erro;
      }
      const bruto = await res.json();
      return { status: 'novo', dados: normalizar(bruto), etag: res.headers.get('etag') };
    },
  };
}

// ---------- municípios ----------
//   {BASE}/{ciclo}/{eleição}/config/mun-e{eleição:6}-cm.json      lista de municípios (e zonas) por UF
//   {BASE}/{ciclo}/{eleição}/dados/{uf}/{uf}{município:5}-c{cargo:4}-e{eleição:6}-u.json   resultado do município
// O código de município é o do TSE (5 dígitos, ex.: 71072 = São Paulo), não o do IBGE.

export const urlMunicipio = (ciclo, eleicao, uf, municipio, cargo) =>
  `${BASE}/${ciclo}/${eleicao}/dados/${uf}/${uf}${municipio}-c${pad(cargo, 4)}-e${pad(eleicao, 6)}-u.json`;

export const urlAcompanhamento = (ciclo, eleicao, uf) =>
  `${BASE}/${ciclo}/${eleicao}/dados/${uf}/${uf}-e${pad(eleicao, 6)}-ab.json`;

// Município → { aptos, secoes:{total,totalizadas} } para TODOS os municípios da UF. É daqui que sai o tamanho de
// cada município (para escolher os grandes) e o total de seções do "resto do estado".
export function detalhesAcompanhamento(bruto) {
  const detalhes = new Map();
  const n = (v) => parseInt(String(v ?? '').replace(/\D/g, ''), 10) || 0;
  for (const a of bruto.abr ?? []) {
    if (a.tpabr !== 'mun') continue;
    detalhes.set(String(a.cdabr), { aptos: n(a.e?.te), secoes: { total: n(a.s?.ts), totalizadas: n(a.s?.st) } });
  }
  return detalhes;
}

export function mapaAcompanhamento(bruto) {
  const mapa = new Map();
  for (const a of bruto.abr ?? []) {
    if (a.tpabr !== 'mun') continue;
    mapa.set(String(a.cdabr), `${a.s?.st ?? ''}:${a.e?.c ?? ''}`);
  }
  return mapa;
}

// Contrato compartilhado com a fonte de demonstração (que não tem `acompanhar`):
//   listar(ciclo, eleicao) → Map uf → [{ codigo, nome, cdi }]
//   obter(alvoMunicipio, anterior) → mesmo contrato de `criarFonteTse().obter`
export function criarFonteMunicipiosTse({ signal } = {}) {
  const base = criarFonteTse({ signal });
  return {
    async listar(ciclo, eleicao) {
      const cfg = await getJson(`${BASE}/${ciclo}/${eleicao}/config/mun-e${pad(eleicao, 6)}-cm.json`, { signal });
      return new Map((cfg.abr ?? []).map((a) => [
        String(a.cd).toLowerCase(),
        (a.mu ?? []).map((m) => ({ codigo: String(m.cd), nome: m.nm, cdi: m.cdi ? String(m.cdi) : null })), // cdi = código IBGE
      ]));
    },
    // Arquivo de acompanhamento da UF: seções totalizadas e comparecimento de TODOS os municípios, sem votos por
    // candidato. Devolve Map município → "seções totalizadas:comparecimento", que muda quando entram urnas novas.
    async acompanhar({ ciclo, eleicao, uf }, anterior) {
      const url = urlAcompanhamento(ciclo, eleicao, uf);
      const headers = { 'user-agent': USER_AGENT, accept: 'application/json' };
      if (anterior?.etag) headers['if-none-match'] = anterior.etag;
      const res = await fetch(url, { headers, signal: comPrazo(signal) });
      if (res.status === 304) return { status: 'inalterado' };
      if (res.status === 404) return { status: 'indisponivel' };
      if (!res.ok) {
        const erro = new Error(`HTTP ${res.status}`);
        erro.status = res.status;
        const espera = Number(res.headers.get('retry-after'));
        erro.esperarMs = espera > 0 ? espera * 1000 : null;
        throw erro;
      }
      const bruto = await res.json();
      return { status: 'novo', mapa: mapaAcompanhamento(bruto), detalhes: detalhesAcompanhamento(bruto), etag: res.headers.get('etag') };
    },
    obter: (alvo, anterior) =>
      base.obter({ ...alvo, url: urlMunicipio(alvo.ciclo, alvo.eleicao, alvo.uf, alvo.municipio, alvo.cargo) }, anterior),
  };
}
