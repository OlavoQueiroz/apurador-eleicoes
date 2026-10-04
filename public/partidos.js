// Visão "Análise": bancadas por bloco ideológico e por partido, comparadas com as eleições anteriores. Sem DOM: o modelo
// é montado a partir de dados puros e as funções devolvem texto HTML/SVG (como cadeiras.js). A classificação dos
// partidos em blocos é a de ideologia.js, uma simplificação editorial.

import { GRUPOS, grupoDoPartido, grupoPorId } from './ideologia.js';
import { ordemSerpentina, posicoesHemiciclo } from './cadeiras.js';
import { focoHtml } from './partido-foco.js';

// Cargos com análise de bancadas (a presidência tem o comparativo, em comparativo-eleicoes.js). `chave` é a do arquivo dados-historicos/eleitos.json; `anos`, as eleições com bancada conhecida (no
// Senado, a bancada de um ano soma os eleitos dele e os de quatro anos antes, então 2014 fica de fora).
export const CARGOS_PARTIDOS = [
  { codigo: 3, chave: 'governador', nome: 'Governadores', total: 27, anos: [2014, 2018, 2022], mapa: true },
  { codigo: 5, chave: 'senador', nome: 'Senado', total: 81, anos: [2018, 2022], mapa: false },
  { codigo: 6, chave: 'deputadoFederal', nome: 'Câmara', total: 513, anos: [2014, 2018, 2022], mapa: false },
  // Deputado estadual só existe no painel para SP e RJ (CARGOS[7] em src/tse.js); `ufs` dá as cadeiras de cada Assembleia.
  { codigo: 7, chave: 'deputadoEstadual', nome: 'Dep. estadual', total: null, anos: [2014, 2018, 2022], mapa: false, ufs: { sp: 94, rj: 70 } },
];
export const cargoPartidos = (codigo) => CARGOS_PARTIDOS.find((c) => c.codigo === Number(codigo));

export const ABAS = [
  { id: 'placar', nome: 'Placar' },
  { id: 'serie', nome: 'Série histórica' },
  { id: 'foco', nome: 'Um partido', cargos: [6, 7] }, // só deputados: federal (Brasil) e estadual (SP e RJ)
];
export const abasDoCargo = (codigo) => ABAS.filter((a) => !a.cargos || a.cargos.includes(Number(codigo)));

export const DISPUTADO = { id: 'disputado', nome: 'Disputado', cor: '#b8bec9' };
const PENDENTE = { id: 'pendente', nome: '2026 ainda não definido', cor: 'var(--vazio)' }; // metade cinza do mapa
const DESCRICAO_SITUACAO = {
  eleito: 'eleito',
  'segundo-turno': '2º turno',
  'provavel-1t': 'na frente com mais de 50%, pode fechar no 1º turno',
  'provavel-2t': 'na frente com 50% ou menos, provável 2º turno',
};
// Como lê a metade de 2026 no mapa de governadores (a cor é a do bloco ou partido; aqui, em cinza neutro).
const LEGENDA_SITUACAO = [
  { id: 'st-eleito', nome: 'eleito', cor: '#6b7585' },
  { id: 'st-claro', nome: 'na frente com mais de 50%', cor: '#6b7585', fundo: 'rgba(107,117,133,0.5)' },
  { id: 'st-lis', nome: 'na frente com 50% ou menos / 2º turno', cor: '#6b7585', fundo: 'repeating-linear-gradient(45deg,#6b7585 0 2px,transparent 2px 4px)' },
];
const ORDEM_BLOCOS = GRUPOS.map((g) => g.id);

