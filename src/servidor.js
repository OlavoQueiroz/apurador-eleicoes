// Servidor HTTP: API JSON, eventos em tempo real (SSE) e os arquivos estáticos de public/.
//   GET /api/meta                      configuração e estado do último ciclo
//   GET /api/resumo                    uma linha por cargo × abrangência (mapa e totais nacionais)
//   GET /api/comparativo/presidente    base por UF (eleição anterior) para o comparativo; ?periodo=2026x2022|2026x2018|2022x2018
//   GET /api/resultado/:cargo/:uf      resultado completo de um arquivo
//   GET /api/historico/:cargo/:uf?modelo=  evolução gravada: % de cada candidato e projeção ao longo da apuração
//   GET /api/municipios/:cargo/:uf     líder e apuração de cada município de uma UF
//   GET /api/projecao/:modelo/:cargo/:uf   estimativa do resultado final (não é dado do TSE)
//   GET /api/busca?q=&cargo=&uf=       candidatos (do cargo e UF abertos e de todo o resto) e municípios
//   GET /events                        SSE: um evento "ciclo" a cada rodada de consultas

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CARGOS } from './tse.js';
import { lerSerie } from './historico.js';
import { buscarCandidatos, criarIndiceMunicipios } from './busca.js';
import { projetarUfSwing } from './swing.js';
import { MODELOS, projetar, projetarUf, projetarBrasil, tamanhoUf } from './projecao.js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const SEM_CACHE = { 'cache-control': 'no-store' };

// Períodos do comparativo da presidência (eleição "atual" × eleição base). 2026 é a apuração ao vivo; as outras já terminaram.
const PERIODOS_COMPARATIVO = {
  '2026x2022': { anoAtual: 2026, anoBase: 2022 },
  '2026x2018': { anoAtual: 2026, anoBase: 2018 },
  '2022x2018': { anoAtual: 2022, anoBase: 2018 },
};

const LIMITE_BUFFER_SSE = 256 * 1024; // acima disso o cliente SSE não está lendo e é desconectado
const MANTER_PROJECAO_MS = 3 * 60_000; // por quanto tempo vale a última projeção boa se a UF sai de sincronia

