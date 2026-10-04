// Análise de um partido só (aba "Um partido" da visão Análise): quantos deputados ele tem até agora, onde, e a
// distância até a cláusula de desempenho. Vale para deputado federal (todas as UFs) e deputado estadual (SP ou RJ).
// Sem DOM: `analisePartido` é pura e `focoHtml` devolve texto HTML, como cadeiras.js e partidos.js.
//
// Fontes por UF: o resumo (`eleitosPorPartido`, `cadeirasPorPartido`, `cadeirasEstimadas`, ver normalize.js) dá as cadeiras
// e o arquivo completo do TSE (`dados`) dá os votos da lista e os candidatos.

export const PARTIDO_PADRAO = 'missao';

// Cláusula de desempenho de 2026 (EC 97/2017, Câmara dos Deputados): o partido (a federação conta como um) precisa de 2,5% dos
// votos válidos em pelo menos 9 UFs, com 1,5% ou mais em cada uma, OU de 13 deputados eleitos em pelo menos 9 UFs.
export const CLAUSULA = { pctNacional: 2.5, pctPorUf: 1.5, deputados: 13, ufs: 9 };

// A sigla sem acento nem pontuação ("MISSÃO" e "MISSAO" são o mesmo partido), para comparar fontes diferentes.
export const normaPartido = (sigla) =>
  String(sigla ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Partidos que aparecem nas listas de candidatos das UFs carregadas, em ordem alfabética: [{ sigla, id }].
export function listarPartidos(detalhes) {
  const vistos = new Map();
  for (const dados of detalhes?.values() ?? []) {
    for (const c of dados?.candidatos ?? []) if (c.partido && !vistos.has(normaPartido(c.partido))) vistos.set(normaPartido(c.partido), c.partido);
  }
  return [...vistos].map(([id, sigla]) => ({ id, sigla })).sort((a, b) => a.sigla.localeCompare(b.sigla, 'pt-BR'));
}

// `alvo`: partido normalizado. `detalhes`: Map uf → arquivo normalizado do TSE. `resumos`: Map uf → resumo da UF.
export function analisePartido({ alvo, detalhes, resumos }) {
  const id = normaPartido(alvo);
  let sigla = null;
  const linhas = [];
  for (const [uf, dados] of detalhes ?? []) {
    if (!dados?.candidatos) continue;
    const dele = dados.candidatos.filter((c) => normaPartido(c.partido) === id);
    if (dele.length && !sigla) sigla = dele[0].partido;
    const lista = dados.agrupamentos.find((a) => a.partidos.some((p) => normaPartido(p) === id));
    const resumo = resumos?.get(uf);
    const confirmadas = sigla ? (resumo?.eleitosPorPartido?.[sigla] ?? 0) : 0;
    const total = Math.max(confirmadas, sigla ? (resumo?.cadeirasPorPartido?.[sigla] ?? confirmadas) : 0);
    const validos = dados.votos.validos;
    linhas.push({
      uf,
      vagasUf: dados.cargo.vagas,
      pctApurado: dados.secoes.pctTotalizadas,
      comVotos: validos > 0,
      candidatos: dele.length,
      lista: lista ? { sigla: lista.sigla, federada: lista.partidos.length > 1, votos: lista.votos } : null,
      votos: lista?.votos ?? 0,
      validos,
      pctValidos: validos > 0 && lista ? (100 * lista.votos) / validos : 0,
      confirmadas,
      naFrente: total - confirmadas,
      estimada: Boolean(resumo?.cadeirasEstimadas),
      principais: dele.filter((c) => c.votos > 0).slice(0, 15).map((c) => ({ nomeUrna: c.nomeUrna, votos: c.votos, situacao: c.situacao })),
    });
  }
  const soma = (campo) => linhas.reduce((s, l) => s + l[campo], 0);
  const comVotos = linhas.filter((l) => l.comVotos);
  const validosTotal = comVotos.reduce((s, l) => s + l.validos, 0);
  const votos = comVotos.reduce((s, l) => s + l.votos, 0);
  const confirmadas = soma('confirmadas');
  const naFrente = soma('naFrente');
  return {
    sigla,
    linhas,
    confirmadas,
    naFrente,
    total: confirmadas + naFrente,
    estimada: linhas.some((l) => l.naFrente > 0 && l.estimada),
    ufsComCadeira: linhas.filter((l) => l.confirmadas + l.naFrente > 0).length,
    ufsComConfirmada: linhas.filter((l) => l.confirmadas > 0).length,
    votos,
    validos: validosTotal,
    pctNacional: validosTotal > 0 ? (100 * votos) / validosTotal : 0,
    ufsAcimaDoMinimo: comVotos.filter((l) => l.pctValidos >= CLAUSULA.pctPorUf).length,
    ufsApuradas: comVotos.length,
  };
}

const pct = (n, casas = 1) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

// `modelo`: de criarModelo (série histórica); `ui`: { partido, detalhes, resumos }; `ajuda`: { esc, fmtInt, corPartido, nomeUf }.
export function focoHtml(modelo, ui, ajuda) {
  const { esc, fmtInt, corPartido, nomeUf } = ajuda;
  const estadual = modelo.cargo.codigo === 7;
  const alvo = normaPartido(ui.partido || PARTIDO_PADRAO);
  if (!ui.detalhes) return '<p class="aviso-bloco espera">Carregando as listas de candidatos de cada UF…</p>';
  const partidos = listarPartidos(ui.detalhes);
  const seletor = `<label class="par-agrupar"><span>Partido</span>
    <select id="foco-partido" aria-label="Partido analisado">${partidos.map((p) =>
    `<option value="${esc(p.id.toLowerCase())}"${p.id === alvo ? ' selected' : ''}>${esc(p.sigla)}</option>`).join('')}</select></label>`;
  const a = analisePartido({ alvo, detalhes: ui.detalhes, resumos: ui.resumos });
  if (!a.sigla) {
    return `<div class="par-topo">${seletor}</div><p class="aviso-bloco espera">Nenhum candidato deste partido apareceu ainda nas listas do TSE para ${estadual ? esc(modelo.uf?.toUpperCase() ?? '') : 'as UFs carregadas'}. Escolha outro partido acima.</p>`;
  }
  const cor = corPartido(a.sigla);
  const anterior = modelo.base; // eleição anterior (2022), se o histórico carregou
  const antes = anterior ? Object.entries(anterior.porPartido).filter(([s]) => normaPartido(s) === alvo).reduce((s, [, n]) => s + n, 0) : null;
  const federada = a.linhas.find((l) => l.lista?.federada)?.lista.sigla;
  const alcance = estadual ? modelo.cargo.ufs?.[modelo.uf] ?? 0 : 513;

  const cartao = (nome, valor, nota = '') => `<div class="par-card" style="--cor:${cor}"><span class="par-card-nome">${esc(nome)}</span>
    <div class="par-card-topo"><b>${fmtInt(valor)}</b></div><span class="par-card-d">${nota}</span></div>`;
  const cartoes = `<div class="par-cards">
    ${cartao('Eleitos confirmados', a.confirmadas, 'já marcados pelo TSE')}
    ${cartao(a.estimada ? 'Na frente (estimativa)' : 'Na frente', a.naFrente, a.estimada ? 'estimativa pelo quociente, não é do TSE' : 'vagas do partido sem eleito marcado')}
    ${cartao('Total hoje', a.total, `de ${fmtInt(alcance)} cadeiras`)}
    ${antes === null ? '' : cartao(`Bancada em ${anterior.ano}`, antes, antes === 0 ? 'sem eleitos (partido novo ou sem bancada)' : a.total >= antes ? `${a.total - antes >= 0 ? '+' : ''}${fmtInt(a.total - antes)} hoje` : `${fmtInt(a.total - antes)} hoje`)}
  </div>`;

  // Cláusula de desempenho: só na Câmara, onde ela vale.
  const parcial = a.linhas.some((l) => l.comVotos && l.pctApurado < 100);
  const linhaClausula = (rotulo, atual, meta, ok, detalhe) =>
    `<tr><td>${esc(rotulo)}</td><td class="num"><b>${atual}</b> de ${meta}</td><td>${ok ? '<span class="pill eleito">atinge hoje</span>' : '<span class="pill">ainda não</span>'}</td><td class="muted pequeno">${detalhe}</td></tr>`;
  const clausula = estadual ? '' : `<div class="par-caixa"><h3 class="par-h">Cláusula de desempenho de 2026</h3>
    <div class="tabela-rolagem"><table class="tabela"><tbody>
      ${linhaClausula('Deputados', fmtInt(a.total), CLAUSULA.deputados, a.total >= CLAUSULA.deputados && a.ufsComCadeira >= CLAUSULA.ufs, `eleitos ou na frente, em ${a.ufsComCadeira} UFs (precisa de ${CLAUSULA.ufs})`)}
      ${linhaClausula('Votos válidos', pct(a.pctNacional, 2), pct(CLAUSULA.pctNacional), a.pctNacional >= CLAUSULA.pctNacional && a.ufsAcimaDoMinimo >= CLAUSULA.ufs, `${a.ufsAcimaDoMinimo} UFs com ${pct(CLAUSULA.pctPorUf)} ou mais (precisa de ${CLAUSULA.ufs})`)}
    </tbody></table></div>
    <p class="par-nota">Basta cumprir <b>um</b> dos dois critérios (13 deputados em 9 UFs, ou 2,5% dos votos válidos com pelo menos 1,5% em 9 UFs). Quem não cumpre perde acesso ao fundo partidário e ao tempo gratuito de rádio e TV (EC 97/2017); a federação conta como um só partido.${parcial ? ' Apuração em andamento: os percentuais usam só as seções já totalizadas e mudam.' : ''}${federada ? ` ${esc(a.sigla)} concorre na federação ${esc(federada)}: os votos da lista são os da federação inteira.` : ''}</p></div>`;

  const ordem = [...a.linhas].sort((x, y) => (y.confirmadas + y.naFrente) - (x.confirmadas + x.naFrente) || y.votos - x.votos || x.uf.localeCompare(y.uf));
  const linhasUf = ordem.map((l) => `<tr>
      <td>${esc(nomeUf(l.uf))}</td>
      <td class="num">${l.vagasUf}</td>
      <td class="num">${l.comVotos ? pct(l.pctApurado, 0) : '—'}</td>
      <td class="num">${l.comVotos && l.lista ? fmtInt(l.votos) : '—'}</td>
      <td class="num">${l.comVotos && l.lista ? pct(l.pctValidos, 2) : '—'}</td>
      <td class="num">${l.confirmadas || '—'}</td>
      <td class="num">${l.naFrente || '—'}</td>
      <td class="muted pequeno">${l.principais.slice(0, estadual ? 0 : 3).map((c) => `${esc(c.nomeUrna)} (${fmtInt(c.votos)}${c.situacao === 'eleito' ? ', eleito' : ''})`).join(' · ') || (l.candidatos ? '' : 'sem candidatos')}</td></tr>`).join('');
  const tabela = `<h3 class="par-h">${estadual ? 'Resultado do partido' : 'Por UF'}</h3>
    <div class="tabela-rolagem"><table class="tabela tabela-foco">
      <thead><tr><th>UF</th><th class="num">Vagas</th><th class="num">Apurado</th><th class="num">Votos da lista</th><th class="num">% válidos</th><th class="num">Confirmadas</th><th class="num">${a.estimada ? 'Na frente*' : 'Na frente'}</th>${estadual ? '' : '<th>Mais votados do partido</th>'}</tr></thead>
      <tbody>${linhasUf}</tbody></table></div>
    ${a.estimada ? '<p class="par-nota">* Estimativa pelo quociente eleitoral com os votos já apurados; muda até o fim da apuração.</p>' : ''}`;

  // Deputado estadual: uma Assembleia só, então vale listar os candidatos mais votados do partido.
  const candidatos = estadual ? (a.linhas[0]?.principais ?? []) : [];
  const lista = estadual && candidatos.length
    ? `<h3 class="par-h">Candidatos mais votados do partido</h3><ol class="candidatos">${candidatos.map((c, i) => `<li style="--cor:${cor}">
        <div class="cand-topo"><span class="cand-pos">${i + 1}</span><div class="cand-nome"><strong>${esc(c.nomeUrna)}</strong>${c.situacao === 'eleito' ? '<span class="pill eleito">Eleito</span>' : ''}</div>
        <div class="cand-votos"><b>${fmtInt(c.votos)}</b></div></div></li>`).join('')}</ol>`
    : '';

  return `<div class="par-topo">${seletor}</div>${cartoes}${clausula}<div class="par-caixa">${tabela}${lista}</div>`;
}
