// Projeções do resultado final a partir de uma apuração parcial. São ESTIMATIVAS do painel, não dados
// do TSE, e ficam numa visão separada da interface. Cada modelo recebe o resultado normalizado de um
// arquivo (cargo × abrangência) e devolve a projeção por candidato.
//
// Ver docs/modelos-simulacao.md. Os modelos oferecidos são a estratificação por município e o swing histórico; o bayesiano
// depende de pesquisas. A extrapolação simples (`projetarIngenuo`) deixou de ser um modelo da interface (errava de 3 a 5 pp
// nos ensaios), mas continua como plano B dos outros dois quando os arquivos ficam fora de sincronia e como base de
// comparação no ensaio e no histórico.

export const MODELOS = [
  {
    id: 'estratificado',
    nome: 'Estratificação por município',
    curto: 'Por município',
    resumo: 'Projeta os grandes municípios um a um e o resto do estado em bloco. Corrige o efeito capital × interior.',
    cargos: [1, 3, 5],
    disponivel: true,
    descricao:
      'Projeta os municípios grandes um a um e o resto do estado em bloco (arquivo da UF menos os grandes), '
      + 'pela fração de seções apuradas de cada parte. Corrige a distorção capital × interior. Se os arquivos '
      + 'estiverem fora de sincronia, volta para a extrapolação simples. Só presidente, governador e senador.',
  },
  {
    id: 'swing',
    nome: 'Swing histórico (2022)',
    curto: 'Swing 2022',
    resumo: 'Compara cada candidato com o que o campo dele teve em 2022 onde já apurou e aplica a diferença ao que falta.',
    cargos: [1],
    disponivel: true,
    descricao:
      'Mede quanto cada candidato está acima ou abaixo do que o campo político dele teve em 2022 nos lugares já '
      + 'apurados e aplica essa variação ao que falta, lugar por lugar. Parte dos mesmos grandes municípios e do '
      + 'resto do estado do modelo por município. Hoje só para presidente; quem herda os votos de 2022 está em '
      + 'dados-historicos/mapeamento-presidente.json.',
  },
  {
    id: 'bayesiano',
    nome: 'Bayesiano com pesquisas',
    curto: 'Pesquisas',
    resumo: 'Mistura pesquisas de intenção de voto com a apuração.',
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
    };
  });

  return { ...base, disponivel: true, validosProjetados, votosFaltantes: faltantes, candidatos };
}

export const fracaoMunicipio = (d) => {
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
    })),
  };
}

// Modelo 2 com municípios grandes + "resto do estado". Só os municípios grandes têm arquivo próprio; o resto da UF
// é o arquivo da UF menos a soma dos grandes, e é projetado em bloco pela fração de seções dele (as seções do resto
// vêm do arquivo de acompanhamento, que lista todos os municípios).
//  • `grandes`: resultados normalizados dos municípios grandes (cada um com codigoMunicipio);
//  • `ufDados`: resultado normalizado do arquivo da UF (ciclo principal);
//  • `detalhes`: Map município → { aptos, secoes:{total,totalizadas} } de TODOS os municípios da UF.
// Os arquivos têm horários de geração diferentes. Se as seções da UF, do acompanhamento e dos grandes não baterem
// (além de `tolerancia`, fração do total de seções da UF; sem ela, a adaptativa de `toleranciaDescompasso`), ou se a subtração der negativo, devolve
// `descompasso` e quem chamou usa a extrapolação simples (plano B).
// Tolerância (fração do total de seções da UF) para considerar os arquivos em sincronia. Uma diferença de poucas
// seções é normal enquanto cada arquivo é regenerado em um momento: 1% no fim, até 3% no começo da apuração, quando
// o cenário muda mais rápido entre uma geração e outra e trocar de modelo por pouco faz a tela oscilar.
export const toleranciaDescompasso = (fracaoApurada) => 0.01 + 0.02 * (1 - Math.min(1, Math.max(0, fracaoApurada))) ** 2;

