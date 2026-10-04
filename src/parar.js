// `npm run stop`: localiza e encerra o painel que está rodando, sem tocar em nenhum outro processo.
//
// Um processo é "do painel" somente se for um `node` rodando o server.js ou o scripts/dev.js DESTE
// projeto (o caminho do script, resolvido contra a pasta de trabalho do processo, cai exatamente
// nesses arquivos). Um server.js de outro projeto, ou qualquer outro node, nunca é reconhecido.
// Não usa arquivo de PID: o estado real do sistema (ps + lsof) não fica velho.

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { PORTA_PADRAO } from './config.js';

function executarComando(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (erro, stdout) => {
      // lsof sai com 1 quando nada casa; isso é "sem resultados", não falha.
      if (erro && erro.code !== 1) reject(erro);
      else resolve(stdout);
    });
  });
}

// ---------- interpretação da saída de ps e lsof ----------

// `ps -axo pid=,ppid=,command=`
export function interpretarPs(saida) {
  const processos = [];
  for (const linha of saida.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(linha);
    if (m) processos.push({ pid: Number(m[1]), ppid: Number(m[2]), comando: m[3] });
  }
  return processos;
}

// `lsof -F pn`: uma linha "p<pid>" abre um processo e as linhas "n<nome>" seguintes pertencem a ele.
export function interpretarLsof(saida) {
  const porPid = new Map();
  let pid = null;
  for (const linha of saida.split('\n')) {
    if (linha.startsWith('p')) {
      pid = Number(linha.slice(1));
      if (!porPid.has(pid)) porPid.set(pid, []);
    } else if (linha.startsWith('n') && pid !== null) {
      porPid.get(pid).push(linha.slice(1));
    }
  }
  return porPid;
}

// "127.0.0.1:3000", "*:3000" ou "[::1]:3000" → 3000
export function portaDe(nome) {
  const m = /:(\d+)$/.exec(nome);
  return m ? Number(m[1]) : null;
}

// ---------- reconhecimento ----------

// O caminho aparece no comando como palavra inteira (não casa "server.js.bak" nem "meu-server.js").
const contemCaminho = (comando, caminho) => comando.endsWith(` ${caminho}`) || comando.includes(` ${caminho} `);

// 'servidor' | 'supervisor' (npm run dev) | null (não é nosso)
export function tipoDoProcesso(comando, cwd, raiz) {
  const tokens = comando.split(/\s+/);
  if (path.basename(tokens[0]) !== 'node') return null;
  const alvos = { servidor: path.join(raiz, 'server.js'), supervisor: path.join(raiz, 'scripts', 'dev.js') };
  for (const [tipo, alvo] of Object.entries(alvos)) {
    // Caminho absoluto no comando (vale mesmo com espaços no caminho)...
    if (contemCaminho(comando, alvo)) return tipo;
    // ...ou relativo, resolvido contra a pasta de trabalho do processo.
    if (cwd && tokens.slice(1).some((t) => !t.startsWith('-') && path.resolve(cwd, t) === alvo)) return tipo;
  }
  return null;
}

const portaDoSupervisor = (comando) => {
  const m = /--porta\s+(\d+)/.exec(comando);
  return m ? Number(m[1]) : PORTA_PADRAO;
};

// Devolve { selecionados, outros }: o que o comando vai encerrar e os demais painéis do projeto
// encontrados (para avisar que existem, sem tocar neles).
export async function localizarPaineis({
  raiz,
  porta = PORTA_PADRAO,
  todos = false,
  executar = executarComando,
  eu = process.pid,
}) {
  const raizReal = realpathSync(raiz);
  const processos = interpretarPs(await executar('ps', ['-axo', 'pid=,ppid=,command=']));
  const candidatos = processos.filter((p) => p.pid !== eu && path.basename(p.comando.split(/\s+/)[0]) === 'node');
  if (!candidatos.length) return { selecionados: [], outros: [] };

  const cwds = interpretarLsof(await executar('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', candidatos.map((p) => p.pid).join(',')]));
  const nossos = [];
  for (const p of candidatos) {
    const tipo = tipoDoProcesso(p.comando, cwds.get(p.pid)?.[0] ?? null, raizReal);
    if (tipo) nossos.push({ ...p, tipo, portas: [] });
  }
  if (!nossos.length) return { selecionados: [], outros: [] };

  const escutas = interpretarLsof(
    await executar('lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-Fpn', '-p', nossos.map((p) => p.pid).join(',')]),
  );
  for (const p of nossos) p.portas = (escutas.get(p.pid) ?? []).map(portaDe).filter(Boolean);

  let selecionados;
  if (todos) {
    selecionados = nossos;
  } else {
    const servidores = nossos.filter((p) => p.tipo === 'servidor' && p.portas.includes(porta));
    const pidsDosServidores = new Set(servidores.map((p) => p.pid));
    const supervisores = nossos.filter((p) => {
      if (p.tipo !== 'supervisor') return false;
      const filhos = nossos.filter((f) => f.tipo === 'servidor' && f.ppid === p.pid);
      // Supervisor de um servidor selecionado; ou sem servidor vivo (caiu, e ele espera uma
      // alteração de arquivo) e apontando para esta porta.
      return filhos.some((f) => pidsDosServidores.has(f.pid)) || (!filhos.length && portaDoSupervisor(p.comando) === porta);
    });
    selecionados = [...servidores, ...supervisores];
  }
  const escolhidos = new Set(selecionados.map((p) => p.pid));
  return { selecionados, outros: nossos.filter((p) => !escolhidos.has(p.pid)) };
}

