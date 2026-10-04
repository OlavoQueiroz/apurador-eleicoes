import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARGOS_PADRAO, UFS, montarAlvos, urlResultado } from '../src/tse.js';
import { lerConfig } from '../src/config.js';

const eleicoes2026 = {
  ciclo: 'ele2026',
  eleicoes: { federal: { 1: '6257', 2: '6258' }, estadual: { 1: '6259', 2: '6260' } },
};

test('urlResultado segue o layout do arquivo unificado do TSE', () => {
  assert.equal(
    urlResultado('ele2026', '6257', 'br', 1),
    'https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json',
  );
  assert.equal(
    urlResultado('ele2026', '6259', 'sp', 6),
    'https://resultados.tse.jus.br/oficial/ele2026/6259/dados/sp/sp-c0006-e006259-u.json',
  );
});

test('1º turno com os cargos padrão: deputado estadual só em SP e RJ, sem distrital', () => {
  const alvos = montarAlvos({ ...eleicoes2026, turno: 1 });
  const por = (cargo) => alvos.filter((a) => a.cargo === cargo);
  assert.deepEqual(CARGOS_PADRAO, [1, 3, 5, 6, 7]);
  assert.equal(por(1).length, 29); // br + 27 UFs + exterior
  assert.equal(por(3).length, 27);
  assert.equal(por(5).length, 27);
  assert.equal(por(6).length, 27);
  assert.equal(por(8).length, 0, 'deputado distrital fora por padrão');
  assert.deepEqual(por(7).map((a) => a.uf), ['sp', 'rj'], 'deputado estadual só em SP e RJ');
  assert.equal(alvos.length, 112);
  assert.equal(new Set(alvos.map((a) => a.chave)).size, alvos.length, 'chaves únicas');
  assert.ok(por(1).every((a) => a.eleicao === '6257'));
  assert.ok(por(5).every((a) => a.eleicao === '6259'));
});

test('deputado estadual: só SP e RJ por enquanto (e o DF não tem esse cargo)', () => {
  const alvos = montarAlvos({ ...eleicoes2026, turno: 1, cargos: [7] });
  assert.deepEqual(alvos.map((a) => a.uf), ['sp', 'rj']);
  assert.ok(!alvos.some((a) => a.uf === 'df'));
});

test('2º turno: só presidente e governador, com os códigos do segundo turno', () => {
  const alvos = montarAlvos({ ...eleicoes2026, turno: 2 });
  assert.equal(alvos.length, 29 + 27);
  assert.ok(alvos.filter((a) => a.cargo === 1).every((a) => a.eleicao === '6258'));
  assert.ok(alvos.filter((a) => a.cargo === 3).every((a) => a.eleicao === '6260'));
  assert.ok(alvos.every((a) => a.url.includes('-u.json')));
});

test('sem código de eleição para o turno, não gera alvos', () => {
  const sem2 = { ciclo: 'ele2026', eleicoes: { federal: { 1: '6257', 2: null }, estadual: { 1: '6259', 2: null } } };
  assert.deepEqual(montarAlvos({ ...sem2, turno: 2 }), []);
});

test('lerConfig: padrões, flags e ambiente', () => {
  const padrao = lerConfig([], {});
  assert.equal(padrao.porta, 3000);
  assert.equal(padrao.host, '127.0.0.1', 'só local por padrão');
  assert.equal(padrao.intervalo, 60);
  assert.equal(padrao.demo, false);
  assert.deepEqual(padrao.cargos, [1, 3, 5, 6, 7]);

  const demo = lerConfig(['--demo'], {});
  assert.equal(demo.demo, true);
  assert.equal(demo.intervalo, 3);

  const misto = lerConfig(['--turno', '2', '--cargos', '1,3', '--porta', '4000'], { INTERVALO: '90' });
  assert.deepEqual([misto.turno, misto.cargos, misto.porta, misto.intervalo], [2, [1, 3], 4000, 90]);
});

