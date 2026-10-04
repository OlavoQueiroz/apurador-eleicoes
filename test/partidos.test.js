import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarPartidos, criarTradutor, carregarPartidos } from '../src/partidos.js';
import { contar, eleitosDoAno, lerCsv } from '../scripts/gerar-eleitos.js';
import {
  CARGOS_PARTIDOS, PRESIDENTE, agrupar, hashPartidos, seletorCargosHtml, aoVivo, bancadaDoAno, blocoDaBancada, blocosDe, criarModelo, dicaGrupoHtml, estadosHtml, partidosHtml, placarHtml, serieHtml,
} from '../public/partidos.js';
import { resumir } from '../src/normalize.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..');
const ajuda = {
  esc: (t) => String(t), fmtInt: (n) => String(n), corPartido: () => '#000', nomeUf: (u) => u.toUpperCase(),
  mapa: { largura: 100, altura: 100, ufs: { sp: { d: 'M0 0L1 1Z' }, ba: { d: 'M0 0L2 2Z' } } }, rotulos: '',
};
const cargo = (codigo) => CARGOS_PARTIDOS.find((c) => c.codigo === codigo);

test('lerCsv: aspas, ponto e vírgula dentro do campo e fim de linha do Windows', () => {
  const linhas = lerCsv('A;B;C\r\n1;"x;y";"a ""b"""\r\n2;;z\r\n');
  assert.deepEqual(linhas, [{ A: '1', B: 'x;y', C: 'a "b"' }, { A: '2', B: '', C: 'z' }]);
});

test('eleitosDoAno: só eleitos, uma vez por candidato, suplementar só no Senado', () => {
  const l = (o) => ({ NM_TIPO_ELEICAO: 'ELEIÇÃO ORDINÁRIA', SG_UF: 'SP', DS_SIT_TOT_TURNO: 'ELEITO', ...o });
  const e = eleitosDoAno([
    l({ DS_CARGO: 'GOVERNADOR', SQ_CANDIDATO: '1', SG_PARTIDO: 'PSDB' }),
    l({ DS_CARGO: 'GOVERNADOR', SQ_CANDIDATO: '2', SG_PARTIDO: 'PT', DS_SIT_TOT_TURNO: 'NÃO ELEITO' }),
    l({ DS_CARGO: 'GOVERNADOR', SQ_CANDIDATO: '3', SG_PARTIDO: 'MDB', NM_TIPO_ELEICAO: 'ELEIÇÃO SUPLEMENTAR', SG_UF: 'AM' }),
    l({ DS_CARGO: 'SENADOR', SQ_CANDIDATO: '4', SG_PARTIDO: 'PSD', NM_TIPO_ELEICAO: 'ELEIÇÃO SUPLEMENTAR', SG_UF: 'MT' }),
    l({ DS_CARGO: 'DEPUTADO FEDERAL', SQ_CANDIDATO: '5', SG_PARTIDO: 'PL', DS_SIT_TOT_TURNO: 'ELEITO POR QP' }),
    l({ DS_CARGO: 'DEPUTADO FEDERAL', SQ_CANDIDATO: '5', SG_PARTIDO: 'PL', DS_SIT_TOT_TURNO: 'ELEITO POR QP' }),
    l({ DS_CARGO: 'DEPUTADO ESTADUAL', SQ_CANDIDATO: '6', SG_PARTIDO: 'PL' }),
    l({ DS_CARGO: 'DEPUTADO DISTRITAL', SQ_CANDIDATO: '7', SG_PARTIDO: 'PL' }),
  ]);
  assert.deepEqual(e.governador, { sp: 'PSDB' });
  assert.deepEqual(e.senador, { mt: ['PSD'] });
  assert.deepEqual(e.deputadoFederal, { sp: { PL: 1 } });
  assert.deepEqual(e.deputadoEstadual, { sp: { PL: 1 } }); // o distrital fica de fora
  assert.deepEqual(contar(e), { governador: 1, senador: 1, deputadoFederal: 1, deputadoEstadual: 1 });
});

