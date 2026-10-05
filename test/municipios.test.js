import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Municipios } from '../src/municipios.js';

function fonteFalsa({ falhar = [] } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async listar() {
      return new Map([['sp', [{ codigo: '1', nome: 'UM' }, { codigo: '2', nome: 'DOIS' }, { codigo: '3', nome: 'TRES' }]]]);
    },
    async obter(alvo, anterior) {
      chamadas.push({ chave: alvo.chave, etag: anterior?.etag ?? null });
      if (falhar.includes(alvo.municipio)) throw new Error('HTTP 500');
      if (anterior?.etag) return { status: 'inalterado' };
      return { status: 'novo', dados: { municipio: alvo.municipio }, etag: `e-${alvo.municipio}` };
    },
  };
}

const consulta = { eleicao: 6257, cargo: 1, uf: 'sp' };

test('primeira consulta dispara a carga em segundo plano e depois entrega os municípios', async () => {
  const fonte = fonteFalsa();
  const m = new Municipios({ fonte, ciclo: 'ele2026' });
  const primeira = m.consultar(consulta);
  assert.equal(primeira.primeiraCarga, true);
  assert.equal(primeira.carregando, true);
  await primeira.pendente;

  const depois = m.consultar(consulta);
  assert.equal(depois.primeiraCarga, false);
  assert.equal(depois.total, 3);
  assert.equal(depois.dados.length, 3);
  assert.deepEqual(depois.progresso, { feitos: 3, total: 3 });
  assert.equal(fonte.chamadas.length, 3, 'sem nova consulta enquanto o dado é recente');
});

test('depois da validade, atualiza com GET condicional e mantém os dados', async () => {
  let agora = 0;
  const fonte = fonteFalsa();
  const m = new Municipios({ fonte, ciclo: 'ele2026', validadeMs: 1000, agora: () => agora });
  await m.consultar(consulta).pendente;
  agora = 1500;
  const velha = m.consultar(consulta);
  assert.equal(velha.dados.length, 3, 'serve o dado anterior enquanto atualiza');
  await velha.pendente;
  assert.equal(fonte.chamadas.length, 6);
  assert.ok(fonte.chamadas.slice(3).every((c) => c.etag), 'reenvia o ETag');
  assert.equal(m.consultar(consulta).dados.length, 3);
});

test('falha em um município não derruba os demais e é sinalizada', async () => {
  const m = new Municipios({ fonte: fonteFalsa({ falhar: ['2'] }), ciclo: 'ele2026' });
  await m.consultar(consulta).pendente;
  const r = m.consultar(consulta);
  assert.equal(r.dados.length, 2);
  assert.match(r.erro, /1 município/);
});

test('UF desconhecida na lista resulta em zero municípios, sem erro', async () => {
  const m = new Municipios({ fonte: fonteFalsa(), ciclo: 'ele2026' });
  await m.consultar({ ...consulta, uf: 'zz' }).pendente;
  const r = m.consultar({ ...consulta, uf: 'zz' });
  assert.equal(r.total, 0);
  assert.equal(r.dados.length, 0);
});

test('429 do TSE: recua, repete e termina carregando tudo', async () => {
  let rejeitar = 2;
  const fonte = {
    async listar() { return new Map([['sp', [{ codigo: '1', nome: 'UM' }, { codigo: '2', nome: 'DOIS' }]]]); },
    async obter(alvo) {
      if (rejeitar > 0) {
        rejeitar -= 1;
        throw Object.assign(new Error('HTTP 429'), { status: 429, esperarMs: 5 });
      }
      return { status: 'novo', dados: { municipio: alvo.municipio }, etag: null };
    },
  };
  const m = new Municipios({ fonte, ciclo: 'ele2026', espacamentoMs: 1 });
  await m.consultar(consulta).pendente;
  const r = m.consultar(consulta);
  assert.equal(r.dados.length, 2);
  assert.equal(r.erro, null);
  assert.ok(m.limitador.baixaMs > 1, 'o ritmo ficou mais lento depois do 429');
});

