// Mapa de cadeiras (hemiciclo) da Câmara e do Senado. Cada cadeira é um ponto; os pontos são ordenados de
// esquerda para direita por ideologia e, dentro dela, por tamanho da bancada, de modo que cada partido forma uma
// fatia. Cadeiras ainda sem eleito ficam cinza e vão para a ponta direita. Sem DOM: devolve texto HTML/SVG.

import { GRUPOS, grupoDoPartido, grupoPorId } from './ideologia.js';

const MARGEM = 22; // folga em volta do desenho para os pontos das bordas não serem cortados
const LARGURA = 600;
const ALTURA = 322;
const RAIO_EXTERNO = 290;
const RAIO_INTERNO = 112;
const CENTRO = { x: LARGURA / 2, y: ALTURA - 24 };

// Posições dos n pontos num semicírculo, em filas concêntricas, da esquerda para a direita (por ângulo).
// Escolhe o número de filas em que o espaço entre pontos da mesma fila e entre filas fica mais parecido.
export function posicoesHemiciclo(n) {
  if (n <= 0) return { pontos: [], raio: 0 };
  let melhor = null;
  for (let filas = 1; filas <= 16; filas += 1) {
    const passo = filas > 1 ? (RAIO_EXTERNO - RAIO_INTERNO) / (filas - 1) : 0;
    const raios = Array.from({ length: filas }, (_, i) => RAIO_EXTERNO - i * passo);
    const soma = raios.reduce((s, r) => s + r, 0);
    const arco = (Math.PI * soma) / n;
    const folga = filas > 1 ? Math.abs(arco - passo) : Infinity;
    if (!melhor || folga < melhor.folga) melhor = { filas, raios, soma, arco, passo, folga };
  }
  const { raios, soma, arco, passo } = melhor;

  const porFila = raios.map((r) => Math.round((n * r) / soma));
  porFila[0] += n - porFila.reduce((s, q) => s + q, 0); // acerta o arredondamento na fila de fora

  const pontos = [];
  raios.forEach((r, fila) => {
    const q = porFila[fila];
    for (let j = 0; j < q; j += 1) {
      const angulo = q === 1 ? Math.PI / 2 : Math.PI - (j * Math.PI) / (q - 1);
      pontos.push({ angulo, x: CENTRO.x + r * Math.cos(angulo), y: CENTRO.y - r * Math.sin(angulo), r });
    }
  });
  pontos.sort((a, b) => b.angulo - a.angulo || a.r - b.r);
  const lado = melhor.filas > 1 ? Math.min(arco, passo) : arco;
  return { pontos, raio: Math.max(2, Math.min(lado * 0.42, 16)) };
}

// Entrega um ponto a cada cadeira. Só ordenar por ângulo espalha um partido pequeno por fileiras diferentes (pontos de
// ângulo parecido, mas longe um do outro). Aqui o hemiciclo é percorrido em faixas verticais, da esquerda para a
// direita, e o sentido alterna a cada faixa (de dentro para fora, depois de fora para dentro): duas cadeiras
// seguidas na ordem de exibição ficam sempre vizinhas, então cada partido forma um bloco de uma cor só.
export function ordemSerpentina(pontos) {
  if (!pontos.length) return [];
  const raioMax = Math.max(...pontos.map((p) => p.r));
  const faixas = pontos.filter((p) => p.r === raioMax).length; // a fila de fora define a largura de cada faixa
  const faixaDe = (p) => Math.min(faixas - 1, Math.floor(((Math.PI - p.angulo) / Math.PI) * faixas));
  return [...pontos].sort((a, b) => {
    const fa = faixaDe(a);
    const fb = faixaDe(b);
    if (fa !== fb) return fa - fb;
    return fa % 2 === 0 ? a.r - b.r : b.r - a.r;
  });
}