const norma = (sigla) =>
  String(sigla ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const soma = (mapa, sigla, n = 1) => { mapa[sigla] = (mapa[sigla] ?? 0) + n; };
const somaValores = (mapa) => Object.values(mapa).reduce((s, n) => s + n, 0);

// ---------- bancadas ----------

// { partido: cadeiras } → { esquerda, centrao, direita, independente }
export function blocosDe(porPartido) {
  const blocos = Object.fromEntries(ORDEM_BLOCOS.map((id) => [id, 0]));
  for (const [sigla, n] of Object.entries(porPartido)) blocos[grupoDoPartido(sigla)] += n;
  return blocos;
}

// Partidos dos eleitos de uma eleição: { partido: cadeiras }. Null se o ano não existe no arquivo. Com `uf`, só dessa UF.
export function eleitosPorPartido(historico, ano, chave, uf = null) {
  const dados = historico?.anos?.[ano]?.[chave];
  if (!dados) return null;
  const valores = Object.entries(dados).filter(([u]) => !uf || u === uf).map(([, v]) => v);
  const saida = {};
  if (chave === 'governador') for (const sigla of valores) soma(saida, sigla);
  else if (chave === 'senador') for (const siglas of valores) for (const sigla of siglas) soma(saida, sigla);
  else for (const u of valores) for (const [sigla, n] of Object.entries(u)) soma(saida, sigla, n);
  return saida;
}

const juntar = (a, b) => {
  const saida = { ...a };
  for (const [sigla, n] of Object.entries(b)) soma(saida, sigla, n);
  return saida;
};

// Bancada logo depois da eleição de `ano`. No Senado são os eleitos de `ano` mais os de quatro anos antes.
export function bancadaDoAno(historico, ano, chave, uf = null) {
  const atual = eleitosPorPartido(historico, ano, chave, uf);
  if (!atual) return null;
  if (chave !== 'senador') return atual;
  const anterior = eleitosPorPartido(historico, ano - 4, chave, uf);
  return anterior ? juntar(anterior, atual) : null;
}

// Bancada de uma UF numa eleição passada, na forma { partido: cadeiras }.
function bancadaUfHistorica(historico, ano, chave, uf) {
  const d = historico?.anos?.[ano]?.[chave]?.[uf];
  if (!d) return null;
  if (chave === 'governador') return { [d]: 1 };
  return { ...d };
}

// A apuração de 2026 a partir do resumo de cada UF (itens de /api/resumo do cargo, sem "br").
//   confirmados: eleitos que o TSE já marcou · naFrente: vagas que ainda não têm eleito marcado, atribuídas por ora a
//   quem lidera (Câmara: vagas já conquistadas pelo partido ou federação) · ocupadas: cadeiras do Senado fora de disputa.
// Situação de um governador em 2026, pelo que o TSE já publicou: 'eleito' (marcado), 'segundo-turno' (marcado), 'provavel-1t'
// (lidera com mais de 50% dos válidos, ainda sem marca), 'provavel-2t' (lidera com 50% ou menos) ou 'sem-dado'.
export function situacaoGovernador(item) {
  const colocados = item.colocados ?? [];
  if (somaValores(item.eleitosPorPartido ?? {}) >= item.vagas) return 'eleito';
  if (colocados.some((c) => c.situacao === 'segundo-turno')) return 'segundo-turno';
  const lider = colocados.find((c) => c.votos > 0);
  if (!lider) return 'sem-dado';
  return lider.pct > 50 ? 'provavel-1t' : 'provavel-2t';
}

export function aoVivo(cargo, itens, ocupadas = [], totalPadrao = cargo.total) {
  const confirmados = {};
  const naFrente = {};
  const porUf = {};
  let vagas = 0;
  for (const item of itens) {
    const c = item.eleitosPorPartido ?? {};
    const f = {};
    if (cargo.codigo === 6 || cargo.codigo === 7) {
      for (const [sigla, n] of Object.entries(item.cadeirasPorPartido ?? c)) if (n > (c[sigla] ?? 0)) f[sigla] = n - (c[sigla] ?? 0);
    } else {
      const abertas = Math.max(0, item.vagas - somaValores(c));
      for (const cand of (item.colocados ?? []).filter((x) => x.situacao !== 'eleito' && x.votos > 0).slice(0, abertas)) soma(f, cand.partido);
    }
    for (const [s, n] of Object.entries(c)) soma(confirmados, s, n);
    for (const [s, n] of Object.entries(f)) soma(naFrente, s, n);
    porUf[item.uf] = { confirmados: c, naFrente: f, vagas: item.vagas, situacao: cargo.codigo === 3 ? situacaoGovernador(item) : null };
    vagas += item.vagas;
  }
  const fixas = {};
  for (const o of ocupadas) soma(fixas, o.partido);
  const total = itens.length ? vagas + ocupadas.length : totalPadrao;
  const definidas = somaValores(confirmados) + somaValores(naFrente) + ocupadas.length;
  // `estimativa`: as vagas "na frente" de deputados vêm de uma distribuição estimada pelo quociente (normalize.js), não do TSE.
  const estimativa = itens.some((i) => i.cadeirasEstimadas);
  return { total, confirmados, naFrente, ocupadas: fixas, porUf, definidas, pendentes: Math.max(0, total - definidas), estimativa };
}

const unir = (...mapas) => mapas.reduce((a, b) => juntar(a, b), {});

// A sigla sem espaços ("PC DO B" e "PCDOB" são o mesmo partido), para juntar o que vem de fontes diferentes.
const rotuloPartido = (sigla) => String(sigla ?? '').trim().toUpperCase().replace(/\s+/g, '');

// { partido: cadeiras } → cadeiras por grupo: por bloco ideológico ou por partido.
export function agrupar(porPartido, modo = 'ideologia') {
  if (modo !== 'partido') return blocosDe(porPartido);
  const saida = {};
  for (const [sigla, n] of Object.entries(porPartido)) soma(saida, rotuloPartido(sigla), n);
  return saida;
}

// Grupo que lidera uma bancada (estado ou Brasil); "disputado" se a diferença para o segundo for pequena (menos de 10%).
export function blocoDaBancada(porPartido, modo = 'ideologia') {
  const total = somaValores(porPartido);
  if (!total) return null;
  const grupos = Object.entries(agrupar(porPartido, modo)).sort((a, b) => b[1] - a[1]);
  const margem = grupos[0][1] - (grupos[1]?.[1] ?? 0);
  if (total > 1 && margem < Math.max(1, Math.round(total * 0.1))) return 'disputado';
  return grupos[0][0];
}

// Tudo o que as telas precisam, de uma vez. `historico` = /api/partidos; `itens` = resumos das UFs; `ocupadas` = Senado.
export function criarModelo({ cargo, historico, itens, ocupadas = [], ufs = [], uf = null }) {
  const vivo = aoVivo(cargo, itens, ocupadas, cargo.ufs?.[uf] ?? cargo.total);
  const atualPorPartido = unir(vivo.confirmados, vivo.naFrente, vivo.ocupadas);
  const series = cargo.anos
    .map((ano) => ({ ano, porPartido: bancadaDoAno(historico, ano, cargo.chave, uf) }))
    .filter((s) => s.porPartido);
  const base = series.length ? series[series.length - 1] : null; // a eleição anterior: o ponto de comparação

  // Bancada de cada UF em cada eleição (só governador e Câmara). O de 2026 é provisório até todas as vagas serem marcadas.
  const estados = !cargo.mapa ? null : ufs.map((uf) => {
    const bancadas = {};
    for (const ano of cargo.anos) bancadas[ano] = bancadaUfHistorica(historico, ano, cargo.chave, uf) ?? {};
    const u = vivo.porUf[uf];
    bancadas[2026] = u ? unir(u.confirmados, u.naFrente) : {};
    // Bloco ideológico da UF em cada eleição; a tela também calcula por partido, a partir das bancadas.
    const blocos = Object.fromEntries(Object.entries(bancadas).map(([ano, bancada]) => [ano, blocoDaBancada(bancada)]));
    return { uf, bancadas, blocos, provisorio: !u || somaValores(u.confirmados) < u.vagas, situacao: u?.situacao ?? 'sem-dado', vagas: u?.vagas ?? 0 };
  });

  const rotulo = uf && cargo.ufs ? `${cargo.nome} · ${uf.toUpperCase()}` : cargo.nome; // nos títulos
  return { cargo, uf, rotulo, historico: Boolean(series.length), vivo, atual: { porPartido: atualPorPartido, blocos: blocosDe(atualPorPartido) }, base, series, estados };
}

// ---------- desenho ----------

const delta = (n) => (n > 0 ? `▲ +${n}` : n < 0 ? `▼ ${n}` : '= 0');
const classeDelta = (n) => (n > 0 ? 'sobe' : n < 0 ? 'desce' : '');
const modoDe = (ajuda) => (ajuda.modo === 'partido' ? 'partido' : 'ideologia');
const OUTROS = { id: 'outros', nome: 'Outros', cor: '#8a94a3' };

// Nome e cor de um grupo (bloco ideológico, partido ou "disputado").
function infoGrupo(id, modo, ajuda) {
  if (id === DISPUTADO.id) return DISPUTADO;
  if (id === OUTROS.id) return OUTROS;
  if (modo === 'partido') return { id, nome: id, cor: ajuda.corPartido(id) };
  return grupoPorId(id);
}

// Grupos para cartões e legenda, em ordem de exibição, com a bancada de hoje e a da eleição anterior. Por ideologia são
// os quatro blocos; por partido, os `max` maiores e um "Outros" com o resto.
function gruposDe(modelo, ajuda, max = 4) {
  const modo = modoDe(ajuda);
  const antesBruto = modelo.base?.porPartido ?? null;
  if (modo !== 'partido') {
    const antes = antesBruto ? blocosDe(antesBruto) : null;
    return GRUPOS.map((g) => ({ ...g, atual: modelo.atual.blocos[g.id], antes: antes ? antes[g.id] : null }));
  }
  const atual = agrupar(modelo.atual.porPartido, 'partido');
  const antes = antesBruto ? agrupar(antesBruto, 'partido') : null;
  const maiores = Object.entries(atual).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).slice(0, max).map(([id]) => id);
  const lista = maiores.map((id) => ({ ...infoGrupo(id, modo, ajuda), atual: atual[id], antes: antes ? (antes[id] ?? 0) : null }));
  const restoAtual = somaValores(atual) - lista.reduce((s, g) => s + g.atual, 0);
  const restoAntes = antes ? somaValores(antes) - lista.reduce((s, g) => s + g.antes, 0) : null;
  if (restoAtual > 0 || restoAntes > 0) lista.push({ ...OUTROS, atual: restoAtual, antes: restoAntes });
  return lista;
}

