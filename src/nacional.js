// Total nacional de presidente a partir dos arquivos das UFs (e do exterior). O arquivo "br" do TSE costuma sair
// bem depois dos estaduais (na noite do 1º turno de 2026 ficou ~45 min parado enquanto as UFs seguiam), então o painel
// compara os dois e fica com o que tiver mais votos válidos.

import { ordenarCandidatos } from './normalize.js';

const arredondar = (n) => Math.round(n * 100) / 100;

// Soma os dados normalizados das UFs num dado com o formato do arquivo nacional. `base` é o dado oficial "br"
// (fornece a lista de candidatos, vices, nomes e o que não se soma, como situação e totalização final); sem ele, usa-se
// o dado de uma das UFs. Devolve null se nenhuma UF tem dado.
export function somarUfs(ufs, base = null) {
  const comDados = ufs.filter((d) => d?.candidatos?.length);
  if (!comDados.length) return null;
  const modelo = base ?? comDados[0];

  const votos = new Map();
  for (const d of comDados) for (const c of d.candidatos) votos.set(c.numero, (votos.get(c.numero) ?? 0) + c.votos);

  const soma = (campo) => comDados.reduce((s, d) => s + (campo(d) ?? 0), 0);
  const validos = soma((d) => d.votos.validos);
  const candidatos = ordenarCandidatos(
    modelo.candidatos.map((c) => {
      const v = votos.get(c.numero) ?? 0;
      return { ...c, votos: v, pct: validos ? arredondar((100 * v) / validos) : 0 };
    }),
  );
  const secoesTotal = soma((d) => d.secoes.total);
  const secoesTotalizadas = soma((d) => d.secoes.totalizadas);
  const comparecimento = soma((d) => d.eleitorado.comparecimento);
  const abstencao = soma((d) => d.eleitorado.abstencao);
  const eleitoradoTotal = soma((d) => d.eleitorado.total);
  const brancos = soma((d) => d.votos.brancos);
  const nulos = soma((d) => d.votos.nulos);
  const pct = (parte, todo) => (todo ? arredondar((100 * parte) / todo) : 0);

  // Idade do dado = a do arquivo mais antigo entre os somados: é a leitura mais atrasada que entrou na conta.
  const geradoEm = comDados.map((d) => d.geradoEm).filter(Boolean).sort()[0] ?? modelo.geradoEm;

  return {
    ...modelo,
    geracao: `soma-ufs:${comDados.map((d) => d.geracao).join('+')}`,
    geradoEm,
    fonte: 'soma-ufs',
    ufsSomadas: comDados.length,
    secoes: { total: secoesTotal, totalizadas: secoesTotalizadas, pctTotalizadas: pct(secoesTotalizadas, secoesTotal) },
    eleitorado: {
      total: eleitoradoTotal,
      comparecimento,
      pctComparecimento: pct(comparecimento, eleitoradoTotal),
      abstencao,
      pctAbstencao: pct(abstencao, eleitoradoTotal),
    },
    votos: {
      validos,
      pctValidos: pct(validos, comparecimento),
      brancos,
      pctBrancos: pct(brancos, comparecimento),
      nulos,
      pctNulos: pct(nulos, comparecimento),
    },
    candidatos,
  };
}

// Escolhe a fonte com mais votos válidos entre o dado oficial nacional (pode ser null) e a soma das UFs.
// Em empate, vale o oficial.
export function melhorNacional(oficial, ufs) {
  const soma = somarUfs(ufs, oficial);
  if (!soma) return oficial ?? null;
  if (!oficial) return soma;
  return soma.votos.validos > oficial.votos.validos ? soma : oficial;
}
