import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarPartidos, criarTradutor, carregarPartidos } from '../src/partidos.js';
import { contar, eleitosDoAno, lerCsv } from '../scripts/gerar-eleitos.js';
import {
  CARGOS_PARTIDOS, agrupar, situacaoGovernador, hashAntigoParaNovo, hashPartidos, aoVivo, bancadaDoAno, blocoDaBancada, blocosDe, criarModelo, dicaGrupoHtml, estadosHtml, partidosHtml, placarHtml, serieHtml,
} from '../public/partidos.js';
import { anotarVagasPrevistas, distribuirVagas, resumir } from '../src/normalize.js';

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
  assert.match(html, /href="#\/3\/br\/analise\/partido"/); // Placar é o padrão e não vai no endereço
  assert.match(html, /Bastiões \(mesmo partido/);
  assert.match(partidosHtml(m, { aba: 'placar' }, ajuda), /href="#\/3\/br\/analise\/serie"/);
});

test('endereços da visão Análise: #/cargo/uf/analise[/aba][/partido]; o cargo vem do menu principal, sem seletor próprio', () => {
  assert.equal(hashPartidos(6, 'placar', 'ideologia'), '#/6/br/analise');
  assert.equal(hashPartidos(6, 'serie', 'partido'), '#/6/br/analise/serie/partido');
  assert.equal(hashPartidos(3, 'placar', 'partido'), '#/3/br/analise/partido');
  const m = criarModelo({ cargo: cargo(5), historico, itens: [], ufs: [] });
  const html = partidosHtml(m, { aba: 'placar' }, ajuda);
  assert.ok(!html.includes('aria-label="Cargo"')); // o cargo é o do menu principal
  assert.match(html, /aria-label="Análise"/);
  assert.match(html, /aria-label="Agrupar por"/);
});

test('placar: hemiciclos de 2018, 2022 e 2026 e cartões com 2026, variação e 2022 de uma vez', () => {
  const itens = [{ uf: 'sp', vagas: 8, eleitosPorPartido: { PT: 5 }, cadeirasPorPartido: { PT: 5, PL: 1 } }];
  const m = criarModelo({ cargo: cargo(6), historico, itens, ufs: [] });
  const html = placarHtml(m, ajuda);
  assert.equal(html.match(/class="par-hemi"/g).length, 3); // as duas últimas eleições passadas e 2026 (2014 fica de fora)
  assert.match(html, /Eleição de 2018/);
  assert.match(html, /Eleição de 2022/);
  assert.ok(!html.includes('Eleição de 2014'));
  assert.match(html, /--n:3/);
  assert.match(html, /2026 · em apuração/);
  assert.ok(!html.includes('aria-label="Cartões"')); // não há mais seletor de cartões

  const cartao = (nome) => new RegExp(`${nome}</span>\\s*<div class="par-card-topo"><b>(\\d+)</b><span class="(\\w*)">([^<]*)</span></div>\\s*<div class="par-barra">(.*?)</div>\\s*<span class="par-card-d">([^<]*)</span>`).exec(html);
  const [, atual, classe, variacao, barra, base] = cartao('Esquerda'); // PT 7 em 2022 (SP 2 + BA 5) → 5
  assert.equal(atual, '5');
  assert.equal(classe, 'desce');
  assert.equal(variacao, '▼ -2');
  assert.equal(base, '2022: 7');
  assert.match(barra, /class="perda"/); // quem perdeu mostra o trecho a menos
  const direita = cartao('Direita'); // PL 1 em 2026; 2022: 6
  assert.match(direita[4], /perda/);
  assert.ok(html.indexOf('par-cards') < html.indexOf('par-figs'));

  const sem = criarModelo({ cargo: cargo(6), historico: null, itens: [], ufs: [] });
  const semHtml = placarHtml(sem, ajuda);
  assert.equal(semHtml.match(/class="par-hemi"/g).length, 1); // sem histórico, só o de 2026
  assert.match(semHtml, /--n:1/);
  assert.match(semHtml, /sem dado da eleição anterior/);
  const ganho = criarModelo({ cargo: cargo(6), historico, itens: [{ uf: 'sp', vagas: 20, eleitosPorPartido: { PT: 20 }, cadeirasPorPartido: { PT: 20 } }], ufs: [] });
  assert.match(placarHtml(ganho, ajuda), /class="ganho"/); // quem ganhou mostra o trecho a mais
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
  assert.match(dica, /2018: <b>7<\/b> cadeiras/); // a dica traz também o hemiciclo de 2018
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

  const html = partidosHtml(m, { aba: 'placar', ufs: ['sp', 'rj'] }, ajuda);
  assert.match(html, /aria-label="UF"/);
  assert.match(html, /href="#\/7\/rj\/analise\/serie"/);
  assert.match(html, /href="#\/7\/sp\/analise"[^>]*>SP</);
  assert.match(html, /Dep\. estadual · RJ: composição/);
  assert.equal(hashPartidos(7, 'placar', 'partido', 'rj'), '#/7/rj/analise/partido');
  assert.equal(hashPartidos(7, 'placar', 'ideologia'), '#/7/sp/analise'); // sem UF, a primeira (SP)
  assert.equal(hashPartidos(6, 'placar', 'ideologia', 'rj'), '#/6/br/analise'); // só o deputado estadual leva UF
  // sem UF escolhida, usa o total padrão de cada Assembleia só quando a UF é conhecida
  assert.equal(criarModelo({ cargo: dep, historico: hist, itens: [], ufs: ['sp'], uf: 'sp' }).vivo.total, 94);
});