// `partidos`: { sigla: { eleitos, ocupadas } } → bancadas em ordem de exibição, com o grupo de cada uma.
export function ordenarBancadas(partidos) {
  const ordemGrupo = new Map(GRUPOS.map((g, i) => [g.id, i]));
  return Object.entries(partidos)
    .map(([sigla, { eleitos = 0, ocupadas = 0, lideres = 0, pessoasEleitas = [], pessoasOcupadas = [], pessoasLideres = [] }]) =>
      ({ sigla, eleitos, ocupadas, lideres, pessoasEleitas, pessoasOcupadas, pessoasLideres, total: eleitos + ocupadas + lideres, grupo: grupoDoPartido(sigla) }))
    .filter((b) => b.total > 0)
    .sort((a, b) => ordemGrupo.get(a.grupo) - ordemGrupo.get(b.grupo) || b.total - a.total || a.sigla.localeCompare(b.sigla, 'pt-BR'));
}

// Uma entrada por cadeira, na ordem em que serão distribuídas pelo hemiciclo.
export function listarCadeiras(bancadas, pendentes) {
  const cadeiras = [];
  for (const b of bancadas) {
    for (let i = 0; i < b.ocupadas; i += 1) cadeiras.push({ sigla: b.sigla, grupo: b.grupo, ocupada: true, pessoa: b.pessoasOcupadas[i] });
    for (let i = 0; i < b.eleitos; i += 1) cadeiras.push({ sigla: b.sigla, grupo: b.grupo, ocupada: false, pessoa: b.pessoasEleitas[i] });
    for (let i = 0; i < b.lideres; i += 1) cadeiras.push({ sigla: b.sigla, grupo: b.grupo, ocupada: false, lider: true, pessoa: b.pessoasLideres[i] });
  }
  for (let i = 0; i < pendentes; i += 1) cadeiras.push({ sigla: null, grupo: null, ocupada: false });
  return cadeiras;
}

// Texto do hover: "Nome (UF) · PARTIDO". Sem o nome (ainda não carregou), só o partido.
const dicaCadeira = (c) => {
  const quem = c.pessoa ? `${c.pessoa.nome}${c.pessoa.uf ? ` (${c.pessoa.uf.toUpperCase()})` : ''} · ` : '';
  return `${quem}${c.sigla}${c.lider ? ' · na frente, ainda não eleito' : ''}${c.pessoa?.inferido ? ' · vaga do partido, nome pelo ranking da lista' : ''}`;
};

const somar = (bancadas, filtro) => bancadas.filter(filtro).reduce((s, b) => s + b.total, 0);

