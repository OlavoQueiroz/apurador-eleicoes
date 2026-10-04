import test from 'node:test';
import assert from 'node:assert/strict';
import { analisePartido, focoHtml, listarPartidos, normaPartido, CLAUSULA } from '../public/partido-foco.js';
import { hashPartidos } from '../public/partidos.js';

const cand = (partido, nomeUrna, votos, situacao = 'nenhuma') => ({ partido, nomeUrna, votos, situacao });
const dados = (vagas, pct, validos, candidatos, agrupamentos) => ({ cargo: { vagas }, secoes: { pctTotalizadas: pct }, votos: { validos }, candidatos, agrupamentos });
const detalhes = new Map([
  ['sp', dados(70, 60, 1000, [cand('MISSÃO', 'Ana', 40, 'eleito'), cand('MISSÃO', 'Bia', 20), cand('PL', 'Caio', 300)], [
    { sigla: 'MISSÃO', partidos: ['MISSÃO'], votos: 80 }, { sigla: 'PL', partidos: ['PL'], votos: 400 }])],
  ['rj', dados(46, 50, 500, [cand('PT', 'Davi', 100)], [{ sigla: 'PT', partidos: ['PT'], votos: 100 }])],
  ['mg', dados(53, 0, 0, [cand('MISSÃO', 'Edu', 0)], [{ sigla: 'MISSÃO', partidos: ['MISSÃO'], votos: 0 }])],
]);
const resumos = new Map([
  ['sp', { eleitosPorPartido: { MISSÃO: 1 }, cadeirasPorPartido: { MISSÃO: 3, PL: 20 }, cadeirasEstimadas: true }],
  ['rj', { eleitosPorPartido: {}, cadeirasPorPartido: {} }],
]);

test('normaPartido: ignora acento e pontuação', () => {
  assert.equal(normaPartido('MISSÃO'), 'MISSAO');
  assert.equal(normaPartido('Missao'), 'MISSAO');
  assert.equal(normaPartido('PC do B'), 'PCDOB');
});

test('listarPartidos: um por partido, em ordem alfabética', () => {
  assert.deepEqual(listarPartidos(detalhes).map((p) => p.sigla), ['MISSÃO', 'PL', 'PT']);
});

test('analisePartido: cadeiras confirmadas e na frente, votos da lista e UFs acima do mínimo', () => {
  const a = analisePartido({ alvo: 'missao', detalhes, resumos });
  assert.equal(a.sigla, 'MISSÃO');
  assert.equal(a.confirmadas, 1);
  assert.equal(a.naFrente, 2);
  assert.equal(a.total, 3);
  assert.equal(a.estimada, true);
  assert.equal(a.ufsComCadeira, 1);
  assert.equal(a.votos, 80); // MG ainda sem votos válidos não conta
  assert.equal(a.validos, 1500);
  assert.ok(Math.abs(a.pctNacional - (100 * 80) / 1500) < 1e-9);
  assert.equal(a.ufsAcimaDoMinimo, 1); // SP: 8% ≥ 1,5%
  const sp = a.linhas.find((l) => l.uf === 'sp');
  assert.deepEqual(sp.principais.map((c) => c.nomeUrna), ['Ana', 'Bia']);
  assert.equal(analisePartido({ alvo: 'naoexiste', detalhes, resumos }).sigla, null);
});

test('focoHtml: cartões, cláusula só na Câmara e aviso quando o partido não aparece', () => {
  const ajuda = { esc: (s) => String(s), fmtInt: (n) => String(n), corPartido: () => '#123456', nomeUf: (u) => u.toUpperCase() };
  const modelo = { cargo: { codigo: 6 }, uf: null, base: { ano: 2022, porPartido: { PL: 99 } } };
  const html = focoHtml(modelo, { partido: 'missao', detalhes, resumos }, ajuda);
  assert.match(html, /Eleitos confirmados<\/span>\s*<div class="par-card-topo"><b>1<\/b>/);
  assert.match(html, /Na frente \(estimativa\)/);
  assert.match(html, /Bancada em 2022/);
  assert.match(html, /sem eleitos \(partido novo/);
  assert.match(html, new RegExp(`Cláusula de desempenho de 2026`));
  assert.match(html, new RegExp(`de ${CLAUSULA.deputados}`));
  assert.match(html, /ainda não/); // 6 deputados e 5 UFs: nenhum critério fechado, mesmo com votos acima de 2,5%
  assert.doesNotMatch(html, /atinge hoje/);
  assert.match(html, /<option value="missao" selected>MISSÃO<\/option>/);
  const estadual = focoHtml({ cargo: { codigo: 7, ufs: { sp: 94 } }, uf: 'sp', base: null }, { partido: 'missao', detalhes: new Map([['sp', detalhes.get('sp')]]), resumos }, ajuda);
  assert.doesNotMatch(estadual, /Cláusula de desempenho/);
  assert.match(estadual, /Candidatos mais votados do partido/);
  assert.match(focoHtml(modelo, { partido: 'xyz', detalhes, resumos }, ajuda), /Nenhum candidato deste partido/);
  assert.match(focoHtml(modelo, { partido: 'missao', detalhes: undefined }, ajuda), /Carregando/);
});

test('hashPartidos: a aba "Um partido" leva o partido no endereço', () => {
  assert.equal(hashPartidos(6, 'foco', 'ideologia', null, 'missao'), '#/6/br/analise/foco/p-missao');
  assert.equal(hashPartidos(7, 'foco', 'ideologia', 'rj', 'missao'), '#/7/rj/analise/foco/p-missao');
  assert.equal(hashPartidos(6, 'placar', 'ideologia', null, 'missao'), '#/6/br/analise');
});
