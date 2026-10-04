// Guarda em disco o último resultado de cada município, para um reinício do painel (ou o `npm run dev`,
// que reinicia a cada alteração de arquivo) não ter que baixar tudo de novo. Falha de disco nunca
// atrapalha o painel: sem cache, ele só baixa de novo.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function criarCacheDisco(diretorio) {
  const arquivo = (chave) => path.join(diretorio, `${chave.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  return {
    async ler(chave) {
      try {
        return JSON.parse(await readFile(arquivo(chave), 'utf8'));
      } catch {
        return null;
      }
    },
    async gravar(chave, valor) {
      try {
        await mkdir(diretorio, { recursive: true });
        const destino = arquivo(chave);
        const temporario = `${destino}.${process.pid}.tmp`;
        await writeFile(temporario, JSON.stringify(valor));
        await rename(temporario, destino); // troca atômica: nunca fica um arquivo pela metade
      } catch {
        // sem disco, sem cache
      }
    },
  };
}