// `dados`: { titulo, unidade, total, pendentes, partidos, ocupadas (bool: há cadeiras fora de disputa) }
// `ui`: { modo: 'partido' | 'ideologia', foco: null | { tipo: 'g' | 'p', id } }
// `ajuda`: { esc, corPartido, fmtInt }
export function cadeirasHtml(dados, ui, { esc, corPartido, fmtInt }) {
  const bancadas = ordenarBancadas(dados.partidos);
  const cadeiras = listarCadeiras(bancadas, dados.pendentes);
  const { pontos: posicoes, raio } = posicoesHemiciclo(cadeiras.length);
  const pontos = ordemSerpentina(posicoes);
  const definidas = cadeiras.filter((c) => c.sigla && !c.lider).length;
  const naFrente = cadeiras.filter((c) => c.lider).length;
  const foco = ui.foco;

  // Por ideologia, sem foco, cada cadeira leva a cor do grupo; ao abrir um grupo (ou um partido), a cor do partido.
  const corCadeira = (c) => {
    if (!c.sigla) return null;
    return ui.modo === 'ideologia' && !foco ? grupoPorId(c.grupo).cor : corPartido(c.sigla);
  };
  const noFoco = (c) => {
    if (!foco) return true;
    if (!c.sigla) return false;
    return foco.tipo === 'g' ? c.grupo === foco.id : c.sigla === foco.id;
  };

  const circulos = cadeiras.map((c, i) => {
    const p = pontos[i];
    const cor = corCadeira(c);
    const r = raio;
    const rotulo = c.sigla ? dicaCadeira(c) : 'Em apuração';
    // Na frente (ainda não eleito): só o contorno na cor do partido.
    const estilo = [
      c.lider ? `fill:color-mix(in srgb, ${cor} 12%, var(--surface));stroke:${cor};stroke-width:2.2` : (cor ? `fill:${cor}` : ''), noFoco(c) ? '' : 'opacity:.14'].filter(Boolean).join(';');
    return `<circle class="${c.sigla ? 'cad' : 'cad vaga'}" data-dica="${esc(rotulo)}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" ${estilo ? `style="${estilo}"` : ''}></circle>`;
  }).join('');

  // Texto no vão central: o foco, ou o total de cadeiras definidas.
  const focoBancadas = foco && bancadas.filter((b) => (foco.tipo === 'g' ? b.grupo === foco.id : b.sigla === foco.id));
  const focoTotal = focoBancadas?.reduce((s, b) => s + b.total, 0) ?? 0;
  const focoNome = foco && (foco.tipo === 'g' ? grupoPorId(foco.id).nome : foco.id);
  const centro = foco
    ? `<text class="cad-num" x="${CENTRO.x}" y="${CENTRO.y - 34}">${fmtInt(focoTotal)}</text><text class="cad-leg" x="${CENTRO.x}" y="${CENTRO.y - 8}">${esc(focoNome)}</text>`
    : `<text class="cad-num" x="${CENTRO.x}" y="${CENTRO.y - 34}">${fmtInt(definidas)}</text><text class="cad-leg" x="${CENTRO.x}" y="${CENTRO.y - 8}">de ${fmtInt(cadeiras.length)} definidas</text>`;

  // `alvo` é o foco que o clique escolhe (vazio = sem foco).
  const chip = (alvo, nome, cor, n, ativo) =>
    `<button type="button" class="cad-chip" data-cad-foco="${esc(alvo)}" aria-pressed="${ativo}" style="--cor:${cor}"><i></i>${esc(nome)} <b>${fmtInt(n)}</b></button>`;

  const grupoAberto = ui.modo === 'ideologia'
    ? (foco?.tipo === 'g' ? foco.id : bancadas.find((b) => foco?.tipo === 'p' && b.sigla === foco.id)?.grupo)
    : null;
  let legenda;
  if (ui.modo === 'ideologia' && !grupoAberto) {
    legenda = GRUPOS.map((g) => ({ g, n: somar(bancadas, (b) => b.grupo === g.id) }))
      .filter(({ n }) => n > 0)
      .map(({ g, n }) => chip(`g:${g.id}`, g.nome, g.cor, n, false)).join('');
  } else {
    // Partidos: todos (por partido) ou só os do grupo aberto (por ideologia). Clicar no que está aberto desfaz o foco.
    const desfazer = ui.modo === 'ideologia' ? `g:${grupoAberto}` : '';
    legenda = bancadas.filter((b) => !grupoAberto || b.grupo === grupoAberto)
      .map((b) => (foco?.tipo === 'p' && foco.id === b.sigla
        ? chip(desfazer, b.sigla, corPartido(b.sigla), b.total, true)
        : chip(`p:${b.sigla}`, b.sigla, corPartido(b.sigla), b.total, false))).join('');
  }

  const modo = (id, rotulo) => `<button type="button" data-cad-modo="${id}" aria-pressed="${ui.modo === id}">${rotulo}</button>`;
  const voltar = foco
    ? `<button type="button" class="cad-voltar" data-cad-foco="">← ${ui.modo === 'ideologia' ? 'Todos os grupos' : 'Todos os partidos'}</button>`
    : '';

  const frente = naFrente
    ? `<p class="muted pequeno">Contorno: ${fmtInt(naFrente)} cadeiras em que o candidato ainda não foi eleito, mas está entre os mais votados da UF neste momento (tantos quantas forem as vagas). Pode mudar até a totalização.</p>`
    : '';
  const inferidas = bancadas.reduce((n, b) => n + b.pessoasEleitas.filter((x) => x.inferido).length, 0);
  const porVaga = inferidas
    ? `<p class="muted pequeno">${fmtInt(inferidas)} cadeiras já foram atribuídas a um partido pelo TSE (campo de vagas conquistadas), mas o candidato eleito ainda não foi marcado. O nome no hover vem do ranking de votos da lista e pode mudar.</p>`
    : '';
  const aviso = definidas === 0
    ? `<p class="muted pequeno">Nenhum eleito ainda: as cadeiras cinza serão preenchidas conforme o TSE totalizar os votos.</p>`
    : '';
  const ocupadas = dados.ocupadas
    ? `<p class="muted pequeno">${fmtInt(bancadas.reduce((s, b) => s + b.ocupadas, 0))} cadeiras estão fora de disputa em 2026 (eleitas em 2022) e já aparecem preenchidas, com o partido atual de cada senador.</p>`
    : '';
  const naoDefinido = ui.modo === 'ideologia' && bancadas.some((b) => b.grupo === 'independente' && b.sigla !== 'S/PARTIDO')
    ? '<p class="muted pequeno">“Independente” reúne senadores sem partido e partidos que a classificação do painel não cobre.</p>' : '';

  return `<section class="cadeiras" aria-label="${esc(dados.titulo)}">
    <div class="cad-topo">
      <h3 class="secao">${esc(dados.titulo)}</h3>
      <div class="gr-seg" role="group" aria-label="Agrupar cadeiras">${modo('partido', 'Por partido')}${modo('ideologia', 'Por ideologia')}</div>
    </div>
    <div class="cad-dica" hidden></div>
    <svg class="cad-svg" viewBox="${-MARGEM} ${-MARGEM} ${LARGURA + 2 * MARGEM} ${ALTURA + 2 * MARGEM}" role="img" aria-label="${esc(`${dados.titulo}: ${definidas} de ${cadeiras.length} cadeiras definidas`)}">${circulos}${centro}</svg>
    <div class="cad-legenda">${voltar}${legenda}</div>
    ${aviso}${porVaga}${frente}${ocupadas}${naoDefinido}
  </section>`;
}