// O que cada hemiciclo desenha: cadeiras confirmadas, vagas na frente (ainda sem eleito marcado) e as sem definição.
const fonteAoVivo = (modelo) => ({
  confirmadas: unir(modelo.vivo.confirmados, modelo.vivo.ocupadas), frente: modelo.vivo.naFrente, pendentes: modelo.vivo.pendentes, total: modelo.vivo.total, definidas: modelo.vivo.definidas,
});
const fonteHistorica = (serie) => {
  const total = somaValores(serie.porPartido);
  return { confirmadas: serie.porPartido, frente: {}, pendentes: 0, total, definidas: total };
};
// Eleições passadas que ganham hemiciclo: as duas mais recentes (ex.: 2018 e 2022), ao lado de 2026.
const historicasDoPlacar = (modelo) => modelo.series.slice(-2);

// Cadeiras na ordem do hemiciclo: da esquerda para a direita por ideologia; por partido, os partidos de cada bloco juntos.
function cadeirasDoHemiciclo(fonte, ajuda) {
  const modo = modoDe(ajuda);
  const confirmadas = agrupar(fonte.confirmadas, modo);
  const frente = agrupar(fonte.frente, modo);
  let ids = ORDEM_BLOCOS;
  if (modo === 'partido') {
    const ordemBloco = new Map(ORDEM_BLOCOS.map((b, i) => [b, i]));
    ids = [...new Set([...Object.keys(confirmadas), ...Object.keys(frente)])].sort((a, b) =>
      ordemBloco.get(grupoDoPartido(a)) - ordemBloco.get(grupoDoPartido(b))
      || (confirmadas[b] ?? 0) + (frente[b] ?? 0) - (confirmadas[a] ?? 0) - (frente[a] ?? 0) || a.localeCompare(b, 'pt-BR'));
  }
  const cadeiras = [];
  for (const id of ids) {
    for (let i = 0; i < (confirmadas[id] ?? 0); i += 1) cadeiras.push({ id, frente: false });
    for (let i = 0; i < (frente[id] ?? 0); i += 1) cadeiras.push({ id, frente: true });
  }
  for (let i = 0; i < fonte.pendentes; i += 1) cadeiras.push({ id: null });
  return cadeiras;
}