// Parte comum aos modelos com "municípios grandes + resto": separa o resto do estado (arquivo da UF menos os
// grandes) e confere a sincronia dos arquivos. Devolve { erro } (descompasso) ou as partes do resto.
export function separarResto({ grandes, ufDados, detalhes, tolerancia = null }) {
  const idsGrandes = new Set(grandes.map((g) => g.codigoMunicipio));
  const secoesUf = ufDados.totalizacaoFinal
    ? { total: ufDados.secoes.total, totalizadas: ufDados.secoes.total }
    : ufDados.secoes;
  const limiteDescompasso = tolerancia ?? toleranciaDescompasso(secoesUf.total > 0 ? secoesUf.totalizadas / secoesUf.total : 0);

  // Seções do resto e conferência de sincronia.
  let restoTotal = 0;
  let restoTotalizadas = 0;
  let restoAptos = 0;
  let restoMunicipios = 0;
  const restoIds = [];
  let acompTotalizadas = 0;
  let grandesAcomp = 0;
  for (const [codigo, d] of detalhes) {
    acompTotalizadas += d.secoes.totalizadas;
    if (idsGrandes.has(codigo)) grandesAcomp += d.secoes.totalizadas;
    else {
      restoTotal += d.secoes.total;
      restoTotalizadas += d.secoes.totalizadas;
      restoAptos += d.aptos;
      restoMunicipios += 1;
      restoIds.push(codigo);
    }
  }
  const grandesArquivos = grandes.reduce((t, g) => t + g.secoes.totalizadas, 0);
  const totalRef = Math.max(1, secoesUf.total);
  const dessincUf = Math.abs(secoesUf.totalizadas - acompTotalizadas) / totalRef;
  const dessincGrandes = Math.abs(grandesArquivos - grandesAcomp) / totalRef;
  const conferencia = {
    secoesUf: secoesUf.totalizadas,
    secoesAcompanhamento: acompTotalizadas,
    diferencaUfPct: dessincUf * 100,
    diferencaGrandesPct: dessincGrandes * 100,
  };
  if (Math.max(dessincUf, dessincGrandes) > limiteDescompasso) {
    return { erro: { descompasso: true, conferencia, motivo: 'Os arquivos da UF e dos municípios estão em momentos diferentes da apuração.' } };
  }

  // Votos do resto = UF − grandes, por candidato.
  const info = new Map();
  const votosUf = new Map();
  for (const c of ufDados.candidatos) {
    info.set(c.sq, { numero: c.numero, nomeUrna: c.nomeUrna, partido: c.partido });
    votosUf.set(c.sq, c.votos);
  }
  const votosGrandes = new Map();
  let validosGrandes = 0;
  for (const g of grandes) {
    validosGrandes += g.votos.validos;
    for (const c of g.candidatos) votosGrandes.set(c.sq, (votosGrandes.get(c.sq) ?? 0) + c.votos);
  }
  const folga = Math.max(10, 0.005 * ufDados.votos.validos);
  const restoVotos = new Map();
  let negativo = false;
  for (const [sq, v] of votosUf) {
    const r = v - (votosGrandes.get(sq) ?? 0);
    if (r < -folga) negativo = true;
    restoVotos.set(sq, Math.max(0, r));
  }
  const restoValidosBruto = ufDados.votos.validos - validosGrandes;
  if (negativo || restoValidosBruto < -folga) {
    return { erro: { descompasso: true, conferencia, motivo: 'A soma dos municípios grandes passa do total da UF: arquivos em momentos diferentes.' } };
  }
  const restoValidos = Math.max(0, restoValidosBruto);
  return {
    secoesUf, conferencia, info, votosUf, restoVotos, restoValidos, restoIds, restoMunicipios,
    restoTotal, restoTotalizadas, restoAptos,
  };
}

