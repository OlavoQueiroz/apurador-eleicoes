import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarPartidos, criarTradutor, carregarPartidos } from '../src/partidos.js';
import { contar, eleitosDoAno, lerCsv } from '../scripts/gerar-eleitos.js';
import {
  CARGOS_PARTIDOS, agrupar, aoVivo, bancadaDoAno, blocoDaBancada, blocosDe, criarModelo, estadosHtml, ganhosHtml, partidosHtml, placarHtml, serieHtml,
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
  ]);
  assert.deepEqual(e.governador, { sp: 'PSDB' });
  assert.deepEqual(e.senador, { mt: ['PSD'] });
  assert.deepEqual(e.deputadoFederal, { sp: { PL: 1 } });
  assert.deepEqual(contar(e), { governador: 1, senador: 1, deputadoFederal: 1 });
});

test('o arquivo gerado tem as contagens oficiais (27 governadores, 513 deputados, 81 senadores por eleição)', () => {
  const eleitos = JSON.parse(readFileSync(path.join(raiz, 'dados-historicos/eleitos.json'), 'utf8'));
  const esperado = { 2014: [27, 27], 2018: [27, 54], 2022: [27, 27] };
  for (const [ano, [gov, sen]] of Object.entries(esperado)) {
    assert.deepEqual(contar(eleitos.anos[ano]), { governador: gov, senador: sen, deputadoFederal: 513 }, ano);
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

test('criarModelo: base é a eleição anterior; estados mudam de bloco e o parcial é marcado', () => {
  const itens = [
    { uf: 'sp', vagas: 8, eleitosPorPartido: { PT: 5 }, cadeirasPorPartido: { PT: 7, PL: 1 } },
    { uf: 'ba', vagas: 6, eleitosPorPartido: { PT: 6 }, cadeirasPorPartido: { PT: 6 } },
  ];
  const m = criarModelo({ cargo: cargo(6), historico, itens, ufs: ['sp', 'ba'] });
  assert.equal(m.base.ano, 2022);
  assert.equal(m.atual.porPartido.PT, 13);
  const sp = m.estados.find((e) => e.uf === 'sp');
  const ba = m.estados.find((e) => e.uf === 'ba');
  assert.equal(sp.blocos[2022], 'direita'); // PL 6 × PT 2
  assert.equal(sp.blocos[2026], 'esquerda');
  assert.equal(sp.provisorio, true);
  assert.equal(ba.provisorio, false);
});

test('telas: todas as abas renderizam, com e sem histórico', () => {
  const itens = [{ uf: 'sp', vagas: 3, eleitosPorPartido: { PL: 1 }, cadeirasPorPartido: { PL: 2, PT: 1 } }];
  for (const c of CARGOS_PARTIDOS) {
    const m = criarModelo({ cargo: c, historico, itens: c.codigo === 6 ? itens : [], ocupadas: c.codigo === 5 ? [{ partido: 'PT' }] : [], ufs: ['sp', 'ba'] });
    for (const agrupar of ['ideologia', 'partido']) {
      for (const aba of ['placar', 'ganhos', 'estados', 'serie']) {
        const html = partidosHtml(m, { aba, agrupar }, ajuda);
        assert.match(html, /aria-label="Análise"/);
        assert.ok(!html.includes('undefined') && !html.includes('NaN'), `${c.nome}/${aba}/${agrupar}`);
      }
    }
    const sem = criarModelo({ cargo: c, historico: null, itens: [], ufs: [] });
    assert.match(partidosHtml(sem, { aba: 'serie' }, ajuda), /gerar-eleitos/);
    assert.match(placarHtml(sem, ajuda), /par-cards/);
  }
  assert.match(ganhosHtml(criarModelo({ cargo: cargo(6), historico, itens, ufs: [] }), ajuda), /par-div/);
  assert.match(serieHtml(criarModelo({ cargo: cargo(6), historico, itens, ufs: [] }), ajuda), /polyline/);
});

test('mapa: UF que mudou de bloco usa gradiente meio a meio; a que não mudou, cor única', () => {
  const itens = [
    { uf: 'sp', vagas: 1, eleitosPorPartido: { PT: 1 }, colocados: [] },
    { uf: 'ba', vagas: 1, eleitosPorPartido: { PT: 1 }, colocados: [] },
  ];
  const m = criarModelo({ cargo: cargo(3), historico, itens, ufs: ['sp', 'ba'] });
  const html = estadosHtml(m, ajuda);
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
  const html = partidosHtml(m, { aba: 'estados', agrupar: 'partido' }, { ...ajuda, corPartido: (s) => (s === 'PT' ? '#d00' : '#00d') });
  assert.match(html, /#\/partidos\/3\/placar\/partido/);
  assert.match(html, /Bastiões \(mesmo partido/);
  assert.match(partidosHtml(m, { aba: 'placar' }, ajuda), /#\/partidos\/3\/ganhos"/);
});