function hemiciclo(fonte, modelo, ajuda) {
  const { esc, fmtInt } = ajuda;
  const modo = modoDe(ajuda);
  const cadeiras = cadeirasDoHemiciclo(fonte, ajuda);
  const { pontos: posicoes, raio } = posicoesHemiciclo(cadeiras.length);
  const pontos = ordemSerpentina(posicoes);
  const circulos = cadeiras.map((c, i) => {
    const p = pontos[i];
    if (!c.id) return `<circle class="par-vaga" data-g="${VAGA}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${raio.toFixed(1)}"/>`;
    const g = infoGrupo(c.id, modo, ajuda);
    const estilo = c.frente ? `fill="none" stroke="${g.cor}" stroke-width="${Math.max(1.4, raio * 0.35).toFixed(1)}"` : `fill="${g.cor}"`;
    return `<circle data-g="${esc(c.id)}"${c.frente ? ' data-frente="1"' : ''} cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(c.frente ? raio * 0.78 : raio).toFixed(1)}" ${estilo}/>`;
  }).join('');
  return `<svg class="par-hemi" viewBox="-22 -22 644 366" role="img" aria-label="${esc(`Composição: ${fonte.definidas} de ${fonte.total} cadeiras definidas`)}">${circulos}
    <text class="par-hemi-num" x="300" y="268">${fmtInt(fonte.total)}</text><text class="par-hemi-leg" x="300" y="292">cadeiras${modelo.cargo.codigo === 3 ? ' de governador' : ''}</text></svg>`;
}

function legendaGrupos(grupos, { esc }, extra = '') {
  const hover = (g) => g.id && !['outros', 'disputado', 'pendente'].includes(g.id) && !String(g.id).startsWith('st-');
  return `<div class="par-leg">${grupos.map((g) => `<span${hover(g) ? ` data-g="${esc(g.id)}"` : ''}><i style="background:${g.fundo ?? g.cor}"></i>${esc(g.nome)}</span>`).join('')}${extra}</div>`;
}

// ---------- hover: total do grupo (bloco ou partido) ----------

const VAGA = '_vaga'; // identificador das cadeiras ainda sem definição

// Cadeiras de cada grupo em cada hemiciclo (eleições passadas e 2026, esta com confirmadas, na frente e fora de disputa),
// para a dica.
function totaisPorGrupo(modelo, ajuda) {
  const modo = modoDe(ajuda);
  const porAno = Object.fromEntries(historicasDoPlacar(modelo).map((x) => [x.ano, agrupar(x.porPartido, modo)]));
  porAno[2026] = agrupar(unir(modelo.vivo.confirmados, modelo.vivo.ocupadas, modelo.vivo.naFrente), modo);
  const anos = Object.keys(porAno).map(Number);
  const grupos = {};
  for (const id of new Set(anos.flatMap((ano) => Object.keys(porAno[ano])))) {
    grupos[id] = { nome: infoGrupo(id, modo, ajuda).nome, valores: Object.fromEntries(anos.map((ano) => [ano, porAno[ano][id] ?? 0])) };
  }
  const totais = Object.fromEntries(historicasDoPlacar(modelo).map((x) => [x.ano, somaValores(x.porPartido)]));
  totais[2026] = modelo.vivo.total;
  return { grupos, anos, totais, pendentes: modelo.vivo.pendentes };
}

// Texto da dica ao passar o mouse num grupo: cadeiras e participação em cada eleição mostrada, e a variação da última
// eleição passada para 2026.
export function dicaGrupoHtml(totais, id, { esc, fmtInt }) {
  if (id === VAGA) return `<strong>Em apuração</strong><span>${fmtInt(totais.pendentes)} cadeiras sem definição</span>`;
  const g = totais.grupos[id];
  if (!g) return '';
  const pct = (n, t) => `${t ? Math.round((100 * n) / t) : 0}%`;
  const linhas = totais.anos.map((ano) => `<span>${esc(ano)}: <b>${fmtInt(g.valores[ano])}</b> cadeiras (${pct(g.valores[ano], totais.totais[ano])})</span>`);
  if (totais.anos.length > 1) {
    const d = g.valores[2026] - g.valores[totais.anos[totais.anos.length - 2]];
    linhas.push(`<span class="${classeDelta(d)}">Variação: ${d > 0 ? '+' : ''}${fmtInt(d)}</span>`);
  }
  return `<strong>${esc(g.nome)}</strong>${linhas.join('')}`;
}

// Liga o hover: ao passar o mouse numa cadeira ou item da legenda, destaca o grupo em todos os hemiciclos e mostra a dica.
export function ligarHover(raiz, ajuda) {
  for (const caixa of raiz.querySelectorAll('.par-caixa[data-totais]')) {
    const totais = JSON.parse(caixa.dataset.totais);
    const dica = document.createElement('div');
    dica.className = 'par-dica';
    dica.hidden = true;
    caixa.append(dica);
    // A dica acompanha o mouse, sem passar da borda direita do cartão.
    const posicionar = (e) => {
      if (dica.hidden) return;
      const r = caixa.getBoundingClientRect();
      dica.style.left = `${Math.max(4, Math.min(e.clientX - r.left + 14, r.width - dica.offsetWidth - 4))}px`;
      dica.style.top = `${e.clientY - r.top + 14}px`;
    };
    const limpar = () => {
      delete caixa.dataset.foco;
      caixa.querySelectorAll('.on').forEach((el) => el.classList.remove('on'));
      dica.hidden = true;
    };
    caixa.addEventListener('mouseover', (e) => {
      const alvo = e.target.closest('[data-g]');
      if (!alvo) return limpar();
      const id = alvo.dataset.g;
      if (caixa.dataset.foco !== id) {
        limpar();
        caixa.dataset.foco = id;
        caixa.querySelectorAll('[data-g]').forEach((el) => el.classList.toggle('on', el.dataset.g === id));
        dica.innerHTML = dicaGrupoHtml(totais, id, ajuda);
      }
      dica.hidden = !dica.innerHTML;
      posicionar(e);
    });
    caixa.addEventListener('mousemove', posicionar);
    caixa.addEventListener('mouseleave', limpar);
  }
}