export function projetarComResto({ grandes, ufDados, detalhes, limite = 20, tolerancia = null }) {
  const base = { modelo: 'estratificado', modo: 'grandes+resto' };
  const sep = separarResto({ grandes, ufDados, detalhes, tolerancia });
  if (sep.erro) return { ...base, disponivel: false, ...sep.erro };
  const {
    secoesUf, conferencia, info, votosUf, restoVotos, restoValidos, restoMunicipios, restoTotal, restoTotalizadas, restoAptos,
  } = sep;

  // Estratos já iniciados contribuem com o que mediram; os que ainda não têm votos entram pelo eleitorado.
  const projetado = new Map(); // sq → votos esperados dos estratos iniciados
  let esperadoIniciado = 0;
  let aptosIniciados = 0;
  let aptosSemVotos = 0;
  let grandesComVotos = 0;
  let grandesSemVotos = 0;
  for (const g of grandes) {
    const f = fracaoMunicipio(g);
    if (f > 0 && g.votos.validos > 0) {
      grandesComVotos += 1;
      esperadoIniciado += g.votos.validos / f;
      aptosIniciados += g.eleitorado.total;
      for (const c of g.candidatos) projetado.set(c.sq, (projetado.get(c.sq) ?? 0) + c.votos / f);
    } else {
      grandesSemVotos += 1;
      aptosSemVotos += g.eleitorado.total;
    }
  }
  const restoFracao = ufDados.totalizacaoFinal ? 1 : (restoTotal > 0 ? restoTotalizadas / restoTotal : 0);
  const restoIniciado = restoFracao > 0 && restoValidos > 0;
  let esperadoResto = 0;
  if (restoIniciado) {
    esperadoResto = restoValidos / restoFracao;
    esperadoIniciado += esperadoResto;
    aptosIniciados += restoAptos;
    for (const [sq, v] of restoVotos) projetado.set(sq, (projetado.get(sq) ?? 0) + v / restoFracao);
  } else {
    aptosSemVotos += restoAptos;
  }
  if (esperadoIniciado <= 0) {
    return { ...base, disponivel: false, conferencia, motivo: 'Ainda não há votos apurados em nenhum município desta UF.' };
  }
  const taxa = aptosIniciados > 0 ? esperadoIniciado / aptosIniciados : 0;
  const esperadoEstimado = aptosSemVotos * taxa;
  const validosProjetados = Math.round(esperadoIniciado + esperadoEstimado);
  const validosAtuais = ufDados.votos.validos;
  const faltantes = Math.max(0, validosProjetados - validosAtuais);

  const candidatos = [...info.entries()].map(([sq, i]) => {
    const comMedida = projetado.get(sq) ?? 0;
    const doEstimado = (comMedida / esperadoIniciado) * esperadoEstimado;
    const votos = votosUf.get(sq) ?? 0;
    const proj = comMedida + doEstimado;
    return {
      ...i,
      votosAtuais: votos,
      votosProjetados: Math.round(proj),
      pctAtual: validosAtuais > 0 ? (votos / validosAtuais) * 100 : 0,
      pctProjetado: validosProjetados > 0 ? (proj / validosProjetados) * 100 : 0,
    };
  }).sort((a, b) => b.votosProjetados - a.votosProjetados).slice(0, limite);

  return {
    ...base,
    disponivel: true,
    fracaoApurada: secoesUf.total > 0 ? secoesUf.totalizadas / secoesUf.total : 0,
    votosValidos: validosAtuais,
    validosProjetados,
    votosFaltantes: faltantes,
    municipios: { total: detalhes.size, grandes: grandes.length, comVotos: grandesComVotos, semVotos: grandesSemVotos, semArquivo: 0 },
    resto: {
      municipios: restoMunicipios,
      secoes: { total: restoTotal, totalizadas: restoTotalizadas },
      fracao: restoFracao,
      iniciado: restoIniciado,
      parte: validosProjetados > 0 ? esperadoResto / validosProjetados : 0,
    },
    parteEstimadaPelaUf: validosProjetados > 0 ? esperadoEstimado / validosProjetados : 0,
    conferencia,
    candidatos,
  };
}

