// Mapa de municípios de uma UF: contornos (public/municipios/<uf>.json, gerados por scripts/gerar-municipios.js e
// indexados pelo código de município do TSE) + resultados de /api/municipios/:cargo/:uf. Não conhece o estado do
// painel: app.js passa o que precisa (cores, formatadores) e chama estas funções.

const geometrias = new Map(); // uf → Promise<{ largura, altura, municipios: { [codigoTse]: { n, d } } }>

// Contornos de uma UF, buscados uma vez. Falha não fica guardada: a próxima consulta tenta de novo.
export function geometriaUf(uf) {
  if (!geometrias.has(uf)) {
    const promessa = fetch(`/municipios/${uf}.json`).then((res) => {
      if (!res.ok) throw new Error(`/municipios/${uf}.json: HTTP ${res.status}`);
      return res.json();
    });
    promessa.catch(() => geometrias.delete(uf));
    geometrias.set(uf, promessa);
  }
  return geometrias.get(uf);
}

// Resultados dos municípios da UF. `null` quando a rota não existe (camada de municípios desligada) ou falha.
export async function resultadosMunicipios(cargo, uf) {
  try {
    const res = await fetch(`/api/municipios/${cargo}/${uf}`, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Desenha o SVG. `corDe(municipio)` devolve { cor, forca } (cor nula = cinza).
export function mapaMunicipiosHtml(geo, resultados, corDe) {
  const porCodigo = new Map((resultados?.municipios ?? []).map((m) => [m.codigo, m]));
  const formas = Object.entries(geo.municipios).map(([codigo, { d }]) => {
    const m = porCodigo.get(codigo);
    const { cor, forca } = m ? corDe(m) : { cor: null, forca: 0 };
    const estilo = cor ? ` style="--cor:${cor};--forca:${forca}"` : '';
    return `<path class="mun" data-mun="${codigo}" d="${d}"${estilo}/>`;
  });
  return `<svg class="mapa-svg mapa-mun" viewBox="0 0 ${geo.largura} ${geo.altura}" role="group" aria-label="Municípios da UF">${formas.join('')}</svg>`;
}

// Conteúdo da dica de um município.
export function dicaMunicipioHtml(m, nome, { ehMajoritario, corPartido, fmtPct, esc }) {
  const linhas = [];
  if (!m?.secoes?.totalizadas) linhas.push('<span class="muted">Sem votos apurados ainda</span>');
  else {
    if (ehMajoritario && m.lider) {
      linhas.push(`<span class="dica-lider" style="--cor:${corPartido(m.lider.partido)}"><i></i><span>${esc(m.lider.nomeUrna)}<small>${esc(m.lider.partido)} · ${fmtPct(m.lider.pct)} dos válidos</small></span></span>`);
    }
    linhas.push(`<span class="muted">${fmtPct(m.secoes.pctTotalizadas)} das seções totalizadas</span>`);
  }
  return `<strong>${esc(nome)}</strong>${linhas.join('')}`;
}
