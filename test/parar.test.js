import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  encerrarPaineis, executarParar, interpretarLsof, interpretarPs, lerArgsParar, localizarPaineis, portaDe, tipoDoProcesso,
} from '../src/parar.js';

const SUPERVISOR_REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/supervisor.js');
const temLsof = spawnSync('lsof', ['-v']).error?.code !== 'ENOENT';

const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const esperarAte = async (condicao, ms = 10_000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await pausa(25);
  }
  throw new Error('tempo esgotado esperando a condição');
};
const estaVivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const dirTemporario = () => realpathSync(mkdtempSync(path.join(tmpdir(), 'apurador-stop-')));

// ---------- interpretação de ps e lsof ----------

test('interpretarPs lê pid, ppid e o comando completo (com espaços)', () => {
  const saida = [
    ' 2856  2828 /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=utility',
    '21593 21592 /usr/local/bin/node server.js --demo --porta 3100',
    '20829 19667 node server.js',
    '',
  ].join('\n');
  assert.deepEqual(interpretarPs(saida), [
    { pid: 2856, ppid: 2828, comando: '/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=utility' },
    { pid: 21593, ppid: 21592, comando: '/usr/local/bin/node server.js --demo --porta 3100' },
    { pid: 20829, ppid: 19667, comando: 'node server.js' },
  ]);
});

test('interpretarLsof agrupa as linhas "n" sob o processo "p" a que pertencem', () => {
  const cwd = interpretarLsof('p20829\nfcwd\nn/Users/olavoqueiroz/Projects/apurador-eleicoes\np21593\nfcwd\nn/tmp/outro\n');
  assert.deepEqual([...cwd], [[20829, ['/Users/olavoqueiroz/Projects/apurador-eleicoes']], [21593, ['/tmp/outro']]]);

  const portas = interpretarLsof('p1\nf19\nn127.0.0.1:3000\nf20\nn*:3001\np2\nf5\nn[::1]:4000\n');
  assert.deepEqual(portas.get(1).map(portaDe), [3000, 3001]);
  assert.deepEqual(portas.get(2).map(portaDe), [4000]);
  assert.equal(portaDe('abc'), null);
  assert.deepEqual([...interpretarLsof('')], []);
});

// ---------- reconhecimento: o que é "do painel" ----------

test('tipoDoProcesso só reconhece node rodando o server.js ou o dev.js DESTE projeto', () => {
  const casos = [
    ['node server.js', '/proj', 'servidor'],
    ['/usr/local/bin/node server.js --demo --porta 3100', '/proj', 'servidor'],
    ['node ./server.js', '/proj', 'servidor'],
    ['node --watch server.js', '/proj', 'servidor'],
    ['node /proj/server.js --sem-abrir', '/', 'servidor'], // caminho absoluto, de qualquer pasta
    ['node /proj/server.js', '/', 'servidor'],
    ['node scripts/dev.js --porta 3001', '/proj', 'supervisor'],
    // não são nossos:
    ['node server.js', '/outro-projeto', null], // server.js de outro projeto
    ['node server.js', null, null], // sem pasta de trabalho conhecida
    ['node /proj/server.js.bak', '/', null], // nome parecido
    ['node /proj/meu-server.js', '/', null],
    ['node /proj/sub/server.js', '/', null], // outra pasta dentro do projeto
    ['node node_modules/.bin/vite', '/proj', null],
    ['node scripts/stop.js', '/proj', null], // o próprio stop não é alvo
    ['/Applications/Claude.app/Contents/Helpers/disclaimer -- /usr/local/bin/node server.js', '/proj', null], // wrapper do app
    ['python server.js', '/proj', null],
  ];
  for (const [comando, cwd, esperado] of casos) {
    assert.equal(tipoDoProcesso(comando, cwd, '/proj'), esperado, `${comando} @ ${cwd}`);
  }
});

