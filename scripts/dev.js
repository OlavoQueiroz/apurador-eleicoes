// npm run dev: servidor com reinício automático quando o código (server.js e src/) muda.
// Argumentos extras vão para o servidor: npm run dev -- --demo --demo-minutos 1

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarSupervisor } from '../src/supervisor.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = (mensagem) => console.log(`[dev] ${mensagem}`);

log('Modo desenvolvimento: o servidor reinicia sozinho quando o código muda. Ctrl+C para sair.');

const supervisor = iniciarSupervisor({
  raiz,
  args: process.argv.slice(2),
  log,
  aoTerminar: (codigo) => process.exit(codigo),
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, async () => {
    await supervisor.parar(sinal);
    process.exit(0);
  });
}