test('erro que não é 429 não é repetido', async () => {
  let chamadas = 0;
  const fonte = {
    async listar() { return new Map([['sp', [{ codigo: '1', nome: 'UM' }]]]); },
    async obter() { chamadas += 1; throw Object.assign(new Error('HTTP 500'), { status: 500 }); },
  };
  const m = new Municipios({ fonte, ciclo: 'ele2026', espacamentoMs: 1 });
  await m.consultar(consulta).pendente;
  assert.equal(chamadas, 1);
  assert.match(m.consultar(consulta).erro, /HTTP 500/);
});

// ---------- atualização guiada pelo arquivo de acompanhamento ----------

// `marcas` = o que o arquivo de acompanhamento diz de cada município ("seções:comparecimento").
function fonteComAcompanhamento(marcas) {
  return {
    municipais: [],
    acompanhamentos: 0,
    indisponivel: false,
    async listar() {
      return new Map([['sp', [{ codigo: '1', nome: 'UM' }, { codigo: '2', nome: 'DOIS' }, { codigo: '3', nome: 'TRES' }]]]);
    },
    async acompanhar() {
      this.acompanhamentos += 1;
      return this.indisponivel ? { status: 'indisponivel' } : { status: 'novo', mapa: new Map(Object.entries(marcas)), etag: 'ab' };
    },
    async obter(alvo) {
      this.municipais.push(alvo.municipio);
      return { status: 'novo', dados: { totalizacaoFinal: false }, etag: null };
    },
  };
}

const novo = (fonte, extra = {}) => {
  const relogio = { agora: 0 };
  const m = new Municipios({
    fonte, ciclo: 'ele2026', validadeMs: 1000, revalidarMs: 50_000, espacamentoMs: 0, pausaUfMs: 0, agora: () => relogio.agora, ...extra,
  });
  return { m, relogio };
};

test('guiada: acompanhamento sem mudança não baixa nenhum município; mudança baixa só o município que mudou', async () => {
  const marcas = { 1: '0:0', 2: '0:0', 3: '0:0' };
  const fonte = fonteComAcompanhamento(marcas);
  const { m, relogio } = novo(fonte);

  await m.consultar(consulta).pendente; // primeira carga é completa
  assert.deepEqual(fonte.municipais.sort(), ['1', '2', '3']);

  fonte.municipais.length = 0;
  relogio.agora = 2000; // velha, mas nada mudou
  await m.consultar(consulta).pendente;
  assert.deepEqual(fonte.municipais, []);

  marcas['2'] = '4:900'; // entraram urnas em um município
  relogio.agora = 4000;
  await m.consultar(consulta).pendente;
  assert.deepEqual(fonte.municipais, ['2']);
});

test('guiada: o acompanhamento é pedido uma vez por UF e passada, não uma vez por município', async () => {
  const fonte = fonteComAcompanhamento({ 1: 'a', 2: 'a', 3: 'a' });
  const { m } = novo(fonte);
  await m.consultar(consulta).pendente;
  assert.equal(fonte.acompanhamentos, 1);
});

test('guiada: acompanhamento fora do ar não dispara varredura; só a passada completa de segurança', async () => {
  const fonte = fonteComAcompanhamento({ 1: 'a', 2: 'a', 3: 'a' });
  const { m, relogio } = novo(fonte);
  await m.consultar(consulta).pendente; // completa (primeira)
  fonte.indisponivel = true;
  fonte.municipais.length = 0;

  relogio.agora = 2000;
  await m.consultar(consulta).pendente;
  assert.deepEqual(fonte.municipais, [], 'sem saber o que mudou, espera');

  relogio.agora = 60_000; // passou a revalidação
  await m.consultar(consulta).pendente;
  assert.deepEqual(fonte.municipais.sort(), ['1', '2', '3']);
});