test('lerConfig rejeita valores inválidos e intervalo agressivo demais', () => {
  assert.throws(() => lerConfig(['--turno', '3'], {}), /turno/);
  assert.throws(() => lerConfig(['--cargos', '1,99'], {}), /Cargo inválido: 99/);
  assert.throws(() => lerConfig(['--porta', 'abc'], {}), /Porta/);
  assert.throws(() => lerConfig(['--intervalo', '5'], {}), /Intervalo mínimo/);
  assert.throws(() => lerConfig(['--foo'], {}), /desconhecida/);
  assert.throws(() => lerConfig(['--demo', '--demo-minutos', '0'], {}), /Duração/);
  assert.equal(lerConfig(['--demo', '--demo-minutos', '2'], {}).demoMinutos, 2);
  assert.throws(() => lerConfig(['--porta'], {}), /precisa de um valor/);
  assert.doesNotThrow(() => lerConfig(['--demo', '--intervalo', '1'], {}));
});

test('fonte de municípios monta a URL do arquivo do município', async () => {
  const { criarFonteMunicipiosTse, urlMunicipio } = await import('../src/tse.js');
  assert.equal(
    urlMunicipio('ele2026', 6257, 'sp', '71072', 1),
    'https://resultados.tse.jus.br/oficial/ele2026/6257/dados/sp/sp71072-c0001-e006257-u.json',
  );
  const original = globalThis.fetch;
  const pedidos = [];
  globalThis.fetch = async (url) => {
    pedidos.push(url);
    return { status: 404, ok: false };
  };
  try {
    const r = await criarFonteMunicipiosTse().obter({ ciclo: 'ele2026', eleicao: 6257, uf: 'sp', municipio: '71072', cargo: 1 }, null);
    assert.equal(r.status, 'indisponivel');
    assert.deepEqual(pedidos, ['https://resultados.tse.jus.br/oficial/ele2026/6257/dados/sp/sp71072-c0001-e006257-u.json']);
  } finally {
    globalThis.fetch = original;
  }
});

test('arquivo de acompanhamento: URL e mapa município → seções:comparecimento', async () => {
  const { urlAcompanhamento, mapaAcompanhamento } = await import('../src/tse.js');
  assert.equal(
    urlAcompanhamento('ele2026', 6257, 'sp'),
    'https://resultados.tse.jus.br/oficial/ele2026/6257/dados/sp/sp-e006257-ab.json',
  );
  const mapa = mapaAcompanhamento({
    abr: [
      { tpabr: 'uf', cdabr: 'sp', s: { st: '9' }, e: { c: '1' } },
      { tpabr: 'mun', cdabr: '61000', s: { st: '3' }, e: { c: '1200' } },
      { tpabr: 'mun', cdabr: '61018', s: { st: '0' }, e: { c: '0' } },
    ],
  });
  assert.deepEqual([...mapa], [['61000', '3:1200'], ['61018', '0:0']]);
});

test('acompanhamento: detalhes de tamanho e seções por município, e opções de linha de comando', async () => {
  const { detalhesAcompanhamento } = await import('../src/tse.js');
  const d = detalhesAcompanhamento({
    abr: [
      { tpabr: 'uf', cdabr: 'sp', s: { ts: '99' }, e: { te: '9' } },
      { tpabr: 'mun', cdabr: '71072', s: { ts: '26.683', st: '10' }, e: { te: '9.000.000' } },
    ],
  });
  assert.deepEqual([...d], [['71072', { aptos: 9000000, secoes: { total: 26683, totalizadas: 10 } }]]);

  assert.equal(lerConfig([], {}).municipiosMinimo, 30000);
  assert.equal(lerConfig(['--municipios-minimo', '50000'], {}).municipiosMinimo, 50000);
  assert.equal(lerConfig(['--municipios-todos'], {}).municipiosMinimo, null);
  assert.throws(() => lerConfig(['--municipios-minimo', 'x'], {}), /municipios-minimo/);
});

test('comPrazo aborta uma requisição que não recebe resposta', async () => {
  const { createServer } = await import('node:http');
  const { comPrazo } = await import('../src/tse.js');
  const servidor = createServer(() => {}); // aceita a conexão e nunca responde
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = servidor.address();
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: comPrazo(null, 50) }), (e) => e.name === 'TimeoutError');
    const manual = new AbortController();
    const sinal = comPrazo(manual.signal, 10_000);
    manual.abort();
    assert.equal(sinal.aborted, true, 'o cancelamento externo continua valendo');
  } finally {
    servidor.closeAllConnections();
    servidor.close();
  }
});
