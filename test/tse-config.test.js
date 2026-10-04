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

test('1º turno com os cargos padrão: tudo menos deputado estadual', () => {
  const alvos = montarAlvos({ ...eleicoes2026, turno: 1 });
  const por = (cargo) => alvos.filter((a) => a.cargo === cargo);
  assert.deepEqual(CARGOS_PADRAO, [1, 3, 5, 6, 8]);
  assert.equal(por(1).length, 29); // br + 27 UFs + exterior
  assert.equal(por(3).length, 27);
  assert.equal(por(5).length, 27);
  assert.equal(por(6).length, 27);
  assert.deepEqual(por(8).map((a) => a.uf), ['df']);
  assert.equal(por(7).length, 0, 'deputado estadual fora por padrão');
  assert.equal(alvos.length, 111);
  assert.equal(new Set(alvos.map((a) => a.chave)).size, alvos.length, 'chaves únicas');
  assert.ok(por(1).every((a) => a.eleicao === '6257'));
  assert.ok(por(5).every((a) => a.eleicao === '6259'));
});

test('deputado estadual é opcional e o DF não tem esse cargo', () => {
  const alvos = montarAlvos({ ...eleicoes2026, turno: 1, cargos: [7] });
  assert.equal(alvos.length, UFS.length - 1);
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
  assert.deepEqual(padrao.cargos, [1, 3, 5, 6, 8]);

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
