// Quem já não tem chance matemática de ficar entre os classificados (os `k` primeiros). Conta só o que é certo: o
// candidato recebe TODOS os votos que ainda podem entrar e os `k` à frente dele não recebem nenhum; se mesmo assim ele
// não passa o k-ésimo, está fora. Não usa projeção nem taxa de comparecimento, então não erra para o lado otimista.

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