// `anterior` = 2022 (swing e comparativo); `historicos` = outras eleições já encerradas, por ano ({ 2018: anterior2018 }).
export function criarServidor({ apuracao, meta, diretorioPublico, municipios = null, historico = null, limitador = null, anterior = null, historicos = {}, partidos = null }) {
  const basesHistoricas = { ...(anterior ? { 2022: anterior } : {}), ...historicos };
  // O swing precisa dos dados de 2022; sem eles o modelo aparece como indisponível.
  const modelos = MODELOS.map((m) => (m.id === 'swing' && !anterior
    ? { ...m, disponivel: false, motivo: 'Dados de 2022 não carregados (rode scripts/gerar-historico-2022.js).' }
    : m));
  const modeloPorIdAtivo = (id) => modelos.find((m) => m.id === id);
  const clientes = new Set();
  const ultimaBoaPorUf = new Map();
  const buscarMunicipios = criarIndiceMunicipios(diretorioPublico);

  const enviarJson = (res, status, corpo) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SEM_CACHE });
    res.end(JSON.stringify(corpo));
  };

  const montarMeta = () => {
    const cargos = [];
    for (const codigo of meta.cargos) {
      const def = CARGOS[codigo];
      const abrangencias = def.abrangencias.filter((uf) => apuracao.estado.has(`${codigo}:${uf}`));
      if (abrangencias.length) cargos.push({ codigo, nome: def.nome, abrangencias });
    }
    return {
      ano: meta.ano,
      turno: meta.turno,
      demo: meta.demo,
      intervaloSegundos: meta.intervalo,
      cargos,
      modelos,
      requisicoes: limitador?.estatisticas() ?? null, // pedidos ao TSE: por prioridade, por minuto e quantos 429
      ultimoCiclo: apuracao.ultimoCiclo && { ...apuracao.ultimoCiclo, chavesAlteradas: undefined },
    };
  };

  const montarResumo = () => ({
    itens: [...apuracao.estado.values()].map((item) => ({
      chave: item.alvo.chave,
      cargo: item.alvo.cargo,
      uf: item.alvo.uf,
      status: item.status,
      erro: item.erro,
      verificadoEm: item.verificadoEm,
      alteradoEm: item.alteradoEm,
      ...item.resumo,
    })),
  });

  // Modelo 2: precisa dos municípios (ver municipios.js). Uma UF por vez, ou o Brasil na presidência,
  // que soma as 27 UFs e o exterior depois que a carga em segundo plano termina.
  const projecaoPorMunicipios = async (item, modeloId) => {
    const { cargo, uf, eleicao } = item.alvo;
    const indisponivel = (motivo, extra = {}) => ({ modelo: modeloId, disponivel: false, motivo, ...extra });
    if (modeloId === 'swing' && cargo !== 1) return indisponivel('O swing histórico, por enquanto, só existe para presidente.');
    const calcularUf = (foto, ufDados, limite) => (modeloId === 'swing'
      ? projetarUfSwing({ foto, ufDados, anterior, limite })
      : projetarUf({ foto, ufDados, limite }));
    // Amortecimento: se os arquivos da UF saem de sincronia logo depois de uma projeção boa, mantém a última por
    // alguns minutos em vez de cair na extrapolação simples e voltar no ciclo seguinte (a tela oscilaria).
    const projetarDaUf = (ufDaFoto, foto, ufDados, limite) => {
      const r = calcularUf(foto, ufDados, limite);
      const chave = `${modeloId}:${cargo}:${ufDaFoto}:${limite ?? 'tudo'}`;
      if (r.disponivel && r.plano !== 'extrapolacao') {
        ultimaBoaPorUf.set(chave, { r, em: Date.now() });
        return r;
      }
      const boa = r.plano === 'extrapolacao' ? ultimaBoaPorUf.get(chave) : null;
      if (boa && Date.now() - boa.em <= MANTER_PROJECAO_MS) {
        return { ...boa.r, mantida: { desde: boa.em, motivo: r.motivoPlano } };
      }
      return r;
    };
    if (!municipios) return indisponivel('Os resultados por município não estão ativos nesta execução.');
    if (![1, 3, 5].includes(cargo)) return indisponivel('Este modelo vale só para presidente, governador e senador.');

    if (uf === 'br') {
      if (cargo !== 1) return indisponivel('Escolha uma UF: o modelo trabalha com os municípios de uma UF por vez.');
      const ufs = [...(await municipios.listar(eleicao)).keys()];
      const fotos = ufs.map((u) => ({ uf: u, foto: municipios.espiar({ eleicao, cargo, uf: u }), ufDados: apuracao.estado.get(`${cargo}:${u}`)?.dados ?? null }));
      const prontas = fotos.filter(({ foto }) => !foto.primeiraCarga && !foto.carregando).length;
      if (prontas < ufs.length) {
        return indisponivel('Carregando os municípios de todas as UFs para somar o Brasil…', {
          carregando: true, progresso: { feitos: prontas, total: ufs.length, unidade: 'UFs' },
        });
      }
      const porUf = fotos.map(({ uf: u, foto, ufDados }) => ({ uf: u, r: projetarDaUf(u, foto, ufDados), ...tamanhoUf({ foto, ufDados }) }));
      return {
        ...projetarBrasil(porUf, { limite: 50, modelo: modeloId, anteriorPorUf: anterior?.porUf() ?? null }),
        carregando: false,
        atualizadoEm: Math.min(...fotos.map(({ foto }) => foto.atualizadoEm ?? Infinity)),
      };
    }

    const snap = municipios.consultar({ eleicao, cargo, uf });
    if (snap.primeiraCarga) {
      return indisponivel(snap.erro ?? 'Carregando os resultados dos municípios…', { carregando: snap.carregando, progresso: snap.progresso });
    }
    const r = projetarDaUf(uf, snap, item.dados, 50);
    return {
      ...r,
      carregando: snap.carregando,
      progresso: snap.progresso,
      atualizadoEm: snap.atualizadoEm,
      aviso: snap.erro,
    };
  };

  // Lista dos municípios de uma UF com o líder de cada um (para o mapa). Dispara a carga se preciso.
  const resultadosMunicipios = (item) => {
    const { cargo, uf, eleicao } = item.alvo;
    const snap = municipios.consultar({ eleicao, cargo, uf });
    return {
      carregando: snap.carregando,
      primeiraCarga: snap.primeiraCarga,
      progresso: snap.progresso,
      atualizadoEm: snap.atualizadoEm,
      erro: snap.erro,
      total: snap.total,
      municipios: snap.dados.map((d) => {
        const l = d.candidatos[0];
        return {
          codigo: d.codigoMunicipio,
          codigoIbge: d.codigoIbge ?? null,
          nome: d.nomeMunicipio,
          secoes: d.secoes,
          validos: d.votos.validos,
          lider: l && l.votos > 0 ? { numero: l.numero, nomeUrna: l.nomeUrna, partido: l.partido, votos: l.votos, pct: l.pct } : null,
        };
      }),
    };
  };

  const servirEstatico = async (req, res, caminho) => {
    const relativo = caminho === '/' ? 'index.html' : decodeURIComponent(caminho).replace(/^\/+/, '');
    const arquivo = path.resolve(diretorioPublico, relativo);
    // Impede sair de public/ com "../".
    if (arquivo !== diretorioPublico && !arquivo.startsWith(diretorioPublico + path.sep)) {
      res.writeHead(403).end('Acesso negado');
      return;
    }
    try {
      const conteudo = await readFile(arquivo);
      res.writeHead(200, { 'content-type': TIPOS[path.extname(arquivo)] ?? 'application/octet-stream', ...SEM_CACHE });
      res.end(conteudo);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Não encontrado');
    }
  };

  const servidor = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET' }).end();
      return;
    }

    if (pathname === '/api/meta') return enviarJson(res, 200, montarMeta());
    if (pathname === '/api/resumo') return enviarJson(res, 200, montarResumo());
    // Comparativo da presidência: a base (eleição anterior) por UF e, quando a eleição "atual" já terminou (2022 × 2018),
    // os votos dela também. Com o período ao vivo (2026), a apuração vem de /api/resumo.
    if (pathname === '/api/comparativo/presidente') {
      const periodo = new URL(req.url, 'http://localhost').searchParams.get('periodo') ?? '2026x2022';
      const def = PERIODOS_COMPARATIVO[periodo];
      if (!def) return enviarJson(res, 400, { disponivel: false, periodo, motivo: `Período desconhecido: ${periodo}.` });
      const naoCarregado = (ano) => ({ disponivel: false, periodo, motivo: `Dados de ${ano} não carregados (rode scripts/gerar-historico-${ano}.js).` });
      const base = basesHistoricas[def.anoBase];
      if (!base) return enviarJson(res, 200, naoCarregado(def.anoBase));
      const vivo = def.anoAtual === meta.ano;
      let atual = null;
      if (!vivo) {
        const encerrada = basesHistoricas[def.anoAtual];
        if (!encerrada) return enviarJson(res, 200, naoCarregado(def.anoAtual));
        atual = { ufs: encerrada.brutoPorUf() };
      }
      return enviarJson(res, 200, { disponivel: true, periodo, vivo, anoAtual: def.anoAtual, anoBase: def.anoBase, fonte: base.fonte, candidatos: base.candidatos22, ufs: base.porUf(), atual });
    }

    // Eleitos de eleições passadas por partido (aba de partidos e ideologia); a apuração de 2026 vem de /api/resumo.
    if (pathname === '/api/partidos') {
      return enviarJson(res, 200, partidos ?? { disponivel: false, motivo: 'Dados de eleitos não carregados (rode scripts/gerar-eleitos.js).' });
    }

    if (pathname === '/api/busca') {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const q = (params.get('q') ?? '').slice(0, 80);
      const cargo = Number(params.get('cargo')) || 0;
      const uf = params.get('uf') ?? '';
      return enviarJson(res, 200, {
        ...buscarCandidatos(apuracao, q, { cargo, uf }),
        municipios: await buscarMunicipios(q, { uf }),
      });
    }

    const m = /^\/api\/resultado\/(\d+)\/([a-z]{2})$/.exec(pathname);
    if (m) {
      const item = apuracao.estado.get(`${Number(m[1])}:${m[2]}`);
      if (!item) return enviarJson(res, 404, { erro: 'Cargo ou abrangência desconhecidos.' });
      return enviarJson(res, 200, {
        chave: item.alvo.chave,
        status: item.status,
        erro: item.erro,
        verificadoEm: item.verificadoEm,
        alteradoEm: item.alteradoEm,
        dados: item.dados,
      });
    }

    const h = /^\/api\/historico\/(\d+)\/([a-z]{2})$/.exec(pathname);
    if (h) {
      const modelo = new URL(req.url, 'http://localhost').searchParams.get('modelo') ?? 'ingenuo';
      const serie = historico && ['ingenuo', 'estratificado', 'swing'].includes(modelo) ? lerSerie(historico, `${Number(h[1])}:${h[2]}`, modelo) : null;
      if (!serie) return enviarJson(res, 404, { erro: 'Sem histórico gravado para esta abrangência.' });
      return enviarJson(res, 200, serie);
    }

    const mu = /^\/api\/municipios\/(\d+)\/([a-z]{2})$/.exec(pathname);
    if (mu) {
      const item = apuracao.estado.get(`${Number(mu[1])}:${mu[2]}`);
      if (!item) return enviarJson(res, 404, { erro: 'Cargo ou abrangência desconhecidos.' });
      if (!municipios || ![1, 3, 5].includes(item.alvo.cargo) || item.alvo.uf === 'br') {
        return enviarJson(res, 404, { erro: 'Resultados por município só existem para presidente, governador e senador, em uma UF.' });
      }
      return enviarJson(res, 200, resultadosMunicipios(item));
    }

    const p = /^\/api\/projecao\/([a-z]+)\/(\d+)\/([a-z]{2})$/.exec(pathname);
    if (p) {
      const modelo = modeloPorIdAtivo(p[1]);
      const item = apuracao.estado.get(`${Number(p[2])}:${p[3]}`);
      if (!modelo || !item) return enviarJson(res, 404, { erro: 'Modelo, cargo ou abrangência desconhecidos.' });
      if (!modelo.disponivel) return enviarJson(res, 200, { modelo: modelo.id, disponivel: false, motivo: modelo.motivo });
      if (modelo.id === 'estratificado' || modelo.id === 'swing') return enviarJson(res, 200, await projecaoPorMunicipios(item, modelo.id));
      if (!item.dados) return enviarJson(res, 200, { modelo: modelo.id, disponivel: false, motivo: 'O arquivo desta abrangência ainda não está disponível no TSE.' });
      const limite = item.alvo.cargo >= 6 ? 20 : 50; // deputados: só os mais votados
      return enviarJson(res, 200, { ...projetar(modelo.id, item.dados, { limite }), geradoEm: item.dados.geradoEm });
    }

    if (pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      res.write('retry: 3000\n\n');
      if (apuracao.ultimoCiclo) res.write(formatarEvento(apuracao.ultimoCiclo));
      clientes.add(res);
      req.on('close', () => clientes.delete(res));
      return undefined;
    }

    return servirEstatico(req, res, pathname);
  });

  // Envia a todos os clientes SSE sem que um socket quebrado ou lento atrapalhe os demais: quem já foi encerrado
  // (ou falha ao escrever) sai da lista, e quem não consome (buffer acumulado) é desconectado — o navegador reconecta.
  const enviarAosClientes = (texto) => {
    for (const cliente of [...clientes]) {
      if (cliente.destroyed || cliente.writableEnded) { clientes.delete(cliente); continue; }
      try {
        cliente.write(texto);
        if (cliente.writableLength > LIMITE_BUFFER_SSE) throw new Error('cliente SSE não está consumindo os eventos');
      } catch {
        clientes.delete(cliente);
        cliente.destroy();
      }
    }
  };

  apuracao.on('ciclo', (ciclo) => enviarAosClientes(formatarEvento(ciclo)));

  // Comentário SSE periódico: mantém a conexão viva através de proxies e abas em segundo plano.
  const batimento = setInterval(() => enviarAosClientes(': ping\n\n'), 20_000);
  batimento.unref();

  servidor.on('close', () => {
    clearInterval(batimento);
    for (const cliente of clientes) cliente.end();
  });
  return servidor;
}

function formatarEvento(ciclo) {
  return `event: ciclo\ndata: ${JSON.stringify({
    terminadoEm: ciclo.terminadoEm,
    comDados: ciclo.comDados,
    chavesAlteradas: ciclo.chavesAlteradas,
  })}\n\n`;
}
