// Caixa de busca global de candidatos e municípios (/api/busca). Não conhece o estado do painel: app.js passa
// o contexto (cargo e UF abertos), os formatadores e o que fazer ao escolher um resultado.
// Os resultados vêm em três grupos: candidatos do cargo e UF abertos, candidatos de todo o resto e municípios.

export function iniciarBusca({ raiz, contexto, nomeCargo, nomeUf, nomeProprio, corPartido, esc, fmtPct, aoEscolher }) {
  raiz.innerHTML = `<div class="busca-caixa">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/></svg>
      <input type="search" placeholder="Buscar candidato, número ou município" autocomplete="off" spellcheck="false"
        role="combobox" aria-expanded="false" aria-controls="busca-lista" aria-autocomplete="list" aria-label="Buscar candidato ou município">
      <kbd aria-hidden="true">/</kbd>
    </div>
    <div class="busca-lista" id="busca-lista" role="listbox" hidden></div>`;
  const entrada = raiz.querySelector('input');
  const lista = raiz.querySelector('.busca-lista');

  let itens = []; // opções na ordem em que aparecem: { tipo: 'candidato' | 'municipio', ...dados }
  let ativo = -1;
  let pedido = 0;
  let espera = null;
  let termoDesenhado = null; // termo a que a lista na tela corresponde

  const abrir = (sim) => {
    lista.hidden = !sim;
    entrada.setAttribute('aria-expanded', String(sim));
  };

  // No grupo do cargo e UF abertos o "onde" seria repetição, então só os outros grupos o mostram.
  const linhaCandidato = (c, i) => `<div class="busca-op" role="option" data-i="${i}" id="busca-op-${i}">
      <span class="busca-cor" style="background:${corPartido(c.partido)}"></span>
      <span class="busca-texto"><b>${esc(c.nomeUrna)}</b><small>${esc(c.numero)} · ${esc(c.partido)}${c.nome && c.nome !== c.nomeUrna ? ` · ${esc(nomeProprio(c.nome))}` : ''}</small></span>
      ${c.aqui ? '' : `<span class="busca-onde">${esc(nomeCargo(c.cargo))} · ${esc(nomeUf(c.uf))}</span>`}</div>`;
  const linhaMunicipio = (m, i) => `<div class="busca-op" role="option" data-i="${i}" id="busca-op-${i}">
      <span class="busca-cor busca-pino"></span>
      <span class="busca-texto"><b>${esc(nomeProprio(m.nome))}</b><small>Município</small></span>
      <span class="busca-onde">${esc(nomeUf(m.uf))}</span></div>`;

  function desenhar(r, termo) {
    const { cargo, uf } = contexto();
    termoDesenhado = termo;
    itens = [];
    const grupo = (titulo, lista_, linha) => {
      if (!lista_.length) return '';
      const html = lista_.map((x) => { itens.push(x); return linha(x, itens.length - 1); }).join('');
      return `<div class="busca-grupo" role="group"><div class="busca-titulo">${titulo}</div>${html}</div>`;
    };
    const aqui = r.aqui.map((c) => ({ tipo: 'candidato', aqui: true, ...c }));
    const outros = r.outros.map((c) => ({ tipo: 'candidato', ...c }));
    const municipios = r.municipios.map((m) => ({ tipo: 'municipio', ...m }));
    const rotuloAqui = termo ? `Em ${esc(nomeCargo(cargo))} · ${esc(nomeUf(uf))}` : `Mais votados em ${esc(nomeCargo(cargo))} · ${esc(nomeUf(uf))}`;
    const html = grupo(rotuloAqui, aqui, linhaCandidato)
      + grupo('Municípios', municipios, linhaMunicipio)
      + grupo(termo ? 'Outros cargos e estados' : '', outros, linhaCandidato);
    lista.innerHTML = html || `<p class="busca-vazio">${termo ? 'Nada encontrado.' : 'Digite um nome, número ou município.'}</p>`;
    ativo = itens.length && termo ? 0 : -1;
    marcar();
    abrir(true);
  }

  function marcar() {
    lista.querySelectorAll('.busca-op').forEach((el) => {
      const sel = Number(el.dataset.i) === ativo;
      el.classList.toggle('ativo', sel);
      el.setAttribute('aria-selected', String(sel));
      if (sel) el.scrollIntoView({ block: 'nearest' });
    });
    if (ativo >= 0) entrada.setAttribute('aria-activedescendant', `busca-op-${ativo}`);
    else entrada.removeAttribute('aria-activedescendant');
  }

  async function buscar() {
    const termo = entrada.value.trim();
    const meu = ++pedido;
    const { cargo, uf } = contexto();
    try {
      const res = await fetch(`/api/busca?${new URLSearchParams({ q: termo, cargo, uf })}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = await res.json();
      if (meu === pedido) desenhar({ aqui: [], outros: [], municipios: [], ...r }, termo);
    } catch {
      if (meu === pedido) {
        lista.innerHTML = '<p class="busca-vazio">Não consegui buscar agora.</p>';
        abrir(true);
      }
    }
  }

  function escolher(item) {
    if (!item) return;
    abrir(false);
    entrada.value = '';
    entrada.blur();
    aoEscolher(item);
  }

  entrada.addEventListener('focus', buscar);
  entrada.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(buscar, 120);
  });
  entrada.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      abrir(false);
      entrada.blur();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!itens.length) return;
      e.preventDefault();
      ativo = (ativo + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
      marcar();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Enter logo depois de digitar: espera a lista do que está no campo, não escolhe da anterior.
      if (entrada.value.trim() !== termoDesenhado) {
        clearTimeout(espera);
        buscar().then(() => escolher(itens[0]));
      } else escolher(itens[ativo >= 0 ? ativo : 0]);
    }
  });

  // mousedown (e não click): roda antes de o campo perder o foco e fechar a lista.
  lista.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const op = e.target.closest('.busca-op');
    if (op) escolher(itens[Number(op.dataset.i)]);
  });
  entrada.addEventListener('blur', () => abrir(false));

  // "/" leva o foco para a busca, como em outros sites.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    entrada.focus();
  });
}
