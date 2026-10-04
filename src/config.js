// Opções de linha de comando e variáveis de ambiente.
//   node server.js [--demo [--demo-minutos 8]] [--turno 2] [--porta 3000] [--intervalo 60] [--cargos 1,3,5,6,7]
//                  [--sem-abrir] [--navegador Safari] [--verboso]
// Equivalentes por ambiente: DEMO=1 TURNO PORT HOST INTERVALO CARGOS ANO DEMO_MINUTOS ABRIR NAVEGADOR

import { CARGOS, CARGOS_PADRAO } from './tse.js';

// O TSE entrega os arquivos por CDN com max-age de ~1 min; consultar mais rápido que isso
// só gera tráfego inútil. Na demonstração não há rede envolvida, então vale um ciclo curto.
export const INTERVALO_MINIMO_REAL = 30;

// Compartilhados com `npm run dev` (supervisor) e `npm run stop`.
export const PORTA_PADRAO = 3000;
// Código de saída do servidor quando a porta já está em uso: nesse caso o supervisor do `dev`
// desiste em vez de esperar uma alteração de arquivo que não resolveria nada.
export const SAIDA_PORTA_OCUPADA = 98;

// `ambiente` existe para os testes poderem simular outra plataforma ou um terminal não interativo.
export function lerConfig(
  argv = process.argv.slice(2),
  env = process.env,
  ambiente = { plataforma: process.platform, interativo: Boolean(process.stdout.isTTY) },
) {
  const cfg = {
    porta: Number(env.PORT) || PORTA_PADRAO,
    host: env.HOST || '127.0.0.1',
    ano: Number(env.ANO) || 2026,
    turno: Number(env.TURNO) || 1,
    intervalo: env.INTERVALO ? Number(env.INTERVALO) : null,
    cargos: env.CARGOS ?? null,
    demo: env.DEMO === '1',
    demoMinutos: Number(env.DEMO_MINUTOS) || 8,
    // Baixa em segundo plano os municípios da presidência para a projeção do Brasil (~5,7 mil arquivos, devagar).
    municipios: env.MUNICIPIOS !== '0',
    // Só municípios com pelo menos este nº de eleitores (mais o maior de cada UF) são baixados; o resto da UF vem
    // do arquivo da UF. null = baixar todos.
    municipiosMinimo: env.MUNICIPIOS_MINIMO ? Number(env.MUNICIPIOS_MINIMO) : 30_000,
    verboso: env.VERBOSO === '1', // loga todo ciclo de consultas, mesmo sem novidade
    // Abre o navegador ao iniciar. Por padrão só num terminal interativo: execuções automatizadas
    // (testes, servidores de preview, scripts) não devem fazer janelas aparecerem sozinhas.
    abrir: env.ABRIR === '1' ? true : env.ABRIR === '0' ? false : ambiente.interativo,
    // No macOS o padrão é o Safari; se não existir, cai para o navegador padrão.
    navegador: env.NAVEGADOR || (ambiente.plataforma === 'darwin' ? 'Safari' : null),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const valor = () => {
      if (i + 1 >= argv.length) throw new Error(`A opção ${arg} precisa de um valor.`);
      i += 1;
      return argv[i];
    };
    if (arg === '--demo') cfg.demo = true;
    else if (arg === '--porta') cfg.porta = Number(valor());
    else if (arg === '--host') cfg.host = valor();
    else if (arg === '--turno') cfg.turno = Number(valor());
    else if (arg === '--intervalo') cfg.intervalo = Number(valor());
    else if (arg === '--cargos') cfg.cargos = valor();
    else if (arg === '--ano') cfg.ano = Number(valor());
    else if (arg === '--verboso') cfg.verboso = true;
    else if (arg === '--sem-municipios') cfg.municipios = false;
    else if (arg === '--municipios-minimo') cfg.municipiosMinimo = Number(valor());
    else if (arg === '--municipios-todos') cfg.municipiosMinimo = null;
    else if (arg === '--demo-minutos') cfg.demoMinutos = Number(valor());
    else if (arg === '--abrir') cfg.abrir = true;
    else if (arg === '--sem-abrir') cfg.abrir = false;
    else if (arg === '--navegador') cfg.navegador = valor();
    else throw new Error(`Opção desconhecida: ${arg}`);
  }

  if (cfg.municipiosMinimo !== null && !(cfg.municipiosMinimo >= 0)) throw new Error('--municipios-minimo precisa ser um número.');
  if (![1, 2].includes(cfg.turno)) throw new Error('O turno deve ser 1 ou 2.');
  if (!Number.isInteger(cfg.porta) || cfg.porta < 1 || cfg.porta > 65535) throw new Error('Porta inválida.');

  cfg.cargos = cfg.cargos
    ? String(cfg.cargos).split(',').map((c) => Number(c.trim()))
    : [...CARGOS_PADRAO];
  const invalido = cfg.cargos.find((c) => !CARGOS[c]);
  if (invalido !== undefined) {
    throw new Error(`Cargo inválido: ${invalido}. Use códigos entre ${Object.keys(CARGOS).join(', ')}.`);
  }

  if (cfg.intervalo === null) cfg.intervalo = cfg.demo ? 3 : 60;
  if (!cfg.demo && cfg.intervalo < INTERVALO_MINIMO_REAL) {
    throw new Error(`Intervalo mínimo de ${INTERVALO_MINIMO_REAL}s para não sobrecarregar o servidor do TSE.`);
  }
  if (!(cfg.intervalo > 0)) throw new Error('Intervalo inválido.');
  if (!(cfg.demoMinutos > 0)) throw new Error('Duração da demonstração inválida.');

  return cfg;
}
