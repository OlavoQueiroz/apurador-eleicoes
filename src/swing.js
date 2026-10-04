// Modelo 3: swing histórico. Compara o que cada candidato tem agora com o que o "campo político" dele teve em 2022
// nos mesmos lugares, mede a variação (swing) nos lugares já bem apurados e a aplica ao que falta. Os lugares
// são os mesmos do modelo 2 (municípios grandes um a um + o resto do estado em bloco; ou todos os municípios).
//
//  • prior de cada lugar = votos de 2022 traduzidos para os candidatos de 2026 pelo mapeamento de herança
//    (src/anterior.js); o do resto do estado é a soma dos municípios que o compõem;
//  • swing do candidato = média, ponderada pelo tamanho, de (% atual − % herdado) nos lugares com pelo menos
//    `fracaoMinima` das seções apuradas;
//  • % esperado em cada lugar = % herdado + swing (normalizado para somar 100%);
//  • o que falta de cada lugar é dividido entre o % já visto ali e o esperado, na proporção da apuração dele:
//    quanto mais apurado, mais pesa o que o próprio lugar mostra.
// Lugar sem dados de 2022, ou sem votos nem prior, usa a média observada nos demais.

import { fracaoMunicipio, projetarIngenuo, separarResto } from './projecao.js';

const soma = (valores) => valores.reduce((s, v) => s + v, 0);

