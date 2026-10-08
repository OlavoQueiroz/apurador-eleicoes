// Peças do 2º turno: o painel do duelo (margem e o que falta para virar) e o editor das premissas de transferência
// de votos dos candidatos eliminados. Sem dependência do restante do app: recebe o que precisa por parâmetro.

const CHAVE = 'apurador-transferencias-t2';

// Premissas { origem (nº do 1º turno): { destino (nº do finalista): fração 0–1 } }. Ficam no navegador de quem editou.
export function lerTransf() {
  try {
    return limparTransf(JSON.parse(localStorage.getItem(CHAVE) ?? '{}'));
  } catch {
    return {};
  }
}

export function gravarTransf(transf) {
  try {
    if (Object.keys(transf).length) localStorage.setItem(CHAVE, JSON.stringify(transf));
    else localStorage.removeItem(CHAVE);
  } catch { /* sem armazenamento: vale só nesta página */ }
}

// Mantém só frações válidas (0 < f ≤ 1) e, por origem, não deixa a soma passar de 100%.
export function limparTransf(transf) {
  const saida = {};
  for (const [origem, destinos] of Object.entries(transf ?? {})) {
    const itens = Object.entries(destinos ?? {}).map(([d, f]) => [d, Number(f)]).filter(([, f]) => f > 0 && f <= 1);
    const soma = itens.reduce((s, [, f]) => s + f, 0);
    if (!itens.length || soma > 1.0001) continue;
    saida[origem] = Object.fromEntries(itens.map(([d, f]) => [d, Math.round(f * 1000) / 1000]));
  }
  return saida;
}

// Parte da URL que leva as premissas à API (vazia se não houver nenhuma).
export const sufixoTransf = (transf) => (Object.keys(transf).length ? `?transf=${encodeURIComponent(JSON.stringify(transf))}` : '');

// Votos válidos que ainda faltam, estimados pela proporção de seções (as regiões chegam em ordens diferentes: é uma ordem de grandeza).
export function validosQueFaltam({ validos, pctSecoes, final = false }) {
  if (final || !(pctSecoes > 0) || pctSecoes >= 100) return 0;
  return Math.round(validos * (100 / pctSecoes - 1));
}

// Que fração dos votos válidos que faltam o segundo colocado precisa para empatar: (R + margem) / (2R). Acima de 1, nem com todos.
export function fracaoParaVirar({ margem, faltam }) {
  if (!(faltam > 0)) return margem > 0 ? Infinity : 0;
  return (faltam + margem) / (2 * faltam);
}

// Painel do duelo (presidente e governador no 2º turno). Só números do TSE e uma conta simples, sempre dita como conta.
export function dueloHtml(d, { esc, fmtInt, fmtPct, corPartido }) {
  const cands = d.candidatos.slice(0, 2);
  if (cands.length < 2 || !(cands[0].votos + cands[1].votos > 0)) return '';
  const [a, b] = cands;
  const total = a.votos + b.votos;
  const pa = (a.votos / total) * 100;
  const margem = a.votos - b.votos;
  const faltam = validosQueFaltam({ validos: d.votos.validos, pctSecoes: d.secoes.pctTotalizadas, final: d.totalizacaoFinal });
  const lado = (c, direita) => `<div class="duelo-lado${direita ? ' direita' : ''}" style="--cor:${corPartido(c.partido)}">
      <span class="duelo-nome"><b>${esc(c.nomeUrna)}</b> <span class="partido" style="--cor:${corPartido(c.partido)}">${esc(c.partido)}</span></span>
      <b class="duelo-pct">${fmtPct(c.pct)}</b>
      <span class="muted pequeno">${fmtInt(c.votos)} votos${c.situacao === 'eleito' ? ' · <b>Eleito (TSE)</b>' : ''}</span>
    </div>`;
  let virada = '';
  if (d.totalizacaoFinal || !(faltam > 0)) {
    virada = '';
  } else {
    const f = fracaoParaVirar({ margem, faltam });
    virada = f > 1
      ? `Faltam cerca de <b>${fmtInt(faltam)}</b> votos válidos, menos que a diferença: <b>${esc(b.nomeUrna)}</b> não alcançaria nem com todos.`
      : `Faltam cerca de <b>${fmtInt(faltam)}</b> votos válidos. Para empatar, <b>${esc(b.nomeUrna)}</b> precisaria de <b>${fmtPct(f * 100, 1)}</b> deles.`;
  }
  return `<div class="duelo" role="group" aria-label="Duelo do 2º turno">
      <div class="duelo-placar">${lado(a, false)}${lado(b, true)}</div>
      <div class="duelo-barra" role="img" aria-label="${esc(a.nomeUrna)} ${fmtPct(pa)}, ${esc(b.nomeUrna)} ${fmtPct(100 - pa)}">
        <i style="width:${pa}%;background:${corPartido(a.partido)}"></i><i style="width:${100 - pa}%;background:${corPartido(b.partido)}"></i><span class="duelo-meio"></span></div>
      <p class="duelo-margem"><b>${esc(a.nomeUrna)}</b> ${margem >= 0 ? 'está' : 'estava'} <b>${fmtInt(Math.abs(margem))}</b> votos (${fmtPct(Math.abs(a.pct - b.pct))} pontos) à frente.</p>
      ${virada ? `<p class="muted pequeno">${virada} É uma conta do painel pela proporção de seções apuradas, não um dado do TSE: as regiões chegam em ordens diferentes.</p>` : ''}
    </div>`;
}

