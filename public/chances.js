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
export function avaliarChances({ votos, k, primeiroTurno = false, validos = 0, eleitorado = null }) {
  if (!eleitorado) return votos.map(() => null);
  const fora = (restantes) => {
    const porLugar = semChanceMatematica(votos, k, restantes);
    const liderDecide = primeiroTurno && restantes != null && votos[0] > 0 && 2 * votos[0] > validos + restantes;
    return porLugar.map((f, i) => f || (liderDecide && i >= 1));
  };
  const estrito = fora(votosRestantes(eleitorado));
  const pratico = fora(votosRestantesEstimados({ ...eleitorado, validos }));
  return votos.map((_, i) => (estrito[i] ? 'matematica' : pratico[i] ? 'pratica' : null));
}
