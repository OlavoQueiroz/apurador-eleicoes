#!/usr/bin/env node
// Confere, no TSE, se os arquivos do 2º turno já foram publicados e se têm o formato que o painel espera. Rode antes da votação
// (e de novo quando algo aparecer): `node scripts/verificar-segundo-turno.js`. Só lê; nada é gravado.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARGOS, criarFonteMunicipiosTse, criarFonteTse, descobrirEleicoes, montarAlvos, urlAcompanhamento } from '../src/tse.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ok = (m) => console.log(`  ✔ ${m}`);
const ruim = (m) => { console.log(`  ✖ ${m}`); falhas += 1; };
const espera = (m) => console.log(`  … ${m}`);
let falhas = 0;

const { ciclo, eleicoes } = await descobrirEleicoes(2026);
console.log(`Eleições de ${ciclo}: federal ${JSON.stringify(eleicoes.federal)}, estadual ${JSON.stringify(eleicoes.estadual)}`);
if (!eleicoes.federal?.[2]) { ruim('o índice do TSE não lista o 2º turno federal'); process.exit(1); }
ok(`2º turno no índice: federal ${eleicoes.federal[2]}, estadual ${eleicoes.estadual?.[2] ?? '—'}`);

const alvos = montarAlvos({ ciclo, eleicoes, turno: 2, cargos: [1, 3] });
const fonte = criarFonteTse();
const mapa = JSON.parse(readFileSync(path.join(raiz, 'dados-historicos/mapeamento-presidente-t2.json'), 'utf8'));
const numerosMapa = Object.keys(mapa).filter((k) => !k.startsWith('_'));

console.log('\nResultado por UF');
const publicados = [];
for (const alvo of alvos) {
  const r = await fonte.obter(alvo, null).catch((e) => ({ status: 'erro', erro: e.message }));
  if (r.status === 'novo') publicados.push({ alvo, dados: r.dados });
}
const pres = publicados.filter((p) => p.alvo.cargo === 1);
const gov = publicados.filter((p) => p.alvo.cargo === 3);
if (!pres.length) espera('presidente: nenhum arquivo publicado ainda');
else {
  ok(`presidente: ${pres.length} de ${alvos.filter((a) => a.cargo === 1).length} arquivos publicados`);
  const br = pres.find((p) => p.alvo.uf === 'br')?.dados;
  if (!br) ruim('falta o arquivo nacional (br)');
  else {
    br.turno === 2 ? ok('campo de turno = 2') : ruim(`turno no arquivo = ${br.turno}`);
    br.candidatos.length === 2 ? ok('2 candidatos') : ruim(`${br.candidatos.length} candidatos`);
    const nums = br.candidatos.map((c) => c.numero).sort();
    JSON.stringify(nums) === JSON.stringify([...numerosMapa].sort()) ? ok(`números ${nums.join(' e ')} batem com mapeamento-presidente-t2.json`) : ruim(`números ${nums.join(', ')} diferem do mapeamento (${numerosMapa.join(', ')}): edite dados-historicos/mapeamento-presidente-t2.json`);
    ok(`seções ${br.secoes.totalizadas}/${br.secoes.total}, ${br.candidatos.map((c) => `${c.nomeUrna} ${c.pct}%`).join(' × ')}`);
  }
}
gov.length ? ok(`governador: ${gov.length} UFs com arquivo (${gov.map((g) => g.alvo.uf).join(', ')})`) : espera('governador: nenhum arquivo publicado ainda');

console.log('\nMunicípios');
const mun = criarFonteMunicipiosTse();
try {
  const lista = await mun.listar(ciclo, eleicoes.federal[2]);
  ok(`lista de municípios publicada (${[...lista.values()].reduce((s, l) => s + l.length, 0)} municípios em ${lista.size} abrangências)`);
  const r = await mun.acompanhar({ ciclo, eleicao: eleicoes.federal[2], uf: 'sp' }, null);
  r.status === 'novo' ? ok(`acompanhamento de SP publicado (${r.detalhes.size} municípios)`) : espera(`acompanhamento de SP: ${r.status}`);
  console.log(`    ${urlAcompanhamento(ciclo, eleicoes.federal[2], 'sp')}`);
} catch (e) {
  espera(`lista de municípios ainda não publicada (${e.message}); o painel tenta de novo a cada minuto`);
}
console.log(falhas ? `\n${falhas} problema(s) acima.` : '\nNada de errado até aqui.');
process.exit(falhas ? 1 : 0);
