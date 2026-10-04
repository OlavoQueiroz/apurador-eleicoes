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
// Terceiros candidatos que o painel sabe mostrar nas barras. `numeroBase`/`numeroAtual` = número na eleição base e na atual
// (ausente = não concorreu). Os de 2026 vêm da urna: Cury (Avante, 70) e Renan Santos (Missão, 14).
const CIRO = { id: 'ciro', nome: 'Ciro Gomes', partido: 'PDT', numeroBase: '12', numeroAtual: '12' };
const ALCKMIN = { id: 'alckmin', nome: 'Geraldo Alckmin', partido: 'PSDB', numeroBase: '45' }; // só concorreu em 2018
const TEBET = { id: 'tebet', nome: 'Simone Tebet', partido: 'MDB', numeroBase: '15' }; // base 2022
const TEBET_ATUAL = { ...TEBET, numeroBase: undefined, numeroAtual: '15' };
const CURY = { id: 'cury', nome: 'Augusto Cury', partido: 'AVANTE', numeroAtual: '70', padrao: true };
const RENAN = { id: 'renan', nome: 'Renan Santos', partido: 'MISSÃO', numeroAtual: '14', padrao: true };
export const PERIODOS = {
  '2026x2022': {
    id: '2026x2022', rotulo: '2026 × 2022', anoAtual: 2026, anoBase: 2022, vivo: true,
    pt: { numero: '13', nome: 'Lula', nomeBase: 'Lula', partido: 'PT' },
    pl: { numero: '22', nome: 'Flávio Bolsonaro', curto: 'Flávio', nomeBase: 'Bolsonaro', partido: 'PL' },
    nota: 'Em 2022, Bolsonaro concorreu pelo PL, o mesmo partido de Flávio em 2026.',
    outros: [{ ...CIRO, numeroAtual: undefined }, TEBET, CURY, RENAN], // Ciro e Tebet só em 2022; Cury e Renan só em 2026
  },
  '2026x2018': {
    id: '2026x2018', rotulo: '2026 × 2018', anoAtual: 2026, anoBase: 2018, vivo: true,
    pt: { numero: '13', nome: 'Lula', titulo: 'PT (Haddad em 2018, Lula em 2026)', curto: 'PT', nomeBase: 'Haddad', partido: 'PT' },
    pl: { numero: '22', nome: 'Flávio Bolsonaro', curto: 'Flávio', nomeBase: 'Bolsonaro', partido: 'PL' },
    nota: 'Lula não concorreu em 2018 (estava inelegível): o PT lançou Haddad, então a comparação é entre as candidaturas do PT, Haddad em 2018 e Lula em 2026. Bolsonaro concorreu pelo PSL, com o número 17; em 2026 o campo dele tem Flávio, pelo PL.',
    outros: [{ ...CIRO, numeroAtual: undefined, padrao: true }, ALCKMIN, CURY, RENAN], // Ciro e Alckmin só em 2018; Cury e Renan só em 2026
  },
  '2022x2018': {
    id: '2022x2018', rotulo: '2022 × 2018', anoAtual: 2022, anoBase: 2018, vivo: false,
    pt: { numero: '13', nome: 'Lula', titulo: 'PT (Haddad em 2018, Lula em 2022)', curto: 'PT', nomeBase: 'Haddad', partido: 'PT' },
    pl: { numero: '22', nome: 'Bolsonaro', curto: 'Bolsonaro', nomeBase: 'Bolsonaro', partido: 'PL' },
    nota: 'Lula não concorreu em 2018 (estava inelegível): o PT lançou Haddad, então a comparação é entre as candidaturas do PT, Haddad em 2018 e Lula em 2022. Bolsonaro concorreu pelo PSL, com o número 17; em 2022, pelo PL, com o 22.',
    outros: [{ ...CIRO, padrao: true }, ALCKMIN, TEBET_ATUAL],
  },
};
export const periodoPorId = (id) => PERIODOS[id] ?? PERIODOS[PADRAO];
// Terceiros mostrados nas barras: o que o usuário marcou (ui.terceiros) ou, sem escolha, os `padrao` do período.
export const terceirosSelecionados = (periodo, ui) =>
  (ui?.terceiros ?? periodo.outros.filter((o) => o.padrao).map((o) => o.id)).filter((id) => periodo.outros.some((o) => o.id === id));
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
    const outros = Object.fromEntries(periodo.outros.map((o) => {
      const vBase = (o.numeroBase && b.votos?.[o.numeroBase]) || 0;
      const vAtual = (o.numeroAtual && item?.votosPorNumero?.[o.numeroAtual]) || 0;
      return [o.id, { vBase, vAtual, pBase: b.validos ? (100 * vBase) / b.validos : 0, pAtual: validosAtual ? (100 * vAtual) / validosAtual : 0 }];
    }));
    const saldo = pronto ? cand.pt.d - cand.pl.d : null;
    return { uf, regiao: regiaoDaUf(uf), peso, fracao, validosBase: b.validos, validosAtual, temNumeros, pronto, pt: cand.pt, pl: cand.pl, outros, saldo, impacto: pronto ? (peso / 100) * saldo : null };
  });
  // Soma de UFs numa linha só (região): só entram as UFs com apuração suficiente, as duas eleições sobre as mesmas UFs;
  // sem nenhuma pronta, a base aparece inteira e o atual fica vazio.
  const agregar = (lista) => {
    const prontas = lista.filter((u) => u.pronto);
    const usadas = prontas.length ? prontas : lista;
    const validosBase = soma(usadas.map((u) => u.validosBase));
    const validosAtual = soma(prontas.map((u) => u.validosAtual));
    const lado = (get) => {
      const vBase = soma(usadas.map((u) => get(u).vBase));
      const vAtual = soma(prontas.map((u) => get(u).vAtual));
      return { vBase, vAtual, pBase: validosBase ? (100 * vBase) / validosBase : 0, pAtual: validosAtual ? (100 * vAtual) / validosAtual : 0 };
    };
    return { validosBase, validosAtual, pt: lado((u) => u.pt), pl: lado((u) => u.pl), outros: Object.fromEntries(periodo.outros.map((o) => [o.id, lado((u) => u.outros[o.id])])) };
  };
  const regioes = REGIOES.map((nome) => {
    const lista = ufs.filter((u) => u.regiao === nome);
    const prontas = lista.filter((u) => u.pronto);
    return { nome, ...agregar(lista), peso: soma(lista.map((u) => u.peso)), impacto: prontas.length ? soma(prontas.map((u) => u.impacto)) : null, prontas: prontas.length, total: lista.length };
  });
  const prontas = ufs.filter((u) => u.pronto);
  // Total do 1º turno em cada eleição, no Brasil inteiro (com o exterior). No período ao vivo, o atual é o que já chegou.
  const todas = Object.keys(base.ufs);
  const nacional = (eleicao) => {
    const validos = soma(todas.map((uf) => (eleicao === 'base' ? base.ufs[uf].validos : itemDe(uf)?.validos ?? 0)));
    const lado = (votos) => ({ votos, pct: validos ? (100 * votos) / validos : 0 });
    const cand = Object.fromEntries(candidatos.map((c) => [c.id, lado(soma(todas.map((uf) => (eleicao === 'base' ? base.ufs[uf].herdados?.[c.numero] : itemDe(uf)?.votosPorNumero?.[c.numero]) ?? 0)))]));
    const outros = Object.fromEntries(periodo.outros.map((o) => {
      const numero = eleicao === 'base' ? o.numeroBase : o.numeroAtual;
      return [o.id, lado(numero ? soma(todas.map((uf) => (eleicao === 'base' ? base.ufs[uf].votos?.[numero] : itemDe(uf)?.votosPorNumero?.[numero]) ?? 0)) : 0)];
    }));
    return { validos, pt: cand.pt, pl: cand.pl, outros };
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

// `ui`: { uf: 'br' | sigla, regiao: null | nome }  ·  `ajuda`: { esc, fmtInt, corPartido, nomeUf, hrefUf, demo }
export function comparativoHtml(modelo, ui, ajuda) {
  return ui.uf === 'br' ? brasilHtml(modelo, ui, ajuda) : ufHtml(modelo, ui, ajuda);
}

function cabecalho(modelo, ajuda, subtitulo) {
  const { esc } = ajuda;
  const p = modelo.periodo;
  return `<div class="detalhe-topo"><div><h2>Presidente · ${esc(p.rotulo)}</h2>
      <p class="muted pequeno">${subtitulo}</p></div></div>`;
}

// Barra de uma eleição para uma linha: PT | terceiros escolhidos | demais (cinza) | campo de Bolsonaro, em % dos votos
// válidos. O número só aparece nos segmentos largos; o título (hover) traz todos.
function barraEleicao(x, lado, p, extras, ajuda) {
  const { esc, corPartido } = ajuda;
  if (!(lado === 'Base' ? x.validosBase : x.validosAtual)) return '<span class="muted">—</span>';
  const pct = (c) => c[`p${lado}`];
  const segs = [{ nome: curto(p.pt), cor: corPartido(p.pt.partido), v: pct(x.pt) }, ...extras.map((o) => ({ nome: o.nome, cor: corPartido(o.partido), v: pct(x.outros[o.id]) }))];
  const demais = Math.max(0, 100 - soma(segs.map((s) => s.v)) - pct(x.pl));
  const todos = [...segs, { nome: 'demais', cor: null, v: demais }, { nome: curto(p.pl), cor: corPartido(p.pl.partido), v: pct(x.pl) }];
  const titulo = todos.filter((s) => s.v >= 0.05).map((s) => `${s.nome} ${pc(s.v)}`).join(' · ');
  return `<span class="comp-eleicao" title="${esc(titulo)}">${todos.filter((s) => s.v > 0).map((s) =>
    `<i style="width:${s.v.toFixed(2)}%;${s.cor ? `--cor:${s.cor}` : ''}" class="${s.cor ? '' : 'demais'}">${s.cor && s.v >= 18 ? fmt(s.v, 1) : ''}</i>`).join('')}</span>`;
}

function brasilHtml(modelo, ui, ajuda) {
  const { esc, corPartido, nomeUf, hrefUf } = ajuda;
  const p = modelo.periodo;
  const t = modelo.total;
  const cores = { pt: corPartido(p.pt.partido), pl: corPartido(p.pl.partido) };
  const selecionados = terceirosSelecionados(p, ui);
  const extras = p.outros.filter((o) => selecionados.includes(o.id));
  const n = modelo.nacional;
  const brasil = {
    validosBase: n.base.validos, validosAtual: n.atual.validos,
    pt: { pBase: n.base.pt.pct, pAtual: n.atual.pt.pct }, pl: { pBase: n.base.pl.pct, pAtual: n.atual.pl.pct },
    outros: Object.fromEntries(p.outros.map((o) => [o.id, { pBase: n.base.outros[o.id].pct, pAtual: n.atual.outros[o.id].pct }])),
  };
  const parcial = p.vivo && n.atual.validos > 0;

  // Regiões e UFs: do maior para o menor impacto (em módulo); sem apuração suficiente vêm depois, por peso.
  const porImpacto = (a, b) => ((b.impacto != null) - (a.impacto != null)) || (Math.abs(b.impacto ?? 0) - Math.abs(a.impacto ?? 0)) || (b.peso - a.peso);
  const regioes = [...modelo.regioes].sort(porImpacto);
  const aberta = ui.regiao ?? regioes[0]?.nome; // sem escolha, a de maior impacto fica aberta (o mapa só recua com escolha explícita)
  const maximo = Math.max(0.1, ...[...modelo.ufs, ...modelo.regioes].map((x) => Math.abs(x.impacto ?? 0)));
  const impacto = (v, barra = true) => (v == null ? '<span class="muted">—</span>'
    : `<span class="comp-imp">${barra ? `<span class="b"><i style="width:${Math.min(100, (100 * Math.abs(v)) / maximo).toFixed(1)}%;--cor:${v >= 0 ? cores.pt : cores.pl}"></i></span>` : ''}<b>${sinal(v)}</b></span>`);
  const celulas = (x, peso, valor, barra) => `<td class="peso">${pc(peso)}</td><td>${barraEleicao(x, 'Base', p, extras, ajuda)}</td><td>${barraEleicao(x, 'Atual', p, extras, ajuda)}</td><td>${impacto(valor, barra)}</td>`;

  const linhaBrasil = `<tr class="comp-brasil"${ui.regiao ? ' data-comp-limpar role="button" tabindex="0" title="Voltar a ver o Brasil"' : ''}>
      <td class="nm"><b>Brasil</b><small class="muted">${n.atual.validos ? `${fmt(n.base.validos / 1e6, 1)} → ${fmt(n.atual.validos / 1e6, 1)} mi votos válidos${parcial ? ' (parcial)' : ''}` : `${fmt(n.base.validos / 1e6, 1)} mi votos válidos em ${p.anoBase}`}</small></td>${celulas(brasil, 100, t.impacto, false)}</tr>`;
  const linhaUf = (u) => `<tr class="comp-uf"><td class="nm"><a href="${hrefUf(u.uf)}">${esc(nomeUf(u.uf))}</a>${u.pronto ? '' : ` <small class="muted">${u.temNumeros ? `${fmt(u.fracao, 0)}% apurado` : 'sem dados'}</small>`}</td>${celulas(u, u.peso, u.impacto)}</tr>`;
  const linhaRegiao = (r) => {
    const aberto = r.nome === aberta;
    const ufs = aberto ? modelo.ufs.filter((u) => u.regiao === r.nome).sort(porImpacto).map(linhaUf).join('') : '';
    return `<tr class="comp-regiao" data-comp-regiao="${esc(r.nome)}" role="button" tabindex="0" aria-expanded="${aberto}">
      <td class="nm"><span class="seta">${aberto ? '▾' : '▸'}</span>${esc(r.nome)}${r.prontas < r.total ? ` <small class="muted" title="UFs com apuração suficiente">${r.prontas}/${r.total}</small>` : ''}</td>${celulas(r, r.peso, r.impacto)}</tr>${ufs}`;
  };

  const chips = p.outros.length
    ? `<div class="comp-terceiros" role="group" aria-label="Terceiros candidatos nas barras" data-sel="${esc(selecionados.join(','))}"><span class="muted">Terceiro candidato:</span>${p.outros.map((o) =>
      `<button type="button" class="comp-chip" data-comp-terceiro="${esc(o.id)}" aria-pressed="${selecionados.includes(o.id)}" style="--cor:${corPartido(o.partido)}"><i></i>${esc(o.nome)}</button>`).join('')}</div>`
    : '';
  const legenda = [{ nome: curto(p.pt), cor: cores.pt }, ...extras.map((o) => ({ nome: o.nome, cor: corPartido(o.partido), nota: o.numeroBase && o.numeroAtual ? `${pc(n.base.outros[o.id].pct)} → ${pc(n.atual.outros[o.id].pct)} no Brasil` : o.numeroBase ? `${pc(n.base.outros[o.id].pct)} no Brasil, só em ${p.anoBase}` : `${pc(n.atual.outros[o.id].pct)} no Brasil, só em ${p.anoAtual}` })), { nome: curto(p.pl), cor: cores.pl }];

  const resumo = t.prontas === 0
    ? `<p class="aviso-bloco espera">Aguardando apuração suficiente: o comparativo usa as UFs com pelo menos ${modelo.fracaoMinima}% das seções totalizadas (0 de ${t.total} até agora). Enquanto isso, as barras de ${p.anoBase} e o peso de cada UF já aparecem.</p>`
    : '';
  const aviso = ajuda.demo && p.vivo ? '<p class="aviso-bloco">Modo demonstração: os candidatos são fictícios e não têm relação com a eleição real; o comparativo não faz sentido aqui.</p>' : '';
  const frase = (c) => (c.titulo ? esc(c.titulo) : `${esc(c.nome)} contra ${esc(c.nomeBase)} ${p.anoBase}`);
  const subtitulo = `1º turno, % dos votos válidos · ${frase(p.pt)} · ${frase(p.pl)}`;
  const margem = t.impacto == null ? '' : ` ${t.prontas} de ${t.total} UFs com apuração suficiente, ${pc(t.cobertura)} dos votos válidos de ${p.anoBase}. ${t.impacto >= 0 ? `Impacto positivo: a margem foi para ${esc(curto(p.pt))}.` : `Impacto negativo: a margem foi para ${esc(curto(p.pl))}.`}`;

  return `${cabecalho(modelo, ajuda, subtitulo)}
    ${aviso}${resumo}${chips}
    <table class="comp-tab">
      <thead><tr><th class="nm">${ui.regiao ? 'Região / UF' : 'Região'}</th><th class="peso">peso</th><th>${p.anoBase}</th><th>${p.anoAtual}${parcial ? ' <small>parcial</small>' : ''}</th><th>impacto (p.p.)</th></tr></thead>
      <tbody>${linhaBrasil}${regioes.map(linhaRegiao).join('')}</tbody>
    </table>
    <div class="comp-legenda">${legenda.map((l) => `<span style="--cor:${l.cor}"><i></i>${esc(l.nome)}${l.nota ? ` <small class="muted">${esc(l.nota)}</small>` : ''}</span>`).join('')}<span><i class="demais"></i>demais</span></div>
    <p class="muted pequeno comp-nota">Impacto = peso da UF nos votos válidos de ${p.anoBase} × saldo da UF (variação de ${esc(p.pt.nome)} − variação de ${esc(curto(p.pl))}, em pontos percentuais); a linha Brasil é a soma.${margem} ${p.vivo ? `UFs com menos de ${modelo.fracaoMinima}% das seções totalizadas ficam de fora: as regiões chegam em ordens diferentes e o resultado parcial engana.` : `${p.anoAtual} já terminou, então todas as UFs entram.`}</p>
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

// Liga as regiões, o "Brasil" (limpa a região) e os chips de terceiro candidato ao estado da interface.
export function ligarComparativo(raiz, ui, aoMudar) {
  const aoAtivar = (el, fn) => {
    el.addEventListener('click', fn);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  };
  raiz.querySelectorAll('[data-comp-regiao]').forEach((el) => aoAtivar(el, () => {
    ui.regiao = ui.regiao === el.dataset.compRegiao ? null : el.dataset.compRegiao;
    aoMudar();
  }));
  raiz.querySelectorAll('[data-comp-limpar]').forEach((el) => aoAtivar(el, () => { ui.regiao = null; aoMudar(); }));
  raiz.querySelectorAll('[data-comp-terceiro]').forEach((b) => b.addEventListener('click', () => {
    const atuais = (b.closest('[data-sel]').dataset.sel || '').split(',').filter(Boolean);
    ui.terceiros = atuais.includes(b.dataset.compTerceiro) ? atuais.filter((id) => id !== b.dataset.compTerceiro) : [...atuais, b.dataset.compTerceiro];
    aoMudar();
  }));
}
