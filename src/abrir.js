// Abre o painel no navegador quando o servidor fica pronto. No macOS o padrão é o Safari.

import { execFile } from 'node:child_process';

// Tentativas em ordem de preferência. No macOS: o app pedido e, se ele não existir, o navegador
// padrão do sistema. Os comandos são executados sem shell, então o nome do app e a URL nunca
// são interpretados como código.
export function comandosParaAbrir(url, { navegador = null, plataforma = process.platform } = {}) {
  if (plataforma === 'darwin') {
    const tentativas = [];
    if (navegador) tentativas.push({ rotulo: navegador, cmd: 'open', args: ['-a', navegador, url] });
    tentativas.push({ rotulo: 'navegador padrão', cmd: 'open', args: [url] });
    return tentativas;
  }
  // Fora do macOS só há o navegador padrão (esses dois caminhos não foram testados).
  if (plataforma === 'win32') return [{ rotulo: 'navegador padrão', cmd: 'cmd', args: ['/c', 'start', '', url] }];
  return [{ rotulo: 'navegador padrão', cmd: 'xdg-open', args: [url] }];
}

const executar = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000 }, (erro) => (erro ? reject(erro) : resolve()));
  });

// Nunca lança: se nada funcionar, avisa e devolve false (o painel continua de pé).
export async function abrirNoNavegador(
  url,
  { navegador = null, plataforma = process.platform, executarComando = executar, log = () => {} } = {},
) {
  for (const { rotulo, cmd, args } of comandosParaAbrir(url, { navegador, plataforma })) {
    try {
      await executarComando(cmd, args);
      log(`Abrindo o painel no ${rotulo}.`);
      return true;
    } catch (erro) {
      // A última linha da mensagem costuma trazer o motivo (ex.: "Unable to find application named 'X'").
      const motivo = String(erro.message ?? erro).trim().split('\n').pop();
      log(`Não consegui abrir no ${rotulo} (${motivo}).`);
    }
  }
  log(`Abra manualmente: ${url}`);
  return false;
}
