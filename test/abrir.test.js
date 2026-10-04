import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirNoNavegador, comandosParaAbrir } from '../src/abrir.js';
import { lerConfig } from '../src/config.js';

const URL_PAINEL = 'http://127.0.0.1:3000';

test('macOS: tenta o app pedido e, se falhar, o navegador padrão', () => {
  assert.deepEqual(comandosParaAbrir(URL_PAINEL, { navegador: 'Safari', plataforma: 'darwin' }), [
    { rotulo: 'Safari', cmd: 'open', args: ['-a', 'Safari', URL_PAINEL] },
    { rotulo: 'navegador padrão', cmd: 'open', args: [URL_PAINEL] },
  ]);
  assert.deepEqual(comandosParaAbrir(URL_PAINEL, { plataforma: 'darwin' }), [
    { rotulo: 'navegador padrão', cmd: 'open', args: [URL_PAINEL] },
  ]);
});

test('outras plataformas usam o abridor padrão do sistema', () => {
  assert.equal(comandosParaAbrir(URL_PAINEL, { plataforma: 'linux' })[0].cmd, 'xdg-open');
  assert.deepEqual(comandosParaAbrir(URL_PAINEL, { plataforma: 'win32' })[0].args, ['/c', 'start', '', URL_PAINEL]);
});

test('abre no Safari de primeira e não tenta mais nada', async () => {
  const chamadas = [];
  const logs = [];
  const ok = await abrirNoNavegador(URL_PAINEL, {
    navegador: 'Safari',
    plataforma: 'darwin',
    executarComando: async (cmd, args) => chamadas.push([cmd, args]),
    log: (m) => logs.push(m),
  });
  assert.equal(ok, true);
  assert.deepEqual(chamadas, [['open', ['-a', 'Safari', URL_PAINEL]]]);
  assert.deepEqual(logs, ['Abrindo o painel no Safari.']);
});

test('Safari inexistente: cai para o navegador padrão e explica o motivo', async () => {
  const chamadas = [];
  const logs = [];
  const ok = await abrirNoNavegador(URL_PAINEL, {
    navegador: 'Safari',
    plataforma: 'darwin',
    executarComando: async (cmd, args) => {
      chamadas.push(args);
      if (args[0] === '-a') throw new Error("Command failed: open -a Safari http://127.0.0.1:3000\nUnable to find application named 'Safari'");
    },
    log: (m) => logs.push(m),
  });
  assert.equal(ok, true);
  assert.equal(chamadas.length, 2);
  assert.deepEqual(chamadas[1], [URL_PAINEL]);
  assert.match(logs[0], /Não consegui abrir no Safari \(Unable to find application named 'Safari'\)/);
  assert.equal(logs[1], 'Abrindo o painel no navegador padrão.');
});

test('se nada funcionar, avisa a URL e devolve false sem lançar', async () => {
  const logs = [];
  const ok = await abrirNoNavegador(URL_PAINEL, {
    navegador: 'Safari',
    plataforma: 'darwin',
    executarComando: async () => {
      throw new Error('boom');
    },
    log: (m) => logs.push(m),
  });
  assert.equal(ok, false);
  assert.equal(logs.at(-1), `Abra manualmente: ${URL_PAINEL}`);
});

test('o nome do app vai como um único argumento, nunca interpretado por um shell', async () => {
  const perigoso = 'Safari"; touch /tmp/invadido; echo "';
  let recebido;
  await abrirNoNavegador(URL_PAINEL, {
    navegador: perigoso,
    plataforma: 'darwin',
    executarComando: async (cmd, args) => {
      recebido = { cmd, args };
    },
  });
  assert.equal(recebido.cmd, 'open');
  assert.deepEqual(recebido.args, ['-a', perigoso, URL_PAINEL]);
});

// ---------- configuração ----------

const mac = { plataforma: 'darwin', interativo: true };
const macSemTerminal = { plataforma: 'darwin', interativo: false };
const linux = { plataforma: 'linux', interativo: true };

test('config: no macOS, em terminal interativo, abre sozinho no Safari', () => {
  const cfg = lerConfig([], {}, mac);
  assert.equal(cfg.abrir, true);
  assert.equal(cfg.navegador, 'Safari');
});

test('config: sem terminal interativo (testes, preview, scripts) não abre sozinho', () => {
  assert.equal(lerConfig([], {}, macSemTerminal).abrir, false);
});

test('config: --abrir força, --sem-abrir e ABRIR=0 desligam', () => {
  assert.equal(lerConfig(['--abrir'], {}, macSemTerminal).abrir, true);
  assert.equal(lerConfig(['--sem-abrir'], {}, mac).abrir, false);
  assert.equal(lerConfig([], { ABRIR: '0' }, mac).abrir, false);
  assert.equal(lerConfig([], { ABRIR: '1' }, macSemTerminal).abrir, true);
  assert.equal(lerConfig(['--abrir'], { ABRIR: '0' }, mac).abrir, true, 'a flag vence o ambiente');
});

test('config: --navegador e NAVEGADOR trocam o app; a flag vence', () => {
  assert.equal(lerConfig(['--navegador', 'Google Chrome'], {}, mac).navegador, 'Google Chrome');
  assert.equal(lerConfig([], { NAVEGADOR: 'Firefox' }, mac).navegador, 'Firefox');
  assert.equal(lerConfig(['--navegador', 'Google Chrome'], { NAVEGADOR: 'Firefox' }, mac).navegador, 'Google Chrome');
  assert.throws(() => lerConfig(['--navegador'], {}, mac), /precisa de um valor/);
});

test('config: fora do macOS não há app padrão (usa o navegador padrão do sistema)', () => {
  const cfg = lerConfig([], {}, linux);
  assert.equal(cfg.abrir, true);
  assert.equal(cfg.navegador, null);
});