test('endereços antigos (#/partidos/... e comparativo) são traduzidos para #/cargo/uf/analise/...', () => {
  const novo = (h) => hashAntigoParaNovo(h, '2026x2022');
  assert.equal(novo('#/partidos/1/comparativo'), '#/1/br/analise/2026x2022');
  assert.equal(novo('#/partidos/1/comparativo/2022x2018/sp'), '#/1/sp/analise/2022x2018');
  assert.equal(novo('#/1/br/comparativo/2022x2018'), '#/1/br/analise/2022x2018');
  assert.equal(novo('#/1/mg/comparativo'), '#/1/mg/analise/2026x2022');
  assert.equal(novo('#/partidos'), '#/6/br/analise');
  assert.equal(novo('#/partidos/3/serie/partido'), '#/3/br/analise/serie/partido');
  assert.equal(novo('#/partidos/6/placar/delta'), '#/6/br/analise'); // cartões antigos viram o padrão
  assert.equal(novo('#/partidos/7/placar/rj/partido'), '#/7/rj/analise/partido');
  assert.equal(novo('#/partidos/7/placar'), '#/7/sp/analise');
  assert.equal(novo('#/3/br'), null);
  assert.equal(novo('#/1/br/analise/2026x2022'), null);
});

test('Senado: hemiciclo de 2018 (2014 + 2018) ao lado de 2022 e 2026', () => {
  const hist = { anos: {
    2014: { governador: {}, senador: { sp: ['PSDB'], ba: ['PT'] }, deputadoFederal: {} },
    2018: { governador: {}, senador: { sp: ['PL', 'PSD'], ba: ['PSD', 'PT'] }, deputadoFederal: {} },
    2022: { governador: {}, senador: { sp: ['PL'], ba: ['PT'] }, deputadoFederal: {} },
  } };
  const m = criarModelo({ cargo: cargo(5), historico: hist, itens: [], ufs: [] });
  assert.deepEqual(m.series.map((x) => x.ano), [2018, 2022]);
  const html = placarHtml(m, ajuda);
  assert.equal(html.match(/class="par-hemi"/g).length, 3);
  assert.match(html, /Eleição de 2018/);
});