test('guiada: município que falhou é retomado na passada seguinte, sem esperar a completa', async () => {
  const fonte = fonteComAcompanhamento({ 1: 'a', 2: 'a', 3: 'a' });
  let falhar = true;
  const obter = fonte.obter.bind(fonte);
  fonte.obter = async (alvo) => {
    if (falhar && alvo.municipio === '2') throw Object.assign(new Error('HTTP 500'), { status: 500 });
    return obter(alvo);
  };
  const { m, relogio } = novo(fonte);
  await m.consultar(consulta).pendente;
  assert.match(m.consultar(consulta).erro, /1 município/);

  falhar = false;
  fonte.municipais.length = 0;
  relogio.agora = 2000;
  await m.consultar(consulta).pendente;
  assert.deepEqual(fonte.municipais, ['2']);
});

test('reinício com cache em disco: confia nas marcas salvas e não baixa de novo o que não mudou', async () => {
  const guardado = new Map();
  const cache = {
    async ler(chave) { return guardado.get(chave) ?? null; },
    async gravar(chave, valor) { guardado.set(chave, JSON.parse(JSON.stringify(valor))); },
  };
  const marcas = { 1: 'a', 2: 'a', 3: 'a' };
  const fonte1 = fonteComAcompanhamento(marcas);
  const { m: antes } = novo(fonte1, { cache });
  await antes.consultar(consulta).pendente;
  assert.equal(guardado.size, 1);

  const fonte2 = fonteComAcompanhamento({ ...marcas, 3: 'b' }); // depois do reinício, só o 3 mudou
  const { m: depois } = novo(fonte2, { cache });
  await depois.consultar(consulta).pendente;
  assert.deepEqual(fonte2.municipais, ['3']);
  assert.equal(depois.consultar(consulta).dados.length, 3, 'o restante veio do disco');
});

test('município 100% apurado deixa de ser consultado', async () => {
  const fonte = fonteComAcompanhamento({ 1: 'a', 2: 'a', 3: 'a' });
  fonte.obter = async (alvo) => {
    fonte.municipais.push(alvo.municipio);
    return { status: 'novo', dados: { totalizacaoFinal: alvo.municipio === '1' }, etag: null };
  };
  const { m, relogio } = novo(fonte, { revalidarMs: 1000 });
  await m.consultar(consulta).pendente;
  fonte.municipais.length = 0;
  relogio.agora = 5000; // passada completa
  await m.consultar(consulta).pendente;
  assert.deepEqual(fonte.municipais.sort(), ['2', '3']);
});

test('manter percorre as UFs pedindo o acompanhamento de cada uma', async () => {
  const fonte = {
    pedidos: [],
    async listar() { return new Map([['sp', [{ codigo: '1', nome: 'UM' }]], ['mg', [{ codigo: '2', nome: 'DOIS' }]]]); },
    async acompanhar({ uf }) { this.pedidos.push(uf); return { status: 'novo', mapa: new Map(), etag: null }; },
    async obter() { return { status: 'novo', dados: { totalizacaoFinal: false }, etag: null }; },
  };
  const { m } = novo(fonte, { validadeMs: 5 });
  const rodando = m.manter({ eleicao: 1, cargo: 1 });
  await new Promise((r) => setTimeout(r, 40));
  m.parar();
  await rodando;
  assert.deepEqual([...new Set(fonte.pedidos)].sort(), ['mg', 'sp']);
});

// ---------- só os municípios grandes ----------

test('só baixa os municípios grandes (e o maior de cada UF), escolhidos pelo tamanho do acompanhamento', async () => {
  const detalhes = new Map([
    ['1', { aptos: 90_000, secoes: { total: 10, totalizadas: 0 } }],
    ['2', { aptos: 40_000, secoes: { total: 10, totalizadas: 0 } }],
    ['3', { aptos: 2_000, secoes: { total: 1, totalizadas: 0 } }],
    ['4', { aptos: 500, secoes: { total: 1, totalizadas: 0 } }],
  ]);
  const fonte = {
    municipais: [],
    async listar() { return new Map([['sp', ['1', '2', '3', '4'].map((c) => ({ codigo: c, nome: `M${c}` }))]]); },
    async acompanhar() { return { status: 'novo', mapa: new Map([...detalhes].map(([k]) => [k, 'x'])), detalhes, etag: null }; },
    async obter(alvo) { this.municipais.push(alvo.municipio); return { status: 'novo', dados: { totalizacaoFinal: false }, etag: null }; },
  };
  const { m } = novo(fonte, { minimoEleitores: 30_000 });
  await m.consultar(consulta).pendente;
  assert.deepEqual(fonte.municipais.sort(), ['1', '2']);
  const foto = m.consultar(consulta);
  assert.equal(foto.dados.length, 2);
  assert.equal(foto.completo, false);
  assert.equal(foto.total, 4);
  assert.equal(foto.detalhes.size, 4);
  assert.deepEqual(foto.progresso, { feitos: 2, total: 2 });
});

