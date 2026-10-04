// Servidor HTTP: API JSON, eventos em tempo real (SSE) e os arquivos estáticos de public/.
//   GET /api/meta                      configuração e estado do último ciclo
//   GET /api/resumo                    uma linha por cargo × abrangência (mapa e totais nacionais)
//   GET /api/resultado/:cargo/:uf      resultado completo de um arquivo
//   GET /events                        SSE: um evento "ciclo" a cada rodada de consultas

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CARGOS } from './tse.js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const SEM_CACHE = { 'cache-control': 'no-store' };

export function criarServidor({ apuracao, meta, diretorioPublico }) {
  const clientes = new Set();

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

  apuracao.on('ciclo', (ciclo) => {
    const evento = formatarEvento(ciclo);
    for (const cliente of clientes) cliente.write(evento);
  });

  // Comentário SSE periódico: mantém a conexão viva através de proxies e abas em segundo plano.
  const batimento = setInterval(() => {
    for (const cliente of clientes) cliente.write(': ping\n\n');
  }, 20_000);
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
