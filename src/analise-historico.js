// Análise do histórico gravado (src/historico.js): quanto a projeção de um modelo oscila entre atualizações consecutivas e,
// se a apuração terminou, quanto ela errou em cada faixa de apuração. Sem E/S: recebe os pontos de `lerSerie`.

const mediana = (v) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Diferença projetada entre os dois primeiros candidatos (os do ÚLTIMO ponto) em cada ponto da série.
function serieDaDiferenca(pontos) {
  const ult = pontos.at(-1);
  const [a, b] = [...ult.candidatos].sort((x, y) => y.pct - x.pct).slice(0, 2).map((c) => c.numero);
  if (!a || !b) return null;
  const pontoDe = (p) => {
    const ca = p.candidatos.find((c) => c.numero === a);
    const cb = p.candidatos.find((c) => c.numero === b);
    return ca?.projPct != null && cb?.projPct != null ? { t: p.t, secoes: p.secoes.pct, plano: p.plano, lead: ca.projPct - cb.projPct, atual: ca.pct - cb.pct } : null;
  };
  return { a, b, pontos: pontos.map(pontoDe).filter(Boolean) };
}

const planoB = (p) => (p?.plano?.planoB ?? 0) > 0;

// `pontos`: de lerSerie(...).pontos (ordenados por t). `limiar`: salto, em pontos percentuais da diferença projetada entre
// os dois primeiros, a partir do qual a mudança conta como "pulo".
export function analisarSerie(pontos, { limiar = 1 } = {}) {
  if (pontos.length < 2) return null;
  const s = serieDaDiferenca(pontos);
  if (!s || s.pontos.length < 2) return null;
  const saltos = s.pontos.slice(1).map((p, i) => {
    const antes = s.pontos[i];
    return {
      t: p.t, secoes: p.secoes, delta: p.lead - antes.lead, mudouAtual: p.atual - antes.atual,
      plano: p.plano?.plano ?? null, trocouDePlano: (p.plano?.plano ?? null) !== (antes.plano?.plano ?? null) || planoB(p) !== planoB(antes),
    };
  });
  const pulos = saltos.filter((x) => Math.abs(x.delta) >= limiar);
  const final = pontos.at(-1).secoes.pct >= 99.9 ? s.pontos.at(-1).atual : null; // a diferença real, se a apuração acabou
  const porFaixa = [];
  if (final !== null) {
    for (let ini = 0; ini < 100; ini += 10) {
      const dentro = s.pontos.filter((p) => p.secoes >= ini && (p.secoes < ini + 10 || ini === 90));
      if (dentro.length) porFaixa.push({ faixa: `${ini}-${ini + 10}%`, erroMedio: dentro.reduce((m, p) => m + Math.abs(p.lead - final), 0) / dentro.length, pontos: dentro.length });
    }
  }
  return {
    candidatos: [s.a, s.b],
    pontos: s.pontos.length,
    saltoMediano: mediana(saltos.map((x) => Math.abs(x.delta))),
    maiorSalto: Math.max(...saltos.map((x) => Math.abs(x.delta))),
    pulos: pulos.length,
    pulosComTrocaDePlano: pulos.filter((x) => x.trocouDePlano).length,
    pulosSemMudancaDoAtual: pulos.filter((x) => Math.abs(x.mudouAtual) < limiar / 4).length, // a projeção pulou sem o % atual mexer
    maiores: [...pulos].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 5),
    porFaixa,
  };
}
