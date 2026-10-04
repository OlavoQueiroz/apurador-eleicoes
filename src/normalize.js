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

  const saida = {
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
  if ([6, 7].includes(saida.cargo.codigo)) anotarVagasPrevistas(saida);
  return saida;
}

// Menor número de votos a mais (positivo) ou a menos (negativo) para a lista `i` mudar de vagas, pelo mesmo método de
// `distribuirVagas`. Soma só na lista (o total muda junto), como se os votos que faltam fossem todos dela. `null` se não muda
// dentro de um teto razoável. Aproximação: não considera que as outras listas também recebem votos até o fim.
function votosParaMudarDeVaga(votos, vagas, i, sentido) {
  const base = distribuirVagas(votos, vagas)[i];
  const muda = (x) => {
    const v = votos.slice();
    v[i] = Math.max(0, v[i] + sentido * x);
    const n = distribuirVagas(v, vagas)[i];
    return sentido > 0 ? n > base : n < base;
  };
  const teto = sentido > 0 ? Math.max(1, votos.reduce((s, n) => s + n, 0)) : votos[i];
  if (!muda(teto)) return null;
  let [baixo, alto] = [0, teto]; // `muda(baixo)` é falso; `muda(alto)` é verdadeiro
  while (alto - baixo > 1) {
    const meio = Math.floor((baixo + alto) / 2);
    if (muda(meio)) alto = meio; else baixo = meio;
  }
  return alto;
}

// Câmara e Assembleia: para cada lista, as vagas previstas (as do TSE ou, se ele ainda não distribuiu, as estimadas pelo
// quociente) e a distância até ganhar uma vaga a mais (`faltamParaVaga`) ou perder uma (`folgaDaVaga`, os votos que ainda
// pode perder sem perdê-la). Alimenta a aba "Um partido".
export function anotarVagasPrevistas(dados) {
  const lista = dados.agrupamentos;
  const votos = lista.map((a) => a.votos ?? 0);
  const { vagas, estimativa } = previsaoPorLista(dados);
  const apurado = votos.some((v) => v > 0);
  lista.forEach((agr, i) => {
    agr.vagasPrevistas = vagas[i];
    agr.faltamParaVaga = apurado ? votosParaMudarDeVaga(votos, dados.cargo.vagas, i, 1) : null;
    const perde = apurado && votos[i] > 0 ? votosParaMudarDeVaga(votos, dados.cargo.vagas, i, -1) : null;
    agr.folgaDaVaga = perde === null ? null : perde - 1;
  });
  dados.vagasEstimadas = estimativa;
}

// Distribuição das vagas de um cargo proporcional entre as listas (partidos ou federações), pelo método do TSE: quociente
// eleitoral = votos válidos ÷ vagas (fração até 0,5 desprezada, acima disso arredonda para cima); cada lista leva
// floor(votos ÷ quociente) vagas; as que sobram vão uma a uma para a maior média votos ÷ (vagas já obtidas + 1). Desde a
// decisão do STF (ADI 7263, valendo a partir de 2022), todas as listas disputam as sobras, sem as barreiras de 80% do
// quociente (partido) e 20% (candidato). Devolve as vagas de cada lista, na mesma ordem de `votos`.
export function distribuirVagas(votos, vagas) {
  const total = votos.reduce((s, v) => s + v, 0);
  const vagasPorLista = votos.map(() => 0);
  if (!total || !vagas) return vagasPorLista;
  const exato = total / vagas;
  const quociente = Math.max(1, exato - Math.floor(exato) > 0.5 ? Math.ceil(exato) : Math.floor(exato));
  for (let i = 0; i < votos.length; i += 1) vagasPorLista[i] = Math.floor(votos[i] / quociente);
  let somadas = vagasPorLista.reduce((s, n) => s + n, 0);
  const media = (i, extra = 0) => votos[i] / (vagasPorLista[i] + 1 + extra);
  while (somadas < vagas) { // sobras: maior média; empate fica com a lista mais votada
    let melhor = -1;
    for (let i = 0; i < votos.length; i += 1) {
      if (votos[i] > 0 && (melhor < 0 || media(i) > media(melhor) || (media(i) === media(melhor) && votos[i] > votos[melhor]))) melhor = i;
    }
    if (melhor < 0) break;
    vagasPorLista[melhor] += 1;
    somadas += 1;
  }
  while (somadas > vagas) { // quociente arredondado para baixo pode passar de `vagas`: tira da menor média
    let pior = -1;
    for (let i = 0; i < votos.length; i += 1) {
      if (vagasPorLista[i] > 0 && (pior < 0 || votos[i] / vagasPorLista[i] < votos[pior] / vagasPorLista[pior])) pior = i;
    }
    vagasPorLista[pior] -= 1;
    somadas -= 1;
  }
  return vagasPorLista;
}

