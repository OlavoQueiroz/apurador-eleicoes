import test from 'node:test';
import assert from 'node:assert/strict';
import { posicoesHemiciclo, ordenarBancadas, listarCadeiras, cadeirasHtml } from '../public/cadeiras.js';
import { grupoDoPartido } from '../public/ideologia.js';

const ajuda = { esc: (t) => String(t), corPartido: () => '#000', fmtInt: (n) => String(n) };

test('posicoesHemiciclo: devolve exatamente n pontos, da esquerda para a direita', () => {
  for (const n of [1, 2, 27, 54, 81, 513]) {
    const { pontos, raio } = posicoesHemiciclo(n);
    assert.equal(pontos.length, n);
    assert.ok(raio > 0);
    for (let i = 1; i < n; i += 1) assert.ok(pontos[i - 1].angulo >= pontos[i].angulo);
  }
  assert.deepEqual(posicoesHemiciclo(0).pontos, []);
});

test('grupoDoPartido: tolera acento, espaço e caixa; o que não conhece é independente', () => {
  assert.equal(grupoDoPartido('PC do B'), 'esquerda');
  assert.equal(grupoDoPartido('União'), 'centrao');
  assert.equal(grupoDoPartido('PL'), 'direita');
  assert.equal(grupoDoPartido('S/Partido'), 'independente');
  assert.equal(grupoDoPartido('P01'), 'independente');
});

test('ordenarBancadas e listarCadeiras: ordem por ideologia, depois tamanho; vagas em aberto ao final', () => {
  const b = ordenarBancadas({ PL: { eleitos: 2 }, PT: { eleitos: 1, ocupadas: 3 }, PSOL: { eleitos: 1 }, MDB: { eleitos: 0 } });
  assert.deepEqual(b.map((x) => x.sigla), ['PT', 'PSOL', 'PL']);
  const c = listarCadeiras(b, 2);
  assert.equal(c.length, 4 + 1 + 2 + 2);
  assert.equal(c.filter((x) => x.sigla === null).length, 2);
  assert.equal(c.filter((x) => x.ocupada).length, 3);
  assert.equal(c.at(-1).sigla, null);
});

test('cadeirasHtml: uma cadeira por ponto e legenda conforme o modo e o foco', () => {
  const dados = { titulo: 'Composição', total: 10, pendentes: 4, partidos: { PT: { eleitos: 2 }, PL: { eleitos: 4 } }, ocupadas: false };
  const html = (ui) => cadeirasHtml(dados, ui, ajuda);
  const base = html({ modo: 'partido', foco: null });
  assert.equal(base.match(/<circle/g).length, 10);
  assert.match(base, /data-cad-foco="p:PL"/);
  const grupos = html({ modo: 'ideologia', foco: null });
  assert.match(grupos, /data-cad-foco="g:esquerda"/);
  assert.doesNotMatch(grupos, /data-cad-foco="p:/);
  const aberto = html({ modo: 'ideologia', foco: { tipo: 'g', id: 'direita' } });
  assert.match(aberto, /data-cad-foco="p:PL"/);
  assert.doesNotMatch(aberto, /data-cad-foco="p:PT"/);
  assert.match(aberto, /Todos os grupos/);
});
