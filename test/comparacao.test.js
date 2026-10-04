import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregarComparacao, resumirComparacao, comparacaoHtml } from '../public/comparacao.js';

const proj = (a, b, extra = {}) => ({
  disponivel: true,
  candidatos: [{ numero: '13', nomeUrna: 'A', pctProjetado: a }, { numero: '22', nomeUrna: 'B', pctProjetado: b }],
  ...extra,
});
const ctx = { modelos: [{ id: 'x', nome: 'Modelo X' }, { id: 'y', nome: 'Modelo Y' }], modelo: 'x', esc: (v) => String(v), fmtPct: (n, c = 2) => `${n.toFixed(c)}%` };

test('modelos que concordam: dispersão pequena', () => {
  const r = resumirComparacao(proj(52, 44), [['x', proj(52, 44)], ['y', proj(52.4, 43.8)]]);
  assert.equal(r.nivel, 'concordam');
  assert.ok(Math.abs(r.dispersao - 0.6) < 1e-9);
});

test('modelos que divergem muito: avisa para não confiar', () => {
  const comparacao = [['x', proj(55, 40)], ['y', proj(48, 47)]];
  const r = resumirComparacao(proj(55, 40), comparacao);
  assert.equal(r.nivel, 'divergem-muito');
  const html = comparacaoHtml(proj(55, 40), comparacao, ctx);
  assert.match(html, /não confie em nenhuma projeção/);
  assert.match(html, /aviso-bloco erro/);
});

test('ignora modelos indisponíveis e precisa de pelo menos dois com dados', () => {
  assert.equal(resumirComparacao(proj(52, 44), [['x', proj(52, 44)], ['y', { disponivel: false }]]), null);
  assert.equal(resumirComparacao(proj(52, 44), undefined), null);
  assert.equal(comparacaoHtml(proj(52, 44), [], ctx), '');
});

test('marca a UF em plano B e destaca o modelo aberto', () => {
  const html = comparacaoHtml(proj(52, 44), [['x', proj(52, 44, { plano: 'extrapolacao' })], ['y', proj(51, 44)]], ctx);
  assert.match(html, /extrapolação simples nesta UF/);
  assert.match(html, /font-weight:650/);
});

test('carregarComparacao busca só os modelos disponíveis e tolera falha de um deles', async () => {
  const pedidos = [];
  const getJson = async (url) => {
    pedidos.push(url);
    if (url.includes('/y/')) throw new Error('HTTP 500');
    return { disponivel: true };
  };
  const r = await carregarComparacao(
    [{ id: 'x', disponivel: true }, { id: 'y', disponivel: true }, { id: 'z', disponivel: false }], 1, 'sp', getJson,
  );
  assert.deepEqual(pedidos.sort(), ['/api/projecao/x/1/sp', '/api/projecao/y/1/sp']);
  assert.deepEqual(r, [['x', { disponivel: true }], ['y', null]]);
});
