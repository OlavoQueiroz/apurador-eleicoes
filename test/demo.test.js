import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizar } from '../src/normalize.js';
import { criarFonteDemo, simular } from '../src/demo.js';

const base = (nome) => normalizar(JSON.parse(readFileSync(new URL(`./fixtures/${nome}.json`, import.meta.url), 'utf8')));
const soma = (candidatos) => candidatos.reduce((s, c) => s + c.votos, 0);

test('t = 0: nada apurado, todos os votos zerados', () => {
  const d = simular(base('presidente-br'), { chave: '1:br' }, 0);
  assert.equal(d.secoes.totalizadas, 0);
  assert.equal(d.eleitorado.comparecimento, 0);
  assert.equal(soma(d.candidatos), 0);
  assert.equal(d.totalizacaoFinal, false);
});

test('meio da apuração: votos dos candidatos fecham exatamente nos votos válidos', () => {
  for (const t of [0.2, 0.5, 0.8]) {
    const d = simular(base('presidente-br'), { chave: '1:br' }, t);
    assert.ok(d.votos.validos > 0);
    assert.equal(soma(d.candidatos), d.votos.validos);
    const pcts = d.candidatos.reduce((s, c) => s + c.pct, 0);
    assert.ok(Math.abs(pcts - 100) < 0.1, `percentuais somam ${pcts}`);
    assert.equal(d.votos.validos + d.votos.brancos + d.votos.nulos, d.eleitorado.comparecimento);
    assert.ok(d.secoes.totalizadas <= d.secoes.total);
  }
});

test('a apuração só avança: seções e comparecimento nunca diminuem', () => {
  const b = base('presidente-br');
  let anterior = simular(b, { chave: '1:br' }, 0);
  for (let t = 0.05; t <= 1.2; t += 0.05) {
    const atual = simular(b, { chave: '1:br' }, t);
    assert.ok(atual.secoes.totalizadas >= anterior.secoes.totalizadas);
    assert.ok(atual.eleitorado.comparecimento >= anterior.eleitorado.comparecimento);
    anterior = atual;
  }
});

test('é determinístico e candidatos saem ordenados por votos', () => {
  const b = base('presidente-br');
  const a1 = simular(b, { chave: '1:br' }, 0.6, { agora: 1 });
  const a2 = simular(b, { chave: '1:br' }, 0.6, { agora: 1 });
  assert.deepEqual(a1, a2);
  for (let i = 1; i < a1.candidatos.length; i += 1) {
    assert.ok(a1.candidatos[i - 1].votos >= a1.candidatos[i].votos);
  }
  assert.notDeepEqual(a1, simular(b, { chave: '1:sp' }, 0.6, { agora: 1 }));
});

test('não altera a estrutura recebida', () => {
  const b = base('presidente-br');
  const copia = structuredClone(b);
  simular(b, { chave: '1:br' }, 1);
  assert.deepEqual(b, copia);
});

test('final, majoritário: ou um eleito (>50%) ou dois no 2º turno', () => {
  const d = simular(base('presidente-br'), { chave: '1:br' }, 2);
  assert.equal(d.totalizacaoFinal, true);
  assert.equal(d.secoes.totalizadas, d.secoes.total);
  const eleitos = d.candidatos.filter((c) => c.situacao === 'eleito');
  const segundo = d.candidatos.filter((c) => c.situacao === 'segundo-turno');
  if (d.candidatos[0].pct > 50) {
    assert.equal(eleitos.length, 1);
    assert.equal(segundo.length, 0);
  } else {
    assert.equal(eleitos.length, 0);
    assert.equal(segundo.length, 2);
  }
});

test('final, senador e deputado: eleitos = número de vagas', () => {
  const sen = simular(base('senador-sp'), { chave: '5:sp' }, 2);
  assert.equal(sen.candidatos.filter((c) => c.situacao === 'eleito').length, 2);

  const dep = simular(base('deputado-federal-df'), { chave: '6:df' }, 2);
  assert.equal(dep.candidatos.filter((c) => c.situacao === 'eleito').length, 8);
  assert.equal(dep.agrupamentos.reduce((s, a) => s + a.vagas, 0), 8);
  assert.equal(soma(dep.candidatos), dep.votos.validos);
});

