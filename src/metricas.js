// Registro em disco do ritmo de pedidos ao TSE: uma linha JSON por minuto e uma por cada 429/503, com o ritmo daquele instante.
// É o dado que, depois de uma apuração, diz em que ritmo o TSE começou a recusar (sem ele, qualquer ajuste de ritmo é palpite).
// Falha de disco nunca atrapalha o painel.

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function criarRegistroRequisicoes(arquivo) {
  let pronto = null;
  const garantir = () => (pronto ??= mkdir(path.dirname(arquivo), { recursive: true }).catch(() => {}));
  return {
    arquivo,
    async gravar(linha) {
      try {
        await garantir();
        await appendFile(arquivo, `${JSON.stringify(linha)}\n`);
      } catch { /* sem disco, sem registro */ }
    },
  };
}

// Linha por minuto a partir de `limitador.estatisticas()`.
export const linhaDoMinuto = (estatisticas, agora = new Date()) => ({ t: agora.toISOString(), tipo: 'minuto', ...estatisticas });
export const linhaDoEvento = (evento) => ({ ...evento, t: new Date(evento.em).toISOString() });

// Piso do ritmo adaptativo aprendido (intervalo mais rápido que já levou 429, com folga), guardado entre execuções.
export async function lerRitmoAprendido(arquivo) {
  try {
    const v = JSON.parse(await readFile(arquivo, 'utf8'));
    return Number.isFinite(v.baixaPisoMs) ? v.baixaPisoMs : 0;
  } catch {
    return 0;
  }
}

export async function gravarRitmoAprendido(arquivo, baixaPisoMs) {
  try {
    await mkdir(path.dirname(arquivo), { recursive: true });
    await writeFile(arquivo, JSON.stringify({ baixaPisoMs, em: new Date().toISOString() }));
  } catch { /* melhor esforço */ }
}
