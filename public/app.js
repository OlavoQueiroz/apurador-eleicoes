// Painel de apuração: busca /api/*, escuta /events (SSE) e redesenha quando chegam dados novos.

import { MAPA } from './mapa-brasil.js';
import { carregarHistorico, montarGrafico } from './grafico.js';
import { ESCALA_SALDO, PADRAO, PERIODOS, calcular, comparativoHtml, corDoMapa, itemDoAtual, ligarComparativo, periodoPorId, regiaoDaUf, sinal, tituloDe } from './comparativo-eleicoes.js';
import { iniciarBusca } from './busca.js';
import { carregarComparacao, comparacaoHtml } from './comparacao.js';
import { cadeirasHtml, ligarCadeiras } from './cadeiras.js';
import { CARGOS_PARTIDOS, CARTOES, PRESIDENTE, cargoPartidos, criarModelo, hashPartidos, ligarHover, partidosHtml, seletorCargosHtml } from './partidos.js';
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
  visao: 'apuracao', // 'apuracao' (dados do TSE), 'projecao' (estimativa do painel) ou 'comparativo' (2026 × 2022, só presidente)
  comparativo: { periodo: PADRAO, bases: {}, regiao: null, terceiros: null }, // período, base de cada período (carregada uma vez), região aberta e terceiros nas barras (null = os padrão do período)
  modelo: 'ingenuo',
  projecao: undefined, // mesmo contrato de `detalhe`
  comparacao: undefined, // projeção de cada modelo disponível, para comparar: [[id, resposta]]
  mapaProj: undefined, // projeção de cada UF para pintar o mapa: { chave, porUf: Map uf → { lider, margem } }
  historico: undefined, // histórico gravado da UF aberta: { chave, dados }; undefined = sem gráfico
  mun: undefined, // municípios da UF aberta: { chave, geo, resultados, porCodigo }; undefined = mapa do Brasil
  busca: '',
  destaque: null, // resultado escolhido na busca global: { tipo: 'c' (candidato, por sq) | 'm' (município, por código), id }
  mostrarTodos: false,
  numerosAbertos: false, // detalhe do arquivo: os quatro números (comparecimento etc.) abertos ou só o resumo
  cadeiras: { modo: 'partido', foco: null }, // mapa de cadeiras (Senado e Câmara): agrupamento e drill-down
  inferidos: null, // Câmara: Map partido → [{ nome, uf }] das vagas já conquistadas por `vag` cujo eleito o TSE ainda não marcou
  lideres: null, // Senado: Map partido → [{ nome, uf }] dos mais votados que ainda não foram eleitos
  eleitos: null, // nomes dos eleitos do cargo aberto no Brasil (hover do mapa de cadeiras): Map partido → [{ nome, uf }]
  senadoOcupadas: null, // 27 cadeiras do Senado fora de disputa em 2026 (public/senado-ocupadas.json)
  partidos: { ativo: false, cargo: 6, aba: 'placar', agrupar: 'ideologia', cartoes: '2026', uf: 'sp', historico: undefined }, // aba Análises (#/partidos/cargo/aba); historico: undefined = carregando, null = indisponível
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
const hashPara = (cargo, uf, visao = estado.visao, modelo = estado.modelo, periodo = estado.comparativo.periodo) => {
  if (visao === 'projecao') return `#/${cargo}/${uf}/projecao/${modelo}`;
  // O comparativo da presidência vive na aba Análises: #/partidos/1/comparativo/período[/uf].
  if (visao === 'comparativo' && cargo === 1) return `#/partidos/1/comparativo/${periodo}${uf === 'br' ? '' : `/${uf}`}`;
  return `#/${cargo}/${uf}`;
};

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

// Base de cada período do comparativo (eleição anterior por UF); não muda durante a apuração, então carrega uma vez.
async function carregarBaseComparativo() {
  const periodo = estado.comparativo.periodo;
  if (estado.comparativo.bases[periodo] !== undefined) return;
  try {
    estado.comparativo.bases[periodo] = await getJson(`/api/comparativo/presidente?periodo=${periodo}`);
  } catch {
    estado.comparativo.bases[periodo] = null;
  }
}

async function carregarDetalhe() {
  if (estado.visao === 'comparativo') {
    estado.detalhe = undefined;
    estado.projecao = undefined;
    await carregarBaseComparativo();
    return;
  }
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
  if (estado.visao === 'projecao' && atual()) estado.comparacao = await carregarComparacao(estado.meta.modelos, estado.cargo, estado.uf, getJson);
  // Projeção por município: a primeira carga leva alguns segundos, então pergunta de novo até terminar.
  clearTimeout(recarga);
  if (estado.visao === 'projecao' && estado.projecao?.carregando && !estado.projecao.disponivel) {
    recarga = setTimeout(atualizar, 1500);
  }
}
let recarga = null;

// Mapa da projeção: o vencedor projetado de cada UF, pelo modelo escolhido. Só nos majoritários, que têm um vencedor por UF.
const querMapaProjecao = () => estado.visao === 'projecao' && ehMajoritario(estado.cargo) && cargoMeta().abrangencias.length > 1;
// Modelos que servem ao cargo aberto e estão disponíveis; os outros ficam fora do seletor.
const modelosDoCargo = (cargo = estado.cargo) => estado.meta.modelos.filter((m) => m.disponivel && (!m.cargos || m.cargos.includes(cargo)));
const chaveMapaProj = () => `${estado.cargo}:${estado.modelo}`;
let recargaMapaProj = null;
async function carregarMapaProjecao() {
  clearTimeout(recargaMapaProj);
  if (!querMapaProjecao()) {
    estado.mapaProj = undefined;
    return;
  }
  const chave = chaveMapaProj();
  const ufs = cargoMeta().abrangencias.filter((uf) => uf !== 'br' || temArquivoNacional(estado.cargo));
  const porUf = new Map();
  let pendente = false;
  await Promise.all(ufs.map(async (uf) => {
    try {
      const p = await getJson(`/api/projecao/${estado.modelo}/${estado.cargo}/${uf}`);
      if (p.carregando && !p.disponivel) pendente = true;
      if (!p.disponivel || !p.candidatos?.length) return;
      const [a, b] = [...p.candidatos].sort((x, y) => y.pctProjetado - x.pctProjetado);
      porUf.set(uf, { lider: a, margem: a.pctProjetado - (b?.pctProjetado ?? 0), fracao: p.fracaoApurada ?? 1 });
    } catch { /* UF sem projeção fica cinza */ }
  }));
  if (chave !== chaveMapaProj() || !querMapaProjecao()) return; // a seleção mudou enquanto carregava
  estado.mapaProj = { chave, porUf };
  if (pendente) {
    recargaMapaProj = setTimeout(async () => {
      await carregarMapaProjecao();
      renderGrade();
    }, 2000);
  }
}

