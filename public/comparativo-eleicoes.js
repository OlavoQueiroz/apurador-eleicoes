// Comparativo entre eleições da presidência (1º turno): o PT (Lula ou Haddad) contra ele mesmo na eleição base, e o
// campo de Bolsonaro (Flávio ou Bolsonaro) contra Bolsonaro na base, por UF e por região. Períodos: 2026 × 2022 e
// 2026 × 2018 (a apuração de 2026 ao vivo) e 2022 × 2018 (as duas já encerradas, útil para testar a página).
//
// A informação principal é o IMPACTO de cada UF no saldo nacional, não a variação dentro da UF, porque uma UF pequena
// pode variar muito e mudar quase nada no Brasil:
//
//   saldo da UF   = variação do PT − variação do campo de Bolsonaro, em pontos percentuais dos votos válidos da UF
//   impacto da UF = peso da UF (votos válidos da eleição BASE ÷ total da base) × saldo da UF
//
// O peso usa a eleição base (fixa): com a apuração parcial, os votos válidos de 2026 ainda não são o total de cada UF.
// Só entram na soma as UFs com apuração suficiente (FRACAO_MINIMA), porque as regiões chegam em ordens diferentes e um
// resultado muito parcial engana. Sem DOM: devolve texto HTML.

export const REGIOES = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];
const UFS_DA_REGIAO = {
  Norte: ['ac', 'am', 'ap', 'pa', 'ro', 'rr', 'to'],
  Nordeste: ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se'],
  'Centro-Oeste': ['df', 'go', 'ms', 'mt'],
  Sudeste: ['es', 'mg', 'rj', 'sp'],
  Sul: ['pr', 'rs', 'sc'],
};
const REGIAO_DA_UF = Object.fromEntries(Object.entries(UFS_DA_REGIAO).flatMap(([regiao, ufs]) => ufs.map((uf) => [uf, regiao])));
export const regiaoDaUf = (uf) => REGIAO_DA_UF[uf] ?? null; // o exterior ("zz") fica de fora

export const FRACAO_MINIMA = 50; // % das seções totalizadas para a UF entrar na soma
export const ESCALA_SALDO = 8; // saldo (p.p.) mínimo que pinta a cor cheia no mapa; se algum saldo for maior, a escala cresce (ver `escala`)

// `pt` e `pl` são os dois campos (as cores são as do PT e do PL em todo o painel); `numero` é o do período ATUAL, o
// mesmo em 2022 e 2026; `nomeBase` é quem concorreu na eleição base (a ligação de números vem de dados-historicos/).
export const PADRAO = '2026x2022';
export const PERIODOS = {
  '2026x2022': {
    id: '2026x2022', rotulo: '2026 × 2022', anoAtual: 2026, anoBase: 2022, vivo: true,
    pt: { numero: '13', nome: 'Lula', nomeBase: 'Lula', partido: 'PT' },
    pl: { numero: '22', nome: 'Flávio Bolsonaro', curto: 'Flávio', nomeBase: 'Bolsonaro', partido: 'PL' },
    nota: 'Em 2022, Bolsonaro concorreu pelo PL, o mesmo partido de Flávio em 2026.',
  },
  '2026x2018': {
    id: '2026x2018', rotulo: '2026 × 2018', anoAtual: 2026, anoBase: 2018, vivo: true,
    pt: { numero: '13', nome: 'Lula', titulo: 'PT (Haddad em 2018, Lula em 2026)', curto: 'PT', nomeBase: 'Haddad', partido: 'PT' },
    pl: { numero: '22', nome: 'Flávio Bolsonaro', curto: 'Flávio', nomeBase: 'Bolsonaro', partido: 'PL' },
    nota: 'Lula não concorreu em 2018 (estava inelegível): o PT lançou Haddad, então a comparação é entre as candidaturas do PT, Haddad em 2018 e Lula em 2026. Bolsonaro concorreu pelo PSL, com o número 17; em 2026 o campo dele tem Flávio, pelo PL.',
  },
  '2022x2018': {
    id: '2022x2018', rotulo: '2022 × 2018', anoAtual: 2022, anoBase: 2018, vivo: false,
    pt: { numero: '13', nome: 'Lula', titulo: 'PT (Haddad em 2018, Lula em 2022)', curto: 'PT', nomeBase: 'Haddad', partido: 'PT' },
    pl: { numero: '22', nome: 'Bolsonaro', curto: 'Bolsonaro', nomeBase: 'Bolsonaro', partido: 'PL' },
    nota: 'Lula não concorreu em 2018 (estava inelegível): o PT lançou Haddad, então a comparação é entre as candidaturas do PT, Haddad em 2018 e Lula em 2022. Bolsonaro concorreu pelo PSL, com o número 17; em 2022, pelo PL, com o 22.',
  },
};
export const periodoPorId = (id) => PERIODOS[id] ?? PERIODOS[PADRAO];
const candidatosDe = (periodo) => [{ id: 'pt', ...periodo.pt }, { id: 'pl', ...periodo.pl }];
const curto = (c) => c.curto ?? c.nome;
export const tituloDe = (c) => c.titulo ?? c.nome; // quando o nome muda entre as eleições (Haddad → Lula), o título diz as duas