// Projeção do modelo 2 para uma UF, escolhendo o método conforme o que foi carregado. `foto` vem de
// Municipios#consultar/espiar. Se os arquivos estiverem fora de sincronia, cai na extrapolação simples (plano B).
export function projetarUf({ foto, ufDados, limite = Infinity }) {
  const indisponivel = (motivo) => ({ modelo: 'estratificado', disponivel: false, motivo });
  if (foto.completo) {
    if (!foto.dados.length) return indisponivel('O TSE ainda não publicou os arquivos dos municípios desta UF.');
    return projetarEstratificado(foto.dados, { limite, totalMunicipios: foto.total });
  }
  if (!ufDados) return indisponivel('O arquivo desta UF ainda não está disponível no TSE.');
  if (!foto.detalhes) return indisponivel(foto.erro ?? 'Aguardando o arquivo de acompanhamento da UF.');
  if (!foto.dados.length) return indisponivel(foto.erro ?? 'Aguardando os municípios grandes desta UF.');
  const r = projetarComResto({ grandes: foto.dados, ufDados, detalhes: foto.detalhes, limite });
  if (!r.descompasso) return r;
  const simples = projetarIngenuo(ufDados, { limite });
  return { ...simples, modelo: 'estratificado', plano: 'extrapolacao', motivoPlano: r.motivo, conferencia: r.conferencia };
}

// Tamanho da UF para a soma nacional: eleitorado e seções, do arquivo da UF quando existe.
export function tamanhoUf({ foto, ufDados }) {
  if (ufDados) return { aptos: ufDados.eleitorado.total, secoes: ufDados.secoes };
  return {
    aptos: foto.dados.reduce((s, m) => s + m.eleitorado.total, 0),
    secoes: foto.dados.reduce((a, m) => ({ total: a.total + m.secoes.total, totalizadas: a.totalizadas + m.secoes.totalizadas }), { total: 0, totalizadas: 0 }),
  };
}

