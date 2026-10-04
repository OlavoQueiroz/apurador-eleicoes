// Aba "Partidos": bancadas por bloco ideológico e por partido, comparadas com as eleições anteriores. Sem DOM: o modelo
// é montado a partir de dados puros e as funções devolvem texto HTML/SVG (como cadeiras.js). A classificação dos
// partidos em blocos é a de ideologia.js, uma simplificação editorial.

import { GRUPOS, grupoDoPartido, grupoPorId } from './ideologia.js';
import { ordemSerpentina, posicoesHemiciclo } from './cadeiras.js';

// Cargos da aba. `chave` é a do arquivo dados-historicos/eleitos.json; `anos`, as eleições com bancada conhecida (no
// Senado, a bancada de um ano soma os eleitos dele e os de quatro anos antes, então 2014 fica de fora).
export const CARGOS_PARTIDOS = [
  { codigo: 5, chave: 'senador', nome: 'Senado', total: 81, anos: [2018, 2022], mapa: false },
  { codigo: 6, chave: 'deputadoFederal', nome: 'Câmara', total: 513, anos: [2014, 2018, 2022], mapa: true },
  { codigo: 3, chave: 'governador', nome: 'Governadores', total: 27, anos: [2014, 2018, 2022], mapa: true },
];
export const cargoPartidos = (codigo) => CARGOS_PARTIDOS.find((c) => c.codigo === Number(codigo));

export const ABAS = [
  { id: 'placar', nome: 'Placar' },
  { id: 'ganhos', nome: 'Ganhos e perdas' },
  { id: 'estados', nome: 'Viradas por estado' },
  { id: 'serie', nome: 'Série histórica' },
];
export const abasDoCargo = (cargo) => ABAS.filter((a) => a.id !== 'estados' || cargo.mapa);

export const DISPUTADO = { id: 'disputado', nome: 'Disputado', cor: '#b8bec9' };
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

// Partidos dos eleitos de uma eleição: { partido: cadeiras }. Null se o ano não existe no arquivo.
export function eleitosPorPartido(historico, ano, chave) {
  const dados = historico?.anos?.[ano]?.[chave];
  if (!dados) return null;
  const saida = {};
  if (chave === 'governador') for (const sigla of Object.values(dados)) soma(saida, sigla);
  else if (chave === 'senador') for (const siglas of Object.values(dados)) for (const sigla of siglas) soma(saida, sigla);
  else for (const u of Object.values(dados)) for (const [sigla, n] of Object.entries(u)) soma(saida, sigla, n);
  return saida;
}

const juntar = (a, b) => {
  const saida = { ...a };
  for (const [sigla, n] of Object.entries(b)) soma(saida, sigla, n);
  return saida;
};

