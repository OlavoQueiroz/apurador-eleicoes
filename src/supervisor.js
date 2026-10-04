// Supervisor do modo desenvolvimento (`npm run dev`): roda o servidor e o reinicia sozinho quando
// o código muda. O navegador só abre na primeira inicialização; nos reinícios o servidor sobe com
// --sem-abrir para não empilhar abas.

import { spawn } from 'node:child_process';
import { existsSync, statSync, watch } from 'node:fs';
import path from 'node:path';
import { SAIDA_PORTA_OCUPADA } from './config.js';

const EXTENSAO_DE_CODIGO = /\.[cm]?js$/;
const ESPERA_ANTES_DE_FORCAR_MS = 3000;

export function iniciarSupervisor({
  raiz,
  entrada = path.join(raiz, 'server.js'),
  args = [],
  observar = ['server.js', 'src'],
  atrasoMs = 250,
  log = () => {},
  aoTerminar = () => {},
}) {
  let filho = null;
  let primeiraVez = true;
  let reiniciando = false;
  let encerrando = false;
  let temporizador = null;
  const observadores = [];

  const pararDeObservar = () => {
    clearTimeout(temporizador);
    for (const observador of observadores) observador.close();
  };

  // SIGTERM primeiro; se o servidor não sair, SIGKILL.
  const matar = (processo, sinal = 'SIGTERM') => {
    processo.kill(sinal);
    setTimeout(() => processo.kill('SIGKILL'), ESPERA_ANTES_DE_FORCAR_MS).unref();
  };

  const iniciarFilho = () => {
    const argumentos = [entrada, ...args, ...(primeiraVez ? [] : ['--sem-abrir'])];
    primeiraVez = false;
    const processo = spawn(process.execPath, argumentos, { cwd: raiz, stdio: 'inherit' });
    filho = processo;

    processo.on('error', (erro) => log(`não consegui iniciar o servidor: ${erro.message}`));
    processo.on('exit', (codigo, sinal) => {
      if (filho === processo) filho = null;
      if (encerrando) return; // parar() cuida do resto

      if (reiniciando) {
        reiniciando = false;
        iniciarFilho();
        return;
      }
      if (codigo === SAIDA_PORTA_OCUPADA) {
        log('a porta está ocupada; mudar o código não resolve. Encerrando (use `npm run stop` ou outra --porta).');
        encerrando = true;
        pararDeObservar();
        aoTerminar(1);
        return;
      }
      if (codigo === 0 || sinal === 'SIGTERM' || sinal === 'SIGINT') {
        // Saída limpa (Ctrl+C no terminal ou `npm run stop`): o supervisor acompanha.
        encerrando = true;
        pararDeObservar();
        aoTerminar(0);
        return;
      }
      log(`o servidor saiu (${sinal ?? `código ${codigo}`}). Aguardando alterações nos arquivos para tentar de novo…`);
    });
  };

  const reiniciar = (motivo) => {
    if (encerrando) return;
    log(`${motivo}; reiniciando…`);
    if (filho) {
      reiniciando = true;
      matar(filho);
    } else {
      iniciarFilho();
    }
  };

  for (const alvo of observar) {
    const caminho = path.join(raiz, alvo);
    if (!existsSync(caminho)) continue;
    const opcoes = statSync(caminho).isDirectory() ? { recursive: true } : {};
    const observador = watch(caminho, opcoes, (_evento, nome) => {
      // Só código importa; ignora arquivos temporários de editores.
      if (nome && !EXTENSAO_DE_CODIGO.test(String(nome))) return;
      clearTimeout(temporizador);
      temporizador = setTimeout(() => reiniciar(`${nome ?? alvo} mudou`), atrasoMs);
    });
    observador.on('error', (erro) => log(`erro ao observar ${alvo}: ${erro.message}`));
    observadores.push(observador);
  }

  iniciarFilho();

  return {
    // Resolve quando o servidor filho já saiu.
    parar(sinal = 'SIGTERM') {
      return new Promise((resolve) => {
        encerrando = true;
        pararDeObservar();
        if (!filho) {
          resolve();
          return;
        }
        const processo = filho;
        processo.once('exit', () => resolve());
        matar(processo, sinal);
      });
    },
    pid: () => filho?.pid ?? null,
  };
}
