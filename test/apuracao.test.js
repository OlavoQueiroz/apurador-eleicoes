import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizar } from '../src/normalize.js';
import { Apuracao } from '../src/apuracao.js';

const dadosBase = normalizar(JSON.parse(readFileSync(new URL('./fixtures/presidente-br.json', import.meta.url), 'utf8')));
const comGeracao = (geracao) => ({ ...dadosBase, geracao });

const alvos = [
  { chave: '1:br', cargo: 1, uf: 'br' },
  { chave: '1:sp', cargo: 1, uf: 'sp' },
];

// Fonte falsa: cada chamada consome a próxima resposta programada para o alvo.
function fonteRoteirizada(roteiro) {
  const chamadas = [];
  return {
    chamadas,
    async obter(alvo, anterior) {
      chamadas.push({ chave: alvo.chave, etag: anterior?.etag ?? null });
      const proxima = roteiro[alvo.chave].shift();
      if (proxima instanceof Error) throw proxima;
      return proxima;
    },
  };
}

test('primeiro ciclo: dado novo conta como alterado; indisponível só na primeira vez', async () => {
  const fonte = fonteRoteirizada({
    '1:br': [{ status: 'novo', dados: comGeracao('1'), etag: 'a' }, { status: 'inalterado' }],
    '1:sp': [{ status: 'indisponivel' }, { status: 'indisponivel' }],
  });
  const a = new Apuracao({ alvos, fonte });

  const c1 = await a.ciclo();
  assert.deepEqual(c1.chavesAlteradas.sort(), ['1:br', '1:sp']);
  assert.equal(c1.comDados, 1);
  assert.equal(c1.indisponiveis, 1);
  assert.equal(a.estado.get('1:br').status, 'ok');
  assert.equal(a.estado.get('1:sp').status, 'indisponivel');

  // Segunda rodada: continua indisponível, e isso não é uma novidade.
  const c2 = await a.ciclo();
  assert.deepEqual(c2.chavesAlteradas, []);
});

test('GET condicional: reenvia o ETag e 304 não conta como alteração', async () => {
  const fonte = fonteRoteirizada({
    '1:br': [
      { status: 'novo', dados: comGeracao('1'), etag: 'a' },
      { status: 'inalterado' },
      { status: 'novo', dados: comGeracao('2'), etag: 'b' },
    ],
    '1:sp': [{ status: 'indisponivel' }, { status: 'indisponivel' }, { status: 'indisponivel' }],
  });
  const a = new Apuracao({ alvos, fonte });

  await a.ciclo();
  const c2 = await a.ciclo();
  assert.deepEqual(c2.chavesAlteradas, []);
  const c3 = await a.ciclo();
  assert.deepEqual(c3.chavesAlteradas, ['1:br']);

  const enviados = fonte.chamadas.filter((c) => c.chave === '1:br').map((c) => c.etag);
  assert.deepEqual(enviados, [null, 'a', 'a']);
  assert.equal(a.estado.get('1:br').etag, 'b');
  assert.equal(a.estado.get('1:br').dados.geracao, '2');
});

test('mesma geração e mesmo ETag não é alteração (resposta 200 repetida)', async () => {
  const fonte = fonteRoteirizada({
    '1:br': [
      { status: 'novo', dados: comGeracao('1'), etag: 'a' },
      { status: 'novo', dados: comGeracao('1'), etag: 'a' },
    ],
    '1:sp': [{ status: 'indisponivel' }, { status: 'indisponivel' }],
  });
  const a = new Apuracao({ alvos, fonte });
  await a.ciclo();
  const c2 = await a.ciclo();
  assert.deepEqual(c2.chavesAlteradas, []);
});

test('erro num arquivo não derruba os outros e preserva o último dado', async () => {
  const fonte = fonteRoteirizada({
    '1:br': [
      { status: 'novo', dados: comGeracao('1'), etag: 'a' },
      new Error('HTTP 503'),
      { status: 'novo', dados: comGeracao('2'), etag: 'b' },
    ],
    '1:sp': [{ status: 'novo', dados: comGeracao('9'), etag: 'z' }, { status: 'inalterado' }, { status: 'inalterado' }],
  });
  const a = new Apuracao({ alvos, fonte });
  await a.ciclo();
  const c2 = await a.ciclo();

  const br = a.estado.get('1:br');
  assert.equal(br.status, 'erro');
  assert.equal(br.erro, 'HTTP 503');
  assert.equal(br.dados.geracao, '1', 'último dado preservado');
  assert.equal(a.estado.get('1:sp').status, 'ok');
  assert.equal(c2.erros, 1);

  // Recupera sozinho quando o TSE volta.
  const c3 = await a.ciclo();
  assert.equal(a.estado.get('1:br').status, 'ok');
  assert.equal(a.estado.get('1:br').erro, null);
  assert.equal(a.estado.get('1:br').dados.geracao, '2');
  assert.equal(c3.erros, 0);
  assert.ok(c3.chavesAlteradas.includes('1:br'));
});

test('arquivo que existia e some vira erro, mantendo o último dado', async () => {
  const fonte = fonteRoteirizada({
    '1:br': [{ status: 'novo', dados: comGeracao('1'), etag: 'a' }, { status: 'indisponivel' }],
    '1:sp': [{ status: 'indisponivel' }, { status: 'indisponivel' }],
  });
  const a = new Apuracao({ alvos, fonte });
  await a.ciclo();
  const c2 = await a.ciclo();
  const br = a.estado.get('1:br');
  assert.equal(br.status, 'erro');
  assert.match(br.erro, /deixou de estar disponível/);
  assert.ok(br.dados);
  assert.deepEqual(c2.chavesAlteradas, ['1:br']);
});

test('emite o evento ciclo e respeita o limite de concorrência', async () => {
  const muitos = Array.from({ length: 20 }, (_, i) => ({ chave: `1:u${i}`, cargo: 1, uf: `u${i}` }));
  let simultaneas = 0;
  let pico = 0;
  const fonte = {
    async obter() {
      simultaneas += 1;
      pico = Math.max(pico, simultaneas);
      await new Promise((r) => setTimeout(r, 2));
      simultaneas -= 1;
      return { status: 'indisponivel' };
    },
  };
  const a = new Apuracao({ alvos: muitos, fonte, concorrencia: 4 });
  const eventos = [];
  a.on('ciclo', (c) => eventos.push(c));
  await a.ciclo();
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].total, 20);
  assert.ok(pico <= 4, `pico de ${pico} requisições simultâneas`);
});

test('iniciar() repete os ciclos e parar() encerra', async () => {
  let rodadas = 0;
  const fonte = { async obter() { rodadas += 1; return { status: 'indisponivel' }; } };
  const a = new Apuracao({ alvos: [alvos[0]], fonte, intervaloMs: 10 });
  a.iniciar();
  await new Promise((r) => setTimeout(r, 80));
  a.parar();
  const total = rodadas;
  assert.ok(total >= 3, `só ${total} rodadas`);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(rodadas, total, 'não roda depois de parar');
});
