import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classificarSituacao, normalizar, paraIso, resumir } from '../src/normalize.js';

const fixture = (nome) => JSON.parse(readFileSync(new URL(`./fixtures/${nome}.json`, import.meta.url), 'utf8'));

function candidatoBruto(bruto, numero) {
  for (const agr of bruto.carg[0].agr) {
    for (const par of agr.par) {
      const achado = par.cand.find((c) => c.n === numero);
      if (achado) return achado;
    }
  }
  throw new Error(`candidato ${numero} não encontrado`);
}

test('presidente antes da apuração: estrutura completa e votos zerados', () => {
  const d = normalizar(fixture('presidente-br'));
  assert.equal(d.cargo.nome, 'Presidente');
  assert.equal(d.cargo.vagas, 1);
  assert.equal(d.abrangencia, 'br');
  assert.equal(d.turno, 1);
  assert.equal(d.candidatos.length, 12);
  assert.equal(d.secoes.total, 499248);
  assert.equal(d.secoes.totalizadas, 0);
  assert.equal(d.eleitorado.total, 158745502);
  assert.equal(d.geradoEm, '2026-10-03T14:47:37-03:00');
  assert.ok(d.candidatos.every((c) => c.votos === 0 && c.situacao === 'nenhuma'));
  // Sem votos, a ordem é a da sequência informada pelo TSE (Lula é o 1º).
  assert.equal(d.candidatos[0].nomeUrna, 'LULA');
  assert.deepEqual(d.candidatos[0].vices, [{ tipo: 'v', nomeUrna: 'GERALDO ALCKMIN', partido: 'PSB' }]);
  assert.equal(resumir(d).lider, null);
});

test('com votos: converte texto em número, lê vírgula decimal e ordena por votos', () => {
  const bruto = fixture('presidente-br');
  Object.assign(candidatoBruto(bruto, '22'), { vap: '51234567', pvap: '51,07' });
  Object.assign(candidatoBruto(bruto, '13'), { vap: '40000000', pvap: '39,87' });
  Object.assign(bruto.s, { st: '125000', pst: '25,04' });
  Object.assign(bruto.v, { vv: '100000000', pvv: '94,10', vb: '2000000', pvb: '1,88', tvn: '4000000', ptvn: '3,76' });
  Object.assign(bruto.e, { c: '106000000', pc: '75,60', a: '34000000', pa: '24,40' });

  const d = normalizar(bruto);
  assert.equal(d.candidatos[0].nomeUrna, 'FLAVIO BOLSONARO');
  assert.equal(d.candidatos[0].votos, 51234567);
  assert.equal(d.candidatos[0].pct, 51.07);
  assert.equal(d.candidatos[1].nomeUrna, 'LULA');
  assert.equal(d.secoes.totalizadas, 125000);
  assert.equal(d.secoes.pctTotalizadas, 25.04);
  assert.deepEqual(d.votos, {
    validos: 100000000, pctValidos: 94.1, brancos: 2000000, pctBrancos: 1.88, nulos: 4000000, pctNulos: 3.76,
  });
  assert.equal(d.eleitorado.pctComparecimento, 75.6);

  const r = resumir(d);
  assert.equal(r.lider.nomeUrna, 'FLAVIO BOLSONARO');
  assert.equal(r.segundo.nomeUrna, 'LULA');
});

test('votos válidos caem para vvc quando vv não existe', () => {
  const bruto = fixture('presidente-br');
  delete bruto.v.vv;
  delete bruto.v.pvv;
  Object.assign(bruto.v, { vvc: '777', pvvc: '88,50' });
  const d = normalizar(bruto);
  assert.equal(d.votos.validos, 777);
  assert.equal(d.votos.pctValidos, 88.5);
});

test('senador: duas vagas e suplentes', () => {
  const d = normalizar(fixture('senador-sp'));
  assert.equal(d.cargo.nome, 'Senador');
  assert.equal(d.cargo.vagas, 2);
  assert.equal(d.abrangencia, 'sp');
  assert.equal(d.candidatos.length, 13);
  assert.deepEqual(d.candidatos.find((c) => c.numero === '222').vices.map((v) => v.tipo), ['s1', 's2']);
});

test('deputado federal: agrupamentos (federações/partidos) e vagas', () => {
  const d = normalizar(fixture('deputado-federal-df'));
  assert.equal(d.cargo.nome, 'Deputado Federal');
  assert.equal(d.cargo.vagas, 8);
  assert.ok(d.candidatos.length > 50);
  assert.ok(d.agrupamentos.length > 5);
  assert.ok(d.agrupamentos.some((a) => a.tipo === 'f' && a.partidos.length > 1));
  assert.ok(d.candidatos.every((c) => c.agrupamentoId));
  // Sem votos: ordena pela sequência do TSE, crescente.
  for (let i = 1; i < d.candidatos.length; i += 1) {
    assert.ok(d.candidatos[i].ordem >= d.candidatos[i - 1].ordem);
  }
});

test('eleitos são contados por partido e por agrupamento', () => {
  const bruto = fixture('deputado-federal-df');
  const [par] = bruto.carg[0].agr[0].par;
  par.cand[0].st = 'Eleito por QP';
  par.cand[0].vap = '90000';
  par.cand[1].e = 's'; // st vazio: vale a flag
  par.cand[1].vap = '80000';
  const d = normalizar(bruto);
  const r = resumir(d);
  assert.equal(r.eleitos, 2);
  assert.equal(r.eleitosPorPartido[par.sg], 2);
  assert.equal(d.agrupamentos.find((a) => a.id === bruto.carg[0].agr[0].n).eleitos, 2);
});

test('classificarSituacao segue a regra do app do TSE', () => {
  const casos = [
    ['Eleito', 'n', 'eleito'],
    ['Eleito por QP', '', 'eleito'],
    ['Eleito por média', '', 'eleito'],
    ['2º turno', '', 'segundo-turno'],
    ['Segundo Turno', '', 'segundo-turno'],
    ['Suplente', '', 'suplente'],
    ['Não eleito', 's', 'nao-eleito'], // o texto manda sobre a flag
    ['Indeferido', '', 'outra'],
    ['', 's', 'eleito'],
    ['', '2', 'segundo-turno'],
    ['', 'n', 'nenhuma'],
    [undefined, undefined, 'nenhuma'],
  ];
  for (const [st, e, esperado] of casos) {
    assert.equal(classificarSituacao(st, e), esperado, `${st}|${e}`);
  }
});

test('paraIso usa o fuso de Brasília e rejeita formato inválido', () => {
  assert.equal(paraIso('04/10/2026', '18:05:09'), '2026-10-04T18:05:09-03:00');
  assert.equal(paraIso('', ''), null);
  assert.equal(paraIso('2026-10-04', '18:05:09'), null);
});

test('arquivo vazio ou sem cargo não quebra', () => {
  const d = normalizar({});
  assert.deepEqual(d.candidatos, []);
  assert.equal(d.secoes.total, 0);
  assert.equal(resumir(d).lider, null);
});