const soma = (lista) => lista.reduce((s, v) => s + v, 0);
const fmt = (n, casas = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const sinal = (n, casas = 2) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), casas)}`;
const pc = (n) => `${fmt(n, 1)}%`;

// Fonte dos votos do período ATUAL por UF: a apuração ao vivo (/api/resumo) ou, para uma eleição encerrada, o arquivo
// dela que o servidor devolve em `base.atual`.
export function itemDoAtual(base, itemAoVivo) {
  if (base.vivo) return itemAoVivo;
  return (uf) => {
    const u = base.atual?.ufs?.[uf];
    return u ? { secoes: { pctTotalizadas: 100 }, validos: u.validos, votosPorNumero: u.votos } : undefined;
  };
}

// `base` = resposta de /api/comparativo/presidente; `itemDe(uf)` = { secoes: { pctTotalizadas }, validos, votosPorNumero }.
export function calcular(base, itemDe, { periodo = PERIODOS[PADRAO], fracaoMinima = FRACAO_MINIMA } = {}) {
  const candidatos = candidatosDe(periodo);
  const ufsBase = Object.keys(base.ufs).filter((uf) => regiaoDaUf(uf));
  const totalValidos = soma(ufsBase.map((uf) => base.ufs[uf].validos));
  const ufs = ufsBase.map((uf) => {
    const b = base.ufs[uf];
    const item = itemDe(uf);
    const peso = totalValidos ? (100 * b.validos) / totalValidos : 0;
    const fracao = item?.secoes?.pctTotalizadas ?? 0;
    const validosAtual = item?.validos ?? 0;
    const temNumeros = !!item?.votosPorNumero && candidatos.every((c) => c.numero in item.votosPorNumero);
    const pronto = temNumeros && validosAtual > 0 && fracao >= fracaoMinima;
    const cand = Object.fromEntries(candidatos.map((c) => {
      const vBase = b.herdados?.[c.numero] ?? 0;
      const vAtual = item?.votosPorNumero?.[c.numero] ?? 0;
      const pBase = b.validos ? (100 * vBase) / b.validos : 0;
      const pAtual = validosAtual ? (100 * vAtual) / validosAtual : 0;
      return [c.id, { vBase, pBase, vAtual, pAtual, d: pronto ? pAtual - pBase : null }];
    }));
    const saldo = pronto ? cand.pt.d - cand.pl.d : null;
    return { uf, regiao: regiaoDaUf(uf), peso, fracao, validosBase: b.validos, validosAtual, temNumeros, pronto, pt: cand.pt, pl: cand.pl, saldo, impacto: pronto ? (peso / 100) * saldo : null };
  });
  const regioes = REGIOES.map((nome) => {
    const lista = ufs.filter((u) => u.regiao === nome);
    const prontas = lista.filter((u) => u.pronto);
    return { nome, peso: soma(lista.map((u) => u.peso)), impacto: prontas.length ? soma(prontas.map((u) => u.impacto)) : null, prontas: prontas.length, total: lista.length };
  });
  const prontas = ufs.filter((u) => u.pronto);
  // Total do 1º turno em cada eleição, no Brasil inteiro (com o exterior). No período ao vivo, o atual é o que já chegou.
  const todas = Object.keys(base.ufs);
  const nacional = (eleicao) => {
    const validos = soma(todas.map((uf) => (eleicao === 'base' ? base.ufs[uf].validos : itemDe(uf)?.validos ?? 0)));
    const cand = Object.fromEntries(candidatos.map((c) => {
      const votos = soma(todas.map((uf) => (eleicao === 'base' ? base.ufs[uf].herdados?.[c.numero] : itemDe(uf)?.votosPorNumero?.[c.numero]) ?? 0));
      return [c.id, { votos, pct: validos ? (100 * votos) / validos : 0 }];
    }));
    return { validos, pt: cand.pt, pl: cand.pl };
  };
  const maiorSaldo = prontas.length ? Math.max(...prontas.map((u) => Math.abs(u.saldo))) : 0;
  return {
    periodo, ufs, regioes, fracaoMinima,
    nacional: { base: nacional('base'), atual: nacional('atual') },
    escala: Math.max(ESCALA_SALDO, Math.ceil(maiorSaldo)),
    total: { impacto: prontas.length ? soma(prontas.map((u) => u.impacto)) : null, prontas: prontas.length, total: ufs.length, cobertura: soma(prontas.map((u) => u.peso)) },
  };
}

// Cor do mapa: a do PT quando o saldo vai para o PT, a do campo de Bolsonaro quando vai para ele; a intensidade segue o
// tamanho do saldo na UF, na `escala` do período (o maior saldo, no mínimo ESCALA_SALDO: em 2022 × 2018 todas as UFs
// passam de 8 p.p. e, com escala fixa, ficariam no mesmo tom). UF sem apuração suficiente fica cinza (null).
export function corDoMapa(u, escala = ESCALA_SALDO) {
  if (!u?.pronto) return null;
  return { candidato: u.saldo >= 0 ? 'pt' : 'pl', forca: Math.round(Math.min(100, (Math.abs(u.saldo) / escala) * 100)) };
}

// Seletor do período (links, como os outros seletores do painel). `hrefPeriodo(id)` monta o endereço.
export function seletorPeriodoHtml(periodoId, hrefPeriodo) {
  const itens = Object.values(PERIODOS).map((p) =>
    `<a class="aba" href="${hrefPeriodo(p.id)}" ${p.id === periodoId ? 'aria-current="page"' : ''}>${p.rotulo}</a>`).join('');
  return `<div class="seg seg-periodo" role="group" aria-label="Período comparado">${itens}</div>`;
}

// Total do 1º turno em cada eleição: votos válidos e a votação das duas candidaturas, lado a lado (Brasil ou uma UF).
// `bloco` = { rotulo, base: {validos, pt:{votos,pct}, pl}, atual: {…}, parcial }.
function totaisHtml(p, { base, atual, parcial }, { esc, fmtInt, corPartido }) {
  const cel = (x, c) => (x.validos ? `<b>${pc(x[c.id].pct)}</b><small>${fmtInt(Math.round(x[c.id].votos))} votos</small>` : '<span class="muted">—</span>');
  const linha = (c) => `<span class="nome" style="--cor:${corPartido(c.partido)}"><i></i>${esc(curto(c))}</span><span class="num">${cel(base, c)}</span><span class="num">${cel(atual, c)}</span>`;
  const [pt, pl] = candidatosDe(p);
  return `<div class="comp-totais" role="group" aria-label="Total do 1º turno em cada eleição">
      <span class="cab"></span><span class="cab num">${p.anoBase}</span><span class="cab num">${p.anoAtual}${parcial ? ' <small>parcial</small>' : ''}</span>
      ${linha(pt)}${linha(pl)}
      <span class="nome muted">Votos válidos</span><span class="num"><b>${fmtInt(Math.round(base.validos))}</b></span><span class="num">${atual.validos ? `<b>${fmtInt(Math.round(atual.validos))}</b>` : '<span class="muted">—</span>'}</span>
    </div>`;
}

// Linha com barra centrada no zero: à esquerda o campo de Bolsonaro, à direita o PT.
function barra(valor, maximo, cores) {
  if (valor == null) return '<span class="comp-barra"><span class="neg"></span><span class="pos"></span></span>';
  const largura = `${Math.min(100, (100 * Math.abs(valor)) / maximo).toFixed(1)}%`;
  const cor = valor >= 0 ? cores.pt : cores.pl;
  return `<span class="comp-barra"><span class="neg">${valor < 0 ? `<i style="width:${largura};--cor:${cor}"></i>` : ''}</span><span class="pos">${valor >= 0 ? `<i style="width:${largura};--cor:${cor}"></i>` : ''}</span></span>`;
}

// `ui`: { uf: 'br' | sigla, regiao: null | nome }  ·  `ajuda`: { esc, fmtInt, corPartido, nomeUf, hrefUf, hrefPeriodo, demo }
export function comparativoHtml(modelo, ui, ajuda) {
  return ui.uf === 'br' ? brasilHtml(modelo, ui, ajuda) : ufHtml(modelo, ui, ajuda);
}

function cabecalho(modelo, ajuda, subtitulo) {
  const { esc, hrefPeriodo } = ajuda;
  const p = modelo.periodo;
  return `<div class="detalhe-topo"><div><h2>Presidente · ${esc(p.rotulo)}</h2>
      <p class="muted pequeno">${subtitulo}</p></div></div>${seletorPeriodoHtml(p.id, hrefPeriodo)}`;
}

function brasilHtml(modelo, ui, ajuda) {
  const { esc, corPartido, nomeUf, hrefUf } = ajuda;
  const p = modelo.periodo;
  const cores = { pt: corPartido('PT'), pl: corPartido('PL') };
  const t = modelo.total;
  const valores = [...modelo.ufs, ...modelo.regioes].map((x) => Math.abs(x.impacto ?? 0));
  const maximo = Math.max(0.1, Math.ceil(Math.max(...valores) * 10) / 10);
  const valorTexto = (v) => (v == null ? '<span class="muted">—</span>' : `<b>${sinal(v)}</b>`);

  const linhaRegiao = (r) => {
    const ativa = ui.regiao === r.nome;
    return `<button type="button" class="comp-linha comp-regiao" data-comp-regiao="${esc(r.nome)}" aria-pressed="${ativa}">
      <span class="nome">${esc(r.nome)}${r.prontas < r.total ? ` <small class="muted" title="UFs com apuração suficiente">${r.prontas}/${r.total}</small>` : ''}</span>
      <span class="peso">${pc(r.peso)}</span>${barra(r.impacto, maximo, cores)}<span class="valor">${valorTexto(r.impacto)}</span></button>`;
  };
  const linhaUf = (u) => `<a class="comp-linha" href="${hrefUf(u.uf)}">
      <span class="nome">${esc(nomeUf(u.uf))}${u.pronto ? '' : ` <small class="muted">${u.temNumeros ? `${fmt(u.fracao, 0)}% apurado` : 'sem dados'}</small>`}</span>
      <span class="peso">${pc(u.peso)}</span>${barra(u.impacto, maximo, cores)}<span class="valor">${valorTexto(u.impacto)}</span></a>`;

  // UFs: as da região escolhida (todas), ou as de maior impacto no Brasil e o resto somado.
  const ordem = (a, b) => (b.pronto - a.pronto) || (Math.abs(b.impacto ?? 0) - Math.abs(a.impacto ?? 0)) || (b.peso - a.peso);
  let ufsHtml;
  let tituloUfs;
  if (ui.regiao) {
    tituloUfs = `UFs do ${esc(ui.regiao)}`;
    ufsHtml = modelo.ufs.filter((u) => u.regiao === ui.regiao).sort(ordem).map(linhaUf).join('');
  } else {
    tituloUfs = t.prontas === 0 ? 'Maiores UFs, por peso' : 'Maiores impactos';
    const ordenadas = [...modelo.ufs].sort(ordem);
    const topo = ordenadas.slice(0, 8);
    const resto = ordenadas.slice(8);
    const restoProntas = resto.filter((u) => u.pronto);
    const impactoResto = restoProntas.length ? soma(restoProntas.map((u) => u.impacto)) : null;
    ufsHtml = topo.map(linhaUf).join('') + (resto.length
      ? `<div class="comp-linha comp-resto"><span class="nome">outras ${resto.length} UFs</span><span class="peso">${pc(soma(resto.map((u) => u.peso)))}</span>${barra(impactoResto, maximo, cores)}<span class="valor">${valorTexto(impactoResto)}</span></div>`
      : '');
  }

  const margem = t.impacto >= 0 ? `Positivo: a margem foi para ${esc(curto(p.pt))}.` : `Negativo: a margem foi para ${esc(curto(p.pl))}.`;
  const resumo = t.prontas === 0
    ? `<p class="aviso-bloco espera">Aguardando apuração suficiente: o comparativo usa as UFs com pelo menos ${modelo.fracaoMinima}% das seções totalizadas (0 de ${t.total} até agora). Enquanto isso, a coluna “peso” mostra o tamanho de cada UF em ${p.anoBase}.</p>`
    : `<div class="comp-resumo"><div class="comp-hero"><span class="muted pequeno">Impacto no saldo nacional</span><b>${sinal(t.impacto)} <small>p.p.</small></b></div>
        <p class="muted pequeno">${t.prontas} de ${t.total} UFs com apuração suficiente, ${pc(t.cobertura)} dos votos válidos de ${p.anoBase}. ${margem}</p></div>`;
  const aviso = ajuda.demo && p.vivo ? '<p class="aviso-bloco">Modo demonstração: os candidatos são fictícios e não têm relação com a eleição real; o comparativo não faz sentido aqui.</p>' : '';
  const frase = (c) => (c.titulo ? esc(c.titulo) : `${esc(c.nome)} contra ${esc(c.nomeBase)} ${p.anoBase}`);
  const subtitulo = `1º turno, % dos votos válidos · ${frase(p.pt)} · ${frase(p.pl)}`;

  const parcial = p.vivo && modelo.nacional.atual.validos > 0;
  const totais = totaisHtml(p, { ...modelo.nacional, parcial }, ajuda);
  return `${cabecalho(modelo, ajuda, subtitulo)}
    ${aviso}${resumo}
    <p class="comp-titulo-bloco">Total do 1º turno, Brasil${parcial ? ' (o que já foi apurado em ' + p.anoAtual + ')' : ''}</p>${totais}
    <div class="comp-tabela">
      <div class="comp-cabeca"><span>Por região</span><span>peso</span><span class="comp-escala"><span>${esc(curto(p.pl))}</span><span>${esc(curto(p.pt))}</span></span><span>impacto</span></div>
      ${modelo.regioes.map(linhaRegiao).join('')}
    </div>
    <div class="comp-tabela">
      <div class="comp-cabeca"><span>${tituloUfs}${ui.regiao ? ' <button type="button" class="comp-limpar" data-comp-limpar>ver o Brasil</button>' : ''}</span><span>peso</span><span></span><span></span></div>
      ${ufsHtml}
    </div>
    <p class="muted pequeno comp-nota">Impacto = peso da UF nos votos válidos de ${p.anoBase} × saldo da UF (variação de ${esc(p.pt.nome)} − variação de ${esc(curto(p.pl))}, em pontos percentuais). ${p.vivo ? `UFs com menos de ${modelo.fracaoMinima}% das seções totalizadas ficam de fora: as regiões chegam em ordens diferentes e o resultado parcial engana.` : `${p.anoAtual} já terminou, então todas as UFs entram.`}</p>
    <p class="muted pequeno comp-nota">Variação não é transferência de votos: com dados por UF não dá para saber de quem veio cada voto, nem separar o efeito de outros candidatos e da abstenção.</p>`;
}

function ufHtml(modelo, ui, ajuda) {
  const { esc, fmtInt, corPartido, nomeUf } = ajuda;
  const p = modelo.periodo;
  const u = modelo.ufs.find((x) => x.uf === ui.uf);
  const cab = cabecalho(modelo, ajuda, `${esc(nomeUf(ui.uf))} · 1º turno, % dos votos válidos · peso no Brasil: ${u ? pc(u.peso) : '—'}`);
  if (!u) return `${cab}<p class="vazio-msg">Sem base de ${p.anoBase} para esta unidade.</p>`;

  const card = (c) => {
    const x = u[c.id];
    return `<div class="comp-card" style="--cor:${corPartido(c.partido)}">
      <div class="comp-card-nome"><i></i><b>${esc(tituloDe(c))}</b>${c.titulo ? '' : `<span class="muted pequeno">${esc(c.partido)}</span>`}</div>
      <div class="comp-card-var">${x.d == null ? '<span class="muted">—</span>' : `<b>${sinal(x.d, 1)}</b> <small>p.p.</small>`}</div>
      <dl><dt>${p.anoBase} · ${esc(c.nomeBase)}</dt><dd><b>${pc(x.pBase)}</b><small>${fmtInt(Math.round(x.vBase))} votos</small></dd>
        <dt>${p.anoAtual}</dt><dd>${u.validosAtual ? `<b>${pc(x.pAtual)}</b><small>${fmtInt(Math.round(x.vAtual))} votos</small>` : '—'}</dd></dl></div>`;
  };
  const apuracao = u.temNumeros && p.vivo
    ? `<div class="progresso"><div class="progresso-linha"><span>Seções totalizadas em ${p.anoAtual}</span><span><b>${fmt(u.fracao)}%</b></span></div><div class="trilho"><i style="width:${Math.min(100, u.fracao)}%"></i></div></div>`
    : '';
  const situacao = u.pronto
    ? `<p class="comp-resumo-uf"><span>Saldo na UF <b>${sinal(u.saldo, 1)} p.p.</b></span><span>Impacto no Brasil <b>${sinal(u.impacto)} p.p.</b></span></p>`
    : `<p class="aviso-bloco espera">${u.temNumeros ? `Apuração em ${fmt(u.fracao, 0)}%: abaixo de ${modelo.fracaoMinima}%, esta UF ainda não entra no comparativo, porque o resultado parcial engana.` : `Ainda sem votos de ${p.anoAtual} para comparar.`}</p>`;
  const validosLinha = `<p class="comp-resumo-uf comp-validos"><span>Votos válidos no 1º turno de ${p.anoBase} <b>${fmtInt(Math.round(u.validosBase))}</b></span><span>de ${p.anoAtual} <b>${u.validosAtual ? fmtInt(Math.round(u.validosAtual)) : '—'}</b>${p.vivo && u.validosAtual && u.fracao < 100 ? ' <small>parcial</small>' : ''}</span></p>`;
  return `${cab}${apuracao}<div class="comp-cards">${candidatosDe(p).map(card).join('')}</div>
    ${validosLinha}${situacao}
    <p class="muted pequeno comp-nota">${esc(p.nota)} A variação mostra o que mudou, não de onde vieram os votos.</p>`;
}

// Liga os botões de região e o "ver o Brasil" ao estado da interface.
export function ligarComparativo(raiz, ui, aoMudar) {
  raiz.querySelectorAll('[data-comp-regiao]').forEach((b) => b.addEventListener('click', () => {
    ui.regiao = ui.regiao === b.dataset.compRegiao ? null : b.dataset.compRegiao;
    aoMudar();
  }));
  raiz.querySelector('[data-comp-limpar]')?.addEventListener('click', () => { ui.regiao = null; aoMudar(); });
}
