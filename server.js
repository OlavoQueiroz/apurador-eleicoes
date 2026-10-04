#!/usr/bin/env node
// Ponto de entrada: node server.js [--demo] [--turno 2] [--porta 3000] [--intervalo 60] [--sem-abrir]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerConfig, SAIDA_PORTA_OCUPADA } from './src/config.js';
import { criarFonteTse, descobrirEleicoes, montarAlvos } from './src/tse.js';
import { criarFonteDemo } from './src/demo.js';
import { Apuracao } from './src/apuracao.js';
import { criarServidor } from './src/servidor.js';
import { abrirNoNavegador } from './src/abrir.js';

const hora = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const log = (...partes) => console.log(`[${hora()}]`, ...partes);

let cfg;
try {
  cfg = lerConfig();
} catch (erro) {
  console.error(`Erro: ${erro.message}`);
  process.exit(2);
}

let eleicoes;
try {
  eleicoes = await descobrirEleicoes(cfg.ano);
} catch (erro) {
  console.error(`Não consegui ler o índice de eleições do TSE: ${erro.message}`);
  console.error('Verifique a conexão com a internet e tente de novo.');
  process.exit(1);
}

const alvos = montarAlvos({ ...eleicoes, turno: cfg.turno, cargos: cfg.cargos });
if (!alvos.length) {
  console.error(`Nenhum arquivo para acompanhar (ano ${cfg.ano}, turno ${cfg.turno}, cargos ${cfg.cargos.join(',')}).`);
  console.error('No 2º turno só existem presidente (1) e governador (3).');
  process.exit(1);
}

const fonteTse = criarFonteTse();
const fonte = cfg.demo ? criarFonteDemo(fonteTse, { duracaoMin: cfg.demoMinutos, semente: Math.floor(Math.random() * 2 ** 31) }) : fonteTse;
const apuracao = new Apuracao({ alvos, fonte, intervaloMs: cfg.intervalo * 1000 });

apuracao.on('ciclo', (c) => {
  log(
    `ciclo: ${c.total} arquivos · ${c.comDados} com dados · ${c.chavesAlteradas.length} alterados`
      + ` · ${c.indisponiveis} ainda indisponíveis · ${c.erros} erros`,
  );
});
apuracao.on('erro', (erro) => log('erro no ciclo:', erro.message));

const servidor = criarServidor({
  apuracao,
  meta: { ano: cfg.ano, turno: cfg.turno, demo: cfg.demo, intervalo: cfg.intervalo, cargos: cfg.cargos },
  diretorioPublico: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'public'),
});

servidor.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    console.error(`A porta ${cfg.porta} já está em uso. Se for o próprio painel rodando em outro terminal, pare-o com: npm run stop`);
    console.error(`Ou use outra porta: node server.js --porta ${cfg.porta + 1}`);
    process.exit(SAIDA_PORTA_OCUPADA);
  }
  console.error(erro);
  process.exit(1);
});

servidor.listen(cfg.porta, cfg.host, () => {
  const url = `http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.porta}`;
  log(`Painel em ${url}`);
  log(`${cfg.ano} · ${cfg.turno}º turno · ${alvos.length} arquivos · consulta a cada ${cfg.intervalo}s`);
  if (cfg.demo) log('MODO DEMONSTRAÇÃO: os votos são fictícios (simulação de ~' + cfg.demoMinutos + ' min).');
  const primeiroCiclo = apuracao.iniciar();

  if (cfg.abrir) {
    // Só abre depois que o servidor está de pé (se a porta estivesse ocupada, ele já teria saído
    // acima) e espera o primeiro ciclo, no máximo 8 s, para a página já abrir com dados.
    const limite = new Promise((resolve) => setTimeout(resolve, 8000).unref());
    Promise.race([primeiroCiclo, limite]).then(() => abrirNoNavegador(url, { navegador: cfg.navegador, log }));
  }
});

const encerrar = () => {
  log('Encerrando…');
  apuracao.parar();
  servidor.close();
  process.exit(0);
};
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