// Cartão de cada grupo: cadeiras em 2026 (grande), variação e uma barra em que a parte da eleição anterior fica clara e a
// diferença se destaca (a mais, cheia; a menos, hachurada), com o valor da eleição anterior embaixo.
function cartoesHtml(modelo, grupos, ajuda) {
  const { esc, fmtInt } = ajuda;
  const ano = modelo.base?.ano;
  const escala = Math.max(1, ...grupos.flatMap((g) => [g.atual, g.antes ?? 0])) * 1.05; // mesma escala em todos os cartões
  const larg = (n) => `${((100 * n) / escala).toFixed(1)}%`;
  return grupos.map((g) => {
    const semBase = g.antes === null;
    const d = semBase ? 0 : g.atual - g.antes;
    const menor = semBase ? g.atual : Math.min(g.atual, g.antes);
    const barra = `<i class="base" style="width:${larg(menor)}"></i>${semBase || d === 0 ? '' : `<i class="${d > 0 ? 'ganho' : 'perda'}" style="left:${larg(menor)};width:${larg(Math.abs(d))}"></i>`}`;
    return `<div class="par-card" style="--cor:${g.cor}"><span class="par-card-nome">${esc(g.nome)}</span>
      <div class="par-card-topo"><b>${fmtInt(g.atual)}</b>${semBase ? '' : `<span class="${classeDelta(d)}">${delta(d)}</span>`}</div>
      <div class="par-barra">${barra}</div>
      <span class="par-card-d">${semBase ? 'sem dado da eleição anterior' : `${esc(ano)}: ${fmtInt(g.antes)}`}</span></div>`;
  }).join('');
}

// Como ler os hemiciclos de 2026: cheio = confirmada pelo TSE; contorno = vaga na frente (nos deputados, estimada pelo
// quociente com os votos já apurados); cinza = sem definição. Só entram os estados que existem agora.
function chavesHtml(vivo, { esc, fmtInt }) {
  const chave = (classe, rotulo, n) => `<span class="par-chave"><i class="${classe}" aria-hidden="true"></i>${esc(rotulo)} <b>${fmtInt(n)}</b></span>`;
  const confirmadas = somaValores(unir(vivo.confirmados, vivo.ocupadas));
  const frente = somaValores(vivo.naFrente);
  const itens = [
    confirmadas ? chave('k-cheio', 'Confirmada pelo TSE', confirmadas) : '',
    frente ? chave('k-frente', vivo.estimativa ? 'Estimativa (vaga na frente, não é do TSE)' : 'Na frente, ainda não confirmada', frente) : '',
    vivo.pendentes > 0 ? chave('k-vazia', 'Sem definição', vivo.pendentes) : '',
  ].filter(Boolean).join('');
  return itens ? `<div class="par-chaves" role="group" aria-label="Como ler as cadeiras de 2026">${itens}</div>` : '';
}

export function placarHtml(modelo, ajuda) {
  const { esc, fmtInt } = ajuda;
  const { vivo, base } = modelo;
  const modo = modoDe(ajuda);
  const grupos = gruposDe(modelo, ajuda);
  if (modelo.cargo.mapa) return `<div class="par-cards">${cartoesHtml(modelo, grupos, ajuda)}</div>${estadosHtml(modelo, ajuda)}`; // governadores: mapa no lugar dos hemiciclos
  const parcial = vivo.pendentes > 0
    ? `<p class="par-nota">Apuração em andamento: ${fmtInt(vivo.pendentes)} de ${fmtInt(vivo.total)} cadeiras ainda sem definição. Contorno = vaga na frente, ainda sem eleito marcado pelo TSE.${vivo.estimativa ? ' As vagas na frente dos deputados são uma estimativa pelo quociente eleitoral com os votos já apurados (as regiões chegam em ordens diferentes) e mudam até o fim da apuração.' : ''}</p>`
    : '';
  const confirmadas = somaValores(unir(vivo.confirmados, vivo.ocupadas));
  const extra = modelo.cargo.codigo === 6 ? bancadasHtml(modelo, ajuda) : '';
  const porPartido = modo === 'partido';
  const figura = (rotulo, fonte) => `<figure class="par-fig"><figcaption>${esc(rotulo)}</figcaption>${hemiciclo(fonte, modelo, ajuda)}</figure>`;
  const figuras = [...historicasDoPlacar(modelo).map((x) => figura(`Eleição de ${x.ano}`, fonteHistorica(x))), figura(vivo.pendentes > 0 ? '2026 · em apuração' : '2026', fonteAoVivo(modelo))];
  const hemiciclos = `<div class="par-figs" style="--n:${figuras.length}">${figuras.join('')}</div>`;
  return `<div class="par-cards">${cartoesHtml(modelo, grupos, ajuda)}</div>
    <div class="par-caixa" data-totais="${esc(JSON.stringify(totaisPorGrupo(modelo, ajuda)))}"><h3 class="par-h">${esc(modelo.rotulo ?? modelo.cargo.nome)}: composição</h3>${hemiciclos}${legendaGrupos(porPartido ? grupos.filter((g) => g.id !== 'outros') : grupos, ajuda)}${chavesHtml(vivo, ajuda)}
    <p class="par-nota">${fmtInt(confirmadas)} confirmadas pelo TSE em 2026${modelo.cargo.codigo === 5 ? ' (inclui as 27 cadeiras fora de disputa em 2026)' : ''}.${porPartido ? ' Os demais partidos aparecem com a cor própria nos hemiciclos.' : ''}</p>${parcial}</div>${extra}`;
}

