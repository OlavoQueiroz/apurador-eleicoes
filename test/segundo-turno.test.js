import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAnterior, aplicarTransferencias } from '../src/anterior.js';
import { adaptarParaSegundoTurno } from '../src/demo.js';
import { dueloHtml, editorTransfHtml, fracaoParaVirar, limparTransf, sufixoTransf, validosQueFaltam } from '../public/segundo-turno.js';

const historico = {
  fonte: 'teste',
  candidatos: { 13: {}, 22: {}, 55: {} },
  municipios: { m1: { uf: 'xx', votos: { 13: 40, 22: 40, 55: 20 } } },
};
const mapeamento = { _leia: 'x', 13: [{ de: '13', peso: 1 }], 22: [{ de: '22', peso: 1 }] };

test('transferências: acrescentam herdeiros ao mapeamento sem alterar o original', () => {
  const novo = aplicarTransferencias(mapeamento, { 55: { 22: 0.5, 13: 0.25 } });
  assert.deepEqual(novo[22], [{ de: '22', peso: 1 }, { de: '55', peso: 0.5 }]);
  assert.deepEqual(novo[13], [{ de: '13', peso: 1 }, { de: '55', peso: 0.25 }]);
  assert.deepEqual(mapeamento[22], [{ de: '22', peso: 1 }]);
  assert.equal(novo._leia, 'x');
});

test('transferências: valores inválidos são ignorados e a premissa muda o prior', () => {
  const base = criarAnterior(historico, mapeamento);
  assert.equal(base.prior('m1').herdados.get('22'), 40);
  const a = base.comTransferencias({ 55: { 22: 0.5, 13: 'abc' }, 99: { 13: 2 } });
  assert.equal(a.prior('m1').herdados.get('22'), 50);
  assert.equal(a.prior('m1').herdados.get('13'), 40);
  assert.deepEqual(a.avisos.filter((x) => /55/.test(x)), []);
});

test('premissas da tela: limpa o que é inválido e rejeita soma acima de 100%', () => {
  assert.deepEqual(limparTransf({ 55: { 13: 0.2, 22: 0.5 }, 70: { 13: 0.7, 22: 0.5 }, 14: { 13: 0 }, 30: { 22: 'x' } }), { 55: { 13: 0.2, 22: 0.5 } });
  assert.equal(sufixoTransf({}), '');
  assert.match(sufixoTransf({ 55: { 13: 0.2 } }), /^\?transf=%7B/);
});

test('conta do duelo: votos que faltam e fração necessária para empatar', () => {
  assert.equal(validosQueFaltam({ validos: 600, pctSecoes: 60 }), 400);
  assert.equal(validosQueFaltam({ validos: 600, pctSecoes: 100 }), 0);
  assert.equal(validosQueFaltam({ validos: 600, pctSecoes: 60, final: true }), 0);
  assert.equal(fracaoParaVirar({ margem: 100, faltam: 400 }), 0.625);
  assert.ok(fracaoParaVirar({ margem: 500, faltam: 400 }) > 1);
});

const util = { esc: (v) => String(v), fmtInt: (n) => String(n), fmtPct: (n, c = 2) => `${n.toFixed(c)}%`, corPartido: () => '#000' };
const dados = (extra = {}) => ({
  turno: 2, totalizacaoFinal: false, votos: { validos: 600 }, secoes: { pctTotalizadas: 60 },
  candidatos: [{ nomeUrna: 'A', partido: 'PT', votos: 350, pct: 58.33 }, { nomeUrna: 'B', partido: 'PL', votos: 250, pct: 41.67 }], ...extra,
});

test('duelo: mostra margem e o que falta; sem votos não desenha; apuração final não faz a conta', () => {
  const html = dueloHtml(dados(), util);
  assert.match(html, /100<\/b> votos/);
  assert.match(html, /precisaria de <b>62\.5%<\/b>/);
  assert.match(html, /não um dado do TSE/);
  assert.equal(dueloHtml(dados({ candidatos: [{ votos: 0 }, { votos: 0 }] }), util), '');
  assert.doesNotMatch(dueloHtml(dados({ totalizacaoFinal: true }), util), /precisaria/);
  const virou = dueloHtml(dados({ secoes: { pctTotalizadas: 99 }, votos: { validos: 600 } }), util);
  assert.match(virou, /não alcançaria nem com todos/);
});

test('editor de premissas: só lista eliminados, mostra o valor guardado e marca personalizadas', () => {
  const finalistas = [{ numero: '13', nomeUrna: 'A', partido: 'PT' }, { numero: '22', nomeUrna: 'B', partido: 'PL' }];
  const candidatos1T = { 13: { nomeUrna: 'A', partido: 'PT' }, 22: { nomeUrna: 'B', partido: 'PL' }, 55: { nomeUrna: 'Caiado', partido: 'PSD' } };
  const html = editorTransfHtml({ candidatos1T, finalistas, transf: { 55: { 22: 0.3 } }, esc: util.esc, corPartido: util.corPartido });
  assert.match(html, /data-origem="55"/);
  assert.doesNotMatch(html, /data-origem="13"/);
  assert.match(html, /value="30"/);
  assert.match(html, /personalizadas/);
  assert.equal(editorTransfHtml({ candidatos1T, finalistas: [finalistas[0]], transf: {}, esc: util.esc, corPartido: util.corPartido }), '');
});

test('ensaio do 2º turno: usa os dois mais votados do 1º; governador só se o líder não passou de 50%', async () => {
  const dados1T = (pct1) => ({ candidatos: [{ votos: 50, pct: pct1 }, { votos: 30, pct: 30 }, { votos: 20, pct: 20 }, { votos: 0, pct: 0 }], turno: 1 });
  let urlPedida = null;
  const base = { async obter(alvo) { urlPedida = alvo.url; return { status: 'novo', dados: dados1T(alvo.uf === 'sp' ? 60 : 40) }; } };
  const f = adaptarParaSegundoTurno(base, { urlDoPrimeiroTurno: () => 'T1', eleicaoDoPrimeiroTurno: (e) => e });
  const r = await f.obter({ cargo: 3, uf: 'rj', eleicao: '2', url: 'T2' });
  assert.equal(urlPedida, 'T1');
  assert.equal(r.dados.candidatos.length, 2);
  assert.equal(r.dados.turno, 2);
  assert.equal((await f.obter({ cargo: 3, uf: 'sp', eleicao: '2' })).status, 'indisponivel');
  assert.equal((await f.obter({ cargo: 1, uf: 'sp', eleicao: '2' })).status, 'novo');
});