// Liga os cliques do mapa de cadeiras (modo e drill-down) ao estado da interface.
export function ligarCadeiras(raiz, ui, aoMudar) {
  // Dica própria: a nativa (title) demora quase um segundo para aparecer.
  const caixa = raiz.querySelector('.cad-dica');
  const svg = raiz.querySelector('.cad-svg');
  if (caixa && svg) {
    svg.addEventListener('mousemove', (e) => {
      const alvo = e.target.closest?.('circle[data-dica]');
      if (!alvo) { caixa.hidden = true; return; }
      const area = caixa.parentElement.getBoundingClientRect();
      caixa.textContent = alvo.dataset.dica;
      caixa.hidden = false;
      const x = Math.min(e.clientX - area.left + 12, area.width - caixa.offsetWidth - 4);
      caixa.style.left = `${Math.max(4, x)}px`;
      caixa.style.top = `${e.clientY - area.top - caixa.offsetHeight - 14}px`;
    });
    svg.addEventListener('mouseleave', () => { caixa.hidden = true; });
  }
  raiz.querySelectorAll('[data-cad-modo]').forEach((b) => b.addEventListener('click', () => {
    ui.modo = b.dataset.cadModo;
    ui.foco = null;
    aoMudar();
  }));
  raiz.querySelectorAll('[data-cad-foco]').forEach((b) => b.addEventListener('click', () => {
    const [tipo, ...resto] = b.dataset.cadFoco.split(':');
    const id = resto.join(':');
    ui.foco = tipo && id ? { tipo, id } : null;
    aoMudar();
  }));
}