test('o arquivo gerado tem as contagens oficiais (27 governadores, 513 federais, 1.035 estaduais, 81 senadores por eleição)', () => {
  const eleitos = JSON.parse(readFileSync(path.join(raiz, 'dados-historicos/eleitos.json'), 'utf8'));
  const esperado = { 2014: [27, 27], 2018: [27, 54], 2022: [27, 27] };
  for (const [ano, [gov, sen]] of Object.entries(esperado)) {
    assert.deepEqual(contar(eleitos.anos[ano]), { governador: gov, senador: sen, deputadoFederal: 513, deputadoEstadual: 1035 }, ano);
    assert.equal(Object.values(eleitos.anos[ano].deputadoEstadual.sp).reduce((a, n) => a + n, 0), 94, `SP ${ano}`);
    assert.equal(Object.values(eleitos.anos[ano].deputadoEstadual.rj).reduce((a, n) => a + n, 0), 70, `RJ ${ano}`);
  }
});

test('sucessão: renomeações e fusões viram o partido de hoje; PSL fica de fora de propósito', () => {
  const traduzir = criarTradutor({ _x: 'comentário', PMDB: 'MDB', 'PC do B': 'PCDOB' });
  assert.equal(traduzir('PMDB'), 'MDB');
  assert.equal(traduzir('PCdoB'), 'PCDOB');
  assert.equal(traduzir('PT'), 'PT');
  const p = carregarPartidos(path.join(raiz, 'dados-historicos/eleitos.json'), path.join(raiz, 'dados-historicos/partidos-sucessao.json'));
  const bancada22 = Object.values(p.anos[2022].deputadoFederal).flatMap((u) => Object.keys(u));
  assert.ok(!bancada22.includes('PC do B') && !bancada22.includes('PRB'));
  const total = (ano) => Object.values(p.anos[ano].deputadoFederal).reduce((s, u) => s + Object.values(u).reduce((a, n) => a + n, 0), 0);
  assert.equal(total(2014), 513);
  assert.ok(Object.values(p.anos[2018].deputadoFederal).some((u) => 'PSL' in u), 'PSL segue separado em 2018');
});

test('criarPartidos soma partidos que viram um só dentro da UF', () => {
  const p = criarPartidos({ fonte: 'x', anos: { 2014: { governador: {}, senador: {}, deputadoFederal: { sp: { PTB: 2, PATRIOTA: 1, PT: 4 } } } } }, { PTB: 'PRD', PATRIOTA: 'PRD' });
  assert.deepEqual(p.anos[2014].deputadoFederal.sp, { PRD: 3, PT: 4 });
});

const historico = {
  anos: {
    2014: { governador: { sp: 'PSDB', ba: 'PT' }, senador: { sp: ['PSDB'], ba: ['PT'] }, deputadoFederal: { sp: { PSDB: 5, PT: 3 }, ba: { PT: 4, PP: 2 } } },
    2018: { governador: { sp: 'PSDB', ba: 'PT' }, senador: { sp: ['PL', 'PSD'], ba: ['PSD', 'PT'] }, deputadoFederal: { sp: { PL: 5, PT: 3 }, ba: { PT: 4, PP: 2 } } },
    2022: { governador: { sp: 'REPUBLICANOS', ba: 'PT' }, senador: { sp: ['PL'], ba: ['PT'] }, deputadoFederal: { sp: { PL: 6, PT: 2 }, ba: { PT: 5, PP: 1 } } },
  },
};

test('blocosDe e blocoDaBancada: bloco com mais cadeiras, ou "disputado" se a diferença for pequena', () => {
  assert.deepEqual(blocosDe({ PT: 3, PL: 5, MDB: 2, XYZ: 1 }), { esquerda: 3, centrao: 2, direita: 5, independente: 1 });
  assert.equal(blocoDaBancada({ PT: 8, PL: 1 }), 'esquerda');
  assert.equal(blocoDaBancada({ PT: 8, PL: 8 }), 'disputado');
  assert.equal(blocoDaBancada({ PT: 30, PL: 28 }), 'disputado');
  assert.equal(blocoDaBancada({ PT: 3 }), 'esquerda');
  assert.equal(blocoDaBancada({}), null);
});