// Nomes dos eleitos de cada UF, para o hover do mapa de cadeiras. Só no Brasil de senador e deputado federal.
let chaveEleitos = '';
async function carregarEleitos() {
  if (!ehAgregado() || ![5, 6].includes(estado.cargo)) {
    estado.eleitos = null;
    estado.lideres = null;
    estado.inferidos = null;
    chaveEleitos = '';
    return;
  }
  const itens = itensDoCargo(); // todas as UFs: no Senado, quem lidera importa; na Câmara, as vagas conquistadas (`vag`) podem vir antes dos nomes
  const chave = `${estado.cargo}|${itens.map(({ uf, item }) => `${uf}${item.alteradoEm}`).join()}`;
  if (chave === chaveEleitos) return;
  chaveEleitos = chave;
  const porPartido = new Map();
  const lideres = new Map(); // só no Senado: os mais votados que ainda não foram eleitos
  const inferidos = new Map(); // só na Câmara: vagas que o TSE já deu a um partido/federação, com o nome pelo ranking da lista
  const guardar = (mapa, c, uf, inferido = false) => {
    if (!mapa.has(c.partido)) mapa.set(c.partido, []);
    mapa.get(c.partido).push({ nome: c.nomeUrna, uf, inferido });
  };
  await Promise.all(itens.map(async ({ uf }) => {
    try {
      const { dados } = await getJson(`/api/resultado/${estado.cargo}/${uf}`);
      const candidatos = dados?.candidatos ?? [];
      for (const c of candidatos) if (c.situacao === 'eleito') guardar(porPartido, c, uf);
      if (estado.cargo === 6) {
        // `vag` (vagas conquistadas) pode estar preenchido antes de os eleitos serem marcados. Dentro de uma lista
        // (partido ou federação) as vagas vão para os mais votados, então os que faltam são os próximos do ranking.
        for (const agr of dados.agrupamentos) {
          const da = candidatos.filter((c) => c.agrupamentoId === agr.id);
          const faltam = agr.vagas - da.filter((c) => c.situacao === 'eleito').length;
          da.filter((c) => c.situacao !== 'eleito' && c.votos > 0).slice(0, Math.max(0, faltam))
            .forEach((c) => guardar(inferidos, c, uf, true));
        }
      }
      if (estado.cargo === 5) {
        // Vagas ainda abertas na UF = vagas − eleitos; ocupam-nas, por ora, os mais votados (a lista vem ordenada por votos).
        const abertas = dados.cargo.vagas - candidatos.filter((c) => c.situacao === 'eleito').length;
        candidatos.filter((c) => c.situacao !== 'eleito' && c.votos > 0).slice(0, Math.max(0, abertas)).forEach((c) => guardar(lideres, c, uf));
      }
    } catch { /* sem o nome, o hover mostra só o partido */ }
  }));
  if (chave.startsWith(`${estado.cargo}|`) && ehAgregado()) {
    estado.eleitos = porPartido;
    estado.lideres = lideres;
    estado.inferidos = inferidos;
  }
}

// ---------- municípios da UF aberta (mapa de municípios) ----------

// Só os cargos majoritários com resultado por município; Brasil, exterior e DF (um município só) ficam de fora.
const querMunicipios = () =>
  estado.visao !== 'comparativo' && [1, 3, 5].includes(estado.cargo) && !['br', 'zz', 'df'].includes(estado.uf) && cargoMeta().abrangencias.includes(estado.uf);
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

const querHistorico = () => [1, 3, 5].includes(estado.cargo) && !ehAgregado() && estado.visao === 'apuracao';
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
  const ancora = raiz.querySelector('.mais-num');
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
      if (estado.partidos.ativo && estado.partidos.cargo !== PRESIDENTE.codigo) {
        await Promise.all([carregarResumo(), carregarHistoricoPartidos()]); // a aba Partidos só usa os resumos das UFs
      } else {
        await Promise.all([carregarResumo(), carregarDetalhe(), carregarMunicipios(), buscarHistorico(), carregarMapaProjecao(), carregarHistoricoPartidos()]);
        await carregarEleitos();
      }
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
  // Deputado estadual só tem SP e RJ e não tem visão Brasil: abre direto em SP.
  return meta.abrangencias.length === 1 || cargo === 7 ? meta.abrangencias[0] : 'br';
}

function lerHash() {
  const hash = location.hash;
  const comp = /^#\/partidos\/1\/comparativo(?:\/(\d{4}x\d{4}))?(?:\/([a-z]{2}))?$/.exec(hash);
  const p = !comp && /^#\/partidos(?:\/(\d+))?(?:\/([a-z]+))?((?:\/[a-z0-9]+)*)$/.exec(hash);
  estado.partidos.ativo = Boolean(comp || p) && cargosDePartidos().length > 0;
  if (p && estado.partidos.ativo) {
    const pedido = Number(p[1]);
    // Presidente na aba Análises é o comparativo, que tem endereço próprio.
    if (pedido === PRESIDENTE.codigo) { history.replaceState(null, '', hashPartidos(PRESIDENTE.codigo)); return lerHash(); }
    estado.visao = 'apuracao';
    estado.partidos.cargo = cargosDePartidos().some((c) => c.codigo === pedido) ? pedido : cargosDePartidos().find((c) => c.codigo !== PRESIDENTE.codigo).codigo;
    estado.partidos.aba = p[2] ?? 'placar';
    // Depois da análise vêm, em qualquer ordem, o agrupamento (partido) e os cartões (2022 ou delta).
    const extras = p[3].split('/').filter(Boolean);
    estado.partidos.agrupar = extras.includes('partido') ? 'partido' : 'ideologia';
    estado.partidos.cartoes = CARTOES.find((id) => extras.includes(id) && id !== '2026') ?? '2026';
    estado.partidos.uf = extras.find((t) => /^[a-z]{2}$/.test(t)) ?? estado.partidos.uf; // deputado estadual: SP ou RJ
    return;
  }
  const m = comp ? [hash, '1', comp[2] ?? 'br', 'comparativo', comp[1]] : /^#\/(\d+)\/([a-z]{2})(?:\/(projecao|comparativo)(?:\/([a-z0-9]+))?)?(?:\/([cm])\/(\w+))?$/.exec(hash);
  const modeloPedido = m?.[4];
  const cargo = m ? Number(m[1]) : estado.meta.cargos[0].codigo;
  const meta = cargoMeta(cargo) ?? estado.meta.cargos[0];
  estado.cargo = meta.codigo;
  // O comparativo com 2022 só existe para presidente.
  estado.visao = m?.[3] === 'projecao' ? 'projecao' : m?.[3] === 'comparativo' && meta.codigo === 1 ? 'comparativo' : 'apuracao';
  if (estado.visao === 'comparativo') {
    estado.comparativo.periodo = PERIODOS[modeloPedido] ? modeloPedido : PADRAO;
    estado.partidos.ativo = cargosDePartidos().length > 0;
    estado.partidos.cargo = PRESIDENTE.codigo;
  }
  // Modelo que não vale para o cargo aberto (ex.: swing em governador) volta para o simples.
  estado.modelo = modelosDoCargo(meta.codigo).some((x) => x.id === modeloPedido) ? modeloPedido : 'ingenuo';
  const ufPedida = m?.[2];
  const valida = ufPedida && (meta.abrangencias.includes(ufPedida) || (ufPedida === 'br' && meta.codigo !== 1 && meta.codigo !== 7));
  estado.uf = valida ? ufPedida : ufPadrao(meta.codigo);
  estado.busca = '';
  estado.mostrarTodos = false;
  estado.destaque = m?.[5] ? { tipo: m[5], id: m[6] } : null;
  estado.destaqueRolado = false;
  // Endereço antigo do comparativo (#/1/br/comparativo): vira o novo, na aba Análises.
  if (estado.visao === 'comparativo' && !comp) history.replaceState(null, '', hashPara(1, estado.uf, 'comparativo'));
}

