import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Apuracao } from '../src/apuracao.js';
import { criarAnterior } from '../src/anterior.js';
import { criarServidor } from '../src/servidor.js';
import {
  calcular, comparativoHtml, corDoMapa, itemDoAtual, regiaoDaUf, seletorPeriodoHtml, FRACAO_MINIMA, PERIODOS,
} from '../public/comparativo-eleicoes.js';

const ajuda = {
  esc: (t) => String(t), fmtInt: (n) => String(n), corPartido: (p) => (p === 'PT' ? '#d00' : '#00d'),
  nomeUf: (uf) => uf.toUpperCase(), hrefUf: (uf) => `#/1/${uf}/comparativo`, hrefPeriodo: (id) => `#/1/br/comparativo/${id}`, demo: false,
};
const perto = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// Base: BA com 1000 válidos (PT 600, campo de Bolsonaro 250); SP com 3000 (PT 1200, Bolsonaro 1400); o exterior não conta.
const base = { vivo: true, ufs: {
  ba: { validos: 1000, herdados: { 13: 600, 22: 250 } },
  sp: { validos: 3000, herdados: { 13: 1200, 22: 1400 } },
  zz: { validos: 100, herdados: { 13: 50, 22: 40 } },
} };
const item = (pct, validos, pt, pl) => ({ secoes: { pctTotalizadas: pct }, validos, votosPorNumero: { 13: pt, 22: pl } });
const itens = { ba: item(80, 1100, 700, 240), sp: item(30, 900, 400, 400) };
const modelo = calcular(base, (uf) => itens[uf]);

test('regiaoDaUf: cinco regiões; o exterior fica de fora', () => {
  assert.equal(regiaoDaUf('ba'), 'Nordeste');
  assert.equal(regiaoDaUf('sp'), 'Sudeste');
  assert.equal(regiaoDaUf('zz'), null);
});

test('calcular: peso pela base, saldo e impacto só para UF com apuração suficiente', () => {
  assert.equal(modelo.ufs.length, 2); // zz fora
  perto(modelo.ufs.reduce((s, u) => s + u.peso, 0), 100);
  const ba = modelo.ufs.find((u) => u.uf === 'ba');
  perto(ba.peso, 25); // 1000 de 4000
  assert.equal(ba.pronto, true);
  perto(ba.pt.pBase, 60); perto(ba.pt.pAtual, (100 * 700) / 1100); perto(ba.pt.d, (100 * 700) / 1100 - 60);
  perto(ba.pl.pBase, 25); perto(ba.pl.d, (100 * 240) / 1100 - 25);
  perto(ba.saldo, ba.pt.d - ba.pl.d);
  perto(ba.impacto, 0.25 * ba.saldo);
  const sp = modelo.ufs.find((u) => u.uf === 'sp');
  assert.ok(sp.fracao < FRACAO_MINIMA);
  assert.equal(sp.pronto, false);
  assert.equal(sp.impacto, null);
});

test('calcular: totais e regiões somam só as UFs prontas', () => {
  assert.equal(modelo.total.prontas, 1);
  assert.equal(modelo.total.total, 2);
  perto(modelo.total.cobertura, 25);
  perto(modelo.total.impacto, modelo.ufs.find((u) => u.uf === 'ba').impacto);
  const ne = modelo.regioes.find((r) => r.nome === 'Nordeste');
  const se = modelo.regioes.find((r) => r.nome === 'Sudeste');
  assert.equal(ne.prontas, 1);
  assert.equal(se.impacto, null);
  perto(se.peso, 75);
});

test('calcular: sem nenhum voto do período atual nada fica pronto e o impacto total é nulo', () => {
  const vazio = calcular(base, () => undefined);
  assert.equal(vazio.total.prontas, 0);
  assert.equal(vazio.total.impacto, null);
  perto(vazio.ufs.reduce((s, u) => s + u.peso, 0), 100); // o peso da base continua disponível
});

test('corDoMapa: cor do PT quando o saldo vai para o PT, do campo de Bolsonaro no outro caso; cheia a 8 p.p.', () => {
  assert.equal(corDoMapa({ pronto: false }), null);
  assert.deepEqual(corDoMapa({ pronto: true, saldo: 4 }), { candidato: 'pt', forca: 50 });
  assert.deepEqual(corDoMapa({ pronto: true, saldo: -2 }), { candidato: 'pl', forca: 25 });
  assert.equal(corDoMapa({ pronto: true, saldo: 20 }).forca, 100);
});