test('bancadaDoAno: o Senado soma os eleitos do ano e os de quatro anos antes', () => {
  assert.deepEqual(bancadaDoAno(historico, 2022, 'senador'), { PL: 2, PSD: 2, PT: 2 });
  assert.equal(bancadaDoAno(historico, 2014, 'senador'), null);
  assert.deepEqual(bancadaDoAno(historico, 2022, 'deputadoFederal'), { PL: 6, PT: 7, PP: 1 });
});

test('aoVivo: Câmara usa as vagas por partido; majoritário usa quem lidera onde não há eleito; Senado soma as ocupadas', () => {
  const camara = aoVivo(cargo(6), [{ uf: 'sp', vagas: 3, eleitosPorPartido: { PL: 1 }, cadeirasPorPartido: { PL: 2, PT: 1 } }]);
  assert.deepEqual(camara.confirmados, { PL: 1 });
  assert.deepEqual(camara.naFrente, { PL: 1, PT: 1 });
  assert.equal(camara.pendentes, 0);

  const colocados = [{ partido: 'PT', votos: 9, situacao: 'eleito' }, { partido: 'PL', votos: 8, situacao: 'nenhuma' }, { partido: 'PSD', votos: 7, situacao: 'nenhuma' }];
  const senado = aoVivo(cargo(5), [{ uf: 'sp', vagas: 2, eleitosPorPartido: { PT: 1 }, colocados }, { uf: 'ba', vagas: 2, eleitosPorPartido: {}, colocados: [] }], [{ partido: 'MDB' }]);
  assert.deepEqual(senado.naFrente, { PL: 1 });
  assert.equal(senado.total, 5);
  assert.equal(senado.definidas, 3);
  assert.equal(senado.pendentes, 2);

  const gov = aoVivo(cargo(3), [{ uf: 'sp', vagas: 1, eleitosPorPartido: {}, colocados: [{ partido: 'PT', votos: 5, situacao: 'segundo-turno' }] }]);
  assert.deepEqual(gov.naFrente, { PT: 1 });
});

test('criarModelo: base é a eleição anterior; só governador tem mapa de estados e o parcial é marcado', () => {
  const itens = [
    { uf: 'sp', vagas: 8, eleitosPorPartido: { PT: 5 }, cadeirasPorPartido: { PT: 7, PL: 1 } },
    { uf: 'ba', vagas: 6, eleitosPorPartido: { PT: 6 }, cadeirasPorPartido: { PT: 6 } },
  ];
  const camara = criarModelo({ cargo: cargo(6), historico, itens, ufs: ['sp', 'ba'] });
  assert.equal(camara.base.ano, 2022);
  assert.equal(camara.atual.porPartido.PT, 13);
  assert.equal(camara.estados, null); // a Câmara só tem a visão nacional
  assert.ok(!partidosHtml(camara, { aba: 'estados' }, ajuda).includes('Viradas por estado')); // não há mais essa análise

  const gov = criarModelo({
    cargo: cargo(3),
    historico,
    itens: [
      { uf: 'sp', vagas: 1, eleitosPorPartido: { PT: 1 }, colocados: [] },
      { uf: 'ba', vagas: 1, eleitosPorPartido: {}, colocados: [{ partido: 'PT', votos: 5, situacao: 'nenhuma' }] },
    ],
    ufs: ['sp', 'ba'],
  });
  const sp = gov.estados.find((e) => e.uf === 'sp');
  const ba = gov.estados.find((e) => e.uf === 'ba');
  assert.equal(sp.blocos[2022], 'centrao'); // REPUBLICANOS
  assert.equal(sp.blocos[2026], 'esquerda');
  assert.equal(sp.provisorio, false);
  assert.equal(ba.provisorio, true); // na frente, ainda sem eleito marcado
});