async function aplicarHash() {
  lerHash();
  estado.detalhe = undefined;
  estado.projecao = undefined;
  estado.comparacao = undefined;
  estado.mapaProj = undefined;
  estado.mun = undefined;
  estado.eleitos = null;
  estado.lideres = null;
  estado.inferidos = null;
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
    .map((c) => `<a class="aba" href="${hashPara(c.codigo, ufPadrao(c.codigo))}" ${c.codigo === estado.cargo && !estado.partidos.ativo ? 'aria-current="page"' : ''}>${esc(c.nome)}</a>`)
    .join('');
  const abaPartidos = cargosDePartidos().length
    ? `<a class="aba" href="${hashPartidos(estado.partidos.cargo, estado.partidos.aba, estado.partidos.agrupar, estado.partidos.cartoes, estado.partidos.uf)}" ${estado.partidos.ativo ? 'aria-current="page"' : ''}>Análises</a>`
    : '';
  if (estado.partidos.ativo) { $('#abas').innerHTML = `<div class="seg">${itens}${abaPartidos}</div>`; return; }
  // Seletor global Apuração | Projeção: vale para a página toda e acompanha a troca de cargo e de UF. Fica na ponta
  // direita da linha dos cargos. O seletor de modelo fica dentro do painel da projeção.
  const visao = (id, rotulo) =>
    `<a class="aba" href="${hashPara(estado.cargo, estado.uf, id)}" ${estado.visao === id ? 'aria-current="page"' : ''}>${rotulo}</a>`;
  const modo = `<div class="seg seg-modo" role="group" aria-label="Visão">${visao('apuracao', 'Apuração')}${visao('projecao', 'Projeção')}</div>`;
  $('#abas').innerHTML = `<div class="seg">${itens}${abaPartidos}</div>${modo}`;
}

// No mapa da projeção a UF ganha a cor do vencedor projetado, mais forte quanto maior a margem sobre o 2º.
const projecaoNoMapa = (uf) => estado.visao === 'projecao' && estado.mapaProj?.chave === chaveMapaProj() && !(uf === 'br' && !temArquivoNacional(estado.cargo));
const forcaMargem = (margem) => Math.round(Math.min(100, 30 + (margem / 20) * 70));

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
  if (estado.visao === 'comparativo') return dadoComparativo(uf);
  // "Brasil" nos cargos sem arquivo nacional é a soma das UFs; nos demais casos é um arquivo comum.
  if (projecaoNoMapa(uf)) {
    const proj = estado.mapaProj.porUf.get(uf);
    return proj
      ? { sub: esc(proj.lider.partido), sub2: fmtPct(proj.lider.pctProjetado, 0), pct: forcaMargem(proj.margem), cor: corPartido(proj.lider.partido), vazio: false }
      : { sub: '', sub2: '—', pct: 0, cor: null, vazio: true };
  }
  return uf === 'br' && !temArquivoNacional(estado.cargo)
    ? { sub: 'Visão geral', sub2: fmtPct(agregadoSecoes().pct, 0), pct: agregadoSecoes().pct, cor: null, vazio: false }
    : conteudoTile(itemResumo(estado.cargo, uf));
}

// Comparativo entre eleições (ver comparativo-eleicoes.js): o que o mapa, a dica e a legenda mostram.
function modeloComparativo() {
  const base = estado.comparativo.bases[estado.comparativo.periodo];
  if (!base?.disponivel) return null;
  return calcular(base, itemDoAtual(base, (uf) => itemResumo(1, uf)), { periodo: periodoPorId(estado.comparativo.periodo) });
}

function dadoComparativo(uf) {
  const modelo = modeloComparativo();
  if (uf === 'br') return { sub: 'Brasil', sub2: modelo?.total.impacto == null ? '—' : `${sinal(modelo.total.impacto)} p.p.`, pct: 0, cor: null, vazio: false };
  const u = modelo?.ufs.find((x) => x.uf === uf);
  const cor = corDoMapa(u, modelo?.escala);
  return cor
    ? { sub: sinal(u.saldo, 1), sub2: 'p.p.', pct: cor.forca, cor: corPartido(cor.candidato === 'pt' ? 'PT' : 'PL'), vazio: false }
    : { sub: '', sub2: '—', pct: 0, cor: null, vazio: true };
}

function dicaComparativoHtml(uf) {
  const modelo = modeloComparativo();
  const u = modelo?.ufs.find((x) => x.uf === uf);
  if (!u) return `<strong>${esc(nomeUf(uf))}</strong><span class="muted">Fora do comparativo</span>`;
  const p = modelo.periodo;
  const linha = (c) => {
    const x = u[c.id];
    const variacao = x.d == null ? '' : ` · ${sinal(x.d, 1)} p.p.`;
    return `<span class="dica-lider" style="--cor:${corPartido(c.partido)}"><i></i><span>${esc(tituloDe(c))}<small>${p.anoBase}: ${fmtPct(x.pBase, 1)} · ${p.anoAtual}: ${u.validosAtual ? fmtPct(x.pAtual, 1) : '—'}${variacao}</small></span></span>`;
  };
  const rodape = u.pronto ? `Impacto no Brasil: ${sinal(u.impacto)} p.p.` : `Apuração em ${fmtPct(u.fracao, 0)}: ainda fora do comparativo`;
  return `<strong>${esc(nomeUf(uf))}</strong>${linha({ id: 'pt', ...p.pt })}${linha({ id: 'pl', ...p.pl })}<span class="muted">${rodape}</span>`;
}

function legendaComparativoHtml() {
  const p = periodoPorId(estado.comparativo.periodo);
  const escala = modeloComparativo()?.escala ?? ESCALA_SALDO;
  return `<div class="leg-linha"><span class="leg-titulo">Saldo na UF</span><span class="muted">${esc(p.pl.curto ?? p.pl.nome)}</span>
      <span class="leg-grad leg-div" style="--esq:${corPartido('PL')};--dir:${corPartido('PT')}"></span><span class="muted">${esc(p.pt.curto ?? p.pt.nome)}</span></div>
    <p class="muted pequeno leg-nota">Cor = variação de ${esc(p.pt.curto ?? p.pt.nome)} − variação de ${esc(p.pl.curto ?? p.pl.nome)} em relação a ${p.anoBase} (cor cheia a ±${escala} p.p.).${p.vivo ? ' Cinza: menos de 50% das seções, ainda fora do comparativo.' : ''}</p>`;
}