// Bancada logo depois da eleição de `ano`. No Senado são os eleitos de `ano` mais os de quatro anos antes.
export function bancadaDoAno(historico, ano, chave) {
  const atual = eleitosPorPartido(historico, ano, chave);
  if (!atual) return null;
  if (chave !== 'senador') return atual;
  const anterior = eleitosPorPartido(historico, ano - 4, chave);
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
export function aoVivo(cargo, itens, ocupadas = []) {
  const confirmados = {};
  const naFrente = {};
  const porUf = {};
  let vagas = 0;
  for (const item of itens) {
    const c = item.eleitosPorPartido ?? {};
    const f = {};
    if (cargo.codigo === 6) {
      for (const [sigla, n] of Object.entries(item.cadeirasPorPartido ?? c)) if (n > (c[sigla] ?? 0)) f[sigla] = n - (c[sigla] ?? 0);
    } else {
      const abertas = Math.max(0, item.vagas - somaValores(c));
      for (const cand of (item.colocados ?? []).filter((x) => x.situacao !== 'eleito' && x.votos > 0).slice(0, abertas)) soma(f, cand.partido);
    }
    for (const [s, n] of Object.entries(c)) soma(confirmados, s, n);
    for (const [s, n] of Object.entries(f)) soma(naFrente, s, n);
    porUf[item.uf] = { confirmados: c, naFrente: f, vagas: item.vagas };
    vagas += item.vagas;
  }
  const fixas = {};
  for (const o of ocupadas) soma(fixas, o.partido);
  const total = itens.length ? vagas + ocupadas.length : cargo.total;
  const definidas = somaValores(confirmados) + somaValores(naFrente) + ocupadas.length;
  return { total, confirmados, naFrente, ocupadas: fixas, porUf, definidas, pendentes: Math.max(0, total - definidas) };
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
export function criarModelo({ cargo, historico, itens, ocupadas = [], ufs = [] }) {
  const vivo = aoVivo(cargo, itens, ocupadas);
  const atualPorPartido = unir(vivo.confirmados, vivo.naFrente, vivo.ocupadas);
  const series = cargo.anos
    .map((ano) => ({ ano, porPartido: bancadaDoAno(historico, ano, cargo.chave) }))
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
    return { uf, bancadas, blocos, provisorio: !u || somaValores(u.confirmados) < u.vagas, vagas: u?.vagas ?? 0 };
  });

  return { cargo, historico: Boolean(series.length), vivo, atual: { porPartido: atualPorPartido, blocos: blocosDe(atualPorPartido) }, base, series, estados };
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

// Cadeiras na ordem do hemiciclo: da esquerda para a direita por ideologia; por partido, os partidos de cada bloco juntos.
function cadeirasDoHemiciclo(modelo, ajuda) {
  const modo = modoDe(ajuda);
  const { vivo } = modelo;
  const confirmadas = agrupar(unir(vivo.confirmados, vivo.ocupadas), modo);
  const frente = agrupar(vivo.naFrente, modo);
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
  for (let i = 0; i < vivo.pendentes; i += 1) cadeiras.push({ id: null });
  return cadeiras;
}

function hemiciclo(modelo, ajuda) {
  const { esc, fmtInt } = ajuda;
  const modo = modoDe(ajuda);
  const { vivo } = modelo;
  const cadeiras = cadeirasDoHemiciclo(modelo, ajuda);
  const { pontos: posicoes, raio } = posicoesHemiciclo(cadeiras.length);
  const pontos = ordemSerpentina(posicoes);
  const circulos = cadeiras.map((c, i) => {
    const p = pontos[i];
    if (!c.id) return `<circle class="par-vaga" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${raio.toFixed(1)}"><title>Em apuração</title></circle>`;
    const g = infoGrupo(c.id, modo, ajuda);
    const estilo = c.frente ? `fill="none" stroke="${g.cor}" stroke-width="${Math.max(1.4, raio * 0.35).toFixed(1)}"` : `fill="${g.cor}"`;
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(c.frente ? raio * 0.78 : raio).toFixed(1)}" ${estilo}><title>${esc(g.nome)}${c.frente ? ' · na frente, ainda não eleito' : ''}</title></circle>`;
  }).join('');
  return `<svg class="par-hemi" viewBox="-22 -22 644 366" role="img" aria-label="${esc(`Composição: ${vivo.definidas} de ${vivo.total} cadeiras definidas`)}">${circulos}
    <text class="par-hemi-num" x="300" y="268">${fmtInt(vivo.total)}</text><text class="par-hemi-leg" x="300" y="292">cadeiras${modelo.cargo.codigo === 3 ? ' de governador' : ''}</text></svg>`;
}

function legendaGrupos(grupos, { esc }, extra = '') {
  return `<div class="par-leg">${grupos.map((g) => `<span><i style="background:${g.cor}"></i>${esc(g.nome)}</span>`).join('')}${extra}</div>`;
}

