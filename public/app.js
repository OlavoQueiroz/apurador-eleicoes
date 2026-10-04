// Painel de apuração: busca /api/*, escuta /events (SSE) e redesenha quando chegam dados novos.

const UF_NOME = {
  ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal',
  es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul', mt: 'Mato Grosso',
  pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco', pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro',
  rn: 'Rio Grande do Norte', ro: 'Rondônia', rr: 'Roraima', rs: 'Rio Grande do Sul', sc: 'Santa Catarina',
  se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins', br: 'Brasil', zz: 'Exterior',
};

// Posição [coluna, linha] de cada UF numa grade que lembra o mapa do Brasil.
const GRADE = {
  rr: [1, 0], ap: [3, 0],
  am: [1, 1], pa: [2, 1], ma: [3, 1], pi: [4, 1], ce: [5, 1], rn: [6, 1],
  ac: [0, 2], ro: [1, 2], mt: [2, 2], to: [3, 2], ba: [4, 2], pe: [5, 2], pb: [6, 2],
  ms: [2, 3], go: [3, 3], df: [4, 3], se: [5, 3], al: [6, 3],
  sp: [3, 4], mg: [4, 4], es: [5, 4],
  pr: [3, 5], rj: [4, 5],
  sc: [3, 6],
  rs: [3, 7],
};

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
  busca: '',
  mostrarTodos: false,
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
    return;
  }
  const chave = chaveAtual();
  try {
    const detalhe = await getJson(`/api/resultado/${estado.cargo}/${estado.uf}`);
    if (chave === chaveAtual()) estado.detalhe = detalhe; // descarta resposta de uma seleção já trocada
  } catch {
    if (chave === chaveAtual()) estado.detalhe = null;
  }
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
      await Promise.all([carregarResumo(), carregarDetalhe()]);
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
  const m = /^#\/(\d+)\/([a-z]{2})$/.exec(location.hash);
  const cargo = m ? Number(m[1]) : estado.meta.cargos[0].codigo;
  const meta = cargoMeta(cargo) ?? estado.meta.cargos[0];
  estado.cargo = meta.codigo;
  const ufPedida = m?.[2];
  const valida = ufPedida && (meta.abrangencias.includes(ufPedida) || (ufPedida === 'br' && meta.codigo !== 1));
  estado.uf = valida ? ufPedida : ufPadrao(meta.codigo);
  estado.busca = '';
  estado.mostrarTodos = false;
}

window.addEventListener('hashchange', async () => {
  lerHash();
  estado.detalhe = undefined;
  render();
  await atualizar();
});

// ---------- desenho: abas e mapa ----------

function renderAbas() {
  $('#abas').innerHTML = estado.meta.cargos
    .map((c) => `<a class="aba" href="#/${c.codigo}/${ufPadrao(c.codigo)}" ${c.codigo === estado.cargo ? 'aria-current="page"' : ''}>${esc(c.nome)}</a>`)
    .join('');
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

function tileHtml(uf, { posicao } = {}) {
  // "Brasil" nos cargos sem arquivo nacional é a soma das UFs; nos demais casos é um arquivo comum.
  const dado = uf === 'br' && !temArquivoNacional(estado.cargo)
    ? { sub: 'Visão geral', sub2: fmtPct(agregadoSecoes().pct, 0), pct: agregadoSecoes().pct, cor: null, vazio: false }
    : conteudoTile(itemResumo(estado.cargo, uf));
  const estilo = [posicao ? `--c:${posicao[0]};--r:${posicao[1]}` : '', dado.cor ? `--cor:${dado.cor}` : ''].filter(Boolean).join(';');
  return `<a class="tile${dado.vazio ? ' vazio' : ''}" href="#/${estado.cargo}/${uf}" style="${estilo}"
      aria-current="${uf === estado.uf}" aria-label="${esc(nomeUf(uf))}: ${dado.vazio ? 'sem dados' : esc(`${dado.sub} ${dado.sub2}`.trim())}" title="${esc(nomeUf(uf))}">
      <span class="tile-uf">${uf.toUpperCase()}</span>
      ${dado.sub ? `<span class="tile-sub">${dado.sub}</span>` : ''}
      <span class="tile-sub">${dado.sub2}</span>
      <span class="tile-barra"><i style="width:${dado.pct}%"></i></span>
    </a>`;
}

function renderGrade() {
  const meta = cargoMeta();
  const ufs = new Set(meta.abrangencias);
  const semMapa = meta.abrangencias.length === 1;
  $('#principal').classList.toggle('sem-mapa', semMapa);
  if (semMapa) return;

  $('#grade').innerHTML = Object.entries(GRADE)
    .filter(([uf]) => ufs.has(uf))
    .map(([uf, posicao]) => tileHtml(uf, { posicao }))
    .join('');

  const especiais = [];
  if (ufs.has('br') || meta.codigo !== 1) especiais.push('br');
  if (ufs.has('zz')) especiais.push('zz');
  $('#especiais').innerHTML = especiais.map((uf) => tileHtml(uf)).join('');
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
  return `<div class="numeros">
    ${caixa('Comparecimento', e.comparecimento, e.pctComparecimento)}
    ${caixa('Abstenção', e.abstencao, e.pctAbstencao)}
    ${caixa('Votos válidos', v.validos, v.pctValidos)}
    ${caixa('Brancos', v.brancos, v.pctBrancos)}
    ${caixa('Nulos', v.nulos, v.pctNulos)}
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
  return `<li style="--cor:${cor}">
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
    ${numeros}${barras}${tabela}`;
}

// ---------- desenho: orquestração ----------

function renderDetalhe() {
  const raiz = $('#detalhe');
  const buscaFocada = document.activeElement?.id === 'busca';
  const cursor = buscaFocada ? document.activeElement.selectionStart : null;
  const rolagem = window.scrollY;

  raiz.innerHTML = ehAgregado() ? detalheAgregadoHtml() : detalheArquivoHtml();

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
      location.hash = `#/${estado.cargo}/${linha.dataset.uf}`;
    });
  });
  window.scrollTo({ top: rolagem });
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

  lerHash();
  await atualizar();
  conectar();
  setInterval(renderEstado, 1000);
}

iniciar();