export function projetarSwing({ grandes, ufDados, detalhes = null, anterior, completo = false, limite = 20, fracaoMinima = 0.5, tolerancia = null, swingPorGrupo = true }) {
  const base = { modelo: 'swing', modo: completo ? 'municipios' : 'grandes+resto' };

  // Candidatos (por número) e votos atuais da UF.
  const info = new Map(ufDados.candidatos.map((c) => [c.numero, { numero: c.numero, nomeUrna: c.nomeUrna, partido: c.partido }]));
  const votosUf = new Map(ufDados.candidatos.map((c) => [c.numero, c.votos]));
  const numeros = [...info.keys()];

  const lugares = [];
  const doMunicipio = (g) => ({
    id: g.codigoMunicipio,
    resto: false,
    votos: new Map(g.candidatos.map((c) => [c.numero, c.votos])),
    validos: g.votos.validos,
    fracao: fracaoMunicipio(g),
    aptos: g.eleitorado.total,
    prior: anterior.prior(g.codigoMunicipio),
  });
  for (const g of grandes) lugares.push(doMunicipio(g));

  let sep = null;
  if (!completo) {
    sep = separarResto({ grandes, ufDados, detalhes, tolerancia });
    if (sep.erro) return { ...base, disponivel: false, ...sep.erro };
    const porSq = new Map(ufDados.candidatos.map((c) => [c.sq, c.numero]));
    // Prior do resto SEM perder a ordem de chegada: o acompanhamento diz quanto de cada município pequeno já foi
    // apurado. O prior da parte já contada (para medir o swing) e o da parte que falta (para projetar) saem do
    // mesmo conjunto de municípios, ponderados por essa fração. Um prior agregado único confundiria "quais
    // municípios chegaram primeiro" com "variação de voto".
    const vazio = () => new Map(numeros.map((n) => [n, 0]));
    const contado = { herdados: vazio(), validos: 0 };
    const falta = { herdados: vazio(), validos: 0 };
    let comPrior = 0;
    for (const codigo of sep.restoIds) {
      const pr = anterior.prior(codigo);
      if (!pr) continue;
      comPrior += 1;
      const d = detalhes.get(codigo).secoes;
      const f = d.total > 0 ? Math.min(1, d.totalizadas / d.total) : 0;
      contado.validos += f * pr.validos;
      falta.validos += (1 - f) * pr.validos;
      for (const n of numeros) {
        contado.herdados.set(n, contado.herdados.get(n) + f * (pr.herdados.get(n) ?? 0));
        falta.herdados.set(n, falta.herdados.get(n) + (1 - f) * (pr.herdados.get(n) ?? 0));
      }
    }
    const fracaoResto = ufDados.totalizacaoFinal ? 1 : (sep.restoTotal > 0 ? sep.restoTotalizadas / sep.restoTotal : 0);
    lugares.push({
      id: 'resto',
      resto: true,
      votos: new Map([...sep.restoVotos].map(([sq, v]) => [porSq.get(sq), v])),
      validos: sep.restoValidos,
      fracao: fracaoResto,
      aptos: sep.restoAptos,
      prior: comPrior > 0 && contado.validos > 0 ? contado : null, // para medir o swing: só o que já foi contado
      priorFalta: comPrior > 0 && falta.validos > 0 ? falta : null, // para o que falta
      priorTotalValidos: contado.validos + falta.validos,
    });
  }

  for (const l of lugares) l.iniciado = l.fracao > 0 && l.validos > 0;
  const iniciados = lugares.filter((l) => l.iniciado);
  if (!iniciados.length) return { ...base, disponivel: false, motivo: 'Ainda não há votos apurados nesta UF.' };

  for (const l of iniciados) l.esperado = l.validos / l.fracao;

  // Fator de crescimento 2022 → 2026 do total de votos válidos, medido onde já há apuração e há prior.
  const comPriorIni = iniciados.filter((l) => l.prior && l.prior.validos > 0);
  const priorTotal = (l) => l.priorTotalValidos ?? l.prior?.validos ?? 0;
  const crescimento = comPriorIni.length ? soma(comPriorIni.map((l) => l.esperado)) / soma(comPriorIni.map(priorTotal)) : null;
  const taxa = soma(iniciados.map((l) => l.esperado)) / Math.max(1, soma(iniciados.map((l) => l.aptos)));

  // Swing por candidato nos lugares bem apurados que têm prior.
  let referencia = comPriorIni.filter((l) => l.fracao >= fracaoMinima);
  if (!referencia.length) referencia = comPriorIni;
  if (!referencia.length) {
    return { ...base, disponivel: false, motivo: 'Não há dados de 2022 para os lugares já apurados desta UF.' };
  }
  const pesoRef = soma(referencia.map((l) => l.esperado));
  const swing = new Map(numeros.map((n) => [n, soma(referencia.map((l) => l.esperado * ((l.votos.get(n) ?? 0) / l.validos - (l.prior.herdados.get(n) ?? 0) / l.prior.validos))) / pesoRef]));

  // Swing próprio dos municípios grandes e do resto do estado (interior), cada um medido onde há apuração suficiente
  // (`fracaoMinima`). Se um grupo não tem lugar de referência, usa o swing geral. Medido no ensaio: sem diferença
  // quando grandes e interior variam igual; com `--swing-porte 3`, o erro aos 20% apurados cai de ~1,6 para ~0,4 pp.
  const swingDoGrupo = (grupo) => {
    const lista = grupo.filter((l) => l.fracao >= fracaoMinima);
    const ref = lista.length ? lista : grupo;
    if (!ref.length) return swing;
    const peso = soma(ref.map((l) => l.esperado));
    return new Map(numeros.map((n) => [n, soma(ref.map((l) => l.esperado * ((l.votos.get(n) ?? 0) / l.validos - (l.prior.herdados.get(n) ?? 0) / l.prior.validos))) / peso]));
  };
  const swingGrandes = swingPorGrupo ? swingDoGrupo(comPriorIni.filter((l) => !l.resto)) : swing;
  const swingResto = swingPorGrupo ? swingDoGrupo(comPriorIni.filter((l) => l.resto)) : swing;

  // % médio observado nos lugares iniciados (para lugares sem prior).
  const observado = new Map(numeros.map((n) => [n, soma(iniciados.map((l) => (l.votos.get(n) ?? 0) / l.fracao)) / soma(iniciados.map((l) => l.esperado))]));

  const esperadoDe = (l) => {
    if (l.iniciado) return l.esperado;
    if (priorTotal(l) > 0 && crescimento !== null) return priorTotal(l) * crescimento;
    return l.aptos * taxa;
  };
  const parteEsperada = (l) => {
    const pr = l.priorFalta ?? l.prior; // o que falta é projetado pelo prior da parte que falta
    if (!pr || !(pr.validos > 0)) return observado;
    const sw = l.resto ? swingResto : swingGrandes;
    const bruto = new Map(numeros.map((n) => [n, Math.max(0, (pr.herdados.get(n) ?? 0) / pr.validos + sw.get(n))]));
    const total = soma([...bruto.values()]);
    return total > 0 ? new Map([...bruto].map(([n, v]) => [n, v / total])) : observado;
  };

  const projetado = new Map(numeros.map((n) => [n, 0]));
  let validosProjetados = 0;
  let esperadoSemMedida = 0;
  let restoProjetado = 0;
  for (const l of lugares) {
    const total = esperadoDe(l);
    validosProjetados += total;
    const esperada = parteEsperada(l);
    if (l.iniciado) {
      const faltam = Math.max(0, total - l.validos);
      // Município: o que falta mistura o que ele já mostrou com o esperado, pela fração apurada. O resto do estado
      // é um conjunto de municípios cuja parte que falta já conhecemos (priorFalta): ali vale só o esperado.
      const f = l.resto && l.priorFalta ? 0 : Math.min(1, Math.max(0, l.fracao));
      for (const n of numeros) {
        const visto = (l.votos.get(n) ?? 0) / l.validos;
        projetado.set(n, projetado.get(n) + (l.votos.get(n) ?? 0) + faltam * (f * visto + (1 - f) * esperada.get(n)));
      }
    } else {
      esperadoSemMedida += total;
      for (const n of numeros) projetado.set(n, projetado.get(n) + total * esperada.get(n));
    }
    if (l.resto) restoProjetado = total;
  }

  validosProjetados = Math.round(validosProjetados);
  const validosAtuais = ufDados.votos.validos;
  const faltantes = Math.max(0, validosProjetados - validosAtuais);
  const candidatos = numeros.map((n) => {
    const votos = votosUf.get(n) ?? 0;
    const proj = projetado.get(n);
    return {
      ...info.get(n),
      votosAtuais: votos,
      votosProjetados: Math.round(proj),
      pctAtual: validosAtuais > 0 ? (votos / validosAtuais) * 100 : 0,
      pctProjetado: validosProjetados > 0 ? (proj / validosProjetados) * 100 : 0,
    };
  }).sort((a, b) => b.votosProjetados - a.votosProjetados).slice(0, limite);

  const secoesUf = ufDados.secoes;
  return {
    ...base,
    disponivel: true,
    fracaoApurada: secoesUf.total > 0 ? secoesUf.totalizadas / secoesUf.total : 0,
    votosValidos: validosAtuais,
    validosProjetados,
    votosFaltantes: faltantes,
    municipios: {
      total: detalhes?.size ?? grandes.length,
      grandes: grandes.length,
      comVotos: grandes.filter((g) => fracaoMunicipio(g) > 0 && g.votos.validos > 0).length,
      semVotos: grandes.filter((g) => !(fracaoMunicipio(g) > 0 && g.votos.validos > 0)).length,
      semArquivo: 0,
    },
    ...(sep ? {
      resto: {
        municipios: sep.restoMunicipios,
        secoes: { total: sep.restoTotal, totalizadas: sep.restoTotalizadas },
        fracao: lugares.find((l) => l.resto).fracao,
        iniciado: lugares.find((l) => l.resto).iniciado,
        parte: validosProjetados > 0 ? restoProjetado / validosProjetados : 0,
      },
      conferencia: sep.conferencia,
    } : {}),
    parteEstimadaPelaUf: validosProjetados > 0 ? esperadoSemMedida / validosProjetados : 0,
    swing: numeros.map((n) => ({ numero: n, nomeUrna: info.get(n).nomeUrna, partido: info.get(n).partido, pontos: swing.get(n) * 100 }))
      .sort((a, b) => Math.abs(b.pontos) - Math.abs(a.pontos)),
    base2022: { lugaresComPrior: comPriorIni.length, lugaresDeReferencia: referencia.length, crescimentoVotos: crescimento },
    candidatos,
  };
}