export function placarHtml(modelo, ajuda) {
  const { esc, fmtInt } = ajuda;
  const { vivo, base } = modelo;
  const grupos = gruposDe(modelo, ajuda);
  const cartoes = grupos.map((g) => {
    const d = g.antes === null ? null : g.atual - g.antes;
    const pct = vivo.total ? Math.round((100 * g.atual) / vivo.total) : 0;
    return `<div class="par-card" style="--cor:${g.cor}"><span class="par-card-nome">${esc(g.nome)}</span><b>${fmtInt(g.atual)}</b>
      <span class="par-card-d ${d === null ? '' : classeDelta(d)}">${d === null ? '—' : `${delta(d)} vs ${base.ano}`} · ${pct}%</span></div>`;
  }).join('');
  const parcial = vivo.pendentes > 0
    ? `<p class="par-nota">Apuração em andamento: ${fmtInt(vivo.pendentes)} de ${fmtInt(vivo.total)} cadeiras ainda sem definição. Contorno = vaga na frente, ainda sem eleito marcado pelo TSE.</p>`
    : '';
  const confirmadas = somaValores(unir(vivo.confirmados, vivo.ocupadas));
  const extra = modelo.cargo.codigo === 6 ? bancadasHtml(modelo, ajuda) : '';
  const porPartido = modoDe(ajuda) === 'partido';
  return `<div class="par-cards">${cartoes}</div>
    <div class="par-caixa"><h3 class="par-h">${esc(modelo.cargo.nome)}: composição</h3>${hemiciclo(modelo, ajuda)}${legendaGrupos(porPartido ? grupos.filter((g) => g.id !== 'outros') : grupos, ajuda)}
    <p class="par-nota">${fmtInt(confirmadas)} confirmadas pelo TSE${modelo.cargo.codigo === 5 ? ' (inclui as 27 cadeiras fora de disputa em 2026)' : ''}.${porPartido ? ' Os demais partidos aparecem com a cor própria no hemiciclo.' : ''}</p>${parcial}</div>${extra}`;
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

// Variação de cadeiras em relação à eleição anterior, em barras divergentes: por bloco ou por partido.
export function ganhosHtml(modelo, ajuda) {
  const { esc, fmtInt } = ajuda;
  const modo = modoDe(ajuda);
  if (!modelo.base) return '<p class="par-nota">Sem dados da eleição anterior.</p>';
  let alvo;
  if (modo === 'partido') {
    const atual = agrupar(modelo.atual.porPartido, 'partido');
    const antes = agrupar(modelo.base.porPartido, 'partido');
    const todas = [...new Set([...Object.keys(atual), ...Object.keys(antes)])]
      .map((id) => ({ ...infoGrupo(id, modo, ajuda), d: (atual[id] ?? 0) - (antes[id] ?? 0) })).filter((x) => x.d !== 0)
      .sort((a, b) => b.d - a.d);
    alvo = [...todas.filter((x) => x.d > 0).slice(0, 6), ...todas.filter((x) => x.d < 0).slice(-6)];
  } else {
    alvo = gruposDe(modelo, ajuda).map((g) => ({ ...g, d: g.atual - g.antes })).filter((x) => x.d !== 0);
  }
  if (!alvo.length) return `<div class="par-caixa"><p class="par-nota">Nenhuma variação em relação a ${modelo.base.ano}.</p></div>`;
  const max = Math.max(...alvo.map((x) => Math.abs(x.d)));
  const linhas = alvo.map(({ nome, cor, d }) => `<div class="par-div"><span>${esc(nome)}</span>
    <div class="par-trilho"><i class="${d > 0 ? 'ganho' : 'perda'}" style="--w:${(50 * Math.abs(d)) / max}%;background:${cor}"></i></div>
    <b class="${classeDelta(d)}">${d > 0 ? '+' : ''}${fmtInt(d)}</b></div>`).join('');
  const parcial = modelo.vivo.pendentes > 0 ? ` Parcial: ${fmtInt(modelo.vivo.pendentes)} cadeiras ainda sem definição, então quem tem mais vagas por apurar aparece com perda.` : '';
  const sucessao = modo === 'partido' ? 'Fusões e renomeações entram pela tabela de sucessão (ex.: PMDB → MDB, DEM → UNIÃO).' : 'Os blocos seguem a classificação de ideologia.js.';
  return `<div class="par-caixa"><h3 class="par-h">Variação de cadeiras vs ${modelo.base.ano}, por ${modo === 'partido' ? 'partido' : 'bloco'}</h3>${linhas}
    <p class="par-nota">${esc(sucessao + parcial)}</p></div>`;
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
  return `<div class="par-caixa"><h3 class="par-h">${esc(modelo.cargo.nome)}: participação ${modo === 'partido' ? 'dos maiores partidos' : 'de cada bloco'} nas cadeiras</h3>
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
  const defs = [];
  const formas = Object.entries(mapa.ufs).map(([uf, forma]) => {
    const s = porUf.get(uf);
    if (!s) return `<g class="uf inativa"><path d="${forma.d}"/></g>`;
    const a = lider(s, anterior);
    const d = lider(s, 2026);
    const fill = a === d || !d ? cor(d ?? a) : `url(#par-${uf})`;
    if (fill.startsWith('url')) {
      defs.push(`<linearGradient id="par-${uf}" x1="0" x2="1" y1="0" y2="0"><stop offset="0.5" stop-color="${cor(a)}"/><stop offset="0.5" stop-color="${cor(d)}"${s.provisorio ? ' stop-opacity="0.55"' : ''}/></linearGradient>`);
    }
    const mudou = d && a !== d;
    const dica = `${nomeUf(uf)}: ${nome(a)} (${anterior}) → ${d ? `${nome(d)} (2026${s.provisorio ? ', parcial' : ''})` : '2026 sem dado'}`;
    return `<g class="uf par-uf${mudou ? ' virou' : ''}"><path d="${forma.d}" style="fill:${fill}${!mudou && d && s.provisorio ? ';fill-opacity:0.6' : ''}"><title>${esc(dica)}</title></path></g>`;
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
  const regra = modelo.cargo.codigo === 6
    ? `Cada UF recebe a cor ${alvoCor} com mais cadeiras na bancada; diferença menor que 10% das cadeiras = disputado.`
    : `Cada UF recebe a cor ${alvoCor} do governador (na frente, enquanto não eleito, em tom mais claro).`;
  return `<div class="par-estados"><div class="par-caixa"><h3 class="par-h">${esc(modelo.cargo.nome)}: ${anterior} → 2026</h3>
      <svg class="par-mapa" viewBox="0 0 ${mapa.largura} ${mapa.altura}" role="img" aria-label="Mapa de UFs por ${modo === 'partido' ? 'partido' : 'bloco'}"><defs>${defs.join('')}</defs>${formas}<g class="rotulos">${rotulos}</g></svg>
      ${legendaGrupos([...legenda, DISPUTADO], ajuda, `<span class="par-meio"><i></i>${anterior} | 2026</span>`)}
      <p class="par-nota">${esc(regra)} Esquerda da UF = ${anterior}; direita = 2026.</p></div>
    <div><div class="par-caixa"><h3 class="par-h">Viradas (${viradas.length})</h3>${viradas.map(itemV).join('') || '<p class="par-nota">Nenhuma até agora.</p>'}</div>
    <div class="par-caixa"><h3 class="par-h">Bastiões (mesmo ${modo === 'partido' ? 'partido' : 'bloco'} desde ${anos[0]})</h3><div>${bastioes.map((s) => `<span class="par-tag" style="border-color:${cor(lider(s, anos[0]))}">${esc(s.uf.toUpperCase())}</span>`).join('') || '<p class="par-nota">Nenhum.</p>'}</div></div></div></div>`;
}

export const MODOS = [{ id: 'ideologia', nome: 'Ideologia' }, { id: 'partido', nome: 'Partido' }];
// Endereço de uma visão da aba; o agrupamento por ideologia é o padrão e não vai no endereço.
export const hashPartidos = (cargo, aba, agrupar) => `#/partidos/${cargo}/${aba}${agrupar === 'partido' ? '/partido' : ''}`;

// Página inteira: seletor de cargo, de agrupamento, abas e o conteúdo da aba. Os controles são links.
export function partidosHtml(modelo, ui, ajuda) {
  const { esc } = ajuda;
  const modo = ui.agrupar === 'partido' ? 'partido' : 'ideologia';
  const aba = abasDoCargo(modelo.cargo).some((a) => a.id === ui.aba) ? ui.aba : 'placar';
  const cargos = (ui.cargos ?? CARGOS_PARTIDOS).map((c) =>
    `<a class="par-seg-b" href="${hashPartidos(c.codigo, aba, modo)}" ${c.codigo === modelo.cargo.codigo ? 'aria-current="page"' : ''}>${esc(c.nome)}</a>`).join('');
  const agrupar = MODOS.map((m) =>
    `<a class="par-seg-b" href="${hashPartidos(modelo.cargo.codigo, aba, m.id)}" ${m.id === modo ? 'aria-current="page"' : ''}>${esc(m.nome)}</a>`).join('');
  const abas = abasDoCargo(modelo.cargo).map((a) =>
    `<a class="par-aba" href="${hashPartidos(modelo.cargo.codigo, a.id, modo)}" ${a.id === aba ? 'aria-current="page"' : ''}>${esc(a.nome)}</a>`).join('');
  const aj = { ...ajuda, modo };
  const corpo = !modelo.historico && aba !== 'placar'
    ? '<p class="aviso-bloco espera">Dados de eleições anteriores não carregados (rode <code>node scripts/gerar-eleitos.js</code>).</p>'
    : { placar: placarHtml, ganhos: ganhosHtml, serie: serieHtml, estados: estadosHtml }[aba](modelo, aj);
  return `<div class="par-topo"><div class="par-seg" role="group" aria-label="Cargo">${cargos}</div>
    <div class="par-agrupar"><span>Agrupar por</span><div class="par-seg" role="group" aria-label="Agrupar por">${agrupar}</div></div></div>
    <nav class="par-abas" aria-label="Análises">${abas}</nav>${corpo}
    <p class="par-nota par-rodape">Os blocos seguem a classificação editorial de ideologia.js (simplificação, não dado oficial).</p>`;
}