test('períodos: três, com a eleição base e os nomes certos de cada candidatura', () => {
  assert.deepEqual(Object.keys(PERIODOS), ['2026x2022', '2026x2018', '2022x2018']);
  assert.equal(PERIODOS['2026x2018'].pt.nomeBase, 'Haddad');
  assert.equal(PERIODOS['2022x2018'].vivo, false);
  assert.equal(PERIODOS['2026x2022'].vivo, true);
});

test('seletorPeriodoHtml: um link por período, o escolhido marcado', () => {
  const html = seletorPeriodoHtml('2022x2018', ajuda.hrefPeriodo);
  assert.match(html, /href="#\/1\/br\/comparativo\/2026x2022"/);
  assert.match(html, /href="#\/1\/br\/comparativo\/2022x2018" aria-current="page">2022 × 2018</);
  assert.equal(html.match(/aria-current="page"/g).length, 1);
});

test('comparativoHtml (Brasil): aviso sem apuração; com apuração, impacto, regiões, UFs e seletor de período', () => {
  const ui = { uf: 'br', regiao: null };
  const vazio = comparativoHtml(calcular(base, () => undefined), ui, ajuda);
  assert.match(vazio, /Aguardando apuração suficiente/);
  assert.match(vazio, /0 de 2/);

  const html = comparativoHtml(modelo, ui, ajuda);
  assert.match(html, /Presidente · 2026 × 2022/);
  assert.match(html, /Impacto no saldo nacional/);
  assert.match(html, /1 de 2 UFs com apuração suficiente/);
  assert.match(html, /data-comp-regiao="Nordeste"/);
  assert.match(html, /href="#\/1\/ba\/comparativo"/);
  assert.match(html, /30% apurado/); // SP ainda abaixo do mínimo
  assert.match(html, /Lula contra Lula 2022 · Flávio Bolsonaro contra Bolsonaro 2022/);
  assert.match(html, /href="#\/1\/br\/comparativo\/2022x2018"/); // seletor de período
  assert.match(html, /não é transferência de votos/i);
});

test('comparativoHtml (região aberta): lista só as UFs da região e oferece voltar ao Brasil', () => {
  const html = comparativoHtml(modelo, { uf: 'br', regiao: 'Nordeste' }, ajuda);
  assert.match(html, /UFs do Nordeste/);
  assert.match(html, /href="#\/1\/ba\/comparativo"/);
  assert.doesNotMatch(html, /href="#\/1\/sp\/comparativo"/);
  assert.match(html, /data-comp-limpar/);
  assert.match(html, /data-comp-regiao="Nordeste"[^>]*aria-pressed="true"/);
});

test('comparativoHtml (UF): cartões das duas candidaturas, variação e impacto; UF abaixo do mínimo avisa', () => {
  const ba = comparativoHtml(modelo, { uf: 'ba', regiao: null }, ajuda);
  assert.match(ba, /BA · 1º turno/);
  assert.match(ba, /2022 · Lula/);
  assert.match(ba, /2022 · Bolsonaro/);
  assert.match(ba, /Impacto no Brasil/);
  const sp = comparativoHtml(modelo, { uf: 'sp', regiao: null }, ajuda);
  assert.match(sp, /Apuração em 30%: abaixo de 50%/);
  assert.doesNotMatch(sp, /Impacto no Brasil/);
});

test('2022 × 2018: o "atual" vem do arquivo de 2022 (apuração completa) e todas as UFs entram', () => {
  const periodo = PERIODOS['2022x2018'];
  const encerrada = {
    vivo: false,
    ufs: { ba: { validos: 1000, herdados: { 13: 300, 22: 400 } }, sp: { validos: 3000, herdados: { 13: 500, 22: 1800 } } }, // 2018: Haddad, Bolsonaro
    atual: { ufs: { ba: { validos: 1000, votos: { 13: 700, 22: 200, 12: 50 } }, sp: { validos: 3000, votos: { 13: 1300, 22: 1500, 12: 100 } } } }, // 2022
  };
  const m = calcular(encerrada, itemDoAtual(encerrada, null), { periodo });
  assert.equal(m.total.prontas, 2);
  const ba = m.ufs.find((u) => u.uf === 'ba');
  perto(ba.pt.pBase, 30); perto(ba.pt.pAtual, 70); perto(ba.pt.d, 40);
  perto(ba.pl.d, 20 - 40);
  perto(ba.saldo, 60);
  assert.equal(ba.fracao, 100);

  const html = comparativoHtml(m, { uf: 'br', regiao: null }, ajuda);
  assert.match(html, /Presidente · 2022 × 2018/);
  assert.match(html, /Lula contra Haddad 2018 · Bolsonaro contra Bolsonaro 2018/);
  assert.match(html, /2022 já terminou, então todas as UFs entram/);
  assert.doesNotMatch(html, /Aguardando apuração/);
  const uf = comparativoHtml(m, { uf: 'ba', regiao: null }, ajuda);
  assert.match(uf, /2018 · Haddad/);
  assert.doesNotMatch(uf, /Seções totalizadas em/); // não há apuração em andamento
});

