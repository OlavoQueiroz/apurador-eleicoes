// Projeções do resultado final a partir de uma apuração parcial. São ESTIMATIVAS do painel, não dados
// do TSE, e ficam numa visão separada da interface. Cada modelo recebe o resultado normalizado de um
// arquivo (cargo × abrangência) e devolve a projeção por candidato.
//
// Ver docs/modelos-simulacao.md. Existem os modelos 1 (extrapolação simples) e 2 (estratificação por
// município); o swing histórico e o bayesiano dependem de dados de eleições anteriores e de pesquisas.

export const MODELOS = [
  {
    id: 'ingenuo',
    nome: 'Extrapolação simples',
    disponivel: true,
    descricao:
      'Mantém o percentual atual de cada candidato e projeta o total de votos válidos pela fração de seções '
      + 'totalizadas. Ignora a ordem geográfica da apuração: no começo, o resultado pode ser uma miragem.',
  },
  {
    id: 'estratificado',
    nome: 'Estratificação por município',
    disponivel: true,
    descricao:
      'Projeta cada município pela fração das seções dele já apuradas e soma. Municípios que ainda não '
      + 'apuraram nada entram pelo eleitorado e pela média da UF. Corrige parte da distorção da ordem de '
      + 'apuração, mas só vale para presidente, governador e senador, uma UF por vez.',
  },
  {
    id: 'bayesiano',
    nome: 'Bayesiano com pesquisas',
    disponivel: false,
    descricao: 'Mistura pesquisas de intenção de voto com a apuração conforme as urnas abrem.',
    motivo: 'Depende de pesquisas de intenção de voto em formato estruturado, que o painel ainda não tem.',
  },
];

export const modeloPorId = (id) => MODELOS.find((m) => m.id === id);

// Fração de seções totalizadas (0–1). Sem total de seções conhecido, não há como projetar.
function fracaoApurada(dados) {
  if (dados.totalizacaoFinal) return 1;
  const { total, totalizadas } = dados.secoes;
  if (!(total > 0) || !(totalizadas > 0)) return 0;
  return Math.min(1, totalizadas / total);
}

// Modelo 1. Projeção = votos atuais + votos válidos faltantes × percentual atual do candidato.
// Os limites mínimo e máximo são os extremos matemáticos (nenhum ou todos os votos faltantes vão para o
// candidato); não são intervalo de confiança, só mostram o quanto ainda está em aberto.
export function projetarIngenuo(dados, { limite = 20 } = {}) {
  const fracao = fracaoApurada(dados);
  const validos = dados.votos.validos;
  const base = { modelo: 'ingenuo', fracaoApurada: fracao, votosValidos: validos };
  if (fracao === 0 || validos === 0) return { ...base, disponivel: false, motivo: 'Ainda não há votos apurados para projetar.' };

  const validosProjetados = Math.round(validos / fracao);
  const faltantes = Math.max(0, validosProjetados - validos);
  const candidatos = dados.candidatos.slice(0, limite).map((c) => {
    const parte = c.votos / validos;
    return {
      numero: c.numero,
      nomeUrna: c.nomeUrna,
      partido: c.partido,
      votosAtuais: c.votos,
      pctAtual: parte * 100,
      votosProjetados: Math.round(c.votos + faltantes * parte),
      pctProjetado: parte * 100,
      pctMinimo: (c.votos / validosProjetados) * 100,
      pctMaximo: ((c.votos + faltantes) / validosProjetados) * 100,
    };
  });

  return { ...base, disponivel: true, validosProjetados, votosFaltantes: faltantes, candidatos };
}

const fracaoMunicipio = (d) => {
  if (d.totalizacaoFinal) return 1;
  const { total, totalizadas } = d.secoes;
  return total > 0 && totalizadas > 0 ? Math.min(1, totalizadas / total) : 0;
};

