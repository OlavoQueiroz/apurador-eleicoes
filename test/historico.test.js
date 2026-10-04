import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Historico, registrarCiclo, lerSerie } from '../src/historico.js';

const dados = (geradoEm, totalizadas, votosA, votosB) => ({
  geradoEm,
  secoes: { total: 100, totalizadas },
  votos: { validos: votosA + votosB },
  totalizacaoFinal: false,
  candidatos: [
    { numero: '13', nomeUrna: 'A', partido: 'PT', votos: votosA, pct: (100 * votosA) / (votosA + votosB) },
    { numero: '22', nomeUrna: 'B', partido: 'PL', votos: votosB, pct: (100 * votosB) / (votosA + votosB) },
  ],
});

const montar = (d) => ({ estado: new Map([['1:sp', { alvo: { chave: '1:sp', cargo: 1, uf: 'sp', eleicao: 6257 }, dados: d }]]) });
const arquivoNovo = () => path.join(mkdtempSync(path.join(tmpdir(), 'hist-')), 'sub', 'h.jsonl');

test('grava um ponto por arquivo novo do TSE, com % e projeção do momento, e não duplica', async () => {
  const arquivo = arquivoNovo();
  const h = new Historico({ arquivo });
  const apuracao = montar(dados('2026-10-04T20:00:00-03:00', 10, 60, 40));
  await registrarCiclo({ chaves: ['1:sp'], apuracao, municipios: null, historico: h });
  await registrarCiclo({ chaves: ['1:sp'], apuracao, municipios: null, historico: h }); // mesmo instante
  assert.equal(h.pontos('1:sp').length, 1);

  apuracao.estado.get('1:sp').dados = dados('2026-10-04T20:01:00-03:00', 20, 55, 45);
  await registrarCiclo({ chaves: ['1:sp'], apuracao, municipios: null, historico: h });
  await h.esvaziar();

  const linhas = readFileSync(arquivo, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].t, '2026-10-04T20:00:00-03:00');
  assert.equal(linhas[0].proj.estratificado, null, 'sem municípios, não inventa');
  assert.equal(linhas[0].proj.ingenuo[0].pct, 60);
});

test('não grava sem votos apurados nem cargos fora de presidente/governador/senador', async () => {
  const h = new Historico({ arquivo: arquivoNovo() });
  await registrarCiclo({ chaves: ['1:sp'], apuracao: montar(dados('t1', 0, 0, 0)), municipios: null, historico: h });
  const dep = montar(dados('t1', 10, 5, 5));
  dep.estado.get('1:sp').alvo.cargo = 6;
  await registrarCiclo({ chaves: ['1:sp'], apuracao: dep, municipios: null, historico: h });
  assert.equal(h.pontos('1:sp').length, 0);
});

test('sobrevive a reinício: relê o arquivo, ignora linha cortada e continua sem duplicar', async () => {
  const arquivo = arquivoNovo();
  const h1 = new Historico({ arquivo });
  const apuracao = montar(dados('t1', 10, 60, 40));
  await registrarCiclo({ chaves: ['1:sp'], apuracao, municipios: null, historico: h1 });
  await h1.esvaziar();
  const { appendFileSync } = await import('node:fs');
  appendFileSync(arquivo, '{"t":"corta'); // parada no meio da gravação

  const h2 = new Historico({ arquivo });
  assert.equal(h2.pontos('1:sp').length, 1);
  await registrarCiclo({ chaves: ['1:sp'], apuracao, municipios: null, historico: h2 }); // mesmo t
  assert.equal(h2.pontos('1:sp').length, 1);
});

test('lerSerie junta o % com a projeção do modelo pedido, ordenado por t', async () => {
  const h = new Historico({ arquivo: arquivoNovo() });
  h.registrar({
    t: 'b', chave: '1:sp', cargo: 1, uf: 'sp', secoes: { total: 100, totalizadas: 50 }, validos: 10,
    candidatos: [{ numero: '13', nomeUrna: 'A', partido: 'PT', votos: 5, pct: 50 }],
    proj: { ingenuo: [{ numero: '13', pct: 50 }], estratificado: [{ numero: '13', pct: 61 }] },
  });
  h.registrar({
    t: 'a', chave: '1:sp', cargo: 1, uf: 'sp', secoes: { total: 100, totalizadas: 10 }, validos: 2,
    candidatos: [{ numero: '13', nomeUrna: 'A', partido: 'PT', votos: 1, pct: 40 }],
    proj: { ingenuo: [{ numero: '13', pct: 40 }], estratificado: null },
  });
  const ingenuo = lerSerie(h, '1:sp', 'ingenuo');
  assert.deepEqual(ingenuo.pontos.map((p) => p.t), ['a', 'b']);
  assert.equal(ingenuo.pontos[1].secoes.pct, 50);
  const estrat = lerSerie(h, '1:sp', 'estratificado');
  assert.equal(estrat.pontos[0].candidatos[0].projPct, null);
  assert.equal(estrat.pontos[1].candidatos[0].projPct, 61);
  assert.equal(lerSerie(h, '1:xx'), null);
  await h.esvaziar();
});