test('itemDoAtual: ao vivo usa a apuração; encerrado usa o arquivo, sempre a 100%', () => {
  const aoVivo = () => 'item-ao-vivo';
  assert.equal(itemDoAtual({ vivo: true }, aoVivo)('ba'), 'item-ao-vivo');
  const f = itemDoAtual({ vivo: false, atual: { ufs: { ba: { validos: 10, votos: { 13: 4 } } } } }, aoVivo);
  assert.deepEqual(f('ba'), { secoes: { pctTotalizadas: 100 }, validos: 10, votosPorNumero: { 13: 4 } });
  assert.equal(f('sp'), undefined);
});

// ---- base por UF e rota do servidor

const hist = (ano, municipios) => ({ ano, turno: 1, fonte: `teste ${ano}`, candidatos: { 13: { nomeUrna: 'A', partido: 'PT' } }, municipios });
const h2022 = hist(2022, { 1: { uf: 'ba', votos: { 13: 60, 22: 30 } }, 2: { uf: 'ba', votos: { 13: 40, 22: 10, 12: 5 } }, 3: { uf: 'sp', votos: { 13: 7, 22: 3 } } });
const h2018 = hist(2018, { 1: { uf: 'ba', votos: { 13: 20, 17: 50 } }, 3: { uf: 'sp', votos: { 13: 5, 17: 9 } } });
const mapa2022 = { 13: [{ de: '13', peso: 1 }], 22: [{ de: '22', peso: 0.5 }] };
const mapa2018 = { 13: [{ de: '13', peso: 1 }], 22: [{ de: '17', peso: 1 }] };

test('anterior.porUf traduz pelo mapeamento e brutoPorUf devolve os votos sem tradução', () => {
  const a22 = criarAnterior(h2022, mapa2022);
  assert.deepEqual(a22.porUf(), { ba: { validos: 145, herdados: { 13: 100, 22: 20 } }, sp: { validos: 10, herdados: { 13: 7, 22: 1.5 } } });
  assert.deepEqual(a22.brutoPorUf().ba, { validos: 145, votos: { 13: 100, 22: 40, 12: 5 } });
  const a18 = criarAnterior(h2018, mapa2018);
  assert.deepEqual(a18.porUf().ba, { validos: 70, herdados: { 13: 20, 22: 50 } }); // o 22 de agora herda o 17 de 2018
});

