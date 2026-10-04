// Painel de apuração: busca /api/*, escuta /events (SSE) e redesenha quando chegam dados novos.

import { MAPA } from './mapa-brasil.js';
import { carregarHistorico, montarGrafico } from './grafico.js';
import { iniciarBusca } from './busca.js';
import { cadeirasHtml, ligarCadeiras } from './cadeiras.js';
import { geometriaUf, resultadosMunicipios, mapaMunicipiosHtml, dicaMunicipioHtml } from './municipios.js';

const UF_NOME = {
  ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal',
  es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul', mt: 'Mato Grosso',
  pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco', pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro',
  rn: 'Rio Grande do Norte', ro: 'Rondônia', rr: 'Roraima', rs: 'Rio Grande do Sul', sc: 'Santa Catarina',
  se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins', br: 'Brasil', zz: 'Exterior',
};

// Posição do rótulo (sistema de coordenadas de mapa-brasil.js) quando o centro da UF não serve: UFs pequenas
// do litoral levam a sigla para o mar, ligada por uma linha ao centro da UF (`guia`); `ancora: 'start'` alinha
// o texto à esquerda, que é o caso dos rótulos que ficam à direita do mapa.
const ROTULOS = {
  rn: { x: 592, y: 170, guia: true, ancora: 'start' },
  pb: { x: 592, y: 193, guia: true, ancora: 'start' },
  pe: { x: 592, y: 216, guia: true, ancora: 'start' },
  al: { x: 592, y: 239, guia: true, ancora: 'start' },
  se: { x: 592, y: 262, guia: true, ancora: 'start' },
  es: { x: 522, y: 384, guia: true, ancora: 'start' },
  rj: { x: 508, y: 426, guia: true, ancora: 'start' },
  df: { x: 385, y: 356, guia: true },
  go: { x: 340, y: 330 },
};
// Espaço à direita do mapa para os rótulos que ficam no mar.
const FOLGA_DIREITA = 40;

// Cores aproximadas; partido sem cor definida ganha uma cor estável derivada do nome.
const CORES = {
  PT: '#d32f2f', PL: '#1e63c9', PSD: '#d99a00', MDB: '#2e9e4f', PP: '#0b7da3', 'UNIÃO': '#0f9aa8',
  REPUBLICANOS: '#3b6fd8', PSB: '#e8641b', PDT: '#b3205f', PSDB: '#2b9bd6', PSOL: '#b58f00', NOVO: '#e67e00',
  PODE: '#31a37e', AVANTE: '#d9611a', SOLIDARIEDADE: '#d98200', 'PC DO B': '#a31621', PCDOB: '#a31621',
  PV: '#2f8f2f', REDE: '#1f9d78', MISSÃO: '#6d4bd1', DC: '#5b8c2a', PCB: '#8c1c1c', PSTU: '#b71c1c',
  PCO: '#7b1fa2', UP: '#d81b60', DEMOCRATA: '#4f7a28', PRD: '#7a5c2e', AGIR: '#3d7ea6', MOBILIZA: '#c25b00',
};

const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

const estado = {
  meta: null,
  resumo: new Map(),
  cargo: 1,
  uf: 'br',
  detalhe: undefined, // undefined = carregando; null = sem dado
  visao: 'apuracao', // 'apuracao' (dados do TSE) ou 'projecao' (estimativa do painel)
  modelo: 'ingenuo',
  projecao: undefined, // mesmo contrato de `detalhe`
  historico: undefined, // histórico gravado da UF aberta: { chave, dados }; undefined = sem gráfico
  mun: undefined, // municípios da UF aberta: { chave, geo, resultados, porCodigo }; undefined = mapa do Brasil
  busca: '',
  destaque: null, // resultado escolhido na busca global: { tipo: 'c' (candidato, por sq) | 'm' (município, por código), id }
  mostrarTodos: false,
  cadeiras: { modo: 'partido', foco: null }, // mapa de cadeiras (Senado e Câmara): agrupamento e drill-down
  eleitos: null, // nomes dos eleitos do cargo aberto no Brasil (hover do mapa de cadeiras): Map partido → [{ nome, uf }]
  senadoOcupadas: null, // 27 cadeiras do Senado fora de disputa em 2026 (public/senado-ocupadas.json)
  conexao: 'conectando',
  ultimoCicloEm: null,
};

// ---------- utilidades ----------

const esc = (valor) =>
  String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtInt = (n) => Number(n ?? 0).toLocaleString('pt-BR');
const fmtPct = (n, casas = 2) =>
  `${Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
const fmtDataHora = (valor) =>
  valor
    ? new Date(valor).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    : '—';

function corPartido(sigla) {
  const chave = String(sigla ?? '').toUpperCase();
  if (CORES[chave]) return CORES[chave];
  let h = 0;
  for (const ch of chave) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 50% 42%)`;
}

const nomeUf = (uf) => UF_NOME[uf] ?? uf.toUpperCase();
const cargoMeta = (codigo = estado.cargo) => estado.meta.cargos.find((c) => c.codigo === codigo);
const ehMajoritario = (codigo) => codigo === 1 || codigo === 3;
const ehProporcional = (codigo) => codigo === 6 || codigo === 7 || codigo === 8;
// Só a presidência tem arquivo nacional; nos outros cargos, "Brasil" soma os resumos das UFs.
const temArquivoNacional = (cargo) => cargo === 1;
const ehAgregado = () => estado.uf === 'br' && !temArquivoNacional(estado.cargo);
const chaveAtual = () => `${estado.cargo}:${estado.uf}`;
const itemResumo = (cargo, uf) => estado.resumo.get(`${cargo}:${uf}`);
// A visão escolhida (apuração ou projeção) acompanha a troca de cargo e de UF.
const hashPara = (cargo, uf, visao = estado.visao, modelo = estado.modelo) =>
  `#/${cargo}/${uf}${visao === 'projecao' ? `/projecao/${modelo}` : ''}`;

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// ---------- carga de dados ----------

async function carregarMeta() {
  estado.meta = await getJson('/api/meta');
  estado.ultimoCicloEm = estado.meta.ultimoCiclo?.terminadoEm ?? null;
}

async function carregarResumo() {
  const { itens } = await getJson('/api/resumo');
  estado.resumo = new Map(itens.map((item) => [item.chave, item]));
}

async function carregarDetalhe() {
  if (ehAgregado()) {
    estado.detalhe = null;
    estado.projecao = null;
    return;
  }
  const chave = `${chaveAtual()}:${estado.visao}:${estado.modelo}`;
  const atual = () => chave === `${chaveAtual()}:${estado.visao}:${estado.modelo}`;
  const url = estado.visao === 'projecao'
    ? `/api/projecao/${estado.modelo}/${estado.cargo}/${estado.uf}`
    : `/api/resultado/${estado.cargo}/${estado.uf}`;
  const campo = estado.visao === 'projecao' ? 'projecao' : 'detalhe';
  try {
    const resposta = await getJson(url);
    if (atual()) estado[campo] = resposta; // descarta resposta de uma seleção já trocada
  } catch {
    if (atual()) estado[campo] = null;
  }
  // Projeção por município: a primeira carga leva alguns segundos, então pergunta de novo até terminar.
  clearTimeout(recarga);
  if (estado.visao === 'projecao' && estado.projecao?.carregando && !estado.projecao.disponivel) {
    recarga = setTimeout(atualizar, 1500);
  }
}
let recarga = null;