// Modelo 2. `municipios` são os resultados normalizados dos municípios de uma UF.
//  • Município com seções apuradas: votos esperados = votos atuais ÷ fração de seções apuradas dele.
//  • Município sem nada apurado: votos válidos esperados = eleitorado × (válidos esperados por eleitor
//    nos municípios já apurados); a divisão entre candidatos é a da UF, ponderada pelo tamanho dos municípios.
// Por isso, no começo, a parte "estimada pela média da UF" pode ser grande, e a tela mostra quanto é.
export function projetarEstratificado(municipios, { limite = 20, totalMunicipios = municipios.length } = {}) {
  const base = { modelo: 'estratificado' };
  const apurados = municipios.filter((m) => fracaoMunicipio(m) > 0 && m.votos.validos > 0);
  if (!apurados.length) return { ...base, disponivel: false, motivo: 'Ainda não há votos apurados em nenhum município.' };
  const zerados = municipios.filter((m) => !apurados.includes(m));

  const info = new Map();
  const projetado = new Map(); // sq → votos esperados, só dos municípios apurados
  const atual = new Map();
  let esperadoApurados = 0;
  let aptosApurados = 0;
  let validosAtuais = 0;
  let secoesTotal = 0;
  let secoesTotalizadas = 0;

  for (const m of municipios) {
    secoesTotal += m.secoes.total;
    secoesTotalizadas += m.secoes.totalizadas;
    for (const c of m.candidatos) {
      if (!info.has(c.sq)) info.set(c.sq, { numero: c.numero, nomeUrna: c.nomeUrna, partido: c.partido });
    }
  }
  for (const m of apurados) {
    const f = fracaoMunicipio(m);
    esperadoApurados += m.votos.validos / f;
    aptosApurados += m.eleitorado.total;
    validosAtuais += m.votos.validos;
    for (const c of m.candidatos) {
      projetado.set(c.sq, (projetado.get(c.sq) ?? 0) + c.votos / f);
      atual.set(c.sq, (atual.get(c.sq) ?? 0) + c.votos);
    }
  }
  for (const m of zerados) validosAtuais += m.votos.validos; // zerados de fato, mas somados por coerência

  const taxaPorEleitor = aptosApurados > 0 ? esperadoApurados / aptosApurados : 0;
  const aptosZerados = zerados.reduce((s, m) => s + m.eleitorado.total, 0);
  const esperadoZerados = aptosZerados * taxaPorEleitor;
  const validosProjetados = Math.round(esperadoApurados + esperadoZerados);

  const candidatos = [...info.entries()].map(([sq, i]) => {
    const parteApurados = projetado.get(sq) ?? 0;
    const parteZerados = esperadoApurados > 0 ? (parteApurados / esperadoApurados) * esperadoZerados : 0;
    const votos = atual.get(sq) ?? 0;
    return { ...i, votosAtuais: votos, votosProjetados: Math.round(parteApurados + parteZerados) };
  }).sort((a, b) => b.votosProjetados - a.votosProjetados).slice(0, limite);

  const faltantes = Math.max(0, validosProjetados - validosAtuais);
  return {
    ...base,
    disponivel: true,
    fracaoApurada: secoesTotal > 0 ? secoesTotalizadas / secoesTotal : 0,
    votosValidos: validosAtuais,
    validosProjetados,
    votosFaltantes: faltantes,
    municipios: {
      total: totalMunicipios,
      comVotos: apurados.length,
      semVotos: zerados.length,
      semArquivo: Math.max(0, totalMunicipios - municipios.length),
    },
    parteEstimadaPelaUf: validosProjetados > 0 ? esperadoZerados / validosProjetados : 0,
    candidatos: candidatos.map((c) => ({
      ...c,
      pctAtual: validosAtuais > 0 ? (c.votosAtuais / validosAtuais) * 100 : 0,
      pctProjetado: validosProjetados > 0 ? (c.votosProjetados / validosProjetados) * 100 : 0,
      pctMinimo: validosProjetados > 0 ? (c.votosAtuais / validosProjetados) * 100 : 0,
      pctMaximo: validosProjetados > 0 ? (Math.min(c.votosAtuais + faltantes, validosProjetados) / validosProjetados) * 100 : 0,
    })),
  };
}