test('/api/comparativo/presidente?periodo=...: base e, nos períodos encerrados, o "atual"; erros claros', async () => {
  const apuracao = new Apuracao({ alvos: [], fonte: { async obter() { return { status: 'indisponivel' }; } } });
  const montar = (extra) => criarServidor({ apuracao, meta: { ano: 2026, turno: 1, demo: false, intervalo: 60, cargos: [1] }, diretorioPublico: '.', ...extra });
  const completo = montar({ anterior: criarAnterior(h2022, mapa2022), historicos: { 2018: criarAnterior(h2018, mapa2018) } });
  const so2022 = montar({ anterior: criarAnterior(h2022, mapa2022) });
  const abrir = async (servidor) => { await new Promise((r) => servidor.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${servidor.address().port}`; };
  const fechar = async (servidor) => { servidor.closeAllConnections(); await new Promise((r) => servidor.close(r)); };
  const [urlCompleto, urlSo2022] = [await abrir(completo), await abrir(so2022)];
  try {
    const padrao = await (await fetch(`${urlCompleto}/api/comparativo/presidente`)).json();
    assert.equal(padrao.periodo, '2026x2022');
    assert.equal(padrao.vivo, true);
    assert.equal(padrao.atual, null);
    assert.deepEqual(padrao.ufs.ba, { validos: 145, herdados: { 13: 100, 22: 20 } });

    const encerrado = await (await fetch(`${urlCompleto}/api/comparativo/presidente?periodo=2022x2018`)).json();
    assert.equal(encerrado.disponivel, true);
    assert.equal(encerrado.vivo, false);
    assert.equal(encerrado.anoBase, 2018);
    assert.deepEqual(encerrado.ufs.ba, { validos: 70, herdados: { 13: 20, 22: 50 } });
    assert.deepEqual(encerrado.atual.ufs.ba, { validos: 145, votos: { 13: 100, 22: 40, 12: 5 } });

    const aoVivo2018 = await (await fetch(`${urlCompleto}/api/comparativo/presidente?periodo=2026x2018`)).json();
    assert.equal(aoVivo2018.vivo, true);
    assert.equal(aoVivo2018.anoBase, 2018);

    const desconhecido = await fetch(`${urlCompleto}/api/comparativo/presidente?periodo=1998x1994`);
    assert.equal(desconhecido.status, 400);

    const sem2018 = await (await fetch(`${urlSo2022}/api/comparativo/presidente?periodo=2022x2018`)).json();
    assert.equal(sem2018.disponivel, false);
    assert.match(sem2018.motivo, /Dados de 2018 não carregados.*gerar-historico-2018/);
  } finally {
    apuracao.parar();
    await fechar(completo);
    await fechar(so2022);
  }
});

// ---- os arquivos reais do projeto (2018 e 2022)

const dir = new URL('../dados-historicos/', import.meta.url);
const existe = ['presidente-2018-t1.json', 'presidente-2022-t1.json', 'mapeamento-presidente.json', 'mapeamento-presidente-2018.json'].every((f) => existsSync(new URL(f, dir)));
const lerJson = (f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));

test('base real de 2018: bate com a apuração oficial do 1º turno e dá um comparativo 2022 × 2018 coerente', { skip: !existe && 'arquivos históricos ausentes' }, () => {
  const a18 = criarAnterior(lerJson('presidente-2018-t1.json'), lerJson('mapeamento-presidente-2018.json'));
  const a22 = criarAnterior(lerJson('presidente-2022-t1.json'), lerJson('mapeamento-presidente.json'));
  assert.deepEqual(a18.avisos, []);

  // Totais oficiais de 2018 (1º turno), com o exterior.
  const bruto18 = a18.brutoPorUf();
  const total = (n) => Object.values(bruto18).reduce((s, u) => s + (u.votos[n] ?? 0), 0);
  assert.equal(total('17'), 49_277_010); // Bolsonaro
  assert.equal(total('13'), 31_342_051); // Haddad
  assert.equal(total('12'), 13_344_371); // Ciro
  assert.equal(Object.values(bruto18).reduce((s, u) => s + u.validos, 0), 107_050_749);
  assert.equal(Object.keys(bruto18).length, 28); // 27 UFs + exterior

  const b = { vivo: false, ufs: a18.porUf(), atual: { ufs: a22.brutoPorUf() } };
  const m = calcular(b, itemDoAtual(b, null), { periodo: PERIODOS['2022x2018'] });
  assert.equal(m.ufs.length, 27);
  assert.equal(m.total.prontas, 27); // eleição encerrada: nenhuma UF fica de fora
  perto(m.ufs.reduce((s, u) => s + u.peso, 0), 100, 1e-6);

  // A soma dos impactos por UF fica perto do saldo nacional calculado direto; a diferença é só a mudança de peso entre as UFs.
  const nacional = (campo, ano) => m.ufs.reduce((s, u) => s + u[campo][ano], 0);
  const v22 = m.ufs.reduce((s, u) => s + u.validosAtual, 0);
  const v18 = m.ufs.reduce((s, u) => s + u.validosBase, 0);
  const direto = (100 * nacional('pt', 'vAtual') / v22 - 100 * nacional('pt', 'vBase') / v18) - (100 * nacional('pl', 'vAtual') / v22 - 100 * nacional('pl', 'vBase') / v18);
  assert.ok(Math.abs(direto - m.total.impacto) < 0.6, `${direto} vs ${m.total.impacto}`);
  // O peso, não a variação, manda: o Acre varia muito e quase não pesa.
  const ac = m.ufs.find((u) => u.uf === 'ac');
  const sp = m.ufs.find((u) => u.uf === 'sp');
  assert.ok(ac.peso < 0.5 && Math.abs(ac.impacto) < 0.1);
  assert.ok(Math.abs(sp.impacto) > 10 * Math.abs(ac.impacto));
});
