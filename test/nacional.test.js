import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizar } from '../src/normalize.js';
import { Apuracao } from '../src/apuracao.js';
import { melhorNacional, somarUfs } from '../src/nacional.js';

const base = normalizar(JSON.parse(readFileSync(new URL('./fixtures/presidente-br.json', import.meta.url), 'utf8')));

// Uma UF fictícia: mesmos candidatos do modelo, com votos e seções dados.
const uf = (geracao, votosPorPos, totalizadas = 100, geradoEm = '2026-10-04T19:30:00-03:00') => {
  const candidatos = base.candidatos.map((c, i) => ({ ...c, votos: votosPorPos[i] ?? 0 }));
  const validos = candidatos.reduce((s, c) => s + c.votos, 0);
  return {
    ...base, geracao, geradoEm, candidatos,
    secoes: { total: 200, totalizadas, pctTotalizadas: 0 },
    eleitorado: { total: 1000, comparecimento: 800, pctComparecimento: 0, abstencao: 200, pctAbstencao: 0 },
    votos: { validos, pctValidos: 0, brancos: 5, pctBrancos: 0, nulos: 7, pctNulos: 0 },
  };
};

const oficial = (validos) => ({ ...base, votos: { ...base.votos, validos } });

test('somarUfs soma votos, seções e eleitorado, recalcula % e ordena', () => {
  const soma = somarUfs([uf('a', [10, 30]), uf('b', [20, 20], 150, '2026-10-04T19:10:00-03:00')], base);
  assert.equal(soma.fonte, 'soma-ufs');
  assert.equal(soma.votos.validos, 80);
  assert.equal(soma.secoes.totalizadas, 250);
  assert.equal(soma.secoes.total, 400);
  assert.equal(soma.eleitorado.comparecimento, 1600);
  const [primeiro, segundo] = soma.candidatos;
  assert.equal(primeiro.votos, 50);
  assert.equal(primeiro.pct, 62.5);
  assert.equal(segundo.votos, 30);
  assert.equal(soma.geradoEm, '2026-10-04T19:10:00-03:00'); // o arquivo mais antigo da conta
});

test('somarUfs sem nenhuma UF com dado devolve null', () => {
  assert.equal(somarUfs([null, undefined]), null);
});

test('melhorNacional: fica com a fonte de mais votos válidos; empate vale o oficial', () => {
  const ufs = [uf('a', [10, 30]), uf('b', [20, 20])]; // soma = 80
  assert.equal(melhorNacional(oficial(50), ufs).fonte, 'soma-ufs');
  const o = oficial(80);
  assert.equal(melhorNacional(o, ufs), o);
  const maior = oficial(500);
  assert.equal(melhorNacional(maior, ufs), maior);
  assert.equal(melhorNacional(null, ufs).fonte, 'soma-ufs');
  assert.equal(melhorNacional(maior, []), maior);
});

test('ciclo: o nacional passa a vir da soma das UFs quando ela tem mais votos, e volta ao oficial se ele passar', async () => {
  const alvos = [
    { chave: '1:br', cargo: 1, uf: 'br' },
    { chave: '1:sp', cargo: 1, uf: 'sp' },
    { chave: '1:rj', cargo: 1, uf: 'rj' },
  ];
  const roteiro = {
    '1:br': [{ status: 'novo', dados: oficial(50), etag: 'a' }, { status: 'indisponivel' }, { status: 'novo', dados: { ...oficial(500), geracao: 'nova' }, etag: 'b' }],
    '1:sp': [{ status: 'novo', dados: uf('sp1', [10, 30]), etag: 's' }, { status: 'inalterado' }, { status: 'inalterado' }],
    '1:rj': [{ status: 'novo', dados: uf('rj1', [20, 20]), etag: 'r' }, { status: 'inalterado' }, { status: 'inalterado' }],
  };
  const fonte = { async obter(alvo) { return roteiro[alvo.chave].shift(); } };
  const a = new Apuracao({ alvos, fonte });

  const c1 = await a.ciclo();
  assert.ok(c1.chavesAlteradas.includes('1:br'));
  assert.equal(a.estado.get('1:br').dados.fonte, 'soma-ufs');
  assert.equal(a.estado.get('1:br').resumo.validos, 80);

  // Arquivo nacional sumiu: o dado somado continua valendo, sem virar erro.
  await a.ciclo();
  assert.equal(a.estado.get('1:br').status, 'ok');
  assert.equal(a.estado.get('1:br').dados.fonte, 'soma-ufs');

  // O oficial passa a soma: vale o oficial.
  await a.ciclo();
  assert.equal(a.estado.get('1:br').dados.votos.validos, 500);
  assert.equal(a.estado.get('1:br').dados.fonte, undefined);
});