// Câmara: maiores bancadas e números de governabilidade (maioria simples 257, 3/5 para emenda constitucional 308).
function bancadasHtml(modelo, { esc, fmtInt, corPartido }) {
  const lista = Object.entries(modelo.atual.porPartido).sort((a, b) => b[1] - a[1]);
  if (!lista.length) return '';
  const maior = lista[0][1];
  const barras = lista.slice(0, 5).map(([sigla, n]) =>
    `<div class="par-linha"><span>${esc(sigla)}</span><div><i style="width:${(100 * n) / maior}%;background:${corPartido(sigla)}"></i></div><b>${fmtInt(n)}</b></div>`).join('');
  const total = somaValores(modelo.atual.porPartido);
  const efetivo = total ? 1 / lista.reduce((s, [, n]) => s + (n / total) ** 2, 0) : 0;
  const b = modelo.atual.blocos;
  return `<div class="par-duas"><div class="par-caixa"><h3 class="par-h">Maiores bancadas</h3>${barras}</div>
    <div class="par-caixa"><h3 class="par-h">Governabilidade</h3><p class="par-lista">Maioria simples: <b>257</b><br>Quórum de emenda (3/5): <b>308</b><br>
    Nº efetivo de partidos: <b>${efetivo.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}</b><br>
    Esquerda + Centrão: <b>${fmtInt(b.esquerda + b.centrao)}</b> · Direita + Centrão: <b>${fmtInt(b.direita + b.centrao)}</b></p></div></div>`;
}

// Série da participação de cada grupo nas cadeiras (% do total definido), incluindo 2026.
export function serieHtml(modelo, ajuda) {
  const { esc } = ajuda;
  const modo = modoDe(ajuda);
  const pontos = modelo.series.map((s) => ({ ano: s.ano, grupos: agrupar(s.porPartido, modo), total: somaValores(s.porPartido) }));
  const definidas = modelo.vivo.definidas;
  if (definidas > 0) pontos.push({ ano: 2026, grupos: agrupar(modelo.atual.porPartido, modo), total: definidas, parcial: modelo.vivo.pendentes > 0 });
  if (pontos.length < 2) return '<div class="par-caixa"><p class="par-nota">Sem pontos suficientes para a série.</p></div>';
  // Por ideologia, os três blocos que se opõem; por partido, os seis maiores no último ponto.
  const ultimo = pontos[pontos.length - 1];
  const ids = modo === 'partido'
    ? Object.entries(ultimo.grupos).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id)
    : ORDEM_BLOCOS.filter((id) => id !== 'independente');
  const pct = (p, id) => (100 * (p.grupos[id] ?? 0)) / p.total;
  const W = 560; const H = 250; const e = 40; const d = 30; const t = 16; const b = 32;
  const x = (i) => e + (i * (W - e - d)) / (pontos.length - 1);
  const maior = Math.max(...pontos.flatMap((p) => ids.map((id) => pct(p, id))));
  const teto = Math.max(20, Math.ceil((maior + 4) / 20) * 20); // o eixo cresce se algum grupo passar de 56%
  const y = (v) => t + (H - t - b) * (1 - v / teto);
  const grade = Array.from({ length: teto / 20 + 1 }, (_, i) => i * 20).map((v) => `<line x1="${e}" x2="${W - d}" y1="${y(v)}" y2="${y(v)}" class="par-grade"/><text x="${e - 6}" y="${y(v) + 4}" class="par-eixo" text-anchor="end">${v}%</text>`).join('');
  const anos = pontos.map((p, i) => `<text x="${x(i)}" y="${H - 10}" class="par-eixo" text-anchor="middle">${p.ano}${p.parcial ? '*' : ''}</text>`).join('');
  const linhas = ids.map((id) => {
    const g = infoGrupo(id, modo, ajuda);
    const xs = pontos.map((p, i) => [x(i), y(pct(p, id)), Math.round(pct(p, id))]);
    const rotulo = ([px, py, v], i) => (modo === 'partido' && i < xs.length - 1 ? '' : `<text x="${px}" y="${py - 8}" class="par-eixo" text-anchor="middle">${v}%</text>`);
    return `<polyline fill="none" stroke="${g.cor}" stroke-width="2.5" points="${xs.map(([px, py]) => `${px},${py}`).join(' ')}"/>
      ${xs.map((pt, i) => `<circle cx="${pt[0]}" cy="${pt[1]}" r="3.5" fill="${g.cor}"/>${rotulo(pt, i)}`).join('')}`;
  }).join('');
  const nota = pontos.some((p) => p.parcial) ? '<p class="par-nota">* 2026 parcial: participação entre as cadeiras já definidas.</p>' : '';
  return `<div class="par-caixa"><h3 class="par-h">${esc(modelo.rotulo ?? modelo.cargo.nome)}: participação ${modo === 'partido' ? 'dos maiores partidos' : 'de cada bloco'} nas cadeiras</h3>
    <svg class="par-serie" viewBox="0 0 ${W} ${H}" role="img" aria-label="Série histórica">${grade}${anos}${linhas}</svg>${legendaGrupos(ids.map((id) => infoGrupo(id, modo, ajuda)), ajuda)}${nota}</div>`;
}

