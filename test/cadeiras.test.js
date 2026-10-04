import test from 'node:test';
import assert from 'node:assert/strict';
import { posicoesHemiciclo, ordemSerpentina, ordenarBancadas, listarCadeiras, cadeirasHtml } from '../public/cadeiras.js';
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

test('ordemSerpentina: usa todos os pontos uma vez e cadeiras seguidas ficam vizinhas', () => {
  for (const n of [27, 81, 513]) {
    const { pontos, raio } = posicoesHemiciclo(n);
    const ordem = ordemSerpentina(pontos);
    assert.equal(ordem.length, n);
    assert.equal(new Set(ordem).size, n);
    // Vizinhas: a distância entre duas cadeiras seguidas nunca passa de poucos diâmetros (sem saltos pelo hemiciclo).
    const maior = Math.max(...ordem.slice(1).map((p, i) => Math.hypot(p.x - ordem[i].x, p.y - ordem[i].y)));
    assert.ok(maior < raio * 2 * 12, `n=${n}: salto de ${maior.toFixed(0)}px entre cadeiras seguidas`);
  }
  assert.deepEqual(ordemSerpentina([]), []);
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

test('cadeiras de quem está na frente: contorno, contam na bancada, não contam como definidas', () => {
  const dados = {
    titulo: 'Senado', total: 6, pendentes: 1,
    partidos: { PT: { eleitos: 1, lideres: 2, pessoasLideres: [{ nome: 'Ana', uf: 'sp' }] }, PL: { ocupadas: 2 } },
    ocupadas: true,
  };
  const html = cadeirasHtml(dados, { modo: 'partido', foco: null }, ajuda);
  assert.equal(html.match(/<circle/g).length, 6);
  assert.equal(html.match(/stroke-width:2\.2/g).length, 2);
  assert.match(html, /Ana \(SP\) · PT · na frente, ainda não eleito/);
  assert.match(html, /<text class="cad-num"[^>]*>3<\/text>/); // 1 eleito + 2 fora de disputa
  assert.match(html, /data-cad-foco="p:PT"[^>]*>.*?<b>3<\/b>/);
});

test('legenda: três maiores à vista e o resto em "Outros"; poucos partidos aparecem todos; o foco nunca some', () => {
  const todos = { PL: 9, PT: 7, PSD: 5, PP: 4, MDB: 3, PSB: 2 };
  const dados = (n) => ({ titulo: 'Câmara', total: 40, pendentes: 0, partidos: Object.fromEntries(Object.entries(n).map(([s, e]) => [s, { eleitos: e }])), ocupadas: false });
  const legenda = (ui, n = todos) => cadeirasHtml(dados(n), ui, ajuda).match(/<div class="cad-legenda">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>|<div class="cad-legenda">[\s\S]*?<\/section>/)[0];
  const visiveis = (h) => [...h.matchAll(/class="cad-chip" data-cad-foco="[^"]*" aria-pressed="(?:true|false)"[^>]*><i><\/i>([^ <]+) /g)].map((m) => m[1]);

  const base = legenda({ modo: 'partido', foco: null });
  assert.deepEqual(visiveis(base), ['PL', 'PT', 'PSD']);
  assert.match(base, /Outros <b>9<\/b> <small>3 partidos<\/small>/); // PP 4 + MDB 3 + PSB 2
  for (const s of ['PP', 'MDB', 'PSB']) assert.match(base, new RegExp(`class="cad-pop-it" data-cad-foco="p:${s}"`));

  // Com o foco num partido do "Outros", ele aparece como chip pressionado e sai da lista.
  const foco = legenda({ modo: 'partido', foco: { tipo: 'p', id: 'MDB' } });
  assert.deepEqual(visiveis(foco), ['PL', 'PT', 'PSD', 'MDB']);
  assert.match(foco, /Outros <b>6<\/b> <small>2 partidos<\/small>/);
  assert.doesNotMatch(foco, /class="cad-pop-it" data-cad-foco="p:MDB"/);

  // Até quatro partidos, nada de "Outros" e a ordem segue a ideologia, como antes.
  const poucos = legenda({ modo: 'partido', foco: null }, { PL: 9, PT: 7, PSD: 5, PP: 4 });
  assert.deepEqual(visiveis(poucos), ['PT', 'PSD', 'PP', 'PL']);
  assert.doesNotMatch(poucos, /cad-outros/);
});

test('vaga do partido: preenchimento claro com borda, separada do eleito marcado, com chave de leitura e contagem', () => {
  const dados = {
    titulo: 'Câmara', total: 6, pendentes: 1,
    partidos: { PT: { eleitos: 3, pessoasEleitas: [{ nome: 'Ana', uf: 'sp' }, { nome: 'Bia', uf: 'sp', inferido: true }, { nome: 'Caio', uf: 'rj', inferido: true }] }, PL: { eleitos: 2 } },
    ocupadas: false,
  };
  const html = cadeirasHtml(dados, { modo: 'partido', foco: null }, ajuda);
  assert.equal(html.match(/<circle/g).length, 6);
  assert.equal(html.match(/stroke-width:1\.6/g).length, 2);
  assert.match(html, /Bia \(SP\) · PT · vaga do partido/);
  assert.doesNotMatch(html, /Ana \(SP\) · PT · vaga do partido/);
  assert.match(html, /Eleito \(marcado pelo TSE\) <b>3<\/b>/);
  assert.match(html, /Vaga do partido \(eleito ainda não marcado\) <b>2<\/b>/);
  assert.match(html, /Em apuração <b>1<\/b>/);
  assert.doesNotMatch(html, /Na frente, ainda não eleito <b>/);
});