// Nomes dos eleitos de cada UF, para o hover do mapa de cadeiras. Só no Brasil de senador e deputado federal.
let chaveEleitos = '';
async function carregarEleitos() {
  if (!ehAgregado() || ![5, 6].includes(estado.cargo)) {
    estado.eleitos = null;
    chaveEleitos = '';
    return;
  }
  const itens = itensDoCargo().filter(({ item }) => item.eleitos > 0);
  const chave = `${estado.cargo}|${itens.map(({ uf, item }) => `${uf}${item.alteradoEm}`).join()}`;
  if (chave === chaveEleitos) return;
  chaveEleitos = chave;
  const porPartido = new Map();
  await Promise.all(itens.map(async ({ uf }) => {
    try {
      const { dados } = await getJson(`/api/resultado/${estado.cargo}/${uf}`);
      for (const c of dados?.candidatos ?? []) {
        if (c.situacao !== 'eleito') continue;
        if (!porPartido.has(c.partido)) porPartido.set(c.partido, []);
        porPartido.get(c.partido).push({ nome: c.nomeUrna, uf });
      }
    } catch { /* sem o nome, o hover mostra só o partido */ }
  }));
  if (chave.startsWith(`${estado.cargo}|`) && ehAgregado()) estado.eleitos = porPartido;
}

// ---------- municípios da UF aberta (mapa de municípios) ----------

// Só os cargos majoritários com resultado por município; Brasil, exterior e DF (um município só) ficam de fora.
const querMunicipios = () =>
  [1, 3, 5].includes(estado.cargo) && !['br', 'zz', 'df'].includes(estado.uf) && cargoMeta().abrangencias.includes(estado.uf);
const modoMunicipal = () => estado.mun?.chave === chaveAtual();

let recargaMunicipios = null;
async function carregarMunicipios() {
  clearTimeout(recargaMunicipios);
  if (!querMunicipios()) {
    estado.mun = undefined;
    return;
  }
  const chave = chaveAtual();
  try {
    const [geo, resultados] = await Promise.all([geometriaUf(estado.uf), resultadosMunicipios(estado.cargo, estado.uf)]);
    if (chave !== chaveAtual()) return; // a seleção mudou enquanto carregava
    // Sem a rota de municípios (camada desligada), segue no mapa do Brasil.
    estado.mun = resultados
      ? { chave, geo, resultados, porCodigo: new Map(resultados.municipios.map((m) => [m.codigo, m])) }
      : undefined;
    // Enquanto o servidor ainda carrega os municípios, acompanha o progresso só redesenhando o mapa.
    if (resultados?.carregando) {
      recargaMunicipios = setTimeout(async () => {
        await carregarMunicipios();
        renderGrade();
      }, 1500);
    }
  } catch {
    if (chave === chaveAtual()) estado.mun = undefined;
  }
}

// ---------- evolução da apuração (gráfico) ----------

const querHistorico = () => [1, 3, 5].includes(estado.cargo) && !ehAgregado() && estado.visao !== 'projecao';
const chaveHistorico = () => `${chaveAtual()}:${estado.modelo ?? 'ingenuo'}`;

async function buscarHistorico() {
  if (!querHistorico()) {
    estado.historico = undefined;
    return;
  }
  const chave = chaveHistorico();
  const dados = await carregarHistorico(estado.cargo, estado.uf, estado.modelo ?? 'ingenuo');
  if (chave !== chaveHistorico()) return; // a seleção mudou enquanto carregava
  estado.historico = dados ? { chave, dados } : undefined; // sem a rota ou sem gravação, a seção some
}

// Insere o gráfico logo abaixo dos números do arquivo aberto.
function montarGraficoEvolucao(raiz) {
  const h = estado.historico;
  const ancora = raiz.querySelector('.numeros');
  if (!querHistorico() || !h || h.chave !== chaveHistorico() || !ancora) return;
  const secao = document.createElement('section');
  secao.className = 'grafico';
  secao.innerHTML = '<h3 class="secao">Evolução da apuração</h3><div class="gr-corpo"></div>';
  ancora.after(secao);
  const modelo = estado.modelo ?? 'ingenuo';
  montarGrafico(secao.querySelector('.gr-corpo'), h.dados, {
    corPartido, fmtPct, esc, chave: h.chave,
    nomeModelo: estado.meta.modelos?.find((m) => m.id === modelo)?.nome ?? modelo,
  });
}

let atualizando = false;
let atualizarDeNovo = false;
async function atualizar() {
  if (atualizando) {
    atualizarDeNovo = true;
    return;
  }
  atualizando = true;
  try {
    do {
      atualizarDeNovo = false;
      await Promise.all([carregarResumo(), carregarDetalhe(), carregarMunicipios(), buscarHistorico()]);
      await carregarEleitos();
      render();
    } while (atualizarDeNovo);
  } catch (erro) {
    console.error(erro);
  } finally {
    atualizando = false;
  }
}

// ---------- seleção (#/cargo/uf) ----------

function ufPadrao(cargo) {
  const meta = cargoMeta(cargo);
  return meta.abrangencias.length === 1 ? meta.abrangencias[0] : 'br';
}

function lerHash() {
  const m = /^#\/(\d+)\/([a-z]{2})(?:\/(projecao)(?:\/([a-z]+))?)?(?:\/([cm])\/(\w+))?$/.exec(location.hash);
  estado.visao = m?.[3] === 'projecao' ? 'projecao' : 'apuracao';
  const modeloPedido = m?.[4];
  estado.modelo = estado.meta.modelos.some((x) => x.id === modeloPedido && x.disponivel) ? modeloPedido : 'ingenuo';
  const cargo = m ? Number(m[1]) : estado.meta.cargos[0].codigo;
  const meta = cargoMeta(cargo) ?? estado.meta.cargos[0];
  estado.cargo = meta.codigo;
  const ufPedida = m?.[2];
  const valida = ufPedida && (meta.abrangencias.includes(ufPedida) || (ufPedida === 'br' && meta.codigo !== 1));
  estado.uf = valida ? ufPedida : ufPadrao(meta.codigo);
  estado.busca = '';
  estado.mostrarTodos = false;
  estado.destaque = m?.[5] ? { tipo: m[5], id: m[6] } : null;
  estado.destaqueRolado = false;
}

async function aplicarHash() {
  lerHash();
  estado.detalhe = undefined;
  estado.projecao = undefined;
  estado.mun = undefined;
  estado.eleitos = null;
  chaveEleitos = '';
  render();
  await atualizar();
}
window.addEventListener('hashchange', aplicarHash);

