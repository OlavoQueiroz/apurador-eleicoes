import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { iniciarSupervisor } from '../src/supervisor.js';

const esperarAte = async (condicao, ms = 10_000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('tempo esgotado esperando a condição');
};
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const estaVivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Projeto falso: o "servidor" registra pid e argumentos a cada início e, ou fica vivo (saindo
// limpo no SIGTERM), ou sai sozinho com o código pedido.
function criarProjetoFalso({ saiComCodigo = null } = {}) {
  const raiz = realpathSync(mkdtempSync(path.join(tmpdir(), 'apurador-sup-')));
  mkdirSync(path.join(raiz, 'src'));
  writeFileSync(path.join(raiz, 'src', 'a.js'), '// v1\n');
  const registro = path.join(raiz, 'inicios.log');
  const corpo = saiComCodigo === null
    ? 'setInterval(() => {}, 1000); process.on("SIGTERM", () => process.exit(0));'
    : `setTimeout(() => process.exit(${saiComCodigo}), 50);`;
  writeFileSync(
    path.join(raiz, 'server.js'),
    `require('node:fs').appendFileSync(${JSON.stringify(registro)}, JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }) + '\\n');\n${corpo}\n`,
  );
  const inicios = () => (existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { raiz, inicios, limpar: () => rmSync(raiz, { recursive: true, force: true }) };
}

test('reinicia quando o código muda e só deixa abrir o navegador na primeira vez', async () => {
  const { raiz, inicios, limpar } = criarProjetoFalso();
  const mensagens = [];
  const supervisor = iniciarSupervisor({ raiz, args: ['--demo'], atrasoMs: 40, log: (m) => mensagens.push(m) });
  try {
    await esperarAte(() => inicios().length >= 1);
    assert.deepEqual(inicios()[0].args, ['--demo'], 'primeira vez: sem --sem-abrir, o navegador pode abrir');
    await pausa(700); // deixa o observador de arquivos assentar antes de medir

    // Alterar um arquivo de src/ reinicia o servidor...
    const antes = inicios().length;
    const pidAntigo = inicios().at(-1).pid;
    writeFileSync(path.join(raiz, 'src', 'a.js'), '// v2\n');
    await esperarAte(() => inicios().length > antes);
    const reinicio = inicios().at(-1);
    assert.deepEqual(reinicio.args, ['--demo', '--sem-abrir'], 'reinício não reabre o navegador');
    assert.notEqual(reinicio.pid, pidAntigo);
    await esperarAte(() => !estaVivo(pidAntigo)); // o processo antigo foi encerrado
    assert.ok(mensagens.some((m) => /mudou; reiniciando/.test(m)));

    // ...mas arquivo que não é código não reinicia.
    const contagem = inicios().length;
    writeFileSync(path.join(raiz, 'src', 'notas.txt'), 'não é código');
    await pausa(500);
    assert.equal(inicios().length, contagem);

    // Alterar o server.js também reinicia.
    writeFileSync(path.join(raiz, 'server.js'), `${readFileSync(path.join(raiz, 'server.js'), 'utf8')}// alterado\n`);
    await esperarAte(() => inicios().length > contagem);
    assert.deepEqual(inicios().at(-1).args, ['--demo', '--sem-abrir'], '--sem-abrir não é repetido');
  } finally {
    const pidFinal = supervisor.pid();
    await supervisor.parar();
    if (pidFinal) await esperarAte(() => !estaVivo(pidFinal));
    limpar();
  }
});

test('parar() encerra o servidor filho e devolve só quando ele saiu', async () => {
  const { raiz, inicios, limpar } = criarProjetoFalso();
  const supervisor = iniciarSupervisor({ raiz, atrasoMs: 40 });
  try {
    await esperarAte(() => supervisor.pid() !== null && inicios().length >= 1);
    const pid = supervisor.pid();
    assert.ok(estaVivo(pid));
    await supervisor.parar();
    assert.equal(estaVivo(pid), false);
    assert.equal(supervisor.pid(), null);
  } finally {
    limpar();
  }
});

test('saída limpa do servidor (Ctrl+C, `npm run stop`) encerra o supervisor também', async () => {
  const { raiz, limpar } = criarProjetoFalso({ saiComCodigo: 0 });
  let codigo = null;
  const supervisor = iniciarSupervisor({ raiz, atrasoMs: 40, aoTerminar: (c) => { codigo = c; } });
  try {
    await esperarAte(() => codigo !== null);
    assert.equal(codigo, 0);
  } finally {
    await supervisor.parar();
    limpar();
  }
});

test('porta ocupada: o supervisor desiste em vez de esperar uma alteração que não ajudaria', async () => {
  const { raiz, limpar } = criarProjetoFalso({ saiComCodigo: 98 });
  const mensagens = [];
  let codigo = null;
  const supervisor = iniciarSupervisor({ raiz, atrasoMs: 40, log: (m) => mensagens.push(m), aoTerminar: (c) => { codigo = c; } });
  try {
    await esperarAte(() => codigo !== null);
    assert.equal(codigo, 1);
    assert.ok(mensagens.some((m) => /porta está ocupada/.test(m) && /npm run stop/.test(m)));
  } finally {
    await supervisor.parar();
    limpar();
  }
});

test('queda do servidor: o supervisor continua e tenta de novo quando o código muda', async () => {
  const { raiz, inicios, limpar } = criarProjetoFalso({ saiComCodigo: 3 });
  const mensagens = [];
  let terminou = false;
  const supervisor = iniciarSupervisor({ raiz, atrasoMs: 40, log: (m) => mensagens.push(m), aoTerminar: () => { terminou = true; } });
  try {
    await esperarAte(() => mensagens.some((m) => /o servidor saiu \(código 3\)/.test(m)));
    await pausa(700);
    const antes = inicios().length;
    assert.equal(terminou, false, 'queda com erro não encerra o supervisor');
    writeFileSync(path.join(raiz, 'src', 'a.js'), '// corrigido\n');
    await esperarAte(() => inicios().length > antes);
    assert.deepEqual(inicios().at(-1).args, ['--sem-abrir']);
  } finally {
    await supervisor.parar();
    limpar();
  }
});

test('pasta observada que não existe é ignorada', async () => {
  const { raiz, inicios, limpar } = criarProjetoFalso();
  const supervisor = iniciarSupervisor({ raiz, observar: ['nao-existe', 'src'], atrasoMs: 40 });
  try {
    await esperarAte(() => inicios().length >= 1);
  } finally {
    const pid = supervisor.pid();
    await supervisor.parar();
    if (pid) await esperarAte(() => !estaVivo(pid));
    limpar();
  }
});