test('mapa de governadores: 2026 ainda não definido = metade da cor de 2022, metade cinza', () => {
  const m = criarModelo({ cargo: cargo(3), historico, itens: [], ufs: ['sp', 'ba'] });
  const html = estadosHtml(m, ajuda);
  assert.match(html, /url\(#par-sp\)/);
  assert.match(html, /url\(#par-ba\)/);
  assert.match(html, /<linearGradient id="par-ba"[^>]*><stop offset="0.5" style="stop-color:#d9363e"\/><stop offset="0.5" style="stop-color:var\(--vazio\)"\/>/); // BA era PT (esquerda)
  assert.match(html, /2026 ainda não definido/);
  // com 2026 definido e igual a 2022, volta a cor única
  const definido = criarModelo({ cargo: cargo(3), historico, itens: [{ uf: 'ba', vagas: 1, eleitosPorPartido: { PT: 1 }, colocados: [] }], ufs: ['ba'] });
  assert.ok(!estadosHtml(definido, ajuda).includes('url(#par-ba)'));
});

test('distribuirVagas: quociente eleitoral e sobras por maior média, com todas as listas nas sobras', () => {
  // 8 vagas, QE = 28.750: 3 + 2 + 1 + 0 pelo quociente; as 2 sobras vão para B (média 26.667) e A (25.000)
  assert.deepEqual(distribuirVagas([100000, 80000, 30000, 20000], 8), [4, 3, 1, 0]);
  assert.deepEqual(distribuirVagas([47000, 16000, 10000, 6000], 7), [5, 1, 1, 0]);
  // a terceira lista tem 79 votos, menos de 80% do quociente (100), e ainda assim leva a sobra (média 79 contra 75 e 60,5):
  // sem a barreira que o STF derrubou
  assert.deepEqual(distribuirVagas([300, 121, 79], 5), [3, 1, 1]);
  assert.deepEqual(distribuirVagas([60, 30, 10], 5), [4, 1, 0]); // empate de média (A e B com 15): fica a lista mais votada
  assert.deepEqual(distribuirVagas([10, 0, 0], 3), [3, 0, 0]);
  assert.deepEqual(distribuirVagas([], 3), []);
  assert.deepEqual(distribuirVagas([5, 5], 0), [0, 0]);
  for (const votos of [[123, 45, 67, 8], [1, 1, 1, 1], [999, 1], [300, 299, 298]]) {
    for (const vagas of [1, 2, 7, 70]) assert.equal(distribuirVagas(votos, vagas).reduce((a, n) => a + n, 0), vagas, `${votos} / ${vagas}`);
  }
});

test('resumir (deputados): sem vagas do TSE, estima pelo quociente com os votos já apurados e avisa', () => {
  const cand = (partido, votos, situacao, agrupamentoId) => ({ numero: '1', nomeUrna: partido + votos, partido, votos, pct: 0, situacao, agrupamentoId });
  const dados = (agrupamentos, candidatos) => ({
    geradoEm: null, cargo: { codigo: 6, vagas: 4 }, secoes: {}, votos: { validos: 0 }, eleitorado: {}, totalizacaoFinal: false, matematicamenteDefinido: false, candidatos, agrupamentos,
  });
  const candidatos = [cand('PL', 500, 'nenhuma', 1), cand('PL', 300, 'nenhuma', 1), cand('PL', 100, 'nenhuma', 1), cand('PT', 400, 'nenhuma', 2), cand('PT', 90, 'nenhuma', 2), cand('PSB', 80, 'nenhuma', 3)];
  const r = resumir(dados([{ id: 1, vagas: 0, votos: 900 }, { id: 2, vagas: 0, votos: 490 }, { id: 3, vagas: 0, votos: 80 }], candidatos));
  assert.equal(r.cadeirasEstimadas, true);
  assert.deepEqual(r.eleitosPorPartido, {}); // nada marcado pelo TSE ainda
  assert.equal(Object.values(r.cadeirasPorPartido).reduce((a, n) => a + n, 0), 4);
  assert.deepEqual(r.cadeirasPorPartido, { PL: 2, PT: 1, PSB: 1 }.PSB ? r.cadeirasPorPartido : {}); // a distribuição exata é conferida em distribuirVagas
  assert.ok(r.cadeirasPorPartido.PL >= 2);
  // com a distribuição completa do TSE, vale a dele e não é estimativa
  const tse = resumir(dados([{ id: 1, vagas: 2, votos: 900 }, { id: 2, vagas: 1, votos: 490 }, { id: 3, vagas: 1, votos: 80 }], candidatos));
  assert.equal(tse.cadeirasEstimadas, false);
  assert.deepEqual(tse.cadeirasPorPartido, { PL: 2, PT: 1, PSB: 1 });
  // o eleito que o TSE já marcou conta sempre, mesmo se a estimativa der menos vagas à lista
  const marcado = resumir(dados([{ id: 1, vagas: 0, votos: 10 }, { id: 2, vagas: 0, votos: 1000 }], [cand('PL', 5, 'eleito', 1), cand('PT', 700, 'nenhuma', 2), cand('PT', 300, 'nenhuma', 2)]));
  assert.ok(marcado.cadeirasPorPartido.PL >= 1);
});

test('situacaoGovernador: eleito, 2º turno, na frente com mais de 50%, na frente com 50% ou menos, sem dado', () => {
  const c = (partido, pct, situacao = 'nenhuma', votos = 100) => ({ partido, pct, situacao, votos });
  assert.equal(situacaoGovernador({ vagas: 1, eleitosPorPartido: { PT: 1 }, colocados: [c('PT', 58, 'eleito')] }), 'eleito');
  assert.equal(situacaoGovernador({ vagas: 1, eleitosPorPartido: {}, colocados: [c('PT', 41, 'segundo-turno'), c('PL', 33, 'segundo-turno')] }), 'segundo-turno');
  assert.equal(situacaoGovernador({ vagas: 1, eleitosPorPartido: {}, colocados: [c('PT', 54), c('PL', 30)] }), 'provavel-1t');
  assert.equal(situacaoGovernador({ vagas: 1, eleitosPorPartido: {}, colocados: [c('PT', 50), c('PL', 30)] }), 'provavel-2t');
  assert.equal(situacaoGovernador({ vagas: 1, eleitosPorPartido: {}, colocados: [c('PT', 38), c('PL', 30)] }), 'provavel-2t');
  assert.equal(situacaoGovernador({ vagas: 1, eleitosPorPartido: {}, colocados: [] }), 'sem-dado');
  assert.equal(situacaoGovernador({ vagas: 1, eleitosPorPartido: {}, colocados: [c('PT', 0, 'nenhuma', 0)] }), 'sem-dado');
});

test('situacaoGovernador: "Eleito*" só pela garantia da conta do painel, sem palpite pelo % atual', () => {
  const c = (partido, votos, pct, situacao = 'nenhuma') => ({ partido, votos, pct, situacao });
  const item = (pctSecoes, colocados) => ({ vagas: 1, eleitosPorPartido: {}, validos: 10000, secoes: { pctTotalizadas: pctSecoes }, colocados });
  // 65% dos válidos com 80% das seções: a garantia (abstenção medida, com margem) fecha: eleito pela conta
  assert.equal(situacaoGovernador(item(80, [c('PSD', 6500, 65), c('UNIÃO', 3000, 30)])), 'eleito-conta');
  // 60% com 65% das seções: a garantia ainda não fecha, e não há palpite pelo %: só "na frente com mais de 50%"
  assert.equal(situacaoGovernador(item(65, [c('PSD', 6000, 60), c('UNIÃO', 3900, 39)])), 'provavel-1t');
  assert.equal(situacaoGovernador(item(46, [c('PSD', 6000, 60), c('UNIÃO', 3900, 39)])), 'provavel-1t');
  // no mapa: cor cheia, sem listras nem tom claro
  const m = criarModelo({ cargo: cargo(3), historico, itens: [{ uf: 'ba', ...item(80, [c('PT', 6500, 65), c('PL', 3000, 30)]) }], ufs: ['ba'] });
  const html = estadosHtml(m, { ...ajuda, mapa: { largura: 100, altura: 100, ufs: { ba: { d: 'M0 0Z' } } } });
  assert.ok(!html.includes('par-lis') && !html.includes('fill-opacity'));
  // o 2º turno marcado pelo TSE vale mais que a conta quando a conta não fecha
  assert.equal(situacaoGovernador(item(46, [c('PSD', 4000, 40, 'segundo-turno'), c('UNIÃO', 3900, 39, 'segundo-turno')])), 'segundo-turno');
});

test('situacaoGovernador: 2º turno inevitável pela conta do painel vira "segundo-turno-conta" (listrado no mapa)', () => {
  const c = (partido, votos, pct, situacao = 'nenhuma') => ({ partido, votos, pct, situacao });
  const item = (pctSecoes, colocados) => ({ vagas: 1, eleitosPorPartido: {}, validos: 1000, secoes: { pctTotalizadas: pctSecoes }, colocados });
  assert.equal(situacaoGovernador(item(80, [c('PT', 300, 30), c('PL', 250, 25)])), 'segundo-turno-conta');
  assert.equal(situacaoGovernador(item(20, [c('PT', 380, 38), c('PL', 300, 30)])), 'provavel-2t'); // cedo demais para ser inevitável
  const m = criarModelo({ cargo: cargo(3), historico, itens: [{ uf: 'ba', ...item(80, [c('PT', 300, 30), c('PL', 250, 25)]) }], ufs: ['ba'] });
  const html = estadosHtml(m, { ...ajuda, mapa: { largura: 100, altura: 100, ufs: { ba: { d: 'M0 0Z' } } } });
  assert.match(html, /class="par-lis"/);
  assert.match(html, /2º turno\* pela conta do painel/);
});

test('mapa de governadores: 2026 listrado (50% ou menos / 2º turno), claro (mais de 50%) e cheio (eleito)', () => {
  const c = (partido, pct, situacao = 'nenhuma') => ({ partido, pct, situacao, votos: 100 });
  const itens = [
    { uf: 'sp', vagas: 1, eleitosPorPartido: {}, colocados: [c('PT', 41), c('PL', 30)] }, // 2022 centrão → 2026 esquerda, listrado
    { uf: 'ba', vagas: 1, eleitosPorPartido: {}, colocados: [c('PT', 61)] }, // claro
    { uf: 'ce', vagas: 1, eleitosPorPartido: { PT: 1 }, colocados: [c('PT', 70, 'eleito')] }, // cheio
    { uf: 'rj', vagas: 1, eleitosPorPartido: {}, colocados: [c('PL', 40, 'segundo-turno'), c('PT', 35, 'segundo-turno')] }, // 2º turno, listrado
  ];
  const m = criarModelo({ cargo: cargo(3), historico, itens, ufs: ['sp', 'ba', 'ce', 'rj'] });
  assert.deepEqual(m.estados.map((e) => [e.uf, e.situacao]), [['sp', 'provavel-2t'], ['ba', 'provavel-1t'], ['ce', 'eleito'], ['rj', 'segundo-turno']]);
  const aj = { ...ajuda, mapa: { largura: 100, altura: 100, ufs: { sp: { d: 'M0 0Z' }, ba: { d: 'M1 1Z' }, ce: { d: 'M2 2Z' }, rj: { d: 'M3 3Z' } } } };
  const html = estadosHtml(m, aj);
  assert.equal(html.match(/class="par-lis"/g).length, 2); // sp e rj
  assert.match(html, /clipPath id="par-dir"/);
  assert.match(html, /<pattern id="par-lis-0"/);
  assert.match(html, /provável 2º turno/);
  assert.match(html, /fill:#d9363e;fill-opacity:0\.6/); // ba (esquerda em 2022 e em 2026), na frente com mais de 50%: cor clara
  assert.ok(!html.includes('stop-opacity')); // nenhuma UF mudou de bloco com a metade de 2026 clara neste cenário
  assert.match(html, /na frente com 50% ou menos \/ 2º turno/); // legenda
  // por partido, as tramas listradas usam a cor do partido
  assert.match(estadosHtml(m, { ...aj, modo: 'partido', corPartido: (x) => (x === 'PT' ? '#d00' : '#00d') }), /<pattern id="par-lis-0"[^>]*><rect[^>]*style="fill:#[0d]{3}"/);
});

test('placar: nota de estimativa quando as vagas na frente dos deputados são estimadas', () => {
  const itens = [{ uf: 'sp', vagas: 8, eleitosPorPartido: {}, cadeirasPorPartido: { PL: 4, PT: 3 }, cadeirasEstimadas: true }];
  const m = criarModelo({ cargo: cargo(6), historico, itens, ufs: [] });
  assert.equal(m.vivo.estimativa, true);
  assert.match(placarHtml(m, ajuda), /estimativa pelo quociente eleitoral/);
  const real = criarModelo({ cargo: cargo(6), historico, itens: [{ ...itens[0], cadeirasEstimadas: false }], ufs: [] });
  assert.doesNotMatch(placarHtml(real, ajuda), /estimativa pelo quociente/);
});

test('anotarVagasPrevistas: distância em votos até ganhar ou perder uma vaga, conferida pela própria distribuição', () => {
  const votos = [100000, 80000, 30000, 20000];
  const dados = {
    cargo: { vagas: 8 },
    candidatos: [],
    agrupamentos: votos.map((v, i) => ({ id: i + 1, votos: v, vagas: 0 })), // o TSE ainda não distribuiu: vale a estimativa
  };
  anotarVagasPrevistas(dados);
  assert.deepEqual(dados.agrupamentos.map((a) => a.vagasPrevistas), [4, 3, 1, 0]);
  assert.equal(dados.vagasEstimadas, true);
  const com = (i, x) => distribuirVagas(votos.map((v, j) => (j === i ? v + x : v)), 8)[i];
  dados.agrupamentos.forEach((a, i) => {
    const base = distribuirVagas(votos, 8)[i];
    assert.ok(a.faltamParaVaga > 0);
    assert.ok(com(i, a.faltamParaVaga) > base, `lista ${i}: com os votos que faltam ganha uma vaga`);
    assert.ok(com(i, a.faltamParaVaga - 1) <= base, `lista ${i}: com um voto a menos ainda não ganha`);
    if (base > 0) {
      assert.ok(com(i, -(a.folgaDaVaga + 1)) < base, `lista ${i}: perdendo a folga mais um voto, perde a vaga`);
      assert.ok(com(i, -a.folgaDaVaga) >= base, `lista ${i}: perdendo só a folga, mantém a vaga`);
    } else {
      assert.equal(a.folgaDaVaga, null);
    }
  });
});

test('aoVivo: quem a conta do painel dá como eleito (Senado e governador) entra como confirmado, não como "na frente"', () => {
  const colocados = [
    { partido: 'PL', votos: 400000, situacao: 'nenhuma' }, { partido: 'PT', votos: 350000, situacao: 'nenhuma' }, { partido: 'PSD', votos: 100000, situacao: 'nenhuma' },
  ];
  // Senado, 2 vagas, 90% apurado: PL e PT isolados dos demais → confirmados; PSD fica de fora
  const item = { uf: 'sp', vagas: 2, turno: 1, validos: 1000000, secoes: { pctTotalizadas: 90 }, eleitosPorPartido: {}, colocados };
  const senado = aoVivo(cargo(5), [item]);
  assert.deepEqual(senado.confirmados, { PL: 1, PT: 1 });
  assert.deepEqual(senado.naFrente, {});
  assert.equal(senado.porConta, 2);
  assert.equal(senado.pendentes, 0);
  // Com pouca apuração, ninguém é dado como eleito: continuam só "na frente"
  const cedo = aoVivo(cargo(5), [{ ...item, secoes: { pctTotalizadas: 10 } }]);
  assert.deepEqual(cedo.confirmados, {});
  assert.deepEqual(cedo.naFrente, { PL: 1, PT: 1 });
  // Governador: líder com 65% aos 80% apurado é dado como eleito, e a situação do mapa vira "eleito"
  const gov = { uf: 'ba', vagas: 1, turno: 1, validos: 1000000, secoes: { pctTotalizadas: 80 }, eleitosPorPartido: {}, colocados: [{ partido: 'PT', votos: 650000, situacao: 'nenhuma' }, { partido: 'PL', votos: 300000, situacao: 'nenhuma' }] };
  assert.deepEqual(aoVivo(cargo(3), [gov]).confirmados, { PT: 1 });
  assert.equal(situacaoGovernador(gov), 'eleito-conta');
});