// Cenário simulado: ps e lsof "falsos" descrevendo vários processos.
function sistemaFalso(raiz) {
  const processos = [
    { pid: 100, ppid: 1, cmd: 'node server.js', cwd: raiz, portas: [3000] }, // o painel padrão
    { pid: 200, ppid: 1, cmd: 'node server.js', cwd: '/outro/projeto', portas: [3001] }, // outro projeto
    { pid: 299, ppid: 1, cmd: '/Applications/Claude.app/Contents/Helpers/disclaimer -- /usr/local/bin/node server.js --porta 3100', cwd: raiz, portas: [] },
    { pid: 300, ppid: 299, cmd: '/usr/local/bin/node server.js --demo --porta 3100', cwd: raiz, portas: [3100] }, // preview de outra sessão
    { pid: 400, ppid: 1, cmd: 'node scripts/dev.js --porta 3200', cwd: raiz, portas: [] }, // supervisor do dev
    { pid: 401, ppid: 400, cmd: `/usr/local/bin/node ${raiz}/server.js --porta 3200`, cwd: raiz, portas: [3200] }, // e seu servidor
    { pid: 500, ppid: 1, cmd: 'node scripts/dev.js --porta 3300', cwd: raiz, portas: [] }, // supervisor cujo servidor caiu
    { pid: 800, ppid: 1, cmd: 'node scripts/dev.js', cwd: raiz, portas: [] }, // idem, sem --porta (vale a padrão)
    { pid: 600, ppid: 1, cmd: 'node node_modules/.bin/vite', cwd: raiz, portas: [5173] }, // node qualquer
    { pid: 700, ppid: 1, cmd: 'node outro.js', cwd: null, portas: [] },
  ];
  const chamadas = [];
  const executar = async (cmd, args) => {
    chamadas.push([cmd, ...args]);
    if (cmd === 'ps') return processos.map((p) => `${p.pid} ${p.ppid} ${p.cmd}`).join('\n');
    const pids = new Set(args[args.indexOf('-p') + 1].split(',').map(Number));
    const consulta = processos.filter((p) => pids.has(p.pid));
    if (args.includes('cwd')) return consulta.filter((p) => p.cwd).map((p) => `p${p.pid}\nfcwd\nn${p.cwd}`).join('\n');
    return consulta.filter((p) => p.portas.length).map((p) => `p${p.pid}\n${p.portas.map((x) => `f9\nn127.0.0.1:${x}`).join('\n')}`).join('\n');
  };
  return { executar, chamadas };
}
const pids = (lista) => lista.map((p) => p.pid).sort((a, b) => a - b);

