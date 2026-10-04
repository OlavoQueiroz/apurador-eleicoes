// Gráfico "Evolução da apuração": para cada candidato, o percentual que ele tinha em cada instante (linha contínua)
// e a projeção do resultado final calculada naquele instante (tracejada). Lê /api/historico/:cargo/:uf, que
// devolve os pontos gravados pelo servidor a cada atualização do TSE. SVG puro, sem bibliotecas; não conhece o
// estado do painel: app.js passa o que precisa (cores de partido, formatadores) em `ctx`.

const PADRAO_SELECIONADOS = 2; // por padrão aparecem os dois primeiros colocados no último ponto
const DISTANCIA_MINIMA_COR = 60; // abaixo disso (RGB) duas cores são consideradas parecidas demais

// Preferências que sobrevivem ao redesenho do painel (que refaz o HTML a cada atualização).
const prefs = { eixo: 'hora', projecao: true, selecionados: new Map() }; // selecionados: chave → Set(número)

// Pontos da UF aberta; `null` se a rota não existe (nada gravado ou camada desligada) ou falha.
export async function carregarHistorico(cargo, uf, modelo) {
  try {
    const res = await fetch(`/api/historico/${cargo}/${uf}?modelo=${encodeURIComponent(modelo)}`, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// ---------- cores ----------

function paraRgb(cor) {
  const hex = /^#([0-9a-f]{6})$/i.exec(cor);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(cor);
  if (hsl) return hslParaRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  return [90, 100, 115];
}

function hslParaRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

function rgbParaHsl([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B); const min = Math.min(R, G, B);
  const l = (max + min) / 2; const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

const distancia = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Cor de cada candidato: a do partido, com luminosidade limitada para ter contraste no tema atual e, se
// ficar parecida demais com a de outro candidato já desenhado, uma variação mais clara ou mais escura.
export function coresDosCandidatos(candidatos, corPartido, escuro) {
  const [minL, maxL] = escuro ? [0.55, 0.78] : [0.25, 0.5];
  const usadas = [];
  return candidatos.map((c) => {
    const [h, s, l0] = rgbParaHsl(paraRgb(corPartido(c.partido)));
    let rgb = hslParaRgb(h, s, Math.min(maxL, Math.max(minL, l0)));
    const menor = (cor) => Math.min(...usadas.map((u) => distancia(u, cor)));
    if (usadas.length && menor(rgb) < DISTANCIA_MINIMA_COR) {
      // Parecida demais com outra já usada: afasta a luminosidade aos poucos, para um lado e para o outro, e fica
      // com a MENOR mudança que separa as cores (se nenhuma separar, com a que ficou mais longe).
      const base = Math.min(maxL, Math.max(minL, l0));
      let melhor = rgb; let folga = menor(rgb);
      for (let passo = 1; passo <= 24 && folga < DISTANCIA_MINIMA_COR; passo += 1) {
        const delta = 0.025 * Math.ceil(passo / 2) * (passo % 2 ? 1 : -1);
        const l = base + delta;
        if (l < minL - 0.12 || l > maxL + 0.12) continue;
        const candidata = hslParaRgb(h, s, l);
        const d = menor(candidata);
        if (d > folga) { folga = d; melhor = candidata; }
      }
      rgb = melhor;
    }
    usadas.push(rgb);
    return `rgb(${rgb.join(' ')})`;
  });
}

// ---------- escalas ----------

function passoBonito(faixa) {
  const alvo = faixa / 5;
  const pot = 10 ** Math.floor(Math.log10(alvo));
  return [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= alvo) ?? pot * 10;
}

const horaSp = (ms) =>
  new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

// ---------- montagem ----------

export function montarGrafico(raiz, historico, ctx) {
  const { corPartido, fmtPct, esc, nomeModelo, chave } = ctx;
  const pontos = (historico?.pontos ?? [])
    .map((p) => ({ ...p, ms: Date.parse(p.t) }))
    .filter((p) => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms);
  if (pontos.length < 2) {
    raiz.innerHTML = '<p class="muted pequeno">O gráfico aparece assim que houver pelo menos duas atualizações gravadas do TSE.</p>';
    return;
  }

  // Candidatos: união de todos os pontos, ordenados pelo percentual do último ponto em que aparecem.
  const info = new Map();
  for (const p of pontos) for (const c of p.candidatos) info.set(c.numero, { numero: c.numero, nomeUrna: c.nomeUrna, partido: c.partido, ultimo: c.pct });
  const ranking = [...info.values()].sort((a, b) => b.ultimo - a.ultimo).slice(0, 8);
  let escolhidos = prefs.selecionados.get(chave);
  if (!escolhidos) {
    escolhidos = new Set(ranking.slice(0, PADRAO_SELECIONADOS).map((c) => c.numero));
    prefs.selecionados.set(chave, escolhidos);
  }
  const escuro = matchMedia('(prefers-color-scheme: dark)').matches;
  const selecionados = ranking.filter((c) => escolhidos.has(c.numero));
  const cores = new Map(selecionados.map((c, i) => [c.numero, coresDosCandidatos(selecionados, corPartido, escuro)[i]]));
  const algumaProjecao = pontos.some((p) => p.candidatos.some((c) => c.projPct != null));

  const chips = ranking.map((c) => {
    const ativo = escolhidos.has(c.numero);
    const cor = ativo ? cores.get(c.numero) : corPartido(c.partido);
    return `<button type="button" class="gr-chip" data-num="${esc(c.numero)}" aria-pressed="${ativo}" style="--cor:${cor}"><i></i>${esc(c.nomeUrna)}</button>`;
  }).join('');

  raiz.innerHTML = `
    <div class="gr-barra">
      <span class="gr-seg" role="group" aria-label="Eixo horizontal">
        <button type="button" data-eixo="hora" aria-pressed="${prefs.eixo === 'hora'}">Horário</button><button type="button" data-eixo="pct" aria-pressed="${prefs.eixo === 'pct'}">% das seções</button>
      </span>
      <label class="gr-proj"><input type="checkbox" ${prefs.projecao ? 'checked' : ''} ${algumaProjecao ? '' : 'disabled'}> Projeção do resultado final</label>
    </div>
    <div class="gr-chips">${chips}</div>
    <div class="gr-area"><svg class="gr-svg" viewBox="0 0 720 340" role="img" aria-label="Evolução do percentual de cada candidato e da projeção do resultado final"></svg><div class="gr-dica" hidden></div></div>
    <p class="muted pequeno gr-nota">Linha contínua: o percentual de votos válidos naquele instante. Tracejada: a projeção do resultado final feita naquele instante${algumaProjecao ? ` (${esc(nomeModelo)})` : ''}. ${algumaProjecao ? '' : 'Este modelo não tem projeção gravada para estes pontos. '}A projeção é estimativa do painel, não dado do TSE.</p>`;

  const svg = raiz.querySelector('.gr-svg');
  const dica = raiz.querySelector('.gr-dica');
  const W = 720; const H = 340; const ml = 44; const mr = 124; const mt = 12; const mb = 40;
  const mostrarProj = () => prefs.projecao && algumaProjecao;

  // Escala vertical a partir dos valores visíveis.
  const valores = [];
  for (const p of pontos) for (const c of p.candidatos) {
    if (!escolhidos.has(c.numero)) continue;
    valores.push(c.pct);
    if (mostrarProj() && c.projPct != null) valores.push(c.projPct);
  }
  if (!valores.length) valores.push(0, 50);
  const passo = passoBonito(Math.max(4, Math.max(...valores) - Math.min(...valores)));
  const y0 = Math.max(0, Math.floor((Math.min(...valores) - 1) / passo) * passo);
  const y1 = Math.min(100, Math.max(y0 + passo * 2, Math.ceil((Math.max(...valores) + 1) / passo) * passo));
  const Y = (v) => mt + (1 - (v - y0) / (y1 - y0)) * (H - mt - mb);

  const t0 = pontos[0].ms; const t1 = Math.max(pontos[pontos.length - 1].ms, t0 + 60_000);
  const X = (p) => ml + (prefs.eixo === 'hora' ? (p.ms - t0) / (t1 - t0) : Math.min(100, p.secoes.pct) / 100) * (W - ml - mr);

  const trilha = (num, campo) => {
    let d = ''; let caneta = false;
    for (const p of pontos) {
      const c = p.candidatos.find((x) => x.numero === num);
      const v = c?.[campo];
      if (v == null) { caneta = false; continue; }
      d += `${caneta ? 'L' : 'M'}${X(p).toFixed(1)} ${Y(v).toFixed(1)}`;
      caneta = true;
    }
    return d;
  };

  function desenhar(foco) {
    let out = '';
    for (let v = y0; v <= y1 + 1e-9; v += passo) {
      out += `<line class="gr-grade" x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}"/><text class="gr-eixo" x="${ml - 8}" y="${Y(v) + 4}" text-anchor="end">${String(v).replace('.', ',')}%</text>`;
    }
    // Marcas do eixo horizontal
    if (prefs.eixo === 'hora') {
      const span = t1 - t0;
      const passoMs = span > 4 * 3_600_000 ? 3_600_000 : span > 90 * 60_000 ? 1_800_000 : span > 30 * 60_000 ? 600_000 : span > 8 * 60_000 ? 120_000 : 60_000;
      for (let t = Math.ceil(t0 / passoMs) * passoMs; t <= t1; t += passoMs) {
        out += `<text class="gr-eixo" x="${X({ ms: t })}" y="${H - 22}" text-anchor="middle">${horaSp(t)}</text>`;
      }
    } else {
      for (let q = 0; q <= 100; q += 20) out += `<text class="gr-eixo" x="${ml + (q / 100) * (W - ml - mr)}" y="${H - 22}" text-anchor="middle">${q}%</text>`;
    }
    out += `<text class="gr-eixo" x="${ml + (W - ml - mr) / 2}" y="${H - 6}" text-anchor="middle">${prefs.eixo === 'hora' ? 'horário de Brasília' : 'seções totalizadas'}</text>`;

    for (const c of selecionados) {
      const cor = cores.get(c.numero);
      if (mostrarProj()) out += `<path d="${trilha(c.numero, 'projPct')}" fill="none" stroke="${cor}" stroke-width="2" stroke-dasharray="6 4" stroke-linejoin="round" stroke-linecap="round"/>`;
      out += `<path d="${trilha(c.numero, 'pct')}" fill="none" stroke="${cor}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
    }

    // Nomes na ponta das linhas, afastados entre si para não se sobreporem.
    const fim = pontos[pontos.length - 1];
    const rotulos = selecionados.map((c) => ({ c, y: Y(fim.candidatos.find((x) => x.numero === c.numero)?.pct ?? y0) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < rotulos.length; i += 1) rotulos[i].y = Math.max(rotulos[i].y, rotulos[i - 1].y + 15);
    for (const { c, y } of rotulos) {
      const nome = c.nomeUrna.length > 15 ? `${c.nomeUrna.slice(0, 14)}…` : c.nomeUrna;
      out += `<text class="gr-nome" x="${X(fim) + 8}" y="${y + 4}" fill="${cores.get(c.numero)}">${esc(nome)}</text>`;
    }

    if (foco) {
      out += `<line x1="${X(foco)}" x2="${X(foco)}" y1="${mt}" y2="${H - mb}" class="gr-mira"/>`;
      for (const c of selecionados) {
        const d = foco.candidatos.find((x) => x.numero === c.numero);
        if (!d) continue;
        out += `<circle cx="${X(foco)}" cy="${Y(d.pct)}" r="4.5" fill="${cores.get(c.numero)}"/>`;
        if (mostrarProj() && d.projPct != null) out += `<circle cx="${X(foco)}" cy="${Y(d.projPct)}" r="4" class="gr-vazio" stroke="${cores.get(c.numero)}"/>`;
      }
    }
    svg.innerHTML = out;
  }

  svg.addEventListener('pointermove', (evento) => {
    const caixa = svg.getBoundingClientRect();
    const x = ((evento.clientX - caixa.left) / caixa.width) * W;
    let foco = pontos[0]; let melhor = Infinity;
    for (const p of pontos) { const d = Math.abs(X(p) - x); if (d < melhor) { melhor = d; foco = p; } }
    desenhar(foco);
    const linhas = selecionados.map((c) => {
      const d = foco.candidatos.find((x) => x.numero === c.numero);
      if (!d) return '';
      const proj = mostrarProj() && d.projPct != null ? ` <span class="muted">→ projeta ${fmtPct(d.projPct, 1)}</span>` : '';
      return `<span><i style="background:${cores.get(c.numero)}"></i>${esc(c.nomeUrna)}: <b>${fmtPct(d.pct, 1)}</b>${proj}</span>`;
    }).join('');
    dica.innerHTML = `<strong>${horaSp(foco.ms)}</strong><span class="muted">${fmtPct(foco.secoes.pct, 0)} das seções totalizadas</span>${linhas}`;
    dica.hidden = false;
    const area = svg.parentElement.getBoundingClientRect();
    dica.style.left = `${Math.min(Math.max(0, (X(foco) / W) * area.width + 12), Math.max(0, area.width - dica.offsetWidth))}px`;
  });
  svg.addEventListener('pointerleave', () => { dica.hidden = true; desenhar(null); });

  raiz.querySelectorAll('[data-eixo]').forEach((b) => b.addEventListener('click', () => {
    prefs.eixo = b.dataset.eixo;
    montarGrafico(raiz, historico, ctx);
  }));
  raiz.querySelector('.gr-proj input').addEventListener('change', (evento) => {
    prefs.projecao = evento.target.checked;
    montarGrafico(raiz, historico, ctx);
  });
  raiz.querySelectorAll('.gr-chip').forEach((b) => b.addEventListener('click', () => {
    const num = b.dataset.num;
    if (escolhidos.has(num)) { if (escolhidos.size > 1) escolhidos.delete(num); } else escolhidos.add(num);
    montarGrafico(raiz, historico, ctx);
  }));
  desenhar(null);
}