// Modelo 2 no Brasil (presidente): projeta cada UF pelos seus municípios e soma. Uma UF em que nenhum
// município apurou ainda entra pelo eleitorado e pela média nacional das UFs que já têm votos.
// `ufs` = [{ uf, dados: [resultado de cada município], total: nº de municípios da UF }]. Candidatos são
// identificados pelo número (nacional na presidência).
export function projetarBrasil(ufs, { limite = 20 } = {}) {
  const base = { modelo: 'estratificado' };
  const parciais = ufs.map((u) => ({
    ...u,
    r: projetarEstratificado(u.dados, { limite: Infinity, totalMunicipios: u.total }),
    aptos: u.dados.reduce((s, m) => s + m.eleitorado.total, 0),
  }));
  const comVotos = parciais.filter((p) => p.r.disponivel);
  if (!comVotos.length) return { ...base, disponivel: false, motivo: 'Ainda não há votos apurados em nenhum município.' };
  const semVotos = parciais.filter((p) => !p.r.disponivel);

  const info = new Map();
  const projetado = new Map();
  const atual = new Map();
  let esperado = 0;
  let aptos = 0;
  let validosAtuais = 0;
  let esperadoEstimado = 0;
  let secoesTotal = 0;
  let secoesTotalizadas = 0;
  const municipios = { total: 0, comVotos: 0, semVotos: 0, semArquivo: 0 };

  for (const { r, aptos: a, dados, total } of comVotos) {
    esperado += r.validosProjetados;
    aptos += a;
    validosAtuais += r.votosValidos;
    esperadoEstimado += r.parteEstimadaPelaUf * r.validosProjetados;
    for (const c of r.candidatos) {
      info.set(c.numero, { numero: c.numero, nomeUrna: c.nomeUrna, partido: c.partido });
      projetado.set(c.numero, (projetado.get(c.numero) ?? 0) + c.votosProjetados);
      atual.set(c.numero, (atual.get(c.numero) ?? 0) + c.votosAtuais);
    }
    for (const m of dados) {
      secoesTotal += m.secoes.total;
      secoesTotalizadas += m.secoes.totalizadas;
    }
    municipios.total += r.municipios.total;
    municipios.comVotos += r.municipios.comVotos;
    municipios.semVotos += r.municipios.semVotos;
    municipios.semArquivo += r.municipios.semArquivo;
  }

  const taxa = aptos > 0 ? esperado / aptos : 0;
  const esperadoUfsVazias = semVotos.reduce((s, p) => s + p.aptos * taxa, 0);
  for (const p of semVotos) {
    for (const m of p.dados) secoesTotal += m.secoes.total;
    municipios.total += p.total;
    municipios.semVotos += p.dados.length;
    municipios.semArquivo += Math.max(0, p.total - p.dados.length);
  }
  const validosProjetados = Math.round(esperado + esperadoUfsVazias);
  const faltantes = Math.max(0, validosProjetados - validosAtuais);

  const candidatos = [...info.values()].map((i) => {
    const parteComVotos = projetado.get(i.numero) ?? 0;
    const parteVazias = esperado > 0 ? (parteComVotos / esperado) * esperadoUfsVazias : 0;
    const votos = atual.get(i.numero) ?? 0;
    return {
      ...i,
      votosAtuais: votos,
      votosProjetados: Math.round(parteComVotos + parteVazias),
      pctAtual: validosAtuais > 0 ? (votos / validosAtuais) * 100 : 0,
      pctProjetado: validosProjetados > 0 ? ((parteComVotos + parteVazias) / validosProjetados) * 100 : 0,
      pctMinimo: validosProjetados > 0 ? (votos / validosProjetados) * 100 : 0,
      pctMaximo: validosProjetados > 0 ? (Math.min(votos + faltantes, validosProjetados) / validosProjetados) * 100 : 0,
    };
  }).sort((a, b) => b.votosProjetados - a.votosProjetados).slice(0, limite);

  return {
    ...base,
    disponivel: true,
    fracaoApurada: secoesTotal > 0 ? secoesTotalizadas / secoesTotal : 0,
    votosValidos: validosAtuais,
    validosProjetados,
    votosFaltantes: faltantes,
    municipios,
    ufs: { total: parciais.length, comVotos: comVotos.length, semVotos: semVotos.length },
    parteEstimadaPelaUf: validosProjetados > 0 ? (esperadoEstimado + esperadoUfsVazias) / validosProjetados : 0,
    candidatos,
  };
}

export function projetar(modelo, dados, opcoes) {
  if (modelo === 'ingenuo') return projetarIngenuo(dados, opcoes);
  if (modelo === 'estratificado') return projetarEstratificado(dados, opcoes);
  return null;
}
