// Quem já não tem chance de ficar entre os classificados (os `k` primeiros), em dois níveis:
//   'matematica': o candidato recebe TODOS os votos que ainda podem entrar (todo eleitor apto das seções que faltam) e os `k`
//     à frente dele não recebem nenhum; se mesmo assim ele não passa o k-ésimo, está fora. Não usa estimativa nenhuma.
//   'pratica': o mesmo cálculo, mas com os votos que faltam estimados pela abstenção, pelos brancos e pelos nulos já
//     medidos nas seções apuradas, com uma margem de segurança. Elimina bem mais cedo, mas não é garantia: depende de as
//     seções que faltam votarem parecido com as já apuradas.
// Na presidência e no governo, no 1º turno, há também a vitória sem 2º turno: se o líder já tem mais da metade dos válidos
// mesmo que todos os votos que faltam fossem dos outros, ninguém mais tem chance.

// Quantos avançam: no Senado, as vagas em disputa; presidente e governador, os dois do 2º turno (ou o único, no 2º turno).
export function quantosClassificam({ cargo, vagas, turno }) {
  if (cargo === 1 || cargo === 3) return turno === 2 ? 1 : 2;
  return Math.max(1, vagas || 1);
}

// Teto dos votos que ainda podem aparecer: todo eleitor apto das seções ainda não totalizadas votando em candidato.
// Sem o total de eleitores no arquivo, não há teto confiável (devolve null).
export function votosRestantes({ total, comparecimento, abstencao }) {
  if (!(total > 0)) return null;
  return Math.max(0, total - (comparecimento ?? 0) - (abstencao ?? 0));
}

// `votos`: votos de cada candidato, do mais votado para o menos. Devolve, para cada um, se já não tem chance.
export function semChanceMatematica(votos, k, restantes) {
  const corte = votos[k - 1];
  return votos.map((v, i) => restantes != null && corte !== undefined && i >= k && v + restantes < corte);
}

// Margem sobre os votos que faltam estimados pelas taxas observadas: as seções que faltam podem comparecer e validar um pouco
// mais que as já apuradas (por exemplo, as das cidades grandes).
export const MARGEM_SEGURANCA = 1.15;

// Votos que ainda devem entrar, pelas taxas de comparecimento e de votos válidos medidas até agora, nunca acima do teto.
// Sem comparecimento medido ainda, devolve o teto.
export function votosRestantesEstimados({ total, comparecimento, abstencao, validos }, margem = MARGEM_SEGURANCA) {
  const teto = votosRestantes({ total, comparecimento, abstencao });
  if (teto === null || !(comparecimento > 0) || !(validos >= 0)) return teto;
  const taxaComparecimento = comparecimento / (comparecimento + (abstencao ?? 0));
  const taxaValidos = Math.min(1, validos / comparecimento);
  return Math.min(teto, teto * taxaComparecimento * taxaValidos * margem);
}

// Para cada candidato (votos do mais votado para o menos): 'matematica', 'pratica' ou null. `primeiroTurno`: vale a
// vitória do líder sem 2º turno (presidente e governador). `eleitorado` = { total, comparecimento, abstencao }.
//
// Sem os dados do eleitorado (servidor antigo, ainda sem o campo), só o nível 'pratica' é calculado, e os votos que faltam saem
// da proporção de seções apuradas: `validos × (100 − p) ÷ p`, com a mesma margem. `pctSecoes` = % de seções totalizadas.
// `votosPorEleitor`: no Senado, `validos` conta 2 votos por eleitor, mas um candidato recebe no máximo 1 de cada um.
const restantesPorSecoes = (validos, pctSecoes, votosPorEleitor = 1) => (pctSecoes > 0
  ? (pctSecoes >= 100 ? 0 : (validos * (100 - pctSecoes) * MARGEM_SEGURANCA) / pctSecoes / votosPorEleitor)
  : null);

// O líder já fecha o 1º turno? Verdadeiro se ele passa de 50% dos válidos mesmo que todos os votos que faltam fossem dos
// outros (ele não recebe mais nenhum). 'matematica' (teto de todos os eleitores aptos que faltam) ou 'pratica' (votos que faltam
// estimados pela abstenção medida, com margem); `null` se ainda não. É uma conta do painel: quem declara o eleito é o TSE.
export function vitoriaNoPrimeiroTurno({ votos, validos = 0, eleitorado = null, pctSecoes = null }) { // (presidente e governador: 1 voto por eleitor)
  if (!(votos[0] > 0)) return null;
  const decide = (restantes) => restantes != null && 2 * votos[0] > validos + restantes;
  if (eleitorado && decide(votosRestantes(eleitorado))) return 'matematica';
  const estimados = eleitorado ? votosRestantesEstimados({ ...eleitorado, validos }) : restantesPorSecoes(validos, pctSecoes);
  return decide(estimados) ? 'pratica' : null;
}

