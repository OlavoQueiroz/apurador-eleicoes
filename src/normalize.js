// Converte o JSON bruto do TSE (campos abreviados, números como texto, vírgula decimal)
// no formato que o resto do painel usa. A semântica dos campos foi conferida no código do
// app oficial de resultados do TSE:
//   s.st/s.pst   seções totalizadas (a barra de progresso oficial)
//   e.c/e.a      comparecimento / abstenção
//   v.vv|v.vvc   votos válidos (vv quando existe, senão vvc)
//   v.vb, v.tvn  votos brancos e total de nulos
//   cand.vap     votos computados do candidato; cand.pvap, o percentual
//   cand.st      texto da situação ("Eleito", "Eleito por QP", "2º turno", "Suplente"...)
//   agr.vag      vagas conquistadas pelo partido/federação (proporcionais)

const inteiro = (valor) => {
  const n = parseInt(String(valor ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

const percentual = (valor) => {
  const n = parseFloat(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// O TSE informa data e hora de Brasília (UTC-3 fixo, sem horário de verão desde 2019).
export function paraIso(data, hora) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data ?? '');
  if (!m || !/^\d{2}:\d{2}:\d{2}$/.test(hora ?? '')) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${hora}-03:00`;
}

const semAcento = (texto) =>
  String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/º/g, 'o').trim();

// Mesma regra do app do TSE: o texto de `st` manda; a flag `e` só vale quando `st` vem vazio.
export function classificarSituacao(st, e) {
  const texto = semAcento(st);
  if (texto) {
    if (/^eleito(\s+por)?/.test(texto)) return 'eleito';
    if (/^(2o|segundo)\s*turno$/.test(texto)) return 'segundo-turno';
    if (/^suplente$/.test(texto)) return 'suplente';
    if (/^nao\s*eleit[oa]?$/.test(texto)) return 'nao-eleito';
    return 'outra'; // ex.: indeferido, renúncia... o texto original é exibido como está
  }
  const flag = String(e ?? '').toLowerCase();
  if (flag === 's') return 'eleito';
  if (flag === '2') return 'segundo-turno';
  return 'nenhuma';
}

export function ordenarCandidatos(candidatos) {
  return candidatos.sort((a, b) => b.votos - a.votos || a.ordem - b.ordem);
}

export function normalizar(bruto) {
  const cargo = bruto.carg?.[0] ?? {};
  const s = bruto.s ?? {};
  const e = bruto.e ?? {};
  const v = bruto.v ?? {};

  const candidatos = [];
  const agrupamentos = [];

  for (const agr of cargo.agr ?? []) {
    const partidos = agr.par ?? [];
    let votosNominais = 0;
    let votosLegenda = 0;
    let eleitos = 0;

    for (const par of partidos) {
      votosLegenda += inteiro(par.tval);
      for (const c of par.cand ?? []) {
        const situacao = classificarSituacao(c.st, c.e);
        const votos = inteiro(c.vap);
        votosNominais += votos;
        if (situacao === 'eleito') eleitos += 1;
        candidatos.push({
          numero: c.n,
          sq: c.sqcand,
          nome: c.nm,
          nomeUrna: c.nmu,
          partido: par.sg,
          partidoNome: par.nm,
          agrupamento: agr.com || par.sg,
          agrupamentoId: agr.n,
          votos,
          pct: percentual(c.pvap),
          ordem: inteiro(c.seq),
          situacao,
          situacaoTexto: c.st || '',
          vices: (c.vs ?? []).map((x) => ({ tipo: x.tp, nomeUrna: x.nmu, partido: x.sgp })),
        });
      }
    }

    agrupamentos.push({
      id: agr.n,
      nome: agr.nm,
      sigla: agr.com || partidos.map((p) => p.sg).join('/'),
      tipo: agr.tp, // i = partido isolado, f = federação, c = coligação
      partidos: partidos.map((p) => p.sg),
      vagas: inteiro(agr.vag),
      votosNominais,
      votosLegenda,
      votos: votosNominais + votosLegenda,
      eleitos,
    });
  }

  ordenarCandidatos(candidatos);
  agrupamentos.sort((a, b) => b.votos - a.votos || b.vagas - a.vagas);

  const tf = String(bruto.tf ?? '').toLowerCase();
  const md = String(bruto.md ?? '').toLowerCase();

  return {
    geracao: String(bruto.idg ?? ''),
    geradoEm: paraIso(bruto.dg, bruto.hg),
    eleicao: String(bruto.ele ?? ''),
    turno: inteiro(bruto.t) || 1,
    abrangencia: String(bruto.cdabr ?? '').toLowerCase(),
    cargo: {
      codigo: inteiro(cargo.cd),
      nome: cargo.nmn ?? '',
      vagas: inteiro(cargo.nv),
      quocienteEleitoral: inteiro(cargo.qe),
    },
    totalizacaoFinal: tf === 's',
    // O app do TSE avisa "matematicamente definido" quando tf = n e md existe e é diferente de n.
    matematicamenteDefinido: tf === 'n' && md !== '' && md !== 'n',
    secoes: { total: inteiro(s.ts), totalizadas: inteiro(s.st), pctTotalizadas: percentual(s.pst) },
    eleitorado: {
      total: inteiro(e.te),
      comparecimento: inteiro(e.c),
      pctComparecimento: percentual(e.pc),
      abstencao: inteiro(e.a),
      pctAbstencao: percentual(e.pa),
    },
    votos: {
      validos: inteiro(v.vv !== undefined ? v.vv : v.vvc),
      pctValidos: percentual(v.vv !== undefined ? v.pvv : v.pvvc),
      brancos: inteiro(v.vb),
      pctBrancos: percentual(v.pvb),
      nulos: inteiro(v.tvn),
      pctNulos: percentual(v.ptvn),
    },
    candidatos,
    agrupamentos,
  };
}

// Visão compacta usada nos mapas/tiles e nos totais nacionais (sem a lista inteira de candidatos).
export function resumir(dados) {
  const [lider, segundo] = dados.candidatos;
  const compacto = (c) =>
    c && { numero: c.numero, nomeUrna: c.nomeUrna, partido: c.partido, votos: c.votos, pct: c.pct, situacao: c.situacao };
  const eleitosPorPartido = {};
  let segundoTurno = 0;
  for (const c of dados.candidatos) {
    if (c.situacao === 'eleito') eleitosPorPartido[c.partido] = (eleitosPorPartido[c.partido] ?? 0) + 1;
    if (c.situacao === 'segundo-turno') segundoTurno += 1;
  }
  return {
    geradoEm: dados.geradoEm,
    vagas: dados.cargo.vagas,
    secoes: dados.secoes,
    validos: dados.votos.validos,
    // Presidência: votos de cada candidato por número (poucos candidatos); alimenta o comparativo com 2022.
    ...(dados.cargo.codigo === 1 ? { votosPorNumero: Object.fromEntries(dados.candidatos.map((c) => [c.numero, c.votos])) } : {}),
    pctComparecimento: dados.eleitorado.pctComparecimento,
    totalizacaoFinal: dados.totalizacaoFinal,
    matematicamenteDefinido: dados.matematicamenteDefinido,
    lider: lider?.votos > 0 ? compacto(lider) : null,
    segundo: lider?.votos > 0 ? compacto(segundo) : null,
    colocados: dados.candidatos.slice(0, 3).filter((c) => c.votos > 0).map(compacto), // 1º, 2º e 3º (tabela do Senado)
    eleitos: Object.values(eleitosPorPartido).reduce((soma, n) => soma + n, 0),
    eleitosPorPartido,
    segundoTurno,
  };
}