// Mapa meio a meio: cada UF é dividida ao meio (esquerda = eleição anterior, direita = 2026); uma cor só se não mudou.
export function estadosHtml(modelo, ajuda) {
  const { esc, nomeUf, mapa, rotulos } = ajuda;
  if (!modelo.estados) return '';
  const modo = modoDe(ajuda);
  const cor = (id) => (id ? infoGrupo(id, modo, ajuda).cor : 'var(--vazio)');
  const nome = (id) => (id ? infoGrupo(id, modo, ajuda).nome : 'sem dado');
  const anos = modelo.cargo.anos;
  const anterior = anos[anos.length - 1];
  const lider = (s, ano) => blocoDaBancada(s.bancadas[ano] ?? {}, modo);
  const porUf = new Map(modelo.estados.map((s) => [s.uf, s]));
  const defs = ['<clipPath id="par-dir" clipPathUnits="objectBoundingBox"><rect x="0.5" y="0" width="0.5" height="1"/></clipPath>']; // metade direita de cada UF
  const padroes = new Map(); // uma trama listrada por cor
  const padraoListrado = (corLista) => {
    if (!padroes.has(corLista)) {
      padroes.set(corLista, `par-lis-${padroes.size}`);
      defs.push(`<pattern id="par-lis-${padroes.size - 1}" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><rect width="3.5" height="7" style="fill:${corLista}"/></pattern>`);
    }
    return padroes.get(corLista);
  };
  const formas = Object.entries(mapa.ufs).map(([uf, forma]) => {
    const s = porUf.get(uf);
    if (!s) return `<g class="uf inativa"><path d="${forma.d}"/></g>`;
    const a = lider(s, anterior);
    const d = lider(s, 2026);
    // Meio a meio quando mudou, e também quando 2026 ainda não está definido (metade da cor de 2022, metade cinza). A metade
    // de 2026 conta o que o TSE já publicou: cor cheia (eleito), clara (na frente com mais de 50%, pode fechar no 1º turno) ou
    // listrada (na frente com 50% ou menos, ou 2º turno confirmado).
    const sit = s.situacao;
    const listrado = Boolean(d) && (sit === 'segundo-turno' || sit === 'provavel-2t');
    const claro = Boolean(d) && sit === 'provavel-1t';
    const fill = !listrado && (a === d || (!a && !d)) ? cor(d ?? a) : `url(#par-${uf})`;
    if (fill.startsWith('url')) {
      defs.push(`<linearGradient id="par-${uf}" x1="0" x2="1" y1="0" y2="0"><stop offset="0.5" style="stop-color:${cor(a)}"/><stop offset="0.5" style="stop-color:${listrado ? 'var(--vazio)' : cor(d)}${claro ? ';stop-opacity:0.55' : ''}"/></linearGradient>`);
    }
    const mudou = d && a !== d;
    const dica = `${nomeUf(uf)}: ${nome(a)} (${anterior}) → ${d ? `${nome(d)} (2026 · ${DESCRICAO_SITUACAO[sit] ?? 'parcial'})` : '2026 ainda não definido'}`;
    const listras = listrado ? `<path class="par-lis" d="${forma.d}" clip-path="url(#par-dir)" style="fill:url(#${padraoListrado(cor(d))})"/>` : '';
    return `<g class="uf par-uf${mudou ? ' virou' : ''}"><path d="${forma.d}" style="fill:${fill}${!mudou && claro ? ';fill-opacity:0.6' : ''}"><title>${esc(dica)}</title></path>${listras}</g>`;
  }).join('');
  const valido = (id) => id && id !== DISPUTADO.id;
  const viradas = modelo.estados.filter((s) => valido(lider(s, 2026)) && valido(lider(s, anterior)) && lider(s, 2026) !== lider(s, anterior));
  const bastioes = modelo.estados.filter((s) => anos.every((ano) => valido(lider(s, ano)) && lider(s, ano) === lider(s, anos[0])) && (!lider(s, 2026) || lider(s, 2026) === lider(s, anos[0])));
  const itemV = (s) => `<div class="par-vira"><b>${esc(s.uf.toUpperCase())}</b> <span style="color:${cor(lider(s, anterior))}">${esc(nome(lider(s, anterior)))}</span> → <span style="color:${cor(lider(s, 2026))}">${esc(nome(lider(s, 2026)))}</span>${s.provisorio ? ' <small>(parcial)</small>' : ''}</div>`;
  // Legenda: os quatro blocos; por partido, os que aparecem no mapa, do mais frequente para o menos.
  let legenda = GRUPOS;
  if (modo === 'partido') {
    const freq = {};
    for (const s of modelo.estados) for (const ano of [anterior, 2026]) { const id = lider(s, ano); if (valido(id)) freq[id] = (freq[id] ?? 0) + 1; }
    legenda = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => infoGrupo(id, modo, ajuda));
  }
  const alvoCor = modo === 'partido' ? 'do partido' : 'do bloco';
  const regra = `Cada UF recebe a cor ${alvoCor} do governador. Em 2026: cor cheia = eleito; clara = na frente com mais de 50% dos válidos (pode fechar no 1º turno); listrada = na frente com 50% ou menos, ou 2º turno.`;
  return `<div class="par-estados"><div class="par-caixa"><h3 class="par-h">${esc(modelo.rotulo ?? modelo.cargo.nome)}: ${anterior} → 2026</h3>
      <svg class="par-mapa" viewBox="0 0 ${mapa.largura} ${mapa.altura}" role="img" aria-label="Mapa de UFs por ${modo === 'partido' ? 'partido' : 'bloco'}"><defs>${defs.join('')}</defs>${formas}<g class="rotulos">${rotulos}</g></svg>
      ${legendaGrupos([...legenda, PENDENTE], ajuda, `<span class="par-meio"><i></i>${anterior} | 2026</span>`)}
      ${legendaGrupos(LEGENDA_SITUACAO, ajuda)}
      <p class="par-nota">${esc(regra)} Esquerda da UF = ${anterior}; direita = 2026.</p></div>
    <div><div class="par-caixa"><h3 class="par-h">Viradas (${viradas.length})</h3>${viradas.map(itemV).join('') || '<p class="par-nota">Nenhuma até agora.</p>'}</div>
    <div class="par-caixa"><h3 class="par-h">Bastiões (mesmo ${modo === 'partido' ? 'partido' : 'bloco'} desde ${anos[0]})</h3><div>${bastioes.map((s) => `<span class="par-tag" style="border-color:${cor(lider(s, anos[0]))}">${esc(s.uf.toUpperCase())}</span>`).join('') || '<p class="par-nota">Nenhum.</p>'}</div></div></div></div>`;
}