test('se nenhum passa do corte, ainda baixa o maior da UF', async () => {
  const detalhes = new Map([['1', { aptos: 900, secoes: { total: 1, totalizadas: 0 } }], ['2', { aptos: 500, secoes: { total: 1, totalizadas: 0 } }]]);
  const fonte = {
    municipais: [],
    async listar() { return new Map([['sp', [{ codigo: '1', nome: 'A' }, { codigo: '2', nome: 'B' }]]]); },
    async acompanhar() { return { status: 'novo', mapa: new Map([['1', 'x'], ['2', 'x']]), detalhes, etag: null }; },
    async obter(alvo) { this.municipais.push(alvo.municipio); return { status: 'novo', dados: { totalizacaoFinal: false }, etag: null }; },
  };
  const { m } = novo(fonte, { minimoEleitores: 30_000 });
  await m.consultar(consulta).pendente;
  assert.deepEqual(fonte.municipais, ['1']);
});

test('sem acompanhamento não dá para escolher os grandes: não baixa a UF inteira', async () => {
  const fonte = {
    municipais: [],
    async listar() { return new Map([['sp', [{ codigo: '1', nome: 'A' }, { codigo: '2', nome: 'B' }]]]); },
    async acompanhar() { return { status: 'indisponivel' }; },
    async obter(alvo) { this.municipais.push(alvo.municipio); return { status: 'novo', dados: {}, etag: null }; },
  };
  const { m } = novo(fonte, { minimoEleitores: 30_000 });
  await m.consultar(consulta).pendente;
  assert.deepEqual(fonte.municipais, []);
  assert.match(m.consultar(consulta).erro, /acompanhamento indisponível/);
});

test('listar tenta de novo quando o TSE responde 429 e não derruba quem espera', async () => {
  let chamadas = 0;
  const calmo = Object.assign(new Error('HTTP 429'), { status: 429, esperarMs: 1 });
  const fonte = {
    async listar() {
      chamadas += 1;
      if (chamadas <= 2) throw calmo;
      return new Map([['sp', [{ codigo: '1', nome: 'UM' }]]]);
    },
  };
  const { m } = novo(fonte);
  const lista = await m.listar(1);
  assert.equal(chamadas, 3);
  assert.deepEqual([...lista.keys()], ['sp']);
});

test('listar desiste depois de várias tentativas e deixa a próxima consulta tentar de novo', async () => {
  let chamadas = 0;
  const calmo = Object.assign(new Error('HTTP 503'), { status: 503, esperarMs: 1 });
  const fonte = { async listar() { chamadas += 1; throw calmo; } };
  const { m } = novo(fonte);
  await assert.rejects(m.listar(1), /HTTP 503/);
  assert.equal(chamadas, 6); // a primeira + 5 tentativas
  await assert.rejects(m.listar(1), /HTTP 503/); // não ficou guardada a falha
  assert.equal(chamadas, 12);
});

test('listar não repete erros que não são pedido de calma', async () => {
  let chamadas = 0;
  const fonte = { async listar() { chamadas += 1; throw Object.assign(new Error('HTTP 500'), { status: 500 }); } };
  const { m } = novo(fonte);
  await assert.rejects(m.listar(1), /HTTP 500/);
  assert.equal(chamadas, 1);
});