test('telas: todas as abas renderizam, com e sem histórico', () => {
  const itens = [{ uf: 'sp', vagas: 3, eleitosPorPartido: { PL: 1 }, cadeirasPorPartido: { PL: 2, PT: 1 } }];
  for (const c of CARGOS_PARTIDOS) {
    const m = criarModelo({ cargo: c, historico, itens: c.codigo === 6 ? itens : [], ocupadas: c.codigo === 5 ? [{ partido: 'PT' }] : [], ufs: ['sp', 'ba'] });
    for (const agrupar of ['ideologia', 'partido']) {
      for (const aba of ['placar', 'serie']) {
        const html = partidosHtml(m, { aba, agrupar }, ajuda);
        assert.match(html, /aria-label="Análise"/);
        assert.ok(!html.includes('undefined') && !html.includes('NaN'), `${c.nome}/${aba}/${agrupar}`);
      }
    }
    const sem = criarModelo({ cargo: c, historico: null, itens: [], ufs: [] });
    assert.match(partidosHtml(sem, { aba: 'serie' }, ajuda), /gerar-eleitos/);
    assert.match(placarHtml(sem, ajuda), /par-cards/);
  }
  assert.match(serieHtml(criarModelo({ cargo: cargo(6), historico, itens, ufs: [] }), ajuda), /polyline/);
});