// O painel redesenha a cada ciclo de apuração; sem isto, o que a pessoa digitou (e ainda não aplicou) e o "aberto" se perderiam.
let rascunho = null; // { origem: { destino: texto digitado } } ou null = sem edição pendente
let aberto = false;

// Editor das premissas: para cada candidato eliminado no 1º turno, quanto dos votos dele vai para cada finalista.
// `candidatos1T` = { número: { nomeUrna, partido } }; `finalistas` = [{ numero, nomeUrna, partido }, ...].
export function editorTransfHtml({ candidatos1T, finalistas, transf, esc, corPartido }) {
  const nums = new Set(finalistas.map((f) => String(f.numero)));
  const eliminados = Object.entries(candidatos1T).filter(([n]) => !nums.has(n)).sort((a, b) => (b[1].votos ?? 0) - (a[1].votos ?? 0));
  if (!eliminados.length || finalistas.length < 2) return '';
  const valor = (origem, destino) => {
    if (rascunho) return rascunho[origem]?.[destino] ?? '';
    const f = transf[origem]?.[destino];
    return f ? Math.round(f * 1000) / 10 : '';
  };
  const linhas = eliminados.map(([n, c]) => `<tr data-origem="${esc(n)}">
      <td><b>${esc(c.nomeUrna)}</b> <span class="partido" style="--cor:${corPartido(c.partido)}">${esc(c.partido)}</span>${c.votos ? `<small class="muted"> · ${(c.votos / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi votos</small>` : ''}</td>
      ${finalistas.map((f) => `<td class="num"><input type="number" min="0" max="100" step="1" inputmode="decimal" data-destino="${esc(String(f.numero))}" value="${valor(n, String(f.numero))}" placeholder="0" aria-label="% dos votos de ${esc(c.nomeUrna)} para ${esc(f.nomeUrna)}"></td>`).join('')}
      <td class="num muted" data-resto></td></tr>`).join('');
  const personalizado = Object.keys(transf).length > 0;
  return `<details class="editor-transf"${personalizado || aberto ? ' open' : ''}>
      <summary>Premissas de transferência de votos${personalizado ? ' · <b>personalizadas</b>' : ''}</summary>
      <p class="muted pequeno">Quanto dos votos que cada candidato eliminado teve no 1º turno você supõe que vá para cada finalista. O que não for atribuído a ninguém
        (abstenção, branco, nulo ou indeciso) é absorvido pela variação que o modelo mede nos lugares já apurados. Vale só para o modelo de swing e só nesta tela.</p>
      <div class="tabela-rolagem"><table class="tabela tabela-transf">
        <thead><tr><th>Candidato do 1º turno</th>${finalistas.map((f) => `<th class="num">% para ${esc(f.nomeUrna)}</th>`).join('')}<th class="num">Sem destino</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
      <div class="transf-acoes"><button class="botao" id="transf-aplicar">Aplicar premissas</button>
        <button class="botao" id="transf-zerar"${personalizado ? '' : ' disabled'}>Voltar ao padrão</button>
        <span class="muted pequeno" id="transf-erro" role="alert"></span></div>
    </details>`;
}

// Liga o editor: lê os campos, valida (soma por candidato ≤ 100%) e chama `aoAplicar(transf)`.
export function ligarEditorTransf(raiz, { aoAplicar }) {
  const editor = raiz.querySelector('.editor-transf');
  if (!editor) return;
  const ler = () => {
    const transf = {};
    let erro = '';
    editor.querySelectorAll('tbody tr').forEach((linha) => {
      const origem = linha.dataset.origem;
      let soma = 0;
      linha.querySelectorAll('input').forEach((inp) => {
        const v = Number(inp.value);
        if (!(v > 0)) return;
        soma += v;
        (transf[origem] ??= {})[inp.dataset.destino] = Math.min(100, v) / 100;
      });
      const resto = linha.querySelector('[data-resto]');
      if (resto) resto.textContent = soma > 0 ? `${Math.round((100 - soma) * 10) / 10}%` : '';
      if (soma > 100.0001) erro = 'A soma dos dois destinos de um mesmo candidato não pode passar de 100%.';
    });
    return { transf, erro };
  };
  editor.addEventListener('toggle', () => { aberto = editor.open; });
  editor.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
    rascunho = {};
    editor.querySelectorAll('tbody tr').forEach((l) => l.querySelectorAll('input').forEach((i) => { if (i.value !== '') (rascunho[l.dataset.origem] ??= {})[i.dataset.destino] = i.value; }));
    const { erro } = ler();
    editor.querySelector('#transf-erro').textContent = erro;
  }));
  ler();
  editor.querySelector('#transf-aplicar')?.addEventListener('click', () => {
    const { transf, erro } = ler();
    editor.querySelector('#transf-erro').textContent = erro;
    if (!erro) { rascunho = null; aoAplicar(limparTransf(transf)); }
  });
  editor.querySelector('#transf-zerar')?.addEventListener('click', () => { rascunho = null; aoAplicar({}); });
}
