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
  return {
    avisos,
    fonte: historico.fonte,
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

export function carregarAnterior(arquivoHistorico, arquivoMapeamento) {
  return criarAnterior(JSON.parse(readFileSync(arquivoHistorico, 'utf8')), JSON.parse(readFileSync(arquivoMapeamento, 'utf8')));
}