// O 2º turno é inevitável? Verdadeiro se o líder não passa de 50% dos válidos nem recebendo TODOS os votos que faltam:
// (V + R) ÷ (válidos + R) ≤ 1/2, ou seja, 2V + R ≤ válidos. 'matematica' (R = teto de todos os eleitores aptos que faltam) ou
// 'pratica' (R estimado pela abstenção medida, com margem); `null` se ainda dá para fechar no 1º turno. Presidente e governador,
// 1º turno. É uma conta do painel: quem marca o 2º turno é o TSE.
export function segundoTurnoGarantido({ votos, validos = 0, eleitorado = null, pctSecoes = null }) {
  if (!(votos[0] > 0) || !(validos > 0)) return null;
  const inevitavel = (restantes) => restantes != null && 2 * (votos[0] + restantes) <= validos + restantes;
  if (eleitorado && inevitavel(votosRestantes(eleitorado))) return 'matematica';
  const estimados = eleitorado ? votosRestantesEstimados({ ...eleitorado, validos }) : restantesPorSecoes(validos, pctSecoes);
  return inevitavel(estimados) ? 'pratica' : null;
}

// Governador de uma UF (item do resumo): 'tse' (o TSE já marcou 2º turno), 'matematica' ou 'pratica' (a conta do painel) ou null.
// Quem já tem eleito (TSE) não vai ao 2º turno; no 2º turno de verdade não há o que contar.
export function segundoTurnoDoGovernador(item) {
  if (item.turno === 2) return null;
  const colocados = item.colocados ?? [];
  if (colocados.some((c) => c.situacao === 'eleito')) return null;
  if (colocados.some((c) => c.situacao === 'segundo-turno')) return 'tse';
  return segundoTurnoGarantido({ votos: colocados.map((c) => c.votos), validos: item.validos, eleitorado: item.eleitorado, pctSecoes: item.secoes?.pctTotalizadas ?? null });
}

export function avaliarChances({ votos, k, primeiroTurno = false, validos = 0, eleitorado = null, pctSecoes = null, votosPorEleitor = 1 }) {
  const restantesSecoes = restantesPorSecoes(validos, pctSecoes, votosPorEleitor);
  if (!eleitorado && restantesSecoes === null) return votos.map(() => null);
  const fora = (restantes) => {
    const porLugar = semChanceMatematica(votos, k, restantes);
    const liderDecide = primeiroTurno && restantes != null && votos[0] > 0 && 2 * votos[0] > validos + restantes;
    return porLugar.map((f, i) => f || (liderDecide && i >= 1));
  };
  const estrito = eleitorado ? fora(votosRestantes(eleitorado)) : votos.map(() => false);
  const pratico = fora(eleitorado ? votosRestantesEstimados({ ...eleitorado, validos }) : restantesSecoes);
  return votos.map((_, i) => (estrito[i] ? 'matematica' : pratico[i] ? 'pratica' : null));
}

// Quem já está garantido entre os `k` primeiros (Senado: os eleitos): mesmo que ele não receba mais nenhum voto e cada
// adversário que pode alcançá-lo receba todos os votos que faltam, menos de `k` terminam à frente dele. 'matematica' (teto) ou
// 'pratica' (abstenção medida, com margem). Conta do painel, não o resultado: quem declara o eleito é o TSE.
export function garantidosNoTopo({ votos, k, validos = 0, eleitorado = null, pctSecoes = null, votosPorEleitor = 1 }) {
  const estrito = eleitorado ? votosRestantes(eleitorado) : null;
  const pratico = eleitorado ? votosRestantesEstimados({ ...eleitorado, validos }) : restantesPorSecoes(validos, pctSecoes, votosPorEleitor);
  const seguro = (restantes, i) => restantes != null && i < k && votos[i] > 0
    && i + votos.slice(i + 1).filter((v) => v + restantes > votos[i]).length < k;
  return votos.map((_, i) => (seguro(estrito, i) ? 'matematica' : seguro(pratico, i) ? 'pratica' : null));
}

// Quem o painel dá como eleito (ou, no 1º turno de presidente e governador, como vencedor sem 2º turno): array com 'matematica' ou
// 'pratica' (as garantias acima) ou null. Só entra quem já não pode ser alcançado, mesmo no pior caso (ou no pior caso com a
// abstenção medida). Não há palpite pelo % atual: com a apuração em andamento, o % final pode se afastar do atual porque as
// regiões chegam em ordens diferentes. `votosPorEleitor`: 2 no Senado. É uma conta do painel; só o TSE declara o eleito.
export function elegiveisPelaConta({ votos, k, primeiroTurno = false, validos = 0, eleitorado = null, pctSecoes = null, votosPorEleitor = 1 }) {
  return primeiroTurno
    ? votos.map((_, i) => (i === 0 ? vitoriaNoPrimeiroTurno({ votos, validos, eleitorado, pctSecoes }) : null))
    : garantidosNoTopo({ votos, k, validos, eleitorado, pctSecoes, votosPorEleitor });
}

// Quem a conta do painel dá como eleito entre os colocados de uma UF (resumo com `colocados`, `vagas`, `turno`, `validos`,
// `eleitorado` e `secoes`): um valor por colocado (null, 'matematica' ou 'pratica'). Governador e Senado. Quem o
// TSE já marcou como eleito não entra: ele já conta como eleito.
export function flagsEleitoPelaConta(item, codigo) {
  const colocados = item.colocados ?? [];
  return elegiveisPelaConta({
    votos: colocados.map((x) => x.votos), k: quantosClassificam({ cargo: codigo, vagas: item.vagas, turno: item.turno }),
    primeiroTurno: [1, 3].includes(codigo) && item.turno !== 2, validos: item.validos, eleitorado: item.eleitorado,
    pctSecoes: item.secoes?.pctTotalizadas ?? null, votosPorEleitor: codigo === 5 ? item.vagas : 1,
  }).map((x, i) => (colocados[i].situacao === 'eleito' ? null : x));
}
