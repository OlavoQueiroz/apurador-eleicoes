// Gera public/mapa-brasil.js (contornos das UFs em SVG) a partir da API de malhas do IBGE.
// Só é preciso rodar de novo se quiser atualizar os contornos: node scripts/gerar-mapa.js
// Fonte: https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR (qualidade mínima, por UF).

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const URL_IBGE = 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=UF';
const SAIDA = fileURLToPath(new URL('../public/mapa-brasil.js', import.meta.url));

const UF_POR_CODIGO = {
  11: 'ro', 12: 'ac', 13: 'am', 14: 'rr', 15: 'pa', 16: 'ap', 17: 'to', 21: 'ma', 22: 'pi', 23: 'ce', 24: 'rn',
  25: 'pb', 26: 'pe', 27: 'al', 28: 'se', 29: 'ba', 31: 'mg', 32: 'es', 33: 'rj', 35: 'sp', 41: 'pr', 42: 'sc',
  43: 'rs', 50: 'ms', 51: 'mt', 52: 'go', 53: 'df',
};

// Projeção equiretangular com a longitude comprimida pelo cosseno da latitude central do Brasil.
const LAT0 = -14;
const ESCALA = 15;
const COS = Math.cos((LAT0 * Math.PI) / 180);

const res = await fetch(URL_IBGE);
if (!res.ok) throw new Error(`IBGE: HTTP ${res.status}`);
const geo = await res.json();

const poligonos = (geometria) => (geometria.type === 'Polygon' ? [geometria.coordinates] : geometria.coordinates);

// Primeira passada: limites, para que o viewBox comece em (0, 0).
let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
const proj = ([lon, lat]) => [lon * COS * ESCALA, -lat * ESCALA];
for (const f of geo.features) {
  for (const poli of poligonos(f.geometry)) {
    for (const [lon, lat] of poli[0]) {
      const [x, y] = proj([lon, lat]);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
}
const margem = 8;
const p = (coord) => {
  const [x, y] = proj(coord);
  return [x - minX + margem, y - minY + margem];
};
const r1 = (n) => Math.round(n * 10) / 10;

// Centro do maior polígono, ponderado pela área, para posicionar o rótulo.
function centroide(anel) {
  let area = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < anel.length - 1; i += 1) {
    const [x0, y0] = anel[i]; const [x1, y1] = anel[i + 1];
    const f = x0 * y1 - x1 * y0;
    area += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  area /= 2;
  return { area: Math.abs(area), x: cx / (6 * area), y: cy / (6 * area) };
}

const ufs = {};
for (const f of geo.features) {
  const uf = UF_POR_CODIGO[f.properties.codarea];
  if (!uf) throw new Error(`Código de UF desconhecido: ${f.properties.codarea}`);
  let d = '';
  let maior = null;
  for (const poli of poligonos(f.geometry)) {
    const anel = poli[0].map(p);
    d += `M${anel.slice(0, -1).map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`;
    const c = centroide(anel);
    if (!maior || c.area > maior.area) maior = c;
  }
  ufs[uf] = { d, x: r1(maior.x), y: r1(maior.y) };
}

const largura = r1(maxX - minX + 2 * margem);
const altura = r1(maxY - minY + 2 * margem);
const corpo = Object.entries(ufs)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([uf, { d, x, y }]) => `  ${uf}: { x: ${x}, y: ${y}, d: '${d}' },`)
  .join('\n');

await writeFile(SAIDA, `// Gerado por scripts/gerar-mapa.js a partir das malhas do IBGE. Não edite à mão.
export const MAPA = {
  largura: ${largura},
  altura: ${altura},
  ufs: {
${corpo}
  },
};
`);
console.log(`Escrito ${SAIDA} (${largura} x ${altura})`);
