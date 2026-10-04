// npm run stop: encerra o painel em execução (padrão: o da porta 3000).
//   npm run stop                 painel da porta padrão (PORT, ou 3000)
//   npm run stop -- --porta 3001 painel de outra porta
//   npm run stop -- --todos      todos os painéis deste projeto
//   npm run stop -- --listar     só mostra o que seria encerrado

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executarParar } from '../src/parar.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.exitCode = await executarParar({ argv: process.argv.slice(2), raiz });