test('mapa: UF que mudou de bloco usa gradiente meio a meio; a que não mudou, cor única', () => {
  const itens = [
    { uf: 'sp', vagas: 1, eleitosPorPartido: { PT: 1 }, colocados: [] },
    { uf: 'ba', vagas: 1, eleitosPorPartido: { PT: 1 }, colocados: [] },
  ];
  const m = criarModelo({ cargo: cargo(3), historico, itens, ufs: ['sp', 'ba'] });
  const html = estadosHtml(m, ajuda);
  assert.equal(partidosHtml(m, { aba: 'placar' }, ajuda).includes('url(#par-sp)'), true); // governadores: o placar é o mapa
  assert.ok(!partidosHtml(m, { aba: 'placar' }, ajuda).includes('par-hemi'));
  assert.match(html, /url\(#par-sp\)/); // SP: Republicanos (centrão) em 2022 → PT
  assert.ok(!html.includes('url(#par-ba)')); // BA: PT → PT
  assert.match(html, /Viradas \(1\)/);
});

test('resumir (Câmara): cadeirasPorPartido inclui as vagas já dadas ao partido antes de marcar os eleitos', () => {
  const cand = (partido, votos, situacao, agrupamentoId) => ({ numero: '1', nomeUrna: partido + votos, partido, votos, pct: 0, situacao, agrupamentoId });
  const dados = {
    geradoEm: null,
    cargo: { codigo: 6, vagas: 5 },
    secoes: {}, votos: { validos: 0 }, eleitorado: {}, totalizacaoFinal: false, matematicamenteDefinido: false,
    candidatos: [cand('PL', 90, 'eleito', 1), cand('PL', 80, 'nenhuma', 1), cand('PL', 70, 'nenhuma', 1), cand('PT', 60, 'nenhuma', 2), cand('PT', 50, 'nenhuma', 2)],
    agrupamentos: [{ id: 1, vagas: 2 }, { id: 2, vagas: 1 }],
  };
  const r = resumir(dados);
  assert.deepEqual(r.eleitosPorPartido, { PL: 1 });
  assert.deepEqual(r.cadeirasPorPartido, { PL: 2, PT: 1 });
  assert.equal(resumir({ ...dados, cargo: { codigo: 5, vagas: 2 } }).cadeirasPorPartido, undefined);
});

test('agrupar: por partido junta grafias iguais; por ideologia soma os blocos', () => {
  assert.deepEqual(agrupar({ 'PC DO B': 2, PCDOB: 1, PT: 3 }, 'partido'), { PCDOB: 3, PT: 3 });
  assert.deepEqual(agrupar({ PT: 3, PL: 2 }), { esquerda: 3, centrao: 0, direita: 2, independente: 0 });
});

test('por partido: o mapa lidera pelo partido, não pelo bloco, e os endereços guardam o agrupamento', () => {
  assert.equal(blocoDaBancada({ PT: 5, PSB: 4, PL: 3 }), 'esquerda');
  assert.equal(blocoDaBancada({ PT: 5, PSB: 4, PL: 3 }, 'partido'), 'PT');
  assert.equal(blocoDaBancada({ PT: 5, PSB: 5, PL: 3 }, 'partido'), 'disputado');
  assert.equal(blocoDaBancada({ PT: 8, PSB: 2, PL: 2 }, 'partido'), 'PT');
  const m = criarModelo({ cargo: cargo(3), historico, itens: [{ uf: 'sp', vagas: 1, eleitosPorPartido: { PT: 1 }, colocados: [] }], ufs: ['sp'] });
  const html = partidosHtml(m, { aba: 'placar', agrupar: 'partido' }, { ...ajuda, corPartido: (s) => (s === 'PT' ? '#d00' : '#00d') });
  assert.match(html, /#\/partidos\/3\/placar\/partido/);
  assert.match(html, /Bastiões \(mesmo partido/);
  assert.match(partidosHtml(m, { aba: 'placar' }, ajuda), /#\/partidos\/3\/serie"/);
});

test('Presidente na aba Análises: o endereço é o do comparativo e o seletor de cargo o inclui', () => {
  assert.equal(hashPartidos(1, 'placar', 'partido'), '#/partidos/1/comparativo');
  assert.equal(hashPartidos(6, 'serie', 'partido'), '#/partidos/6/serie/partido');
  assert.equal(hashPartidos(6, 'placar', 'ideologia', '2022'), '#/partidos/6/placar/2022');
  assert.equal(hashPartidos(6, 'placar', 'partido', 'delta'), '#/partidos/6/placar/partido/delta');
  assert.equal(hashPartidos(6, 'placar', 'ideologia', '2026'), '#/partidos/6/placar');
  const html = seletorCargosHtml({ cargos: [PRESIDENTE, ...CARGOS_PARTIDOS], atual: 1, aba: 'placar', modo: 'ideologia', esc: (t) => t });
  assert.match(html, /href="#\/partidos\/1\/comparativo" aria-current="page">Presidente/);
  assert.match(html, /href="#\/partidos\/6\/placar"/);
});

test('placar: dois hemiciclos (eleição anterior e 2026) e três leituras dos cartões', () => {
  const itens = [{ uf: 'sp', vagas: 8, eleitosPorPartido: { PT: 5 }, cadeirasPorPartido: { PT: 5, PL: 1 } }];
  const m = criarModelo({ cargo: cargo(6), historico, itens, ufs: [] });
  const html = placarHtml(m, ajuda);
  assert.equal(html.match(/class="par-hemi"/g).length, 2);
  assert.match(html, /Eleição de 2022/);
  assert.match(html, /2026 · em apuração/);
  for (const id of ['2022', 'delta']) assert.match(html, new RegExp(`/partidos/6/placar/${id}"`));

  const valor = (cartoes, nome) => {
    const h = placarHtml(m, { ...ajuda, cartoes });
    return new RegExp(`${nome}</span><b class="[^"]*">([^<]+)</b>`).exec(h)?.[1];
  };
  assert.equal(valor('2022', 'Esquerda'), '7'); // PT 7 em 2022 (SP 2 + BA 5)
  assert.equal(valor('2026', 'Esquerda'), '5');
  assert.equal(valor('delta', 'Esquerda'), '-2');

  const sem = criarModelo({ cargo: cargo(6), historico: null, itens: [], ufs: [] });
  assert.equal(placarHtml(sem, ajuda).match(/class="par-hemi"/g).length, 1); // sem histórico, só o de 2026
});

test('hover: dica com as cadeiras do grupo nas duas eleições e a variação; cadeiras ainda sem definição', () => {
  const itens = [{ uf: 'sp', vagas: 8, eleitosPorPartido: { PT: 5 }, cadeirasPorPartido: { PT: 5, PL: 1 } }];
  const m = criarModelo({ cargo: cargo(6), historico, itens, ufs: [] });
  const aj = { ...ajuda, esc: (t) => String(t).replace(/"/g, '&quot;') }; // como o esc do app, que protege aspas em atributos
  const lerTotais = (h) => JSON.parse(/data-totais="([^"]*)"/.exec(h)[1].replace(/&quot;/g, '"'));
  const html = placarHtml(m, aj);
  assert.match(html, /data-g="esquerda"/);
  assert.match(html, /data-g="_vaga"/);
  assert.match(html, /class="par-caixa" data-totais=/);
  const totais = lerTotais(html);
  const dica = dicaGrupoHtml(totais, 'esquerda', ajuda);
  assert.match(dica, /<strong>Esquerda<\/strong>/);
  assert.match(dica, /2022: <b>7<\/b> cadeiras \(\d+%\)/);
  assert.match(dica, /2026: <b>5<\/b> cadeiras/);
  assert.match(dica, /Variação: -2/);
  assert.match(dicaGrupoHtml(totais, '_vaga', ajuda), /cadeiras sem definição/);
  assert.equal(dicaGrupoHtml(totais, 'inexistente', ajuda), '');
  // por partido o id é o partido
  const porPartido = lerTotais(placarHtml(m, { ...aj, modo: 'partido' }));
  assert.match(dicaGrupoHtml(porPartido, 'PT', ajuda), /<strong>PT<\/strong>/);
});

test('Deputado estadual (SP ou RJ): bancada da Assembleia, UF no endereço e no seletor', () => {
  const dep = CARGOS_PARTIDOS.find((c) => c.codigo === 7);
  assert.deepEqual(dep.ufs, { sp: 94, rj: 70 });
  const hist = { anos: { 2022: { governador: {}, senador: {}, deputadoFederal: {}, deputadoEstadual: { sp: { PL: 20, PT: 10 }, rj: { PL: 7, PT: 3 } } } } };
  assert.deepEqual(bancadaDoAno(hist, 2022, 'deputadoEstadual', 'rj'), { PL: 7, PT: 3 });
  assert.deepEqual(bancadaDoAno(hist, 2022, 'deputadoEstadual'), { PL: 27, PT: 13 });

  const itens = [{ uf: 'rj', vagas: 70, eleitosPorPartido: { PT: 2 }, cadeirasPorPartido: { PT: 3, PL: 1 } }];
  const m = criarModelo({ cargo: dep, historico: hist, itens, ufs: ['rj'], uf: 'rj' });
  assert.equal(m.rotulo, 'Dep. estadual · RJ');
  assert.equal(m.vivo.total, 70);
  assert.equal(m.base.porPartido.PL, 7);
  assert.deepEqual(m.vivo.naFrente, { PT: 1, PL: 1 });

  const html = partidosHtml(m, { aba: 'placar', cargos: [PRESIDENTE, ...CARGOS_PARTIDOS], ufs: ['sp', 'rj'] }, ajuda);
  assert.match(html, /aria-label="UF"/);
  assert.match(html, /href="#\/partidos\/7\/serie\/rj"/);
  assert.match(html, /href="#\/partidos\/7\/placar\/sp" >SP|href="#\/partidos\/7\/placar\/sp"[^>]*>SP</);
  assert.match(html, /Dep\. estadual · RJ: composição/);
  assert.equal(hashPartidos(7, 'placar', 'partido', 'delta', 'rj'), '#/partidos/7/placar/rj/partido/delta');
  assert.equal(hashPartidos(6, 'placar', 'ideologia', '2026', 'rj'), '#/partidos/6/placar'); // só o deputado estadual leva UF
  // sem UF escolhida, usa o total padrão de cada Assembleia só quando a UF é conhecida
  assert.equal(criarModelo({ cargo: dep, historico: hist, itens: [], ufs: ['sp'], uf: 'sp' }).vivo.total, 94);
});