test('localizarPaineis: por padrão só a porta pedida; o resto é informado e não tocado', async () => {
  const raiz = dirTemporario();
  try {
    const { executar, chamadas } = sistemaFalso(raiz);
    const { selecionados, outros } = await localizarPaineis({ raiz, porta: 3000, executar, eu: 1 });
    // 100 é o painel da porta 3000; 800 é um supervisor sem --porta cujo servidor caiu (vale a porta padrão).
    assert.deepEqual(pids(selecionados), [100, 800]);
    assert.deepEqual(pids(outros), [300, 400, 401, 500]);
    // O server.js de outro projeto (200), o vite (600), o wrapper (299) e o desconhecido (700) nunca aparecem.
    for (const p of [...selecionados, ...outros]) assert.ok(![200, 299, 600, 700].includes(p.pid));
    // lsof só foi consultado para processos node (não para todos os processos da máquina).
    const consultados = chamadas.filter((c) => c[0] === 'lsof').flatMap((c) => c[c.indexOf('-p') + 1].split(','));
    assert.ok(!consultados.includes('299'));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('localizarPaineis: --porta escolhe o servidor e leva o supervisor junto', async () => {
  const raiz = dirTemporario();
  try {
    const { executar } = sistemaFalso(raiz);
    assert.deepEqual(pids((await localizarPaineis({ raiz, porta: 3100, executar, eu: 1 })).selecionados), [300]);
    assert.deepEqual(pids((await localizarPaineis({ raiz, porta: 3200, executar, eu: 1 })).selecionados), [400, 401]);
    // Supervisor sem servidor vivo: vale a porta dos argumentos...
    assert.deepEqual(pids((await localizarPaineis({ raiz, porta: 3300, executar, eu: 1 })).selecionados), [500]);
    // ...ou a padrão, quando não há --porta (é o caso do 800).
    assert.deepEqual(pids((await localizarPaineis({ raiz, porta: 3000, executar, eu: 1 })).selecionados), [100, 800]);
    const semServidor = await localizarPaineis({ raiz, porta: 3999, executar, eu: 1 });
    assert.deepEqual(semServidor.selecionados, []);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('localizarPaineis: o supervisor sem --porta e sem servidor vivo conta para a porta padrão', async () => {
  const raiz = dirTemporario();
  try {
    const { executar } = sistemaFalso(raiz);
    // Porta padrão do cenário é 3000 (painel 100); o supervisor 800 não tem --porta e seu servidor caiu.
    const { selecionados } = await localizarPaineis({ raiz, executar, eu: 1 });
    assert.deepEqual(pids(selecionados), [100, 800]);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('localizarPaineis: --todos pega tudo do projeto, mas nunca processos de fora', async () => {
  const raiz = dirTemporario();
  try {
    const { executar } = sistemaFalso(raiz);
    const { selecionados, outros } = await localizarPaineis({ raiz, todos: true, executar, eu: 1 });
    assert.deepEqual(pids(selecionados), [100, 300, 400, 401, 500, 800]);
    assert.deepEqual(outros, []);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('localizarPaineis: sem nenhum node no sistema, devolve vazio sem consultar o lsof', async () => {
  const raiz = dirTemporario();
  try {
    const chamadas = [];
    const executar = async (cmd, args) => {
      chamadas.push(cmd);
      return cmd === 'ps' ? '1 0 /sbin/launchd\n' : '';
    };
    assert.deepEqual(await localizarPaineis({ raiz, executar, eu: 1 }), { selecionados: [], outros: [] });
    assert.deepEqual(chamadas, ['ps']);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

// ---------- linha de comando ----------

test('lerArgsParar: padrões, opções e erros', () => {
  assert.deepEqual(lerArgsParar([], {}), { porta: 3000, todos: false, listar: false });
  assert.equal(lerArgsParar([], { PORT: '4000' }).porta, 4000);
  assert.deepEqual(lerArgsParar(['--porta', '3001', '--todos', '--listar'], {}), { porta: 3001, todos: true, listar: true });
  assert.throws(() => lerArgsParar(['--porta'], {}), /precisa de um valor/);
  assert.throws(() => lerArgsParar(['--porta', 'abc'], {}), /Porta inválida/);
  assert.throws(() => lerArgsParar(['--porta', '70000'], {}), /Porta inválida/);
  assert.throws(() => lerArgsParar(['--matar-tudo'], {}), /desconhecida/);
});

test('executarParar --listar mostra o que seria encerrado sem encerrar nada', async () => {
  const raiz = dirTemporario();
  try {
    const { executar } = sistemaFalso(raiz);
    const linhas = [];
    const codigo = await executarParar({ argv: ['--listar'], raiz, executar, eu: 1, log: (m) => linhas.push(m) });
    assert.equal(codigo, 0);
    assert.match(linhas.join('\n'), /Seria encerrado: painel na porta 3000 \(PID 100\)/);
    assert.match(linhas.join('\n'), /Não seria tocado:.*porta 3100/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('executarParar sem nada na porta avisa que existem outros painéis e não toca neles', async () => {
  const raiz = dirTemporario();
  try {
    const { executar } = sistemaFalso(raiz);
    const linhas = [];
    const codigo = await executarParar({ argv: ['--porta', '3999'], raiz, executar, eu: 1, log: (m) => linhas.push(m) });
    assert.equal(codigo, 0);
    const texto = linhas.join('\n');
    assert.match(texto, /Nenhum painel deste projeto está rodando na porta 3999/);
    assert.match(texto, /Há outros processos do projeto/);
    assert.match(texto, /--todos/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('executarParar: argumentos inválidos, Windows e ferramenta ausente', async () => {
  const log = () => {};
  assert.equal(await executarParar({ argv: ['--foo'], raiz: '/', log }), 2);
  const linhas = [];
  assert.equal(await executarParar({ argv: [], raiz: '/', plataforma: 'win32', log: (m) => linhas.push(m) }), 1);
  assert.match(linhas[0], /Ctrl\+C/);

  const raiz = dirTemporario();
  try {
    const semFerramenta = async () => {
      throw Object.assign(new Error('spawn ps ENOENT'), { code: 'ENOENT', path: 'ps' });
    };
    const saida = [];
    assert.equal(await executarParar({ argv: [], raiz, executar: semFerramenta, log: (m) => saida.push(m) }), 1);
    assert.match(saida[0], /Não encontrei o comando "ps"/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

// ---------- com processos de verdade ----------

const SERVIDOR_CJS = `
const net = require('node:net');
const s = net.createServer().listen(0, '127.0.0.1', () => console.log('PORTA ' + s.address().port));
process.on('SIGTERM', () => process.exit(0));
`;

function subirServidor(cwd, { script = SERVIDOR_CJS, nomeArquivo = 'server.js', args = [] } = {}) {
  writeFileSync(path.join(cwd, nomeArquivo), script);
  const processo = spawn(process.execPath, [nomeArquivo, ...args], { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  const porta = new Promise((resolve) => {
    let texto = '';
    processo.stdout.on('data', (d) => {
      texto += d;
      const m = /PORTA (\d+)/.exec(texto);
      if (m) resolve(Number(m[1]));
    });
  });
  return { processo, porta };
}

test('com processos reais: encerra só o painel deste projeto e poupa o de outro projeto', { skip: !temLsof && 'lsof indisponível' }, async () => {
  const raizA = dirTemporario();
  const raizB = dirTemporario();
  const a = subirServidor(raizA);
  const b = subirServidor(raizB); // mesmo nome de arquivo, outro projeto
  try {
    const [portaA, portaB] = await Promise.all([a.porta, b.porta]);

    const { selecionados, outros } = await localizarPaineis({ raiz: raizA, porta: portaA });
    assert.deepEqual(selecionados.map((p) => p.pid), [a.processo.pid]);
    assert.deepEqual(selecionados[0].portas, [portaA]);
    assert.deepEqual(outros, []);

    // Mesmo pedindo a porta do outro projeto, o painel B não é reconhecido como nosso.
    assert.deepEqual((await localizarPaineis({ raiz: raizA, porta: portaB })).selecionados, []);

    const linhas = [];
    const codigo = await executarParar({ argv: ['--porta', String(portaA)], raiz: raizA, log: (m) => linhas.push(m) });
    assert.equal(codigo, 0);
    assert.match(linhas.join('\n'), new RegExp(`Encerrado: painel na porta ${portaA}`));
    await esperarAte(() => !estaVivo(a.processo.pid));
    assert.equal(estaVivo(b.processo.pid), true, 'o painel do outro projeto continua rodando');

    // Rodar de novo não acha nada, e isso não é erro.
    const de_novo = [];
    assert.equal(await executarParar({ argv: ['--porta', String(portaA)], raiz: raizA, log: (m) => de_novo.push(m) }), 0);
    assert.match(de_novo[0], /Nenhum painel/);
  } finally {
    a.processo.kill('SIGKILL');
    b.processo.kill('SIGKILL');
    rmSync(raizA, { recursive: true, force: true });
    rmSync(raizB, { recursive: true, force: true });
  }
});

test('com processos reais: encerra o supervisor do dev junto com o servidor', { skip: !temLsof && 'lsof indisponível' }, async () => {
  const raiz = dirTemporario();
  const estranhoRaiz = dirTemporario();
  writeFileSync(path.join(raiz, 'package.json'), '{"type":"module"}');
  mkdirSync(path.join(raiz, 'scripts'));
  // Servidor falso (ESM, porque o package.json acima declara type: module).
  writeFileSync(
    path.join(raiz, 'server.js'),
    `import net from 'node:net';
const s = net.createServer().listen(0, '127.0.0.1', () => console.log('PORTA ' + s.address().port));
process.on('SIGTERM', () => process.exit(0));
`,
  );
  // dev.js falso: usa o supervisor de verdade.
  writeFileSync(
    path.join(raiz, 'scripts', 'dev.js'),
    `import { iniciarSupervisor } from ${JSON.stringify(pathToFileURL(SUPERVISOR_REAL).href)};
const sup = iniciarSupervisor({ raiz: ${JSON.stringify(raiz)}, log: console.log, aoTerminar: (c) => process.exit(c) });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await sup.parar(s); process.exit(0); });
`,
  );
  const dev = spawn(process.execPath, ['scripts/dev.js'], { cwd: raiz, stdio: ['ignore', 'pipe', 'inherit'] });
  const saidaDev = new Promise((resolve) => dev.once('exit', (codigo) => resolve(codigo)));
  const porta = await new Promise((resolve) => {
    let texto = '';
    dev.stdout.on('data', (d) => {
      texto += d;
      const m = /PORTA (\d+)/.exec(texto);
      if (m) resolve(Number(m[1]));
    });
  });
  const estranho = subirServidor(estranhoRaiz);
  try {
    await estranho.porta;
    const { selecionados } = await localizarPaineis({ raiz, porta });
    assert.deepEqual(selecionados.map((p) => p.tipo).sort(), ['servidor', 'supervisor']);
    const servidorPid = selecionados.find((p) => p.tipo === 'servidor').pid;
    const supervisorPid = selecionados.find((p) => p.tipo === 'supervisor').pid;
    assert.equal(supervisorPid, dev.pid);

    const resultado = await encerrarPaineis(selecionados);
    assert.ok(resultado.every((r) => r.saida === 'limpa'), JSON.stringify(resultado));
    assert.equal(estaVivo(servidorPid), false);
    assert.equal(await saidaDev, 0, 'o supervisor saiu com código 0');
    assert.equal(estaVivo(estranho.processo.pid), true, 'processo estranho intacto');
  } finally {
    dev.kill('SIGKILL');
    estranho.processo.kill('SIGKILL');
    rmSync(raiz, { recursive: true, force: true });
    rmSync(estranhoRaiz, { recursive: true, force: true });
  }
});

test('encerrarPaineis força o encerramento de quem ignora o SIGTERM', async () => {
  const teimoso = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); console.log("pronto")'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const saiu = new Promise((resolve) => teimoso.once('exit', resolve));
  try {
    await new Promise((resolve) => teimoso.stdout.once('data', resolve));
    const mensagens = [];
    const [resultado] = await encerrarPaineis([{ pid: teimoso.pid, tipo: 'servidor', portas: [] }], { esperaMs: 300, log: (m) => mensagens.push(m) });
    assert.equal(resultado.saida, 'forcada');
    assert.match(mensagens[0], /forçando/);
    await saiu;
    assert.equal(estaVivo(teimoso.pid), false);
  } finally {
    teimoso.kill('SIGKILL');
  }
});

test('encerrarPaineis tolera um processo que já não existe', async () => {
  const efemero = spawn(process.execPath, ['-e', '0']);
  await new Promise((resolve) => efemero.once('exit', resolve));
  const [resultado] = await encerrarPaineis([{ pid: efemero.pid, tipo: 'servidor', portas: [] }], { esperaMs: 100 });
  assert.equal(resultado.saida, 'limpa');
});