// ---------- busca global ----------

// Cargo em que um município pode ser aberto: o atual, se for majoritário com resultado municipal naquela UF;
// senão o primeiro que servir.
function cargoParaMunicipio(uf) {
  const serve = (c) => [1, 3, 5].includes(c.codigo) && c.abrangencias.includes(uf);
  return (serve(cargoMeta()) ? cargoMeta() : estado.meta.cargos.find(serve))?.codigo;
}

function escolherNaBusca(item) {
  let hash;
  if (item.tipo === 'candidato') hash = `${hashPara(item.cargo, item.uf, 'apuracao')}/c/${item.sq}`;
  else {
    const cargo = cargoParaMunicipio(item.uf);
    if (!cargo) return;
    hash = `${hashPara(cargo, item.uf, 'apuracao')}/m/${item.codigo}`;
  }
  // Escolher de novo o que já está aberto não muda o hash; redesenha à mão para rolar até ele outra vez.
  if (location.hash === hash) aplicarHash();
  else location.hash = hash;
}

// Município escolhido na busca: contorno destacado no mapa e um cartão com o resultado dele.
function destacarMunicipio() {
  if (estado.destaque?.tipo !== 'm' || !modoMunicipal()) return;
  const forma = $(`path.mun[data-mun="${estado.destaque.id}"]`);
  if (!forma) return;
  forma.classList.add('sel');
  forma.parentNode.append(forma); // por último, para o contorno não ficar escondido pelos vizinhos
}

function municipioSelecionadoHtml() {
  if (estado.destaque?.tipo !== 'm') return '';
  const nome = estado.mun?.geo.municipios[estado.destaque.id]?.n;
  if (!nome) return '';
  const m = estado.mun.porCodigo.get(estado.destaque.id);
  const dado = !m?.secoes?.totalizadas
    ? '<span class="muted pequeno">Sem votos apurados ainda</span>'
    : `${ehMajoritario(estado.cargo) && m.lider ? `<span class="pequeno"><b>${esc(m.lider.nomeUrna)}</b> (${esc(m.lider.partido)}) lidera com ${fmtPct(m.lider.pct)} dos válidos · </span>` : ''}<span class="muted pequeno">${fmtPct(m.secoes.pctTotalizadas)} das seções totalizadas</span>`;
  return `<div class="sel-municipio"><div><b>${esc(nomeProprio(nome))}</b> · ${esc(nomeUf(estado.uf))}<br>${dado}</div>
    <a href="${hashPara(estado.cargo, estado.uf)}">Limpar</a></div>`;
}

// ---------- desenho: abas e mapa ----------

// Navegação entre cargos: controle segmentado.
function renderAbas() {
  const itens = estado.meta.cargos
    .map((c) => `<a class="aba" href="${hashPara(c.codigo, ufPadrao(c.codigo))}" ${c.codigo === estado.cargo ? 'aria-current="page"' : ''}>${esc(c.nome)}</a>`)
    .join('');
  $('#abas').innerHTML = `<div class="seg">${itens}</div>`;
}

function conteudoTile(item) {
  if (!item || !item.secoes) return { sub: '', sub2: '—', pct: 0, cor: null, vazio: true };
  const lider = item.lider;
  const comLider = ehMajoritario(estado.cargo) && lider;
  return {
    sub: comLider ? esc(lider.partido) : '',
    sub2: comLider ? fmtPct(lider.pct, 0) : fmtPct(item.secoes.pctTotalizadas, 0),
    pct: item.secoes.pctTotalizadas,
    cor: comLider ? corPartido(lider.partido) : null,
    vazio: false,
  };
}

// Dados de uma "unidade" (UF, Brasil ou exterior) para o mapa, os chips e a dica.
function dadoUnidade(uf) {
  // "Brasil" nos cargos sem arquivo nacional é a soma das UFs; nos demais casos é um arquivo comum.
  return uf === 'br' && !temArquivoNacional(estado.cargo)
    ? { sub: 'Visão geral', sub2: fmtPct(agregadoSecoes().pct, 0), pct: agregadoSecoes().pct, cor: null, vazio: false }
    : conteudoTile(itemResumo(estado.cargo, uf));
}

// Pílula no canto do mapa que leva ao total do Brasil (que já inclui o exterior).
function totalBrasilHtml() {
  const dado = dadoUnidade('br');
  const cor = dado.cor ? ` style="--cor:${dado.cor}"` : '';
  return `<a class="tot-pilula" href="#/${estado.cargo}/br" aria-current="${estado.uf === 'br'}"${cor} title="Brasil: total, com o exterior">
    <i></i><b>Brasil</b><span>${esc(dado.sub2)}</span></a>`;
}

// Botão de voltar ao total, na linha das abas do painel de detalhe, quando há uma UF (ou o exterior) selecionada.
function voltarHtml() {
  const meta = cargoMeta();
  if (estado.uf === 'br' || !(meta.abrangencias.includes('br') || meta.codigo !== 1)) return '';
  return `<a class="voltar" href="${hashPara(estado.cargo, 'br')}"><span aria-hidden="true">‹</span> Voltar ao Brasil</a>`;
}

// Intensidade da cor: a UF começa cinza e ganha a cor do líder conforme é apurada, para que uma UF com
// poucas seções não pareça um resultado firme.
const forcaCor = (pct) => Math.round(Math.min(100, Math.max(0, pct)));

// O exterior não tem contorno: é um globo no canto vazio do mapa, tratado como mais uma UF.
function exteriorGloboHtml() {
  const dado = dadoUnidade('zz');
  const estilo = dado.vazio || !dado.cor ? '' : ` style="--cor:${dado.cor};--forca:${forcaCor(dado.pct)}"`;
  const aria = `Exterior: ${dado.vazio ? 'sem dados' : esc(`${dado.sub} ${dado.sub2}`.trim())}`;
  const cx = 66; const cy = MAPA.altura - 78; const r = 38;
  return `<a class="uf exterior-globo${dado.vazio ? ' vazio' : ''}" href="${hashPara(estado.cargo, 'zz')}" data-uf="zz"${estilo}
      aria-current="${estado.uf === 'zz'}" aria-label="${aria}">
      <circle cx="${cx}" cy="${cy}" r="${r}"/>
      <g class="globo-linhas"><ellipse cx="${cx}" cy="${cy}" rx="${r * 0.42}" ry="${r}"/><path d="M${cx - r} ${cy}H${cx + r}M${cx - r * 0.86} ${cy - r * 0.5}H${cx + r * 0.86}M${cx - r * 0.86} ${cy + r * 0.5}H${cx + r * 0.86}"/></g>
      <text class="rot-ext" x="${cx}" y="${cy + r + 16}">EXTERIOR</text></a>`;
}

