// MODO DEMONSTRAÇÃO: usa a estrutura real publicada pelo TSE (quantidade de candidatos, vagas,
// eleitorado, nº de seções) mas inventa os votos, que "chegam" aos poucos, e troca candidatos
// e partidos por nomes fictícios. Serve para ver o painel funcionando antes de existirem
// resultados de verdade. Votos inventados nunca ficam atribuídos a pessoas ou partidos reais,
// para que um print do demo não possa ser confundido com resultado.

import { ordenarCandidatos } from './normalize.js';

const limitar = (x, min, max) => Math.min(max, Math.max(min, x));
const arredondar2 = (x) => Math.round(x * 100) / 100;

function hash(texto) {
  let h = 2166136261;
  for (const ch of texto) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: gerador pseudoaleatório determinístico (mesma semente, mesma sequência).
function aleatorio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Troca nomes, números e siglas por identificadores fictícios. `registro` é compartilhado entre
// todos os arquivos da execução, de modo que o mesmo candidato (mesmo `sq`) e o mesmo partido
// recebem sempre o mesmo código fictício, no total nacional e nas UFs.
export function criarRegistroAnonimo() {
  return { siglas: new Map(), candidatos: new Map() };
}

export function anonimizar(dados, registro) {
  const saida = structuredClone(dados);
  const sigla = (original) => {
    if (!registro.siglas.has(original)) registro.siglas.set(original, `P${String(registro.siglas.size + 1).padStart(2, '0')}`);
    return registro.siglas.get(original);
  };
  const codigo = (sq) => {
    if (!registro.candidatos.has(sq)) registro.candidatos.set(sq, String(registro.candidatos.size + 1).padStart(4, '0'));
    return registro.candidatos.get(sq);
  };

  const rotuloAgrupamento = new Map();
  for (const agr of saida.agrupamentos) {
    agr.partidos = agr.partidos.map(sigla);
    agr.sigla = agr.partidos.join('/');
    agr.nome = `Agrupamento fictício ${agr.sigla}`;
    rotuloAgrupamento.set(agr.id, agr.sigla);
  }
  for (const c of saida.candidatos) {
    const n = codigo(c.sq);
    c.partido = sigla(c.partido);
    c.partidoNome = `Partido fictício ${c.partido}`;
    c.nome = `Candidato fictício ${n}`;
    c.nomeUrna = `CANDIDATO ${n}`;
    c.numero = `9${n}`;
    c.agrupamento = rotuloAgrupamento.get(c.agrupamentoId) ?? c.partido;
    c.vices = c.vices.map((v) => ({ tipo: v.tipo, nomeUrna: `${v.tipo === 'v' ? 'VICE' : 'SUPLENTE'} FICTÍCIO ${n}`, partido: c.partido }));
  }
  return saida;
}

// `t` é o progresso global da simulação (0 = início, 1 = tudo apurado, >1 = parado no final).
export function simular(base, alvo, t, { semente = 2026, agora = Date.now() } = {}) {
  const r = aleatorio(hash(`${alvo.chave}|${semente}`));
  const dados = structuredClone(base);

  // Cada UF começa a "chegar" em um momento diferente e a apuração desacelera no fim.
  const atraso = r() * 0.35;
  const progresso = limitar((t - atraso) / (1 - atraso), 0, 1);
  const p = 1 - (1 - progresso) ** 2;

  // Sorteios em ordem fixa, independentes de t, para o resultado ser estável entre ciclos.
  const taxaComparecimento = 0.72 + r() * 0.1;
  const taxaBrancos = 0.01 + r() * 0.02;
  const taxaNulos = 0.03 + r() * 0.03;

  const totalSecoes = base.secoes.total;
  const totalizadas = Math.round(totalSecoes * p);
  dados.secoes = {
    total: totalSecoes,
    totalizadas,
    pctTotalizadas: totalSecoes ? arredondar2((100 * totalizadas) / totalSecoes) : 0,
  };

  const eleitores = base.eleitorado.total;
  const comparecimento = Math.round(eleitores * taxaComparecimento * p);
  const abstencao = Math.round(eleitores * p) - comparecimento;
  const brancos = Math.round(comparecimento * taxaBrancos);
  const nulos = Math.round(comparecimento * taxaNulos);
  const validos = comparecimento - brancos - nulos;
  const porComparecimento = (n) => (comparecimento ? arredondar2((100 * n) / comparecimento) : 0);

  dados.eleitorado = {
    total: eleitores,
    comparecimento,
    pctComparecimento: p > 0 ? arredondar2(taxaComparecimento * 100) : 0,
    abstencao,
    pctAbstencao: p > 0 ? arredondar2((1 - taxaComparecimento) * 100) : 0,
  };
  dados.votos = {
    validos,
    pctValidos: porComparecimento(validos),
    brancos,
    pctBrancos: porComparecimento(brancos),
    nulos,
    pctNulos: porComparecimento(nulos),
  };

  // Pesos: disputa majoritária tem poucos favoritos; nas proporcionais poucos candidatos
  // concentram a maior parte dos votos (decaimento tipo Zipf). O "viés" de cada candidato some
  // conforme a apuração avança, imitando regiões que votam diferente e chegam em ordens diferentes.
  const proporcional = [6, 7, 8].includes(base.cargo.codigo);
  const candidatos = dados.candidatos;
  const posicoes = candidatos.map((_, i) => i);
  if (proporcional) {
    for (let i = posicoes.length - 1; i > 0; i -= 1) {
      const j = Math.floor(r() * (i + 1));
      [posicoes[i], posicoes[j]] = [posicoes[j], posicoes[i]];
    }
  }
  const rankingNacional = new Map(
    [...candidatos]
      .sort((a, b) => hash(`${a.sq}|${semente}`) - hash(`${b.sq}|${semente}`))
      .map((c, posicao) => [c.sq, posicao]),
  );
  const pesos = candidatos.map((c, i) => {
    let bruto;
    if (proporcional) bruto = 1 / (posicoes[i] + 1) ** 1.05;
    else if (base.cargo.codigo === 1) {
      // Presidente: a posição de cada candidato no ranking nacional é a mesma no país todo
      // (sorteada pelo código, não pela UF), com degraus claros entre as posições e uma variação
      // por UF que às vezes inverte o primeiro lugar; assim o mapa e o total nacional contam a
      // mesma história, mas o mapa não fica uniforme.
      bruto = 0.78 ** rankingNacional.get(c.sq) * (0.8 + 0.4 * r());
    } else bruto = 0.05 + r() ** 2;
    const vies = (r() - 0.5) * 0.6;
    return bruto * (1 + vies * (1 - p));
  });
  const somaPesos = pesos.reduce((s, x) => s + x, 0) || 1;

  let distribuidos = 0;
  candidatos.forEach((c, i) => {
    c.votos = Math.floor((validos * pesos[i]) / somaPesos);
    distribuidos += c.votos;
    c.situacao = 'nenhuma';
    c.situacaoTexto = '';
  });
  // O resto da divisão inteira vai para o candidato de maior peso, para a soma fechar em `validos`.
  if (candidatos.length) {
    candidatos[pesos.indexOf(Math.max(...pesos))].votos += validos - distribuidos;
  }
  candidatos.forEach((c) => {
    c.pct = validos ? arredondar2((100 * c.votos) / validos) : 0;
  });
  ordenarCandidatos(candidatos);
  candidatos.forEach((c, i) => {
    c.ordem = i + 1;
  });

  // Desfecho só quando tudo foi apurado. Simplificado: não aplica quociente eleitoral.
  const final = progresso >= 1;
  dados.totalizacaoFinal = final;
  dados.matematicamenteDefinido = false;
  if (final && candidatos.length) {
    const majoritario = [1, 3].includes(base.cargo.codigo);
    if (majoritario) {
      if (candidatos[0].pct > 50 || base.turno === 2) {
        candidatos[0].situacao = 'eleito';
      } else {
        candidatos[0].situacao = 'segundo-turno';
        if (candidatos[1]) candidatos[1].situacao = 'segundo-turno';
      }
    } else {
      candidatos.slice(0, base.cargo.vagas).forEach((c) => {
        c.situacao = 'eleito';
      });
    }
  }

  const eleitosPorAgrupamento = new Map();
  const votosPorAgrupamento = new Map();
  for (const c of candidatos) {
    votosPorAgrupamento.set(c.agrupamentoId, (votosPorAgrupamento.get(c.agrupamentoId) ?? 0) + c.votos);
    if (c.situacao === 'eleito') {
      eleitosPorAgrupamento.set(c.agrupamentoId, (eleitosPorAgrupamento.get(c.agrupamentoId) ?? 0) + 1);
    }
  }
  for (const agr of dados.agrupamentos) {
    agr.votosNominais = votosPorAgrupamento.get(agr.id) ?? 0;
    agr.votosLegenda = 0;
    agr.votos = agr.votosNominais;
    agr.eleitos = eleitosPorAgrupamento.get(agr.id) ?? 0;
    agr.vagas = proporcional ? agr.eleitos : 0;
  }
  dados.agrupamentos.sort((a, b) => b.votos - a.votos);

  dados.geracao = `demo-${Math.round(Math.min(t, 1.2) * 1000)}`;
  dados.geradoEm = new Date(agora).toISOString();
  return dados;
}

// Mesmo contrato da fonte real, mas os votos são inventados. A estrutura de cada arquivo
// (candidatos, eleitorado) é buscada uma única vez na fonte base, anonimizada e guardada.
export function criarFonteDemo(fonteBase, { duracaoMin = 8, semente = 2026, agora = Date.now } = {}) {
  const inicio = agora();
  const esqueletos = new Map();
  const registro = criarRegistroAnonimo();
  // Municípios fictícios: a lista de municípios é a real (1 arquivo por eleição), mas NENHUM arquivo de município
  // é baixado. A estrutura de cada um (candidatos, porte) é derivada do esqueleto da UF já anonimizado e os
  // votos são inventados com o mesmo relógio. Assim a demonstração não manda milhares de requisições ao TSE.
  const municipios = (fonteMunicipiosBase) => {
    const esqueletosMunicipio = new Map();
    return {
      listar: (ciclo, eleicao) => fonteMunicipiosBase.listar(ciclo, eleicao),
      async obter(alvo) {
        let base = esqueletosMunicipio.get(alvo.chave);
        if (!base) {
          const uf = esqueletos.get(`${alvo.cargo}:${alvo.uf}`);
          if (!uf) return { status: 'indisponivel' }; // esqueleto da UF ainda não carregado
          const r = aleatorio(hash(`${alvo.chave}|porte|${semente}`));
          const secoes = Math.floor(r() ** 3 * 400) + 3;
          base = structuredClone(uf);
          base.secoes = { total: secoes, totalizadas: 0, pctTotalizadas: 0 };
          base.eleitorado = { ...base.eleitorado, total: secoes * Math.round(250 + r() * 150) };
          esqueletosMunicipio.set(alvo.chave, base);
        }
        const agoraMs = agora();
        const t = (agoraMs - inicio) / (duracaoMin * 60_000);
        return { status: 'novo', dados: simular(base, alvo, t, { semente, agora: agoraMs }), etag: null };
      },
    };
  };
  return {
    demo: true,
    municipios,
    async obter(alvo) {
      let base = esqueletos.get(alvo.chave);
      if (!base) {
        const r = await fonteBase.obter(alvo, null);
        if (r.status !== 'novo') return r;
        base = anonimizar(r.dados, registro);
        esqueletos.set(alvo.chave, base);
      }
      const agoraMs = agora();
      const t = (agoraMs - inicio) / (duracaoMin * 60_000);
      return { status: 'novo', dados: simular(base, alvo, t, { semente, agora: agoraMs }), etag: null };
    },
  };
}
