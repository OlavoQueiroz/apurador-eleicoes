// Comparação entre os modelos de projeção: mostra, lado a lado, a diferença entre os dois primeiros colocados em cada
// modelo disponível. Quando os modelos divergem muito, nenhuma projeção merece confiança: este é, hoje, o único sinal
// de incerteza do painel. Sem dependência do restante do app (recebe tudo por parâmetro) para poder ser testado.

// Busca a projeção de cada modelo disponível: [[id, resposta | null], ...]. `getJson` é o do app.
export function carregarComparacao(modelos, cargo, uf, getJson, urlDe = (id, c, u) => `/api/projecao/${id}/${c}/${u}`) {
  const ids = modelos.filter((m) => m.disponivel).map((m) => m.id);
  return Promise.all(ids.map((id) => getJson(urlDe(id, cargo, uf)).then((r) => [id, r]).catch(() => [id, null])));
}

// Linhas e dispersão (em pontos percentuais) da diferença entre o 1º e o 2º da projeção atual `p`.
export function resumirComparacao(p, comparacao) {
  const lista = (comparacao ?? []).filter(([, r]) => r?.disponivel && r.candidatos?.length);
  if (lista.length < 2 || !p?.candidatos || p.candidatos.length < 2) return null;
  const [a, b] = p.candidatos;
  const linhas = lista.map(([id, r]) => {
    const pa = r.candidatos.find((c) => c.numero === a.numero)?.pctProjetado ?? 0;
    const pb = r.candidatos.find((c) => c.numero === b.numero)?.pctProjetado ?? 0;
    return { id, planoB: r.plano === 'extrapolacao', pa, pb, dif: pa - pb };
  });
  const difs = linhas.map((l) => l.dif);
  const dispersao = Math.max(...difs) - Math.min(...difs);
  const nivel = dispersao < 1.5 ? 'concordam' : dispersao < 4 ? 'divergem-pouco' : 'divergem-muito';
  return { a, b, linhas, dispersao, nivel };
}

const JUIZO = {
  concordam: 'Os modelos concordam.',
  'divergem-pouco': 'Os modelos divergem um pouco: leia a projeção com cautela.',
  'divergem-muito': 'Os modelos divergem muito: não confie em nenhuma projeção agora.',
};

// `ctx` = { modelos, modelo (o aberto), esc, fmtPct }.
export function comparacaoHtml(p, comparacao, { modelos, modelo, esc, fmtPct }) {
  const r = resumirComparacao(p, comparacao);
  if (!r) return '';
  const nome = (id) => modelos.find((m) => m.id === id)?.nome ?? id;
  const sinal = (v) => `${v >= 0 ? '+' : ''}${fmtPct(v, 1)}`;
  return `<h3 class="secao">Comparação entre modelos</h3>
    <div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Modelo</th><th class="num">${esc(r.a.nomeUrna)}</th><th class="num">${esc(r.b.nomeUrna)}</th><th class="num">Diferença</th></tr></thead>
      <tbody>${r.linhas.map((l) => `<tr${l.id === modelo ? ' style="font-weight:650"' : ''}><td>${esc(nome(l.id))}${l.planoB ? ' <span class="muted">(extrapolação simples nesta UF)</span>' : ''}</td>
        <td class="num">${fmtPct(l.pa, 1)}</td><td class="num">${fmtPct(l.pb, 1)}</td><td class="num">${sinal(l.dif)}</td></tr>`).join('')}</tbody></table></div>
    <p class="aviso-bloco${r.nivel === 'divergem-muito' ? ' erro' : ''}">${JUIZO[r.nivel]} Diferença entre o maior e o menor valor: <b>${fmtPct(r.dispersao, 1)}</b> ponto(s).</p>`;
}