function comparativoPainelHtml() {
  const periodo = estado.comparativo.periodo;
  const p = periodoPorId(periodo);
  const base = estado.comparativo.bases[periodo];
  const topo = `<div class="detalhe-topo"><div><h2>Presidente · ${esc(p.rotulo)}</h2></div></div>`;
  if (base === undefined) return `${topo}<p class="vazio-msg">Carregando…</p>`;
  if (!base?.disponivel) return `${topo}<p class="aviso-bloco espera">${esc(base?.motivo ?? 'Não consegui carregar os dados deste período.')}</p>`;
  return comparativoHtml(modeloComparativo(), { uf: estado.uf, regiao: estado.comparativo.regiao, terceiros: estado.comparativo.terceiros }, {
    esc, fmtInt, corPartido, nomeUf, hrefUf: (uf) => hashPara(1, uf), demo: estado.meta.demo,
  });
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
  if (estado.uf === 'br' || meta.codigo === 7 || !(meta.abrangencias.includes('br') || meta.codigo !== 1)) return '';
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
  const fora = estado.visao === 'comparativo' && estado.comparativo.regiao && regiaoDaUf(uf) !== estado.comparativo.regiao;
  return `<a class="uf${dado.vazio ? ' vazio' : ''}${fora ? ' fora' : ''}" href="${hashPara(estado.cargo, uf)}" data-uf="${uf}"${estilo}
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

function legendaHtml({ unidade = 'UF' } = {}) {
  if (estado.visao === 'comparativo') return legendaComparativoHtml();
  const gradiente = (cor) => `<span class="leg-grad" style="--cor:${cor}"></span>`;
  // Mesma linha em todos os cargos: o gradiente mostra a fatia das seções já totalizadas.
  const totalizadas = `<div class="leg-linha"><span class="leg-titulo">Seções totalizadas</span><span class="muted">0%</span>${gradiente('var(--accent)')}<span class="muted">100%</span></div>`;
  // Fora da projeção não há chave de cores dos partidos: o painel ao lado já mostra a etiqueta colorida de cada um.
  if (ehMajoritario(estado.cargo) && unidade === 'UF' && estado.visao === 'projecao') {
    const vencedores = [...new Set([...(estado.mapaProj?.porUf.values() ?? [])].map((x) => x.lider.partido))].sort();
    const itens = vencedores.map((p) => `<span class="leg-item"><i style="background:${corPartido(p)}"></i>${esc(p)}</span>`).join('');
    return `<div class="leg-linha"><span class="leg-titulo">Vencedor projetado (estimativa)</span>${itens || '<span class="muted">calculando…</span>'}</div>
      <div class="leg-linha"><span class="leg-titulo">Margem</span><span class="muted">estreita</span>${gradiente('var(--text)')}<span class="muted">ampla</span></div>`;
  }
  return totalizadas;
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

  // Deputado estadual (só SP e RJ) não tem visão Brasil.
  const temTotal = meta.codigo !== 7 && (ativas.has('br') || meta.codigo !== 1);
  if (temTotal) $('#grade').insertAdjacentHTML('beforeend', totalBrasilHtml());
  destacarMunicipio();
  $('#legenda').innerHTML = municipal
    ? legendaHtml({ unidade: 'município' })
      + (estado.visao === 'projecao' ? '<p class="muted pequeno leg-nota">Municípios: apuração atual. A projeção é por UF.</p>' : '')
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

function dicaProjecaoHtml(uf) {
  const proj = estado.mapaProj.porUf.get(uf);
  if (!proj) return `<strong>${esc(nomeUf(uf))}</strong><span class="muted">Sem projeção ainda</span>`;
  const l = proj.lider;
  return `<strong>${esc(nomeUf(uf))}</strong><span class="dica-lider" style="--cor:${corPartido(l.partido)}"><i></i><span>${esc(l.nomeUrna)}<small>${esc(l.partido)} · ${fmtPct(l.pctProjetado)} projetado</small></span></span>
    <span class="muted">Margem projetada: ${fmtPct(proj.margem, 1)} sobre o 2º</span>`;
}

function dicaHtml(uf) {
  if (estado.visao === 'comparativo') return dicaComparativoHtml(uf);
  if (projecaoNoMapa(uf)) return dicaProjecaoHtml(uf);
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

// Informação de apoio: fechado, só comparecimento e abstenção numa linha; aberto, os quatro números com os valores
// absolutos. O estado (aberto ou não) sobrevive aos redesenhos do painel.
function numerosHtml(dados) {
  const { eleitorado: e, votos: v } = dados;
  const caixa = (rotulo, valor, pct) => `<div class="numero"><b>${fmtPct(pct)}</b><span>${rotulo}</span><span class="valor">${fmtInt(valor)}</span></div>`;
  const resumo = (rotulo, pct) => `<span><i>${rotulo}</i> <b>${fmtPct(pct)}</b></span>`;
  // Brancos e nulos não entram no cálculo de quem vence, então ficam juntos num bloco só.
  return `<details class="mais-num"${estado.numerosAbertos ? ' open' : ''}>
    <summary>
      <span class="resumo-linha">${resumo('Comparecimento', e.pctComparecimento)}${resumo('Abstenção', e.pctAbstencao)}</span>
      <span class="alterna"><span class="mais-ab">Mais números ▾</span><span class="mais-fe">Menos ▴</span></span>
    </summary>
    <div class="numeros quatro">
      ${caixa('Comparecimento', e.comparecimento, e.pctComparecimento)}
      ${caixa('Abstenção', e.abstencao, e.pctAbstencao)}
      ${caixa('Votos válidos', v.validos, v.pctValidos)}
      ${caixa('Brancos e nulos', v.brancos + v.nulos, v.pctBrancos + v.pctNulos)}
    </div>
  </details>`;
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

// Antes de qualquer voto não há o que mostrar: sem barra, sem líder e um traço no lugar de "0,00%" repetido.
function candidatoHtml(c, posicao, largura, semVotos = false) {
  const cor = corPartido(c.partido);
  const classes = [
    estado.destaque?.tipo === 'c' && estado.destaque.id === String(c.sq) ? 'destaque' : '',
    posicao === 1 && !semVotos ? 'lider' : '',
  ].filter(Boolean).join(' ');
  // Em disputa proporcional o número identifica o candidato (e a busca usa ele); nos majoritários é o do partido.
  const numero = ehProporcional(estado.cargo) ? `<span class="cand-num">${esc(c.numero)}</span>` : '';
  return `<li${classes ? ` class="${classes}"` : ''} style="--cor:${cor}">
    <div class="cand-topo">
      <span class="cand-pos">${posicao}</span>
      <div class="cand-nome"><strong>${esc(c.nomeUrna)}</strong>${numero}<span class="partido" title="${esc(c.partidoNome)}">${esc(c.partido)}</span>${pilulaSituacao(c)}</div>
      <div class="cand-votos">${semVotos ? '<b class="sem-votos">—</b>' : `<b>${fmtPct(c.pct)}</b><small>${fmtInt(c.votos)}</small>`}</div>
    </div>
    ${semVotos ? '' : `<div class="barra"><i style="width:${largura}%"></i></div>`}
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

// Mapa de cadeiras da Assembleia Legislativa (deputado estadual): como a Câmara, mas de uma UF só, então os nomes saem
// do próprio arquivo aberto. Eleitos marcados + vagas que o TSE já deu a um partido/federação (nome pelo ranking da lista).
function cadeirasAssembleiaHtml(d) {
  const candidatos = d.candidatos;
  const partidos = {};
  const guardar = (c, inferido) => {
    const p = (partidos[c.partido] ??= { eleitos: 0, pessoasEleitas: [] });
    p.eleitos += 1;
    p.pessoasEleitas.push({ nome: c.nomeUrna, inferido });
  };
  let definidas = 0;
  for (const c of candidatos) if (c.situacao === 'eleito') { guardar(c, false); definidas += 1; }
  for (const agr of d.agrupamentos) {
    const lista = candidatos.filter((c) => c.agrupamentoId === agr.id);
    const faltam = Math.max(0, agr.vagas - lista.filter((c) => c.situacao === 'eleito').length);
    for (const c of lista.filter((x) => x.situacao !== 'eleito' && x.votos > 0).slice(0, faltam)) { guardar(c, true); definidas += 1; }
  }
  return cadeirasHtml({
    titulo: `Composição da Assembleia Legislativa · ${nomeUf(estado.uf)}`,
    total: d.cargo.vagas,
    pendentes: Math.max(0, d.cargo.vagas - definidas),
    partidos,
    ocupadas: false,
  }, estado.cadeiras, { esc, corPartido, fmtInt });
}


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
  if (d.secoes.totalizadas > 0 && !d.totalizacaoFinal) {
    aviso.push('<p class="aviso-bloco">Resultado parcial: os percentuais refletem só as seções já totalizadas e podem mudar bastante, porque as regiões chegam em ordens diferentes.</p>');
  }

  const candidatos = d.candidatos;
  let topo = '';
  if (ehMajoritario(d.cargo.codigo) && candidatos.length > 1 && candidatos[0].votos > 0) {
    const [a, b] = candidatos;
    topo = `<p class="aviso-bloco"><b>${esc(a.nomeUrna)}</b> está ${fmtInt(a.votos - b.votos)} votos (${fmtPct(a.pct - b.pct)} pontos) à frente de <b>${esc(b.nomeUrna)}</b>.</p>`;
  }

  const semVotos = candidatos.every((c) => !c.votos);
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
        <ol class="candidatos" style="list-style:none;padding:0">${candidatoHtml(escolhido, posicaoGeral.get(escolhido.sq), largura(escolhido), semVotos)}</ol>`
      : '';
    lista = `<div class="ferramentas">
        <input id="busca" type="search" placeholder="Buscar candidato, número ou partido" value="${esc(estado.busca)}" autocomplete="off">
        ${termo || filtrados.length <= 20 ? '' : `<button class="botao" id="mostrar-todos">${estado.mostrarTodos ? 'Mostrar só os 20 primeiros' : `Mostrar todos (${fmtInt(filtrados.length)})`}</button>`}
      </div>
      <ol class="candidatos" style="list-style:none;padding:0">${visiveis.map((c) => candidatoHtml(c, posicaoGeral.get(c.sq), largura(c), semVotos)).join('')}</ol>
      ${filtrados.length === 0 ? '<p class="vazio-msg">Nenhum candidato encontrado.</p>' : ''}
      ${termo && filtrados.length > limite ? `<p class="muted pequeno">Mostrando ${limite} de ${fmtInt(filtrados.length)}. Refine a busca.</p>` : ''}
      ${agrupamentosHtml(d)}`;
  } else {
    lista = `<ol class="candidatos">${candidatos.map((c, i) => candidatoHtml(c, i + 1, c.pct, semVotos)).join('')}</ol>`;
  }

  const vagas = d.cargo.vagas > 1 ? ` · ${d.cargo.vagas} vagas` : '';
  const subtitulo = ehProporcional(d.cargo.codigo) ? `${fmtInt(candidatos.length)} candidatos${vagas}` : d.cargo.vagas > 1 ? `${d.cargo.vagas} vagas` : '';
  return `<div class="detalhe-topo"><div><h2>${esc(titulo)}</h2>
      ${subtitulo ? `<p class="muted pequeno">${subtitulo}</p>` : ''}</div>
      ${selosHtml(d, det.status)}</div>
    ${aviso.join('')}
    ${progressoHtml(d.secoes)}
    ${numerosHtml(d)}
    ${topo ? `<div style="margin-top:14px">${topo}</div>` : ''}
    ${d.cargo.codigo === 7 ? cadeirasAssembleiaHtml(d) : ''}
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
  let inferidas = 0;
  for (const sigla of new Set([...Object.keys(porPartido), ...(estado.inferidos?.keys() ?? [])])) {
    const nomeados = estado.eleitos?.get(sigla) ?? [];
    const inferidos = estado.inferidos?.get(sigla) ?? [];
    inferidas += inferidos.length;
    partidos[sigla] = { eleitos: (porPartido[sigla] ?? 0) + inferidos.length, pessoasEleitas: [...nomeados, ...inferidos] };
  }
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
  let naFrente = 0;
  for (const [sigla, pessoas] of estado.lideres ?? []) {
    naFrente += pessoas.length;
    partidos[sigla] = { ...partidos[sigla], lideres: pessoas.length, pessoasLideres: pessoas };
  }
  const eleitos = Object.values(porPartido).reduce((s, n) => s + n, 0);
  return cadeirasHtml({
    titulo: codigo === 5 ? 'Composição do Senado' : 'Composição da Câmara',
    total: vagas,
    pendentes: Math.max(0, vagas - eleitos - inferidas - naFrente),
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

  const porPartido = {};
  for (const { item } of itens) {
    for (const [partido, n] of Object.entries(item.eleitosPorPartido ?? {})) porPartido[partido] = (porPartido[partido] ?? 0) + n;
  }
  const partidos = Object.entries(porPartido).sort((a, b) => b[1] - a[1]);
  const maior = partidos[0]?.[1] ?? 0;

  const barras = partidos.length
    ? `<h3 class="secao">Eleitos por partido</h3>
       <ol class="candidatos">${partidos.map(([p, n], i) => `<li class="${i === 0 ? 'lider' : ''}" style="--cor:${corPartido(p)}">
         <div class="cand-topo"><span class="cand-pos">${i + 1}</span><div class="cand-nome"><strong>${esc(p)}</strong></div>
         <div class="cand-votos"><b>${fmtInt(n)}</b></div></div>
         <div class="barra"><i style="width:${(n / maior) * 100}%"></i></div></li>`).join('')}</ol>`
    : '<p class="aviso-bloco espera">Nenhum candidato eleito ainda.</p>';

  let tabela = '';
  const porNome = (a, b) => nomeUf(a.uf).localeCompare(nomeUf(b.uf), 'pt-BR');
  if (meta.codigo === 3 || meta.codigo === 5) {
    // Governador e Senado: 1º, 2º e 3º colocados de cada UF, com o nome e a tag do partido na mesma célula.
    const celula = (c) => (c
      ? `<td><div class="colocado-nome">${esc(c.nomeUrna)}</div>
          <div class="colocado-info"><span class="partido" style="--cor:${corPartido(c.partido)}">${esc(c.partido)}</span>
          <span class="muted pequeno">${fmtPct(c.pct)}${c.situacao === 'eleito' ? ' · eleito' : ''}</span></div></td>`
      : '<td class="muted">—</td>');
    const linhas = itens.slice().sort(porNome).map(({ uf, item }) => {
      const [a, b, c] = item.colocados ?? [];
      return `<tr class="clicavel" data-uf="${uf}"><td>${esc(nomeUf(uf))}</td>${celula(a)}${celula(b)}${celula(c)}
        <td class="num">${fmtPct(item.secoes.pctTotalizadas)}</td></tr>`;
    }).join('');
    tabela = `<h3 class="secao">Mais votados em cada UF</h3>
      <div class="tabela-rolagem"><table class="tabela tabela-colocados">
        <thead><tr><th>UF</th><th>1º</th><th>2º</th><th>3º</th><th class="num">Totalizadas</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>`;
  }

  return `<div class="detalhe-topo"><div><h2>${esc(meta.nome)} · Brasil</h2></div></div>
    ${progressoHtml(secoes, 'Seções totalizadas (todas as UFs)')}
    ${cadeirasAgregadoHtml(meta.codigo, vagas, porPartido)}
    ${barras}${tabela}`;
}

// ---------- desenho: projeção (estimativa do painel, não é dado do TSE) ----------

// Seletor de modelo: mesmo controle segmentado das abas de cargo, na linha delas (o modelo também pinta o mapa).
function seletorModeloHtml() {
  const lista = modelosDoCargo();
  if (estado.visao !== 'projecao' || lista.length < 2) return '';
  const itens = lista.map((m) =>
    `<a class="aba" href="${hashPara(estado.cargo, estado.uf, 'projecao', m.id)}" ${m.id === estado.modelo ? 'aria-current="page"' : ''}>${esc(m.curto ?? m.nome)}</a>`).join('');
  return `<div class="seg seg-modelo" role="group" aria-label="Modelo de projeção">${itens}</div>`;
}

// Uma linha sob o título do painel dizendo o que o modelo escolhido faz.
function resumoModeloHtml() {
  const resumo = estado.meta.modelos.find((m) => m.id === estado.modelo)?.resumo;
  return resumo ? `<p class="muted pequeno resumo-modelo">${esc(resumo)}</p>` : '';
}

// Detalhe completo dos modelos, recolhido no rodapé: descrição do escolhido e os que ainda não existem.
function sobreModelosHtml() {
  const atual = estado.meta.modelos.find((m) => m.id === estado.modelo);
  const pendentes = estado.meta.modelos.filter((m) => !m.disponivel)
    .map((m) => `<li><b>${esc(m.nome)} (em breve):</b> ${esc(m.motivo)}</li>`).join('');
  return `<p class="muted pequeno">${esc(atual.descricao)}</p>
    ${pendentes ? `<ul class="muted pequeno lista-pendentes">${pendentes}</ul>` : ''}`;
}

// Só no modelo por município: quanto da projeção depende de municípios que ainda não apuraram nada.
function municipiosHtml(p) {
  const avisos = [];
  // Plano B: arquivos da UF e dos municípios em momentos diferentes, então a projeção é a extrapolação simples.
  if (p.mantida) {
    avisos.push(`<b>Projeção de poucos minutos atrás.</b> Os arquivos desta UF saíram de sincronia por um instante (${esc(p.mantida.motivo ?? '')}); a tela mantém a última projeção por município em vez de trocar de modelo.`);
  }
  if (p.plano === 'extrapolacao') {
    avisos.push(`<b>Usando a extrapolação simples nesta UF.</b> ${esc(p.motivoPlano ?? '')} Volta ao modelo por município quando os arquivos se alinharem.`);
  }
  if (p.ufs?.planoB > 0) avisos.push(`${fmtInt(p.ufs.planoB)} UF(s) estão na extrapolação simples porque os arquivos delas estão em momentos diferentes.`);
  if (!p.municipios) return avisos.map((a) => `<p class="aviso-bloco">${a}</p>`).join('');

  // Swing histórico: quanto cada candidato está acima ou abaixo do que o campo dele teve em 2022 nos lugares já apurados.
  const swingHtml = p.swing?.length
    ? `<h3 class="secao">Variação em relação a 2022</h3>
       <div class="tabela-rolagem"><table class="tabela">
         <thead><tr><th>Candidato</th><th class="num">Pontos percentuais</th></tr></thead>
         <tbody>${p.swing.slice(0, 8).map((x) => `<tr><td><b>${esc(x.nomeUrna)}</b> <span class="partido" style="--cor:${corPartido(x.partido)}">${esc(x.partido)}</span></td>
           <td class="num">${x.pontos > 0 ? '+' : ''}${fmtPct(x.pontos, 1)}</td></tr>`).join('')}</tbody></table></div>
       <p class="muted pequeno">Medido onde a apuração já passa de 50% e somado ao resultado de 2022 de cada lugar. Votos de 2022 sem herdeiro (ex.: candidatos de partidos que não concorrem) entram pela própria variação.</p>`
    : '';

  const m = p.municipios;
  const grandes = m.grandes != null;
  if (m.semVotos > 0 && p.parteEstimadaPelaUf > 0) {
    avisos.push(grandes
      ? `${fmtInt(m.semVotos)} município(s) grande(s) ainda sem votos entram pela média do que já foi medido.`
      : `${fmtInt(m.semVotos)} município(s) ainda sem votos entram pela média da UF.`);
  }
  if (p.resto) {
    avisos.push(`O resto do estado (${fmtInt(p.resto.municipios)} municípios menores) é projetado em bloco: ${p.resto.iniciado ? `${fmtPct(p.resto.fracao * 100, 0)} das seções dele apuradas` : 'ainda sem apuração, entra pelo eleitorado'}. Ele responde por <b>${fmtPct(p.resto.parte * 100, 0)}</b> do total projetado.`);
  }
  if (p.parteEstimadaPelaUf > 0) avisos.push(`<b>${fmtPct(p.parteEstimadaPelaUf * 100, 0)}</b> do total projetado vem de partes sem apuração, estimadas pela média do que já foi medido.`);
  if (m.semArquivo > 0) avisos.push(`${fmtInt(m.semArquivo)} município(s) sem arquivo no TSE ficaram de fora, então a projeção está incompleta.`);
  if (p.ufs?.semVotos > 0) avisos.push(`${fmtInt(p.ufs.semVotos)} UF(s) ainda sem nenhum município apurado entram pelo eleitorado e pela média das demais.`);
  if (p.conferencia && Math.abs(p.conferencia.diferencaPct) > 2) {
    avisos.push(`A soma dos municípios (${fmtInt(p.conferencia.municipios)} votos válidos) difere ${fmtPct(Math.abs(p.conferencia.diferencaPct), 1)} do arquivo da UF (${fmtInt(p.conferencia.uf)}). Podem estar em momentos diferentes da apuração.`);
  }
  if (p.aviso) avisos.push(esc(p.aviso));
  const rotulo = grandes ? 'Municípios grandes com votos' : 'Municípios com votos';
  return `<div class="numeros">
      <div class="numero"><b>${fmtInt(m.comVotos)}</b><span>${rotulo} de ${fmtInt(grandes ? m.grandes : m.total)}</span></div>
      <div class="numero"><b>${fmtInt(m.semVotos)}</b><span>${grandes ? 'Grandes ainda sem votos' : 'Municípios ainda sem votos'}</span></div>
    </div>
    ${avisos.map((a) => `<p class="aviso-bloco">${a}</p>`).join('')}
    ${swingHtml}`;
}

function detalheProjecaoHtml() {
  const titulo = `${cargoMeta().nome} · ${nomeUf(estado.uf)}`;
  const topo = `<div class="detalhe-topo"><div><h2>${esc(titulo)}</h2>
      <p class="muted pequeno">Projeção do resultado final · <b>não é resultado do TSE</b></p></div>
      <div class="selos"><span class="selo aviso">Estimativa do painel</span></div></div>
    ${seletorModeloHtml()}${resumoModeloHtml()}`;
  // Modelo e explicações ficam recolhidos: o que importa primeiro é a tabela.
  const comoCalcula = `<details class="como-calcula"${estado.comoAberto ? ' open' : ''}><summary>Como é calculado · ${esc(estado.meta.modelos.find((m) => m.id === estado.modelo)?.nome ?? '')}</summary>
      <p class="aviso-bloco">Isto <b>não é resultado do TSE</b>: é uma extrapolação feita por este painel a partir de uma apuração parcial, com limitações. Só o resultado oficial vale.</p>
      ${sobreModelosHtml()}</details>`;
  const p = estado.projecao;
  if (p === undefined) return `${topo}<p class="vazio-msg">Carregando…</p>${comoCalcula}`;
  if (!p || !p.disponivel) {
    const { feitos, total, unidade = 'municípios' } = p?.progresso ?? {};
    const andamento = p?.carregando && total ? ` (${fmtInt(feitos)} de ${fmtInt(total)} ${unidade})` : '';
    const frac = (p?.fracaoApurada ?? 0) * 100;
    return `${topo}<div class="vazio-proj"><div class="ic" aria-hidden="true">◷</div>
      <b>${p?.carregando ? 'Calculando a projeção…' : 'Aguardando os primeiros votos'}</b>
      <span class="muted pequeno">${esc(p?.motivo ?? 'Projeção indisponível.')}${andamento}</span>
      ${p?.carregando ? '' : `<div class="trilho"><i style="width:${frac}%"></i></div>
      <span class="muted pequeno">${fmtPct(frac, 0)} das seções totalizadas</span>`}</div>${comoCalcula}`;
  }

  // Barras na mesma escala: a do maior percentual (projetado ou atual) entre os candidatos.
  const escala = Math.min(100, Math.max(1, ...p.candidatos.map((c) => Math.max(c.pctProjetado, c.pctAtual))));
  const x = (pct) => Math.min(100, (pct / escala) * 100);
  const [lider, segundo] = p.candidatos;
  const margem = lider.pctProjetado - (segundo?.pctProjetado ?? 0);
  const heroi = `<div class="heroi" style="--cor:${corPartido(lider.partido)}">
      <div><span class="muted pequeno">Lidera a projeção</span>
        <div class="heroi-nome"><b>${esc(lider.nomeUrna)}</b> <span class="partido" style="--cor:${corPartido(lider.partido)}">${esc(lider.partido)}</span></div></div>
      <div class="heroi-num"><b>${fmtPct(lider.pctProjetado, 1)}</b>${segundo ? `<span class="muted pequeno">+${fmtPct(margem, 1).replace('%', '')} pp sobre o 2º</span>` : ''}</div></div>`;
  const linhas = p.candidatos.map((c) => `<li class="proj-cand" style="--cor:${corPartido(c.partido)}">
      <div class="proj-topo"><span><b>${esc(c.nomeUrna)}</b> <span class="partido" style="--cor:${corPartido(c.partido)}">${esc(c.partido)}</span></span><b>${fmtPct(c.pctProjetado)}</b></div>
      <div class="proj-barra" role="img" aria-label="Projetado ${fmtPct(c.pctProjetado)}, atual ${fmtPct(c.pctAtual)}">
        <i class="proj-valor" style="width:${x(c.pctProjetado)}%"></i>
        <i class="proj-atual" style="left:${x(c.pctAtual)}%"></i></div>
      <span class="muted pequeno">atual ${fmtPct(c.pctAtual)} · ${fmtInt(c.votosProjetados)} votos</span>
    </li>`).join('');
  return `${topo}
    ${heroi}
    <ul class="proj-lista">${linhas}</ul>
    <p class="muted pequeno proj-legenda"><span class="lg-valor"></span>projetado <span class="lg-atual"></span>atual</p>
    <div class="progresso">
      <div class="progresso-linha"><span>Seções totalizadas usadas como base</span><span><b>${fmtPct(p.fracaoApurada * 100)}</b></span></div>
      <div class="trilho"><i style="width:${p.fracaoApurada * 100}%"></i></div>
    </div>
    <div class="numeros">
      <div class="numero"><b>${fmtInt(p.validosProjetados)}</b><span>Votos válidos projetados</span></div>
      <div class="numero"><b>${fmtInt(p.votosFaltantes)}</b><span>Votos válidos ainda a apurar</span></div>
    </div>
    ${comoCalcula}
    ${municipiosHtml(p)}
    ${comparacaoHtml(p, estado.comparacao, { modelos: estado.meta.modelos, modelo: estado.modelo, esc, fmtPct })}`;
}

// Brasil dos cargos sem arquivo nacional: a projeção é por UF, escolhida no mapa.
function projecaoAgregadoHtml() {
  return `<div class="detalhe-topo"><div><h2>${esc(cargoMeta().nome)} · Brasil</h2>
      <p class="muted pequeno">Projeção do resultado final · <b>não é resultado do TSE</b></p></div>
      <div class="selos"><span class="selo aviso">Estimativa do painel</span></div></div>
    ${seletorModeloHtml()}${resumoModeloHtml()}
    <p class="vazio-msg">Escolha uma UF no mapa para ver a projeção dela. O mapa mostra o vencedor projetado em cada UF.</p>`;
}

// ---------- desenho: orquestração ----------

function renderDetalhe() {
  const raiz = $('#detalhe');
  const buscaFocada = document.activeElement?.id === 'busca';
  const cursor = buscaFocada ? document.activeElement.selectionStart : null;
  const rolagem = window.scrollY;

  if (estado.visao === 'comparativo') raiz.innerHTML = comparativoPainelHtml();
  else if (ehAgregado()) raiz.innerHTML = estado.visao === 'projecao' ? projecaoAgregadoHtml() : detalheAgregadoHtml();
  else raiz.innerHTML = (estado.visao === 'projecao' ? detalheProjecaoHtml() : municipioSelecionadoHtml() + detalheArquivoHtml());

  // "Voltar ao Brasil" vai para o canto do cabeçalho do painel, ao lado dos selos, sem empurrar o título.
  const topoDetalhe = $('.detalhe-topo', raiz);
  if (topoDetalhe && voltarHtml()) {
    const acoes = document.createElement('div');
    acoes.className = 'topo-acoes';
    acoes.innerHTML = voltarHtml();
    const selos = $('.selos', topoDetalhe);
    if (selos) acoes.append(selos);
    topoDetalhe.append(acoes);
  }
  if (estado.visao === 'comparativo') ligarComparativo(raiz, estado.comparativo, () => { renderGrade(); renderDetalhe(); });
  $('.como-calcula', raiz)?.addEventListener('toggle', (e) => { estado.comoAberto = e.target.open; });
  $('.mais-num', raiz)?.addEventListener('toggle', (e) => { estado.numerosAbertos = e.target.open; });

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

// ---------- aba Análises (partidos e ideologia) ----------

// Cargos da aba que o servidor está acompanhando (governador, senador e deputado federal).
// Na mesma ordem do menu principal (a de estado.meta.cargos): Presidente, Governador, Senador, deputados.
const cargosDePartidos = () => estado.meta.cargos.map((c) => (c.codigo === PRESIDENTE.codigo ? PRESIDENTE : cargoPartidos(c.codigo))).filter(Boolean);

// Eleitos de 2014, 2018 e 2022 por partido; não mudam durante a apuração, então carrega uma vez.
async function carregarHistoricoPartidos() {
  if (!estado.partidos.ativo || estado.partidos.cargo === PRESIDENTE.codigo || estado.partidos.historico !== undefined) return;
  try {
    const h = await getJson('/api/partidos');
    estado.partidos.historico = h.disponivel ? h : null;
  } catch {
    estado.partidos.historico = null;
  }
}

function renderPartidos() {
  const cargo = cargoPartidos(estado.partidos.cargo);
  const meta = cargoMeta(cargo.codigo);
  let ufs = meta.abrangencias.filter((uf) => uf !== 'br');
  // Deputado estadual: uma Assembleia por vez (SP ou RJ), a escolhida no seletor de UF.
  const ufsDisponiveis = cargo.ufs ? ufs.filter((uf) => uf in cargo.ufs) : null;
  const uf = ufsDisponiveis ? (ufsDisponiveis.includes(estado.partidos.uf) ? estado.partidos.uf : ufsDisponiveis[0]) : null;
  if (uf) ufs = [uf];
  const itens = ufs.map((u) => itemResumo(cargo.codigo, u)).filter((item) => item?.secoes);
  const modelo = criarModelo({
    cargo,
    historico: estado.partidos.historico,
    itens: itens.map((item) => ({ ...item, uf: item.chave.split(':')[1] })),
    ocupadas: cargo.codigo === 5 ? (estado.senadoOcupadas ?? []) : [],
    ufs,
    uf,
  });
  const ajuda = { esc, fmtInt, corPartido, nomeUf, mapa: MAPA, rotulos: rotulosMapaHtml(new Set(Object.keys(MAPA.ufs))) };
  $('#detalhe').innerHTML = partidosHtml(modelo, {
    aba: estado.partidos.aba, agrupar: estado.partidos.agrupar, cartoes: estado.partidos.cartoes, cargos: cargosDePartidos(), ufs: ufsDisponiveis,
  }, ajuda);
  ligarHover($('#detalhe'), ajuda);
}

// Presidente na aba Análises: cargo e período numa linha só, como os seletores das outras análises; o mapa e a tabela
// ficam no mesmo cartão (ver .analises-comparativo em partidos.css).
function renderTopoAnalises() {
  const raiz = $('#topo-analises');
  const ativo = estado.partidos.ativo && estado.partidos.cargo === PRESIDENTE.codigo;
  $('#principal').classList.toggle('analises-comparativo', ativo);
  raiz.hidden = !ativo;
  if (!ativo) { raiz.innerHTML = ''; return; }
  const periodos = Object.values(PERIODOS).map((p) =>
    `<a class="aba" href="${hashPara(1, estado.uf, 'comparativo', undefined, p.id)}" ${p.id === estado.comparativo.periodo ? 'aria-current="page"' : ''}>${esc(p.rotulo)}</a>`).join('');
  raiz.innerHTML = `${seletorCargosHtml({ cargos: cargosDePartidos(), atual: PRESIDENTE.codigo, aba: estado.partidos.aba, modo: estado.partidos.agrupar, cartoes: estado.partidos.cartoes, uf: estado.partidos.uf, esc })}
    <div class="seg seg-modelo" role="group" aria-label="Período comparado">${periodos}</div>`;
}

function render() {
  renderAbas();
  renderTopoAnalises();
  if (estado.partidos.ativo && estado.partidos.cargo !== PRESIDENTE.codigo) {
    $('#principal').classList.add('sem-mapa');
    renderPartidos();
    renderEstado();
    return;
  }
  renderGrade();
  renderDetalhe();
  renderEstado();
}

// O que o card do topo resume: o arquivo aberto (UF ou Brasil da presidência) ou, nas visões "Brasil" somadas
// (governador, senado, câmara), as UFs juntas, com a hora do arquivo mais recente.
function origemEstado() {
  if (ehAgregado()) {
    const itens = itensDoCargo();
    if (!itens.length) return null;
    const { totalizadas, pct } = agregadoSecoes();
    const geradoEm = itens.map(({ item }) => item.geradoEm).filter(Boolean).sort().at(-1) ?? null;
    return { geradoEm, totalizadas, pct, final: itens.every(({ item }) => item.totalizacaoFinal) };
  }
  const fonte = estado.detalhe?.dados ?? itemResumo(estado.cargo, estado.uf);
  if (!fonte?.secoes) return null;
  return { geradoEm: fonte.geradoEm ?? null, totalizadas: fonte.secoes.totalizadas, pct: fonte.secoes.pctTotalizadas, final: !!fonte.totalizacaoFinal };
}

function renderEstado() {
  const textos = { 'ao-vivo': 'Ao vivo', reconectando: 'Reconectando…', conectando: 'Conectando…' };
  $('#pulso').dataset.estado = estado.conexao;
  $('#estado-texto').textContent = textos[estado.conexao];
  $('#cel-conexao').title = estado.ultimoCicloEm
    ? `Verificado há ${Math.max(0, Math.round((Date.now() - estado.ultimoCicloEm) / 1000))} s · a cada ${estado.meta.intervaloSegundos} s`
    : 'Aguardando a primeira verificação…';

  const origem = origemEstado();
  $('#tse-rotulo').textContent = estado.meta.demo ? 'Simulação' : 'Arquivo do TSE';
  $('#tse-hora').textContent = origem?.geradoEm ? fmtDataHora(origem.geradoEm) : '—';

  const ap = $('#apuracao-estado');
  let texto = '—';
  let tom = '';
  let dica = '';
  if (origem) {
    if (origem.totalizadas === 0) {
      texto = 'Aguardando início';
      dica = 'Os arquivos do TSE já existem, mas ainda não têm votos.';
    } else if (origem.final) {
      texto = 'Apuração concluída';
      tom = 'final';
    } else {
      texto = `Em apuração · ${fmtPct(origem.pct, 1)}`;
      tom = 'parcial';
    }
  }
  ap.textContent = texto;
  ap.className = `v ${tom}`.trim();
  ap.title = dica;
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
  $('#banner-demo').hidden = !meta.demo;

  fetch('/senado-ocupadas.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
    .then((j) => { estado.senadoOcupadas = j?.cadeiras ?? null; if (estado.partidos.ativo) renderPartidos(); else if (estado.cargo === 5) renderDetalhe(); }).catch(() => {});
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