// ---------- encerramento ----------

const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return erro.code === 'EPERM'; // existe, só não temos permissão
  }
};
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// SIGTERM em todos (o servidor e o supervisor saem de forma limpa) e, se algum não sair no prazo, SIGKILL.
export async function encerrarPaineis(paineis, { esperaMs = 3000, log = () => {} } = {}) {
  for (const p of paineis) {
    try {
      process.kill(p.pid, 'SIGTERM');
    } catch (erro) {
      if (erro.code !== 'ESRCH') throw erro;
    }
  }
  const limite = Date.now() + esperaMs;
  while (Date.now() < limite && paineis.some((p) => vivo(p.pid))) await dormir(50);

  const resultado = [];
  for (const p of paineis) {
    if (!vivo(p.pid)) {
      resultado.push({ ...p, saida: 'limpa' });
      continue;
    }
    log(`O processo ${p.pid} não saiu em ${esperaMs} ms; forçando o encerramento.`);
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch (erro) {
      if (erro.code !== 'ESRCH') log(`Não consegui encerrar o processo ${p.pid}: ${erro.message}`);
    }
    await dormir(300);
    resultado.push({ ...p, saida: vivo(p.pid) ? 'falhou' : 'forcada' });
  }
  return resultado;
}

// ---------- linha de comando ----------

export function lerArgsParar(argv, env = process.env) {
  const opcoes = { porta: Number(env.PORT) || PORTA_PADRAO, todos: false, listar: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--todos') opcoes.todos = true;
    else if (arg === '--listar') opcoes.listar = true;
    else if (arg === '--porta') {
      if (i + 1 >= argv.length) throw new Error('A opção --porta precisa de um valor.');
      i += 1;
      opcoes.porta = Number(argv[i]);
    } else throw new Error(`Opção desconhecida: ${arg}`);
  }
  if (!Number.isInteger(opcoes.porta) || opcoes.porta < 1 || opcoes.porta > 65535) throw new Error('Porta inválida.');
  return opcoes;
}

const descrever = (p) =>
  p.tipo === 'supervisor'
    ? `supervisor do modo dev (PID ${p.pid})`
    : `painel${p.portas.length ? ` na porta ${p.portas.join(', ')}` : ''} (PID ${p.pid})`;

// Devolve o código de saída do comando.
export async function executarParar({
  argv = [],
  env = process.env,
  raiz,
  plataforma = process.platform,
  executar = executarComando,
  eu = process.pid,
  esperaMs = 3000,
  log = console.log,
}) {
  let opcoes;
  try {
    opcoes = lerArgsParar(argv, env);
  } catch (erro) {
    log(`Erro: ${erro.message}`);
    log('Uso: npm run stop [-- --porta N | --todos | --listar]');
    return 2;
  }
  if (plataforma === 'win32') {
    log('O comando stop usa ps e lsof (macOS/Linux). No Windows, pare o painel com Ctrl+C no terminal onde ele roda.');
    return 1;
  }

  let achados;
  try {
    achados = await localizarPaineis({ raiz, porta: opcoes.porta, todos: opcoes.todos, executar, eu });
  } catch (erro) {
    if (erro.code === 'ENOENT') log(`Não encontrei o comando "${erro.path}", necessário para localizar o painel.`);
    else log(`Não consegui listar os processos: ${erro.message}`);
    return 1;
  }

  const { selecionados, outros } = achados;
  if (!selecionados.length) {
    log(opcoes.todos ? 'Nenhum painel deste projeto está rodando.' : `Nenhum painel deste projeto está rodando na porta ${opcoes.porta}.`);
    if (outros.length) {
      log(`Há outros processos do projeto: ${outros.map(descrever).join('; ')}.`);
      log('Use --porta N para escolher a porta ou --todos para parar todos.');
    }
    return 0;
  }

  if (opcoes.listar) {
    for (const p of selecionados) log(`Seria encerrado: ${descrever(p)}.`);
    if (outros.length) log(`Não seria tocado: ${outros.map(descrever).join('; ')}.`);
    return 0;
  }

  for (const p of selecionados) log(`Encerrando ${descrever(p)}…`);
  const resultado = await encerrarPaineis(selecionados, { esperaMs, log });
  for (const r of resultado) {
    log(r.saida === 'falhou' ? `Não consegui encerrar ${descrever(r)}.` : `Encerrado: ${descrever(r)}${r.saida === 'forcada' ? ' (à força)' : ''}.`);
  }
  if (outros.length) log(`Não foi tocado: ${outros.map(descrever).join('; ')}.`);
  return resultado.every((r) => r.saida !== 'falhou') ? 0 : 1;
}
