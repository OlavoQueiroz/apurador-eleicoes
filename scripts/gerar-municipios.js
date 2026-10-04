// Gera public/municipios/<uf>.json (contornos dos municípios de cada UF, em SVG) a partir das malhas do IBGE.
// Os contornos saem indexados pelo código de município do TSE (5 dígitos), porque é esse o código que o painel
// recebe dos resultados; a ponte com o código do IBGE (7 dígitos) é o campo `cdi` da lista de municípios do TSE.
// Só é preciso rodar de novo para atualizar os contornos: node scripts/gerar-municipios.js
//   TSE:  {BASE}/{ciclo}/{eleição}/config/mun-e{eleição}-cm.json
//   IBGE: https://servicodados.ibge.gov.br/api/v3/malhas/estados/{código da UF} (qualidade mínima, por município)

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BASE, descobrirEleicoes } from '../src/tse.js';

const ANO = Number(process.env.ANO ?? 2026);
const SAIDA = fileURLToPath(new URL('../public/municipios/', import.meta.url));
const LARGURA = 600; // largura-alvo do desenho de cada UF
const MARGEM = 6;

// Código IBGE de cada UF (a API de malhas pede o código numérico).
const CODIGO_UF = {
  ro: 11, ac: 12, am: 13, rr: 14, pa: 15, ap: 16, to: 17, ma: 21, pi: 22, ce: 23, rn: 24, pb: 25, pe: 26, al: 27,
  se: 28, ba: 29, mg: 31, es: 32, rj: 33, sp: 35, pr: 41, sc: 42, rs: 43, ms: 50, mt: 51, go: 52, df: 53,
};

const pad6 = (n) => String(n).padStart(6, '0');
const r1 = (n) => Math.round(n * 10) / 10;

async function json(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'apurador-local/0.1 (gerador de contornos)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

const poligonos = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

const { ciclo, eleicoes } = await descobrirEleicoes(ANO);
const eleicao = eleicoes.federal?.[1] ?? eleicoes.estadual?.[1];
const lista = await json(`${BASE}/${ciclo}/${eleicao}/config/mun-e${pad6(eleicao)}-cm.json`);

await mkdir(SAIDA, { recursive: true });
let total = 0;
const semContorno = [];

for (const abr of lista.abr ?? []) {
  const uf = String(abr.cd).toLowerCase();
  if (!CODIGO_UF[uf]) continue; // "zz" (exterior) não tem geometria
  const porIbge = new Map((abr.mu ?? []).filter((m) => m.cdi).map((m) => [String(m.cdi), m]));
  const malha = await json(
    `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${CODIGO_UF[uf]}?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio`,
  );

  // Projeção equiretangular com a longitude comprimida pelo cosseno da latitude central da UF,
  // enquadrada na largura-alvo.
  let minLon = Infinity; let maxLon = -Infinity; let minLat = Infinity; let maxLat = -Infinity;
  for (const f of malha.features) {
    for (const poli of poligonos(f.geometry)) {
      for (const [lon, lat] of poli[0]) {
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
    }
  }
  const cos = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const escala = (LARGURA - 2 * MARGEM) / ((maxLon - minLon) * cos);
  const proj = ([lon, lat]) => [(lon - minLon) * cos * escala + MARGEM, (maxLat - lat) * escala + MARGEM];

  const municipios = {};
  for (const f of malha.features) {
    const m = porIbge.get(String(f.properties.codarea));
    if (!m) { semContorno.push(`${uf} IBGE ${f.properties.codarea} sem município no TSE`); continue; }
    let d = '';
    for (const poli of poligonos(f.geometry)) {
      const pontos = [];
      for (const c of poli[0].slice(0, -1)) {
        const [x, y] = proj(c).map(r1);
        const ant = pontos[pontos.length - 1];
        if (!ant || ant[0] !== x || ant[1] !== y) pontos.push([x, y]); // descarta pontos repetidos após o arredondamento
      }
      if (pontos.length >= 3) d += `M${pontos.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
    }
    municipios[m.cd] = { n: m.nm, d };
  }
  for (const m of porIbge.values()) if (!municipios[m.cd]) semContorno.push(`${uf} ${m.nm} (TSE ${m.cd}) sem contorno no IBGE`);

  const altura = r1((maxLat - minLat) * escala + 2 * MARGEM);
  await writeFile(`${SAIDA}${uf}.json`, JSON.stringify({ largura: LARGURA, altura, municipios }));
  total += Object.keys(municipios).length;
  console.log(`${uf}: ${Object.keys(municipios).length} municípios`);
}
console.log(`Total: ${total} municípios em ${SAIDA}`);
if (semContorno.length) console.log(`Atenção:\n  ${semContorno.join('\n  ')}`);