export const MODOS = [{ id: 'ideologia', nome: 'Ideologia' }, { id: 'partido', nome: 'Partido' }];
// Endereço da visão Análise (#/cargo/uf/analise/aba/partido): a análise Placar e o agrupamento por ideologia são o padrão e
// não vão no endereço. A UF só conta no deputado estadual; nos outros cargos é "br".
export const hashPartidos = (cargo, aba, agrupar, uf, partido = null) => {
  const ufs = cargoPartidos(cargo)?.ufs;
  const ufDe = ufs ? (uf && uf in ufs ? uf : Object.keys(ufs)[0]) : 'br';
  return `#/${cargo}/${ufDe}/analise${aba && aba !== 'placar' ? `/${aba}` : ''}${aba === 'foco' && partido ? `/p-${partido}` : ''}${agrupar === 'partido' ? '/partido' : ''}`;
};

// Endereços de versões anteriores (#/partidos/..., #/1/br/comparativo/...) viram os atuais (#/cargo/uf/analise/...);
// null se `hash` não for um deles. `periodoPadrao` é o período do comparativo quando o endereço antigo não trazia um.
export function hashAntigoParaNovo(hash, periodoPadrao) {
  const comp = /^#\/(?:partidos\/1\/comparativo|1\/([a-z]{2})\/comparativo)(?:\/(\d{4}x\d{4}))?(?:\/([a-z]{2}))?$/.exec(hash);
  if (comp) return `#/1/${comp[1] ?? comp[3] ?? 'br'}/analise/${comp[2] ?? periodoPadrao}`;
  const p = /^#\/partidos(?:\/(\d+))?(?:\/([a-z]+))?((?:\/[a-z0-9-]+)*)$/.exec(hash);
  if (!p) return null;
  const cargo = Number(p[1]) || 6;
  if (cargo === 1) return `#/1/br/analise/${periodoPadrao}`;
  const extras = p[3].split('/').filter(Boolean);
  const uf = extras.find((t) => /^[a-z]{2}$/.test(t)) ?? (cargo === 7 ? 'sp' : 'br');
  return hashPartidos(cargo, p[2], extras.includes('partido') ? 'partido' : 'ideologia', uf);
}

// Página inteira: seletor de UF (deputado estadual), de análise e de agrupamento, e o conteúdo da análise. O cargo vem do
// menu principal. Os controles são links.
export function partidosHtml(modelo, ui, ajuda) {
  const { esc } = ajuda;
  const modo = ui.agrupar === 'partido' ? 'partido' : 'ideologia';
  const aba = abasDoCargo(modelo.cargo.codigo).some((a) => a.id === ui.aba) ? ui.aba : 'placar';
  const foco = aba === 'foco';
  const agrupar = MODOS.map((m) =>
    `<a class="aba" href="${hashPartidos(modelo.cargo.codigo, aba, m.id, modelo.uf)}" ${m.id === modo ? 'aria-current="page"' : ''}>${esc(m.nome)}</a>`).join('');
  const abas = abasDoCargo(modelo.cargo.codigo).map((a) =>
    `<a class="aba" href="${hashPartidos(modelo.cargo.codigo, a.id, modo, modelo.uf, ui.partido)}" ${a.id === aba ? 'aria-current="page"' : ''}>${esc(a.nome)}</a>`).join('');
  const aj = { ...ajuda, modo };
  const corpo = foco
    ? focoHtml(modelo, ui, aj)
    : !modelo.historico && aba !== 'placar'
      ? '<p class="aviso-bloco espera">Dados de eleições anteriores não carregados (rode <code>node scripts/gerar-eleitos.js</code>).</p>'
      : { placar: placarHtml, serie: serieHtml }[aba](modelo, aj);
  // Os três seletores na mesma linha (quebra em telas estreitas); o agrupamento fica na ponta direita.
  const ufs = modelo.cargo.ufs
    ? `<div class="seg seg-modelo" role="group" aria-label="UF">${(ui.ufs ?? Object.keys(modelo.cargo.ufs)).map((u) =>
      `<a class="aba" href="${hashPartidos(modelo.cargo.codigo, aba, modo, u)}" ${u === modelo.uf ? 'aria-current="page"' : ''}>${esc(u.toUpperCase())}</a>`).join('')}</div>`
    : '';
  return `<div class="par-topo">${ufs}
    <div class="seg seg-modelo" role="group" aria-label="Análise">${abas}</div>
    ${foco ? '' : `<div class="par-agrupar"><span>Agrupar por</span><div class="seg seg-modelo" role="group" aria-label="Agrupar por">${agrupar}</div></div>`}</div>${corpo}
    ${foco ? '' : '<p class="par-nota par-rodape">Os blocos seguem a classificação editorial de ideologia.js (simplificação, não dado oficial).</p>'}`;
}
