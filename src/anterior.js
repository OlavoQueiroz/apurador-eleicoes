// Resultado da eleição anterior (2022, presidente) por município, já traduzido para os candidatos de 2026
// pelo mapeamento de herança. Alimenta o modelo de swing histórico.

import { readFileSync } from 'node:fs';

// `historico` = conteúdo de presidente-2022-t1.json; `mapeamento` = mapeamento-presidente.json.
export function criarAnterior(historico, mapeamento) {
  const herdeiros = Object.entries(mapeamento).filter(([chave, v]) => !chave.startsWith('_') && Array.isArray(v));
  const avisos = [];
  const usado = new Map(); // candidato de 2022 → soma dos pesos distribuídos
  for (const [, fontes] of herdeiros) {
    for (const f of fontes) usado.set(f.de, (usado.get(f.de) ?? 0) + f.peso);
  }
  for (const [de, soma] of usado) {
    if (soma > 1.0001) avisos.push(`os votos do candidato ${de} de 2022 estão distribuídos além de 100% (${Math.round(soma * 100)}%)`);
    if (!historico.candidatos[de]) avisos.push(`candidato ${de} de 2022 não existe nos dados históricos`);
  }

  const cache = new Map();
  let porUfCache = null;
  let brutoCache = null;
  return {
    avisos,
    fonte: historico.fonte,
    // Votos de 2022 por UF: { uf: { validos, votos: { numero 2022 → votos }, herdados: { numero 2026 → votos herdados } } }. É a base do comparativo
    // 2026 × 2022 (mesma tradução do swing: PT→Lula, PL→Flávio...). Calculado uma vez.
    porUf() {
      if (!porUfCache) {
        const ufs = {};
        for (const m of Object.values(historico.municipios)) {
          const u = (ufs[m.uf] ??= { validos: 0, votos: {} });
          for (const [numero, votos] of Object.entries(m.votos)) {
            u.votos[numero] = (u.votos[numero] ?? 0) + votos;
            u.validos += votos;
          }
        }
        porUfCache = Object.fromEntries(Object.entries(ufs).map(([uf, u]) => [uf, {
          validos: u.validos,
          votos: u.votos, // brutos, por número do ano da base: dá o terceiro candidato (Ciro, Alckmin...) no comparativo
          herdados: Object.fromEntries(herdeiros.map(([numero, fontes]) => [numero, fontes.reduce((s, f) => s + f.peso * (u.votos[f.de] ?? 0), 0)])),
        }]));
      }
      return porUfCache;
    },
    // Votos brutos (sem tradução) por UF: { uf: { validos, votos: { numero → votos } } }. É o "atual" do comparativo
    // quando a eleição já terminou (por exemplo 2022 × 2018).
    brutoPorUf() {
      if (!brutoCache) {
        brutoCache = {};
        for (const m of Object.values(historico.municipios)) {
          const u = (brutoCache[m.uf] ??= { validos: 0, votos: {} });
          for (const [numero, votos] of Object.entries(m.votos)) {
            u.votos[numero] = (u.votos[numero] ?? 0) + votos;
            u.validos += votos;
          }
        }
      }
      return brutoCache;
    },
    candidatos22: historico.candidatos,
    // Mesma base com premissas de transferência acrescentadas ao mapeamento: { "55": { "13": 0.2, "22": 0.5 } } = 20% dos votos
    // do candidato 55 do turno anterior vão para o 13 e 50% para o 22 (o resto some: abstenção, branco ou nulo). É a
    // premissa editável do 2º turno.
    comTransferencias(transf) {
      return criarAnterior(historico, aplicarTransferencias(mapeamento, transf));
    },
    ano: historico.ano,
    turno: historico.turno,
    // Votos de 2022 do município traduzidos: { herdados: Map(numero 2026 → votos), validos: total de válidos em 2022 }.
    prior(codigo) {
      if (cache.has(codigo)) return cache.get(codigo);
      const m = historico.municipios[codigo];
      let resultado = null;
      if (m) {
        const herdados = new Map();
        for (const [numero, fontes] of herdeiros) {
          herdados.set(numero, fontes.reduce((s, f) => s + f.peso * (m.votos[f.de] ?? 0), 0));
        }
        resultado = { herdados, validos: Object.values(m.votos).reduce((s, v) => s + v, 0) };
      }
      cache.set(codigo, resultado);
      return resultado;
    },
  };
}

// Junta ao mapeamento as transferências { origem: { destino: fração } }. Valores inválidos são ignorados; as frações de uma origem
// são limitadas a 100% no total (a mais, o `criarAnterior` já avisa).
export function aplicarTransferencias(mapeamento, transf) {
  const saida = {};
  for (const [k, v] of Object.entries(mapeamento)) saida[k] = Array.isArray(v) ? v.map((f) => ({ ...f })) : v;
  for (const [origem, destinos] of Object.entries(transf ?? {})) {
    for (const [destino, peso] of Object.entries(destinos ?? {})) {
      const w = Number(peso);
      if (!(w > 0) || !(w <= 1)) continue;
      const lista = (saida[destino] ??= []);
      const existente = lista.find((f) => f.de === origem);
      if (existente) existente.peso = w;
      else lista.push({ de: origem, peso: w });
    }
  }
  return saida;
}

export function carregarAnterior(arquivoHistorico, arquivoMapeamento) {
  return criarAnterior(JSON.parse(readFileSync(arquivoHistorico, 'utf8')), JSON.parse(readFileSync(arquivoMapeamento, 'utf8')));
}