// Swing para uma UF, escolhendo o método conforme o que foi carregado (como projetarUf, do modelo 2). Com os
// arquivos fora de sincronia cai na extrapolação simples (plano B).
export function projetarUfSwing({ foto, ufDados, anterior, limite = Infinity, swingPorGrupo = true }) {
  const indisponivel = (motivo) => ({ modelo: 'swing', disponivel: false, motivo });
  if (!anterior) return indisponivel('Não há dados de 2022 carregados.');
  if (!ufDados) return indisponivel('O arquivo desta UF ainda não está disponível no TSE.');
  if (foto.completo) {
    if (!foto.dados.length) return indisponivel('O TSE ainda não publicou os arquivos dos municípios desta UF.');
    return projetarSwing({ grandes: foto.dados, ufDados, anterior, completo: true, limite });
  }
  if (!foto.detalhes) return indisponivel(foto.erro ?? 'Aguardando o arquivo de acompanhamento da UF.');
  if (!foto.dados.length) return indisponivel(foto.erro ?? 'Aguardando os municípios grandes desta UF.');
  const r = projetarSwing({ grandes: foto.dados, ufDados, detalhes: foto.detalhes, anterior, limite, swingPorGrupo });
  if (!r.descompasso) return r;
  const simples = projetarIngenuo(ufDados, { limite });
  return { ...simples, modelo: 'swing', plano: 'extrapolacao', motivoPlano: r.motivo, conferencia: r.conferencia };
}
