import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Apuracao } from '../src/apuracao.js';
import { Municipios } from '../src/municipios.js';
import { criarServidor } from '../src/servidor.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const mun = (votosA, votosB, totalizadas) => ({
  totalizacaoFinal: false,
  secoes: { total: 10, totalizadas, pctTotalizadas: totalizadas * 10 },
  eleitorado: { total: 1000 },
  votos: { validos: votosA + votosB },
  candidatos: [
    { sq: 'a', numero: '13', nomeUrna: 'A', partido: 'PT', votos: votosA, pct: 0 },
    { sq: 'b', numero: '22', nomeUrna: 'B', partido: 'PL', votos: votosB, pct: 0 },
  ],
});

test('/api/municipios devolve líder e apuração de cada município, e a projeção por município usa os mesmos dados', async () => {
  const fonteMunicipios = {
    async listar() {
      return new Map([['sp', [{ codigo: '71072', nome: 'SÃO PAULO' }, { codigo: '1', nome: 'VAZIO' }]]]);
    },
    async obter(alvo) {
      return { status: 'novo', dados: alvo.municipio === '71072' ? mun(300, 100, 5) : mun(0, 0, 0), etag: null };
    },
  };
  const apuracao = new Apuracao({
    alvos: [{ chave: '1:sp', cargo: 1, uf: 'sp', eleicao: 6257 }],
    fonte: { async obter() { return { status: 'indisponivel' }; } },
  });
  await apuracao.ciclo();
  const municipios = new Municipios({ fonte: fonteMunicipios, ciclo: 'ele2026', pausaUfMs: 0 });
  const servidor = criarServidor({
    apuracao, municipios,
    meta: { ano: 2026, turno: 1, demo: false, intervalo: 60, cargos: [1] },
    diretorioPublico: path.resolve(aqui, '../public'),
  });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const primeira = await (await fetch(`${base}/api/municipios/1/sp`)).json();
    assert.equal(primeira.primeiraCarga, true);
    assert.deepEqual(primeira.municipios, []);
    await municipios.consultar({ eleicao: 6257, cargo: 1, uf: 'sp' }).pendente;

    const r = await (await fetch(`${base}/api/municipios/1/sp`)).json();
    assert.equal(r.primeiraCarga, false);
    assert.equal(r.total, 2);
    const sp = r.municipios.find((m) => m.codigo === '71072');
    assert.equal(sp.nome, 'SÃO PAULO');
    assert.equal(sp.lider.partido, 'PT');
    assert.equal(sp.secoes.totalizadas, 5);
    assert.equal(r.municipios.find((m) => m.codigo === '1').lider, null, 'sem votos, sem líder');

    // resultado completo de um município (painel da direita ao clicar na cidade)
    const um = await (await fetch(`${base}/api/municipio/1/sp/71072`)).json();
    assert.equal(um.dados.codigoMunicipio, '71072');
    assert.equal(um.dados.nomeMunicipio, 'SÃO PAULO');
    assert.equal(um.dados.candidatos.length, 2);
    assert.equal(um.dados.candidatos[0].votos, 300);
    assert.equal(um.dados.secoes.totalizadas, 5);
    assert.equal((await fetch(`${base}/api/municipio/1/sp/99999`)).status, 404);
    assert.equal((await fetch(`${base}/api/municipio/1/zz/71072`)).status, 404);
    assert.equal((await fetch(`${base}/api/municipio/6/sp/71072`)).status, 404, 'deputado não tem resultado por município');

    const proj = await (await fetch(`${base}/api/projecao/estratificado/1/sp`)).json();
    assert.equal(proj.disponivel, true);
    assert.equal(proj.municipios.comVotos, 1);
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolve) => servidor.close(resolve));
    apuracao.parar();
  }
});