// Modelo 2 no Brasil (presidente): soma a projeção de cada UF. Uma UF em que nada foi apurado ainda entra pelo
// eleitorado e pela média nacional das UFs que já têm votos. `ufs` = [{ uf, r, aptos, secoes }], onde `r` é a
// projeção da UF (projetarUf). Candidatos são identificados pelo número (nacional na presidência).
//
// A apuração não começa de forma equilibrada pelo país, então a "média das UFs apuradas" erra no começo da noite.
// Com `anteriorPorUf` (anterior.porUf(): votos de 2022 por UF, já traduzidos para os candidatos de 2026), uma UF
// zerada usa o PRÓPRIO resultado de 2022 + o swing nacional medido nas UFs já apuradas, e o total de votos de 2022
// × o crescimento de votos medido nas mesmas. UF sem dado de 2022 (ou sem swing medido) cai na média, como antes.
export function projetarBrasil(ufs, { limite = 20, modelo = 'estratificado', anteriorPorUf = null } = {}) {
  const base = { modelo };
  const comVotos = ufs.filter((u) => u.r.disponivel);
  if (!comVotos.length) return { ...base, disponivel: false, motivo: 'Ainda não há votos apurados em nenhum município.' };
  const semVotos = ufs.filter((u) => !u.r.disponivel);

  const info = new Map();
  const projetado = new Map();
  const atual = new Map();
  let esperado = 0;
  let aptos = 0;
  let validosAtuais = 0;
  let esperadoEstimado = 0;
  let secoesTotal = 0;
  let secoesTotalizadas = 0;
  const municipios = { total: 0, grandes: 0, comVotos: 0, semVotos: 0, semArquivo: 0 };
  let planoB = 0;

  for (const { r, aptos: a, secoes } of comVotos) {
    esperado += r.validosProjetados;
    aptos += a;
    validosAtuais += r.votosValidos;
    esperadoEstimado += (r.parteEstimadaPelaUf ?? 0) * r.validosProjetados;
    if (r.plano === 'extrapolacao') planoB += 1;
    for (const c of r.candidatos) {
      info.set(c.numero, { numero: c.numero, nomeUrna: c.nomeUrna, partido: c.partido });
      projetado.set(c.numero, (projetado.get(c.numero) ?? 0) + c.votosProjetados);
      atual.set(c.numero, (atual.get(c.numero) ?? 0) + c.votosAtuais);
    }
    secoesTotal += secoes.total;
    secoesTotalizadas += secoes.totalizadas;
    for (const k of Object.keys(municipios)) municipios[k] += r.municipios?.[k] ?? 0;
  }

  // UFs zeradas com histórico de 2022: % de 2022 + swing nacional, e total de 2022 × crescimento.
  const porHistorico = new Map(); // número → votos esperados nas UFs zeradas que usam o histórico
  let esperadoPorHistorico = 0;
  let ufsPorHistorico = 0;
  const usadas = new Set(); // UFs zeradas estimadas pelo histórico
  if (anteriorPorUf) {
    const base22 = comVotos.map((u) => ({ u, p: anteriorPorUf[u.uf] })).filter(({ p }) => p?.validos > 0);
    const peso = base22.reduce((t, { u }) => t + u.r.validosProjetados, 0);
    const validos22 = base22.reduce((t, { p }) => t + p.validos, 0);
    const comPrior = semVotos.filter((u) => anteriorPorUf[u.uf]?.validos > 0);
    if (peso > 0 && validos22 > 0 && comPrior.length) {
      const crescimento = peso / validos22;
      const swing = new Map(); // número → variação nacional da fatia (fração, não pontos)
      for (const n of info.keys()) {
        let soma = 0;
        for (const { u, p } of base22) {
          const agora = (u.r.candidatos.find((c) => c.numero === n)?.votosProjetados ?? 0) / u.r.validosProjetados;
          soma += u.r.validosProjetados * (agora - (p.herdados[n] ?? 0) / p.validos);
        }
        swing.set(n, soma / peso);
      }
      for (const { uf } of comPrior) {
        const p = anteriorPorUf[uf];
        const bruto = new Map([...info.keys()].map((n) => [n, Math.max(0, (p.herdados[n] ?? 0) / p.validos + swing.get(n))]));
        const total = [...bruto.values()].reduce((t, v) => t + v, 0);
        if (!(total > 0)) continue;
        const votosUf = p.validos * crescimento;
        esperadoPorHistorico += votosUf;
        ufsPorHistorico += 1;
        usadas.add(uf);
        for (const [n, v] of bruto) porHistorico.set(n, (porHistorico.get(n) ?? 0) + votosUf * (v / total));
      }
    }
  }

  const semHistorico = semVotos.filter((u) => !usadas.has(u.uf));
  const taxa = aptos > 0 ? esperado / aptos : 0;
  const esperadoUfsVazias = semHistorico.reduce((s, u) => s + u.aptos * taxa, 0) + esperadoPorHistorico;
  const esperadoPorMedia = esperadoUfsVazias - esperadoPorHistorico;
  for (const u of semVotos) secoesTotal += u.secoes.total;
  const validosProjetados = Math.round(esperado + esperadoUfsVazias);
  const faltantes = Math.max(0, validosProjetados - validosAtuais);

  const candidatos = [...info.values()].map((i) => {
    const parteComVotos = projetado.get(i.numero) ?? 0;
    const parteVazias = (esperado > 0 ? (parteComVotos / esperado) * esperadoPorMedia : 0) + (porHistorico.get(i.numero) ?? 0);
    const votos = atual.get(i.numero) ?? 0;
    return {
      ...i,
      votosAtuais: votos,
      votosProjetados: Math.round(parteComVotos + parteVazias),
      pctAtual: validosAtuais > 0 ? (votos / validosAtuais) * 100 : 0,
      pctProjetado: validosProjetados > 0 ? ((parteComVotos + parteVazias) / validosProjetados) * 100 : 0,
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
    ufs: { total: ufs.length, comVotos: comVotos.length, semVotos: semVotos.length, planoB, semVotosPorHistorico: ufsPorHistorico },
    parteEstimadaPelaUf: validosProjetados > 0 ? (esperadoEstimado + esperadoUfsVazias) / validosProjetados : 0,
    candidatos,
  };
}

export function projetar(modelo, dados, opcoes) {
  if (modelo === 'estratificado') return projetarEstratificado(dados, opcoes);
  return null;
}