function ufMapaHtml(uf, ativas) {
  const forma = MAPA.ufs[uf];
  if (!ativas.has(uf)) return `<g class="uf inativa"><path d="${forma.d}"/></g>`;
  const dado = dadoUnidade(uf);
  // Nos majoritários, sem líder (ainda sem votos) a UF fica cinza; nos demais cargos a cor é a de destaque.
  const cor = dado.cor ?? (ehMajoritario(estado.cargo) ? null : 'var(--accent)');
  const estilo = dado.vazio || !cor ? '' : ` style="--cor:${cor};--forca:${forcaCor(dado.pct)}"`;
  return `<a class="uf${dado.vazio ? ' vazio' : ''}" href="${hashPara(estado.cargo, uf)}" data-uf="${uf}"${estilo}
      aria-current="${uf === estado.uf}" aria-label="${esc(nomeUf(uf))}: ${dado.vazio ? 'sem dados' : esc(`${dado.sub} ${dado.sub2}`.trim())}">
      <path d="${forma.d}"/></a>`;
}

function rotulosMapaHtml(ativas) {
  return Object.entries(MAPA.ufs).map(([uf, centro]) => {
    const pos = { ...centro, ...ROTULOS[uf] };
    const classe = `rot${ativas.has(uf) ? '' : ' inativa'}${pos.ancora === 'start' ? ' fora' : ''}`;
    const texto = `<text class="${classe}" x="${pos.x}" y="${pos.y}">${uf.toUpperCase()}</text>`;
    if (!pos.guia) return texto;
    // A linha termina na borda do texto (à esquerda dele quando alinhado à esquerda, no meio quando centralizado).
    const x2 = pos.ancora === 'start' ? pos.x - 3 : pos.x;
    const y2 = pos.ancora === 'start' ? pos.y : pos.y - 8;
    return `<line class="guia" x1="${centro.x}" y1="${centro.y}" x2="${x2}" y2="${y2}"/>
      <circle class="guia-ponto" cx="${centro.x}" cy="${centro.y}" r="2"/>${texto}`;
  }).join('');
}

function legendaHtml({ lideres = null, unidade = 'UF' } = {}) {
  const gradiente = (cor) => `<span class="leg-grad" style="--cor:${cor}"></span>`;
  if (ehMajoritario(estado.cargo)) {
    const partidos = [...new Set(lideres ?? itensDoCargo().filter(({ uf }) => uf !== 'zz').map(({ item }) => item.lider?.partido).filter(Boolean))].sort();
    const chaves = partidos.map((p) => `<span class="leg-item"><i style="background:${corPartido(p)}"></i>${esc(p)}</span>`).join('');
    return `<div class="leg-linha"><span class="leg-titulo">Mais votado ${unidade === 'UF' ? 'na UF' : 'no município'}</span>${chaves || '<span class="muted">sem votos ainda</span>'}</div>
      <div class="leg-linha"><span class="leg-titulo">Apuração</span><span class="muted">pouca</span>${gradiente('var(--text)')}<span class="muted">toda</span></div>`;
  }
  return `<div class="leg-linha"><span class="leg-titulo">Seções totalizadas</span><span class="muted">0%</span>${gradiente('var(--accent)')}<span class="muted">100%</span></div>`;
}

function renderGrade() {
  const meta = cargoMeta();
  const ativas = new Set(meta.abrangencias);
  const semMapa = meta.abrangencias.length === 1;
  $('#principal').classList.toggle('sem-mapa', semMapa);
  if (semMapa) return;

  // A UF selecionada vai por último para que o contorno de destaque não fique escondido; o DF, que é um
  // buraco dentro de Goiás, vem logo antes para ficar por cima dele.
  const municipal = modoMunicipal();
  const ordem = Object.keys(MAPA.ufs).sort((a, b) => (a === 'df') - (b === 'df')).sort((a, b) => (a === estado.uf) - (b === estado.uf));
  $('#grade').innerHTML = municipal ? mapaMunicipalHtml() : `<svg class="mapa-svg" viewBox="0 0 ${MAPA.largura + FOLGA_DIREITA} ${MAPA.altura}" role="group" aria-label="Mapa do Brasil por UF">
      ${ordem.map((uf) => ufMapaHtml(uf, ativas)).join('')}
      ${ativas.has('zz') ? exteriorGloboHtml() : ''}
      <g class="rotulos">${rotulosMapaHtml(ativas)}</g>
    </svg>`;

  const temTotal = ativas.has('br') || meta.codigo !== 1;
  if (temTotal) $('#grade').insertAdjacentHTML('beforeend', totalBrasilHtml());
  destacarMunicipio();
  $('#legenda').innerHTML = municipal
    ? legendaHtml({ lideres: estado.mun.resultados.municipios.map((m) => m.lider?.partido).filter(Boolean), unidade: 'município' })
    : legendaHtml();
}

// Mapa dos municípios da UF aberta, no lugar do mapa do Brasil. A cor segue a mesma regra das UFs.
function corMunicipio(m) {
  const lider = ehMajoritario(estado.cargo) && m.lider;
  const cor = lider ? corPartido(m.lider.partido) : ehMajoritario(estado.cargo) ? null : 'var(--accent)';
  return { cor, forca: m.secoes?.totalizadas ? forcaCor(m.secoes.pctTotalizadas) : 0 };
}

function mapaMunicipalHtml() {
  const { geo, resultados } = estado.mun;
  const total = Object.keys(geo.municipios).length;
  const progresso = resultados.carregando ? ` · carregando ${fmtInt(resultados.progresso.feitos)} de ${fmtInt(resultados.progresso.total)}` : '';
  return `${mapaMunicipiosHtml(geo, resultados, corMunicipio)}
    <div class="mun-titulo"><b>${esc(nomeUf(estado.uf))}</b><span>${fmtInt(total)} municípios${progresso}</span></div>`;
}

