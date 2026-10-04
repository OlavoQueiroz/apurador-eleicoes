import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizar } from '../src/normalize.js';
import { Apuracao } from '../src/apuracao.js';
import { criarServidor } from '../src/servidor.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dados = normalizar(JSON.parse(readFileSync(path.join(aqui, 'fixtures/presidente-br.json'), 'utf8')));

const alvos = [
  { chave: '1:br', cargo: 1, uf: 'br' },
  { chave: '1:sp', cargo: 1, uf: 'sp' },
];

let servidor;
let apuracao;
let base;

before(async () => {
  const fonte = {
    async obter(alvo) {
      return alvo.uf === 'br' ? { status: 'novo', dados, etag: 'e1' } : { status: 'indisponivel' };
    },
  };
  apuracao = new Apuracao({ alvos, fonte });
  await apuracao.ciclo();
  servidor = criarServidor({
    apuracao,
    meta: { ano: 2026, turno: 1, demo: false, intervalo: 60, cargos: [1] },
    diretorioPublico: path.resolve(aqui, '../public'),
  });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  apuracao.parar();
  servidor.closeAllConnections();
  await new Promise((resolve) => servidor.close(resolve));
});

test('/api/meta descreve cargos e abrangências disponíveis', async () => {
  const meta = await (await fetch(`${base}/api/meta`)).json();
  assert.equal(meta.ano, 2026);
  assert.equal(meta.demo, false);
  assert.deepEqual(meta.cargos, [{ codigo: 1, nome: 'Presidente', abrangencias: ['br', 'sp'] }]);
  assert.equal(meta.ultimoCiclo.total, 2);
});

test('/api/resumo traz status e líder de cada arquivo', async () => {
  const { itens } = await (await fetch(`${base}/api/resumo`)).json();
  const br = itens.find((i) => i.chave === '1:br');
  const sp = itens.find((i) => i.chave === '1:sp');
  assert.equal(br.status, 'ok');
  assert.equal(br.secoes.total, 499248);
  assert.equal(br.lider, null, 'sem votos ainda');
  assert.equal(sp.status, 'indisponivel');
  assert.equal(sp.secoes, undefined);
});

test('/api/resultado devolve o dado completo ou 404', async () => {
  const ok = await (await fetch(`${base}/api/resultado/1/br`)).json();
  assert.equal(ok.dados.candidatos.length, 12);
  const semDado = await (await fetch(`${base}/api/resultado/1/sp`)).json();
  assert.equal(semDado.dados, null);
  assert.equal((await fetch(`${base}/api/resultado/9/br`)).status, 404);
  assert.equal((await fetch(`${base}/api/resultado/1/xx`)).status, 404);
});

test('API não é cacheada e só aceita GET', async () => {
  const res = await fetch(`${base}/api/meta`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${base}/api/meta`, { method: 'POST' })).status, 405);
});

test('não permite sair de public/ com ../', async () => {
  const res = await fetch(`${base}/..%2fpackage.json`);
  assert.ok([403, 404].includes(res.status), `status ${res.status}`);
  assert.doesNotMatch(await res.text(), /apurador-eleicoes/);
});

test('SSE: avisa o cliente a cada ciclo, com as chaves alteradas', async () => {
  const controle = new AbortController();
  const res = await fetch(`${base}/events`, { signal: controle.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');

  const leitor = res.body.getReader();
  const decoder = new TextDecoder();
  let recebido = '';
  const lerAte = async (padrao) => {
    while (!padrao.test(recebido)) {
      const { value, done } = await leitor.read();
      if (done) break;
      recebido += decoder.decode(value);
    }
  };

  await lerAte(/event: ciclo/); // estado atual enviado ao conectar
  recebido = '';
  const alterados = new Promise((resolve) => apuracao.once('ciclo', resolve));
  await apuracao.ciclo();
  await alterados;
  await lerAte(/event: ciclo\ndata: .*\n\n/);
  const linha = /data: (.*)\n/.exec(recebido)[1];
  const evento = JSON.parse(linha);
  assert.ok(Array.isArray(evento.chavesAlteradas));
  assert.ok(evento.terminadoEm > 0);
  controle.abort();
});

test('/api/projecao: modelo indisponível explica o motivo, e sem dados não projeta', async () => {
  const meta = await (await fetch(`${base}/api/meta`)).json();
  assert.deepEqual(meta.modelos.map((m) => m.id), ['ingenuo', 'estratificado', 'swing', 'bayesiano']);
  assert.equal(meta.modelos.find((m) => m.id === 'swing').disponivel, false, 'sem dados de 2022 carregados');

  const estratificado = await (await fetch(`${base}/api/projecao/estratificado/1/br`)).json();
  assert.equal(estratificado.disponivel, false);
  assert.ok(estratificado.motivo);

  const semVotos = await (await fetch(`${base}/api/projecao/ingenuo/1/br`)).json();
  assert.equal(semVotos.disponivel, false, 'arquivo existente mas sem votos');

  const semArquivo = await (await fetch(`${base}/api/projecao/ingenuo/1/sp`)).json();
  assert.equal(semArquivo.disponivel, false);

  assert.equal((await fetch(`${base}/api/projecao/ingenuo/9/br`)).status, 404);
});

test('/api/municipios: sem a camada de municípios, ou fora de presidente/governador/senador, responde 404', async () => {
  assert.equal((await fetch(`${base}/api/municipios/1/sp`)).status, 404);
  assert.equal((await fetch(`${base}/api/municipios/9/sp`)).status, 404);
});

test('/api/historico: 404 quando não há gravação', async () => {
  assert.equal((await fetch(`${base}/api/historico/1/sp`)).status, 404);
  assert.equal((await fetch(`${base}/api/historico/1/sp?modelo=nenhum`)).status, 404);
});

test('ícones da aba: favicon.ico, PNG e apple-touch-icon saem com o tipo certo (o Safari não usa SVG como ícone de aba)', async () => {
  for (const [arquivo, tipo] of [['favicon.ico', 'image/x-icon'], ['favicon-32.png', 'image/png'], ['apple-touch-icon.png', 'image/png'], ['favicon.svg', 'image/svg+xml']]) {
    const res = await fetch(`${base}/${arquivo}`);
    assert.equal(res.status, 200, arquivo);
    assert.equal(res.headers.get('content-type'), tipo, arquivo);
    assert.ok((await res.arrayBuffer()).byteLength > 100, arquivo);
  }
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /rel="icon" href="favicon\.ico"/);
  assert.match(html, /rel="apple-touch-icon" href="apple-touch-icon\.png"/);
});