test('fonte de demonstração busca a estrutura uma vez e repassa indisponível', async () => {
  let chamadas = 0;
  const dados = base('presidente-br');
  const fonteBase = {
    async obter(alvo) {
      chamadas += 1;
      return alvo.chave === 'x' ? { status: 'indisponivel' } : { status: 'novo', dados, etag: 'e1' };
    },
  };
  let relogio = 1_000;
  const fonte = criarFonteDemo(fonteBase, { duracaoMin: 1, agora: () => relogio });

  const r1 = await fonte.obter({ chave: '1:br' });
  relogio += 30_000;
  const r2 = await fonte.obter({ chave: '1:br' });
  assert.equal(chamadas, 1);
  assert.equal(r1.status, 'novo');
  assert.ok(r2.dados.secoes.totalizadas > r1.dados.secoes.totalizadas);
  assert.notEqual(r1.dados.geracao, r2.dados.geracao);
  assert.deepEqual(await fonte.obter({ chave: 'x' }), { status: 'indisponivel' });
});

test('presidente: o líder nacional também lidera na maioria das UFs (mapa e total contam a mesma história)', () => {
  const b = base('presidente-br');
  const ufs = ['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt', 'pa', 'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to'];
  const lider = (chave) => simular(b, { chave }, 2).candidatos[0].sq;
  const nacional = lider('1:br');
  const iguais = ufs.filter((uf) => lider(`1:${uf}`) === nacional).length;
  assert.ok(iguais >= ufs.length / 2, `o líder nacional lidera só ${iguais} de ${ufs.length} UFs`);
  // ...mas não em todas: o mapa precisa ter alguma variação.
  assert.ok(iguais < ufs.length, 'nenhuma UF destoa do total nacional');
});

test('anonimizar: nenhum nome, número ou sigla real sobrevive e a identidade é estável entre arquivos', async () => {
  const { anonimizar, criarRegistroAnonimo } = await import('../src/demo.js');
  const registro = criarRegistroAnonimo();
  const nacional = base('presidente-br');
  const senador = base('senador-sp');
  const a = anonimizar(nacional, registro);
  const b = anonimizar(senador, registro);

  const reais = new Set();
  for (const c of [...nacional.candidatos, ...senador.candidatos]) {
    [c.nome, c.nomeUrna, c.partido, c.partidoNome, c.numero, ...c.vices.map((v) => v.nomeUrna)].forEach((x) => reais.add(x));
  }
  for (const c of [...a.candidatos, ...b.candidatos]) {
    for (const campo of [c.nome, c.nomeUrna, c.partido, c.partidoNome, c.numero, c.agrupamento]) {
      assert.ok(!reais.has(campo), `sobrou dado real: ${campo}`);
    }
    for (const v of c.vices) assert.ok(!reais.has(v.nomeUrna));
    assert.match(c.nomeUrna, /^CANDIDATO \d{4}$/);
  }
  assert.ok(a.agrupamentos.every((g) => !/PARTIDO|FEDERAÇÃO/.test(g.nome)));

  // Estrutura preservada.
  assert.equal(a.candidatos.length, nacional.candidatos.length);
  assert.equal(b.cargo.vagas, senador.cargo.vagas);
  assert.equal(new Set(a.candidatos.map((c) => c.numero)).size, a.candidatos.length, 'números únicos');

  // Mesmo candidato (sq) → mesmo código fictício, no total nacional e nas UFs.
  const de = (dados) => new Map(dados.candidatos.map((c) => [c.sq, c.nomeUrna]));
  const outraUf = anonimizar(nacional, registro);
  assert.deepEqual(de(outraUf), de(a));
  // Mesmo partido → mesma sigla fictícia em todos os arquivos.
  assert.equal(a.candidatos[0].partido, outraUf.candidatos[0].partido);
  // Original intacto.
  assert.ok(nacional.candidatos.some((c) => c.nomeUrna === 'LULA'));
});