// O TSE escreve os nomes em maiúsculas.
const nomeProprio = (nome) =>
  nome.toLowerCase().replace(/(^|\s|-|')(\p{L})/gu, (t, sep, letra) => sep + letra.toUpperCase())
    .replace(/\s(D[aeo]s?|E)(?=\s)/g, (t) => t.toLowerCase());

// ---------- dica ao passar o mouse sobre uma UF ----------

function dicaHtml(uf) {
  const item = itemResumo(estado.cargo, uf);
  const dado = conteudoTile(item);
  const linhas = [];
  if (dado.vazio) linhas.push('<span class="muted">Sem dados ainda</span>');
  else {
    if (ehMajoritario(estado.cargo) && item.lider) {
      linhas.push(`<span class="dica-lider" style="--cor:${corPartido(item.lider.partido)}"><i></i><span>${esc(item.lider.nomeUrna)}<small>${esc(item.lider.partido)} · ${fmtPct(item.lider.pct)} dos válidos</small></span></span>`);
    }
    linhas.push(`<span class="muted">${fmtPct(item.secoes.pctTotalizadas)} das seções totalizadas</span>`);
  }
  return `<strong>${esc(nomeUf(uf))}</strong>${linhas.join('')}`;
}

function iniciarDica() {
  const area = $('#grade').parentElement;
  const dica = $('#dica');
  const esconder = () => { dica.hidden = true; };
  area.addEventListener('pointermove', (evento) => {
    const mun = estado.mun && evento.target.closest?.('path.mun');
    const alvo = mun || evento.target.closest?.('a.uf');
    if (!alvo || evento.pointerType === 'touch') return esconder();
    dica.innerHTML = mun
      ? dicaMunicipioHtml(estado.mun.porCodigo.get(mun.dataset.mun), nomeProprio(estado.mun.geo.municipios[mun.dataset.mun].n),
        { ehMajoritario: ehMajoritario(estado.cargo), corPartido, fmtPct, esc })
      : dicaHtml(alvo.dataset.uf);
    dica.hidden = false;
    const caixa = area.getBoundingClientRect();
    const x = Math.min(evento.clientX - caixa.left + 14, caixa.width - dica.offsetWidth);
    dica.style.left = `${Math.max(0, x)}px`;
    dica.style.top = `${evento.clientY - caixa.top + 16}px`;
  });
  area.addEventListener('pointerleave', esconder);
}

// ---------- desenho: blocos do detalhe ----------

function progressoHtml({ total, totalizadas, pct, pctTotalizadas }, rotulo = 'Seções totalizadas') {
  pct ??= pctTotalizadas;
  return `<div class="progresso">
    <div class="progresso-linha"><span>${rotulo}</span><span><b>${fmtPct(pct)}</b> · ${fmtInt(totalizadas)} de ${fmtInt(total)}</span></div>
    <div class="trilho"><i style="width:${Math.min(100, pct)}%"></i></div>
  </div>`;
}

function numerosHtml(dados) {
  const { eleitorado: e, votos: v } = dados;
  const caixa = (rotulo, valor, pct) => `<div class="numero"><b>${fmtPct(pct)}</b><span>${rotulo}</span><span class="valor">${fmtInt(valor)}</span></div>`;
  // Brancos e nulos não entram no cálculo de quem vence, então ficam juntos num bloco só.
  return `<div class="numeros quatro">
    ${caixa('Comparecimento', e.comparecimento, e.pctComparecimento)}
    ${caixa('Abstenção', e.abstencao, e.pctAbstencao)}
    ${caixa('Votos válidos', v.validos, v.pctValidos)}
    ${caixa('Brancos e nulos', v.brancos + v.nulos, v.pctBrancos + v.pctNulos)}
  </div>`;
}

function selosHtml(dados, status) {
  const selos = [];
  if (dados.totalizacaoFinal) selos.push('<span class="selo ok">Totalização final</span>');
  else if (dados.matematicamenteDefinido) selos.push('<span class="selo ok">Matematicamente definido (TSE)</span>');
  else if (dados.secoes.totalizadas > 0) selos.push('<span class="selo aviso">Em apuração</span>');
  else selos.push('<span class="selo">Aguardando apuração</span>');
  if (status === 'erro') selos.push('<span class="selo aviso">Dado possivelmente desatualizado</span>');
  return `<div class="selos">${selos.join('')}</div>`;
}

function pilulaSituacao(c) {
  if (c.situacao === 'eleito') return '<span class="pill eleito">Eleito</span>';
  if (c.situacao === 'segundo-turno') return '<span class="pill segundo-turno">2º turno</span>';
  if (c.situacao === 'suplente') return '<span class="pill">Suplente</span>';
  if (c.situacao === 'outra' && c.situacaoTexto) return `<span class="pill">${esc(c.situacaoTexto)}</span>`;
  return '';
}

function extraCandidato(c) {
  if (!c.vices?.length) return '';
  const rotulo = { v: 'Vice', s1: '1º suplente', s2: '2º suplente' };
  const texto = c.vices.map((x) => `${rotulo[x.tipo] ?? 'Vice'}: ${esc(x.nomeUrna)}`).join(' · ');
  return `<span class="cand-extra">${texto}</span>`;
}

function candidatoHtml(c, posicao, largura) {
  const cor = corPartido(c.partido);
  const destaque = estado.destaque?.tipo === 'c' && estado.destaque.id === String(c.sq) ? ' class="destaque"' : '';
  return `<li${destaque} style="--cor:${cor}">
    <div class="cand-topo">
      <span class="cand-pos">${posicao}</span>
      <div class="cand-nome"><strong>${esc(c.nomeUrna)}</strong><span class="cand-num">${esc(c.numero)}</span>${extraCandidato(c)}</div>
      <span class="partido" title="${esc(c.partidoNome)}">${esc(c.partido)}</span>
      ${pilulaSituacao(c)}
      <div class="cand-votos"><b>${fmtPct(c.pct)}</b><small>${fmtInt(c.votos)}</small></div>
    </div>
    <div class="barra"><i style="width:${largura}%"></i></div>
  </li>`;
}

function agrupamentosHtml(dados) {
  const linhas = dados.agrupamentos
    .map((a) => `<tr>
      <td><span class="partido" style="--cor:${corPartido(a.partidos[0])}">${esc(a.sigla)}</span></td>
      <td class="num">${fmtInt(a.votos)}</td>
      <td class="num">${a.vagas || '—'}</td>
      <td class="num">${a.eleitos || '—'}</td>
    </tr>`)
    .join('');
  return `<h3 class="secao">Partidos e federações</h3>
    <div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Partido / federação</th><th class="num">Votos</th><th class="num">Vagas</th><th class="num">Eleitos</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>`;
}

// ---------- desenho: detalhe de um arquivo (UF ou Brasil/presidente) ----------

function detalheArquivoHtml() {
  const titulo = `${cargoMeta().nome} · ${nomeUf(estado.uf)}`;
  const det = estado.detalhe;
  if (det === undefined) {
    return `<div class="detalhe-topo"><h2>${esc(titulo)}</h2></div><p class="vazio-msg">Carregando…</p>`;
  }
  if (!det || det.status === 'indisponivel' || !det.dados) {
    return `<div class="detalhe-topo"><h2>${esc(titulo)}</h2></div>
      <p class="aviso-bloco espera">O arquivo de resultado desta abrangência ainda não está disponível no TSE.</p>`;
  }
  const d = det.dados;
  const aviso = [];
  if (det.status === 'erro') aviso.push(`<p class="aviso-bloco erro">Falha ao atualizar: ${esc(det.erro)}.</p>`);
  if (d.secoes.totalizadas === 0) {
    aviso.push('<p class="aviso-bloco espera">Aguardando o início da apuração: os arquivos do TSE já existem, mas ainda não têm votos.</p>');
  } else if (!d.totalizacaoFinal) {
    aviso.push('<p class="aviso-bloco">Resultado parcial: os percentuais refletem só as seções já totalizadas e podem mudar bastante, porque as regiões chegam em ordens diferentes.</p>');
  }

  const candidatos = d.candidatos;
  let topo = '';
  if (ehMajoritario(d.cargo.codigo) && candidatos.length > 1 && candidatos[0].votos > 0) {
    const [a, b] = candidatos;
    topo = `<p class="aviso-bloco"><b>${esc(a.nomeUrna)}</b> está ${fmtInt(a.votos - b.votos)} votos (${fmtPct(a.pct - b.pct)} pontos) à frente de <b>${esc(b.nomeUrna)}</b>.</p>`;
  }

  let lista;
  let fixado = '';
  if (ehProporcional(d.cargo.codigo)) {
    const termo = estado.busca.trim().toLowerCase();
    const filtrados = termo
      ? candidatos.filter((c) => `${c.nome} ${c.nomeUrna} ${c.numero} ${c.partido}`.toLowerCase().includes(termo))
      : candidatos;
    const limite = termo ? 100 : estado.mostrarTodos ? filtrados.length : 20;
    const visiveis = filtrados.slice(0, limite);
    // Em disputas proporcionais os percentuais são minúsculos; a barra é relativa ao mais votado.
    const maisVotado = candidatos[0]?.votos ?? 0;
    const largura = (c) => (maisVotado > 0 ? (c.votos / maisVotado) * 100 : 0);
    const posicaoGeral = new Map(candidatos.map((c, i) => [c.sq, i + 1]));
    // Candidato vindo da busca global que ficou fora da parte visível da lista: aparece fixado acima dela.
    const escolhido = estado.destaque?.tipo === 'c' && !termo ? candidatos.find((c) => String(c.sq) === estado.destaque.id) : null;
    fixado = escolhido && !visiveis.includes(escolhido)
      ? `<h3 class="secao sel-fixado">Candidato selecionado</h3>
        <ol class="candidatos" style="list-style:none;padding:0">${candidatoHtml(escolhido, posicaoGeral.get(escolhido.sq), largura(escolhido))}</ol>`
      : '';
    lista = `<div class="ferramentas">
        <input id="busca" type="search" placeholder="Buscar candidato, número ou partido" value="${esc(estado.busca)}" autocomplete="off">
        ${termo || filtrados.length <= 20 ? '' : `<button class="botao" id="mostrar-todos">${estado.mostrarTodos ? 'Mostrar só os 20 primeiros' : `Mostrar todos (${fmtInt(filtrados.length)})`}</button>`}
      </div>
      <ol class="candidatos" style="list-style:none;padding:0">${visiveis.map((c) => candidatoHtml(c, posicaoGeral.get(c.sq), largura(c))).join('')}</ol>
      ${filtrados.length === 0 ? '<p class="vazio-msg">Nenhum candidato encontrado.</p>' : ''}
      ${termo && filtrados.length > limite ? `<p class="muted pequeno">Mostrando ${limite} de ${fmtInt(filtrados.length)}. Refine a busca.</p>` : ''}
      ${agrupamentosHtml(d)}`;
  } else {
    lista = `<ol class="candidatos">${candidatos.map((c, i) => candidatoHtml(c, i + 1, c.pct)).join('')}</ol>`;
  }

  const vagas = d.cargo.vagas > 1 ? ` · ${d.cargo.vagas} vagas` : '';
  return `<div class="detalhe-topo"><div><h2>${esc(titulo)}</h2>
      <p class="muted pequeno">${ehProporcional(d.cargo.codigo) ? `${fmtInt(candidatos.length)} candidatos${vagas}` : `${d.cargo.vagas > 1 ? `${d.cargo.vagas} vagas · ` : ''}${estado.meta.demo ? 'Simulação de' : 'Dados do TSE de'} ${esc(fmtDataHora(d.geradoEm))}`}</p></div>
      ${selosHtml(d, det.status)}</div>
    ${aviso.join('')}
    ${progressoHtml(d.secoes)}
    ${numerosHtml(d)}
    ${topo ? `<div style="margin-top:14px">${topo}</div>` : ''}
    ${fixado}
    <h3 class="secao">${ehProporcional(d.cargo.codigo) ? 'Candidatos mais votados' : 'Candidatos'}</h3>
    ${lista}`;
}

// ---------- desenho: visão "Brasil" dos cargos sem arquivo nacional ----------

function itensDoCargo() {
  return cargoMeta().abrangencias
    .filter((uf) => uf !== 'br')
    .map((uf) => ({ uf, item: itemResumo(estado.cargo, uf) }))
    .filter(({ item }) => item?.secoes);
}

function agregadoSecoes() {
  const itens = itensDoCargo();
  const total = itens.reduce((s, { item }) => s + item.secoes.total, 0);
  const totalizadas = itens.reduce((s, { item }) => s + item.secoes.totalizadas, 0);
  return { total, totalizadas, pct: total ? (100 * totalizadas) / total : 0 };
}

// Mapa de cadeiras do Senado (5) e da Câmara (6): eleitos até agora por partido + cadeiras ainda em aberto.
function cadeirasAgregadoHtml(codigo, vagas, porPartido) {
  if (codigo !== 5 && codigo !== 6) return '';
  const partidos = {};
  for (const [sigla, n] of Object.entries(porPartido)) partidos[sigla] = { eleitos: n, pessoasEleitas: estado.eleitos?.get(sigla) ?? [] };
  let ocupadas = false;
  if (codigo === 5 && estado.senadoOcupadas) {
    ocupadas = true;
    for (const { partido, nome, uf } of estado.senadoOcupadas) {
      const sigla = partido.toUpperCase();
      partidos[sigla] = {
        ...partidos[sigla],
        ocupadas: (partidos[sigla]?.ocupadas ?? 0) + 1,
        pessoasOcupadas: [...(partidos[sigla]?.pessoasOcupadas ?? []), { nome, uf }],
      };
    }
  }
  const eleitos = Object.values(porPartido).reduce((s, n) => s + n, 0);
  return cadeirasHtml({
    titulo: codigo === 5 ? 'Composição do Senado' : 'Composição da Câmara',
    total: vagas,
    pendentes: Math.max(0, vagas - eleitos),
    partidos,
    ocupadas,
  }, estado.cadeiras, { esc, corPartido, fmtInt });
}

function detalheAgregadoHtml() {
  const meta = cargoMeta();
  const itens = itensDoCargo();
  if (!itens.length) {
    return `<div class="detalhe-topo"><h2>${esc(meta.nome)} · Brasil</h2></div>
      <p class="aviso-bloco espera">Os arquivos do TSE para este cargo ainda não estão disponíveis.</p>`;
  }

  const secoes = agregadoSecoes();
  const vagas = itens.reduce((s, { item }) => s + item.vagas, 0);
  const eleitos = itens.reduce((s, { item }) => s + item.eleitos, 0);
  const concluidas = itens.filter(({ item }) => item.totalizacaoFinal).length;
  const emSegundoTurno = itens.filter(({ item }) => item.segundoTurno > 0).length;

  const porPartido = {};
  for (const { item } of itens) {
    for (const [partido, n] of Object.entries(item.eleitosPorPartido ?? {})) porPartido[partido] = (porPartido[partido] ?? 0) + n;
  }
  const partidos = Object.entries(porPartido).sort((a, b) => b[1] - a[1]);
  const maior = partidos[0]?.[1] ?? 0;

  const caixa = (rotulo, valor) => `<div class="numero"><b>${valor}</b><span>${rotulo}</span></div>`;
  const numeros = `<div class="numeros">
    ${caixa('Vagas em disputa', fmtInt(vagas))}
    ${caixa('Eleitos até agora', fmtInt(eleitos))}
    ${caixa('UFs com totalização final', `${concluidas} de ${itens.length}`)}
    ${meta.codigo === 3 ? caixa('UFs indo para 2º turno', emSegundoTurno) : ''}
  </div>`;

  const barras = partidos.length
    ? `<h3 class="secao">Eleitos por partido</h3>
       <ol class="candidatos">${partidos.map(([p, n], i) => `<li style="--cor:${corPartido(p)}">
         <div class="cand-topo"><span class="cand-pos">${i + 1}</span><div class="cand-nome"><strong>${esc(p)}</strong></div>
         <div class="cand-votos"><b>${fmtInt(n)}</b></div></div>
         <div class="barra"><i style="width:${(n / maior) * 100}%"></i></div></li>`).join('')}</ol>`
    : '<p class="aviso-bloco espera">Nenhum candidato eleito ainda.</p>';

  let tabela = '';
  if (ehMajoritario(meta.codigo) || meta.codigo === 5) {
    const linhas = itens
      .slice()
      .sort((a, b) => nomeUf(a.uf).localeCompare(nomeUf(b.uf), 'pt-BR'))
      .map(({ uf, item }) => `<tr class="clicavel" data-uf="${uf}">
        <td>${esc(nomeUf(uf))}</td>
        <td>${item.lider ? esc(item.lider.nomeUrna) : '—'}</td>
        <td>${item.lider ? `<span class="partido" style="--cor:${corPartido(item.lider.partido)}">${esc(item.lider.partido)}</span>` : ''}</td>
        <td class="num">${item.lider ? fmtPct(item.lider.pct) : '—'}</td>
        <td class="num">${fmtPct(item.secoes.pctTotalizadas)}</td>
      </tr>`)
      .join('');
    tabela = `<h3 class="secao">Mais votado em cada UF</h3>
      <div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>UF</th><th>Candidato</th><th>Partido</th><th class="num">% válidos</th><th class="num">Totalizadas</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>`;
  }

  return `<div class="detalhe-topo"><div><h2>${esc(meta.nome)} · Brasil</h2>
      <p class="muted pequeno">Soma das UFs. Selecione uma UF no mapa para ver os candidatos.</p></div></div>
    ${secoes.totalizadas === 0 ? '<p class="aviso-bloco espera">Aguardando o início da apuração: os arquivos do TSE já existem, mas ainda não têm votos.</p>' : ''}
    ${progressoHtml(secoes, 'Seções totalizadas (todas as UFs)')}
    ${cadeirasAgregadoHtml(meta.codigo, vagas, porPartido)}
    ${numeros}${barras}${tabela}`;
}

// ---------- desenho: projeção (estimativa do painel, não é dado do TSE) ----------

function alternadorVisaoHtml() {
  const aba = (visao, rotulo) =>
    `<a class="aba" href="${hashPara(estado.cargo, estado.uf, visao)}" ${estado.visao === visao ? 'aria-current="page"' : ''}>${rotulo}</a>`;
  return `<nav class="abas visoes" aria-label="Visão">${aba('apuracao', 'Apuração (TSE)')}${aba('projecao', 'Projeção (estimativa)')}${voltarHtml()}</nav>`;
}

function seletorModeloHtml() {
  const opcoes = estado.meta.modelos
    .map((m) => `<option value="${m.id}" ${m.id === estado.modelo ? 'selected' : ''} ${m.disponivel ? '' : 'disabled'}>${esc(m.nome)}${m.disponivel ? '' : ' (indisponível)'}</option>`)
    .join('');
  const atual = estado.meta.modelos.find((m) => m.id === estado.modelo);
  const pendentes = estado.meta.modelos.filter((m) => !m.disponivel)
    .map((m) => `<li><b>${esc(m.nome)}:</b> ${esc(m.motivo)}</li>`).join('');
  return `<div class="ferramentas"><label class="muted pequeno" for="modelo">Modelo</label>
      <select id="modelo" class="botao">${opcoes}</select></div>
    <p class="muted pequeno">${esc(atual.descricao)}</p>
    ${pendentes ? `<ul class="muted pequeno lista-pendentes">${pendentes}</ul>` : ''}`;
}

// Só no modelo por município: quanto da projeção depende de municípios que ainda não apuraram nada.
function municipiosHtml(p) {
  if (!p.municipios) return '';
  const m = p.municipios;
  const avisos = [];
  if (m.semVotos > 0) {
    avisos.push(`${fmtInt(m.semVotos)} município(s) ainda sem votos entram pela média da UF: eles respondem por <b>${fmtPct(p.parteEstimadaPelaUf * 100, 0)}</b> do total projetado.`);
    // Quanto mais alta essa parte, menos a projeção vem de dado apurado.
  }
  if (m.semArquivo > 0) avisos.push(`${fmtInt(m.semArquivo)} município(s) sem arquivo no TSE ficaram de fora, então a projeção está incompleta.`);
  if (p.ufs?.semVotos > 0) avisos.push(`${fmtInt(p.ufs.semVotos)} UF(s) ainda sem nenhum município apurado entram pelo eleitorado e pela média das demais.`);
  if (p.conferencia && Math.abs(p.conferencia.diferencaPct) > 2) {
    avisos.push(`A soma dos municípios (${fmtInt(p.conferencia.municipios)} votos válidos) difere ${fmtPct(Math.abs(p.conferencia.diferencaPct), 1)} do arquivo da UF (${fmtInt(p.conferencia.uf)}). Podem estar em momentos diferentes da apuração.`);
  }
  if (p.aviso) avisos.push(esc(p.aviso));
  return `<div class="numeros">
      <div class="numero"><b>${fmtInt(m.comVotos)}</b><span>Municípios com votos de ${fmtInt(m.total)}</span></div>
      <div class="numero"><b>${fmtInt(m.semVotos)}</b><span>Municípios ainda sem votos</span></div>
    </div>
    ${avisos.map((a) => `<p class="aviso-bloco">${a}</p>`).join('')}`;
}

function detalheProjecaoHtml() {
  const titulo = `${cargoMeta().nome} · ${nomeUf(estado.uf)}`;
  const topo = `<div class="detalhe-topo"><div><h2>${esc(titulo)}</h2>
      <p class="muted pequeno">Projeção do resultado final</p></div>
      <div class="selos"><span class="selo aviso">Estimativa do painel</span></div></div>
    <p class="aviso-bloco">Isto <b>não é resultado do TSE</b>: é uma extrapolação feita por este painel a partir de uma apuração parcial, com limitações. Só o resultado oficial vale.</p>
    ${seletorModeloHtml()}`;
  const p = estado.projecao;
  if (p === undefined) return `${topo}<p class="vazio-msg">Carregando…</p>`;
  if (!p || !p.disponivel) {
    const { feitos, total, unidade = 'municípios' } = p?.progresso ?? {};
    const andamento = p?.carregando && total ? ` (${fmtInt(feitos)} de ${fmtInt(total)} ${unidade})` : '';
    return `${topo}<p class="aviso-bloco espera">${esc(p?.motivo ?? 'Projeção indisponível.')}${andamento}</p>`;
  }

  const linhas = p.candidatos.map((c) => `<tr>
      <td><b>${esc(c.nomeUrna)}</b> <span class="partido" style="--cor:${corPartido(c.partido)}">${esc(c.partido)}</span></td>
      <td class="num">${fmtPct(c.pctAtual)}</td>
      <td class="num"><b>${fmtPct(c.pctProjetado)}</b></td>
      <td class="num">${fmtInt(c.votosProjetados)}</td>
      <td class="num">${fmtPct(c.pctMinimo, 1)} a ${fmtPct(c.pctMaximo, 1)}</td>
    </tr>`).join('');
  return `${topo}
    <div class="progresso">
      <div class="progresso-linha"><span>Seções totalizadas usadas como base</span><span><b>${fmtPct(p.fracaoApurada * 100)}</b></span></div>
      <div class="trilho"><i style="width:${p.fracaoApurada * 100}%"></i></div>
    </div>
    <div class="numeros">
      <div class="numero"><b>${fmtInt(p.validosProjetados)}</b><span>Votos válidos projetados</span></div>
      <div class="numero"><b>${fmtInt(p.votosFaltantes)}</b><span>Votos válidos ainda a apurar</span></div>
    </div>
    ${municipiosHtml(p)}
    <h3 class="secao">Candidatos</h3>
    <div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Candidato</th><th class="num">% atual</th><th class="num">% projetado</th><th class="num">Votos projetados</th><th class="num" title="Extremos matemáticos: nenhum ou todos os votos faltantes para o candidato. Não é intervalo de confiança.">Faixa possível</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
    <p class="muted pequeno">A faixa possível só mostra o que ainda está matematicamente em aberto; é larga no começo da apuração e não indica probabilidade.</p>`;
}

// ---------- desenho: orquestração ----------

function renderDetalhe() {
  const raiz = $('#detalhe');
  const buscaFocada = document.activeElement?.id === 'busca';
  const cursor = buscaFocada ? document.activeElement.selectionStart : null;
  const rolagem = window.scrollY;

  if (ehAgregado()) raiz.innerHTML = detalheAgregadoHtml();
  else raiz.innerHTML = alternadorVisaoHtml() + (estado.visao === 'projecao' ? '' : municipioSelecionadoHtml()) + (estado.visao === 'projecao' ? detalheProjecaoHtml() : detalheArquivoHtml());

  $('#modelo', raiz)?.addEventListener('change', (evento) => {
    location.hash = hashPara(estado.cargo, estado.uf, 'projecao', evento.target.value);
  });

  const busca = $('#busca', raiz);
  if (busca) {
    busca.addEventListener('input', () => {
      estado.busca = busca.value;
      renderDetalhe();
    });
    if (buscaFocada) {
      busca.focus();
      busca.setSelectionRange(cursor, cursor);
    }
  }
  $('#mostrar-todos', raiz)?.addEventListener('click', () => {
    estado.mostrarTodos = !estado.mostrarTodos;
    renderDetalhe();
  });
  raiz.querySelectorAll('tr[data-uf]').forEach((linha) => {
    linha.addEventListener('click', () => {
      location.hash = hashPara(estado.cargo, linha.dataset.uf);
    });
  });
  ligarCadeiras(raiz, estado.cadeiras, renderDetalhe);
  montarGraficoEvolucao(raiz);
  window.scrollTo({ top: rolagem });
  // Candidato escolhido na busca: rola até ele uma vez, quando o detalhe já tiver carregado.
  const alvo = !estado.destaqueRolado && $('.candidatos > li.destaque, .sel-fixado + .candidatos > li', raiz);
  if (alvo) {
    estado.destaqueRolado = true;
    alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function render() {
  renderAbas();
  renderGrade();
  renderDetalhe();
  renderEstado();
}

function renderEstado() {
  const textos = { 'ao-vivo': 'Ao vivo', reconectando: 'Reconectando…', conectando: 'Conectando…' };
  $('#pulso').dataset.estado = estado.conexao;
  $('#estado-texto').textContent = textos[estado.conexao];
  const verificado = estado.ultimoCicloEm
    ? `Verificado há ${Math.max(0, Math.round((Date.now() - estado.ultimoCicloEm) / 1000))} s · a cada ${estado.meta.intervaloSegundos} s`
    : 'Aguardando a primeira verificação…';
  $('#estado-detalhe').textContent = verificado;
}

// ---------- tempo real ----------

function conectar() {
  const fonte = new EventSource('/events');
  fonte.onopen = () => {
    estado.conexao = 'ao-vivo';
    renderEstado();
  };
  fonte.onerror = () => {
    estado.conexao = 'reconectando';
    renderEstado();
  };
  fonte.addEventListener('ciclo', (evento) => {
    const ciclo = JSON.parse(evento.data);
    estado.ultimoCicloEm = ciclo.terminadoEm;
    estado.conexao = 'ao-vivo';
    // Só redesenha quando algo mudou (ou na primeira carga); o texto "verificado há" é separado.
    if (ciclo.chavesAlteradas.length || estado.resumo.size === 0) atualizar();
    else renderEstado();
  });
}

async function iniciar() {
  try {
    await carregarMeta();
  } catch {
    $('#detalhe').innerHTML = '<p class="aviso-bloco erro">Não consegui falar com o servidor local. Ele está rodando?</p>';
    return;
  }
  const { meta } = estado;
  document.title = `${meta.demo ? '[DEMO] ' : ''}Apuração ${meta.ano}`;
  $('#ano').textContent = meta.ano;
  $('#subtitulo').textContent = `${meta.turno}º turno`;
  $('#banner-demo').hidden = !meta.demo;

  fetch('/senado-ocupadas.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
    .then((j) => { estado.senadoOcupadas = j?.cadeiras ?? null; if (estado.cargo === 5) renderDetalhe(); }).catch(() => {});
  lerHash();
  iniciarDica();
  iniciarBusca({
    raiz: $('#busca-global'),
    contexto: () => ({ cargo: estado.cargo, uf: estado.uf }),
    nomeCargo: (codigo) => cargoMeta(codigo)?.nome ?? `Cargo ${codigo}`,
    nomeUf, nomeProprio, corPartido, esc, fmtPct,
    aoEscolher: escolherNaBusca,
  });
  await atualizar();
  conectar();
  setInterval(renderEstado, 1000);
}

iniciar();