// Câmara e Assembleia: cadeiras por partido contando também as vagas ainda sem eleito marcado. Se o TSE já distribuiu todas
// as vagas entre as listas (`vag`), vale a distribuição dele; senão, com votos já apurados, o painel estima a distribuição
// pelo quociente eleitoral (distribuirVagas) e marca `estimativa`, porque ela muda até o fim da apuração. Dentro de cada
// lista as vagas vão para os mais votados (os candidatos já vêm em ordem de votos); os eleitos que o TSE já marcou contam
// sempre.
// Vagas de cada lista (na ordem de `dados.agrupamentos`): as do TSE se ele já distribuiu todas; senão, as estimadas pelo
// quociente com os votos já apurados (`estimativa`). Os eleitos que o TSE já marcou contam sempre.
function previsaoPorLista(dados) {
  const lista = dados.agrupamentos;
  const votos = lista.map((a) => a.votos ?? 0);
  const tseCompleto = lista.reduce((s, a) => s + a.vagas, 0) >= dados.cargo.vagas;
  const estimativa = !tseCompleto && votos.some((v) => v > 0);
  const vagasEstimadas = estimativa ? distribuirVagas(votos, dados.cargo.vagas) : null;
  const vagas = lista.map((agr, i) => {
    if (!estimativa) return agr.vagas;
    const eleitos = dados.candidatos.filter((c) => c.agrupamentoId === agr.id && c.situacao === 'eleito').length;
    return Math.max(vagasEstimadas[i], eleitos);
  });
  return { vagas, estimativa };
}

function cadeirasPorPartido(dados) {
  const lista = dados.agrupamentos;
  const { vagas, estimativa } = previsaoPorLista(dados);
  const porPartido = {};
  lista.forEach((agr, i) => {
    const candidatos = dados.candidatos.filter((c) => c.agrupamentoId === agr.id);
    const eleitos = candidatos.filter((c) => c.situacao === 'eleito');
    const faltam = Math.max(0, vagas[i] - eleitos.length);
    for (const c of [...eleitos, ...candidatos.filter((x) => x.situacao !== 'eleito' && x.votos > 0).slice(0, faltam)]) {
      porPartido[c.partido] = (porPartido[c.partido] ?? 0) + 1;
    }
  });
  return { porPartido, estimativa };
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
    turno: dados.turno,
    eleitorado: { total: dados.eleitorado.total, comparecimento: dados.eleitorado.comparecimento, abstencao: dados.eleitorado.abstencao }, // teto dos votos que faltam (public/chances.js)
    // Câmara e Assembleia: eleitos mais as vagas já conquistadas (ou estimadas, se `cadeirasEstimadas`) por partido/federação.
    ...([6, 7].includes(dados.cargo.codigo) ? (({ porPartido, estimativa }) => ({ cadeirasPorPartido: porPartido, cadeirasEstimadas: estimativa }))(cadeirasPorPartido(dados)) : {}),
    segundoTurno,
  };
}
