#!/usr/bin/env node
// Ponto de entrada: node server.js [--demo] [--turno 2] [--porta 3000] [--intervalo 60] [--sem-abrir]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerConfig, SAIDA_PORTA_OCUPADA } from './src/config.js';
import { CARGOS, criarFonteTse, criarFonteMunicipiosTse, descobrirEleicoes, montarAlvos } from './src/tse.js';
import { criarFonteDemo } from './src/demo.js';
import { Apuracao } from './src/apuracao.js';
import { Limitador } from './src/limitador.js';
import { Municipios } from './src/municipios.js';
import { criarCacheDisco } from './src/cache-disco.js';
import { Historico, registrarCiclo } from './src/historico.js';
import { carregarAnterior } from './src/anterior.js';
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
// Ritmo único para tudo que vai ao TSE: o dado por UF (ciclo principal) tem prioridade sobre os municípios, e um
// 429 de qualquer lado faz os dois recuarem. Na demonstração nada de município vai ao TSE.
const limitador = cfg.demo ? new Limitador({ altaMs: 0, baixaMs: 0 }) : new Limitador({ altaMs: 50, baixaMs: 200 });
const apuracao = new Apuracao({ alvos, fonte, intervaloMs: cfg.intervalo * 1000, limitador });
const fonteMunicipiosTse = criarFonteMunicipiosTse();
const raiz = path.dirname(fileURLToPath(import.meta.url));
const municipios = new Municipios({
  fonte: cfg.demo ? fonte.municipios(fonteMunicipiosTse) : fonteMunicipiosTse,
  ciclo: eleicoes.ciclo,
  // Só os municípios grandes têm arquivo baixado; o resto da UF sai do arquivo da UF. Na demonstração, todos (locais).
  minimoEleitores: cfg.demo ? null : cfg.municipiosMinimo,
  // Dado de demonstração é inventado e não deve ir para o cache. No real, o ciclo dos municípios é mais
  // lento que o das UFs: são milhares de arquivos.
  cache: cfg.demo ? null : criarCacheDisco(path.join(raiz, '.cache', 'municipios')),
  // Municípios: ~5 req/s e sempre atrás do dado por UF (5,7 mil arquivos levam uns 20 min na primeira vez).
  limitador,
  validadeMs: cfg.demo ? cfg.intervalo * 1000 : Math.max(cfg.intervalo, 120) * 1000,
});

// Resultado de 2022 por município, para o modelo de swing (opcional: sem os arquivos o modelo fica indisponível).
let prior2022 = null;
try {
  prior2022 = carregarAnterior(path.join(raiz, 'dados-historicos', 'presidente-2022-t1.json'), path.join(raiz, 'dados-historicos', 'mapeamento-presidente.json'));
  for (const aviso of prior2022.avisos) console.warn(`Mapeamento de 2022: ${aviso}`);
} catch (erro) {
  console.warn(`Swing histórico desligado: ${erro.message}`);
}

// Resultado de 2018 por UF, para o comparativo 2022 × 2018 e 2026 × 2018 (opcional: sem o arquivo o período fica indisponível).
let prior2018 = null;
try {
  prior2018 = carregarAnterior(path.join(raiz, 'dados-historicos', 'presidente-2018-t1.json'), path.join(raiz, 'dados-historicos', 'mapeamento-presidente-2018.json'));
  for (const aviso of prior2018.avisos) console.warn(`Mapeamento de 2018: ${aviso}`);
} catch (erro) {
  console.warn(`Comparativo com 2018 desligado: ${erro.message}`);
}

// Histórico da apuração (gráfico de evolução): um arquivo por ciclo/turno, em dados/ (fora do git). A
// demonstração grava num arquivo próprio e recomeça do zero a cada execução.
const historico = new Historico({
  arquivo: path.join(raiz, 'dados', 'historico', `${eleicoes.ciclo}-t${cfg.turno}${cfg.demo ? '-demo' : ''}.jsonl`),
  zerar: cfg.demo,
});
apuracao.on('ciclo', (c) => {
  registrarCiclo({ chaves: c.chavesAlteradas, apuracao, municipios, historico, anterior: prior2022 });
});

// Por padrão o terminal fica quieto: loga o primeiro ciclo e só avisa quando erros ou arquivos
// indisponíveis mudam (problema ou volta ao normal). Durante a apuração quase todo ciclo traz dados
// novos, então logar "alterados" seria só ruído. --verboso loga todo ciclo.
let anterior = null;
apuracao.on('ciclo', (c) => {
  const mudouEstado = !anterior || anterior.erros !== c.erros || anterior.indisponiveis !== c.indisponiveis;
  anterior = c;
  if (!cfg.verboso && !mudouEstado) return;
  log(
    `ciclo: ${c.total} arquivos · ${c.comDados} com dados · ${c.chavesAlteradas.length} alterados`
      + ` · ${c.indisponiveis} ainda indisponíveis · ${c.erros} erros`,
  );
});
apuracao.on('erro', (erro) => log('erro no ciclo:', erro.message));
// A cada minuto, uma linha com o volume de pedidos ao TSE, só se houver 429 ou com --verboso.
let limitadasAntes = 0;
setInterval(() => {
  const e = limitador.estatisticas();
  if (cfg.verboso || e.limitadas !== limitadasAntes) {
    log(`pedidos ao TSE: ${e.porMinuto}/min (UF ${e.alta}, município ${e.baixa}) · ${e.limitadas} limitados (429/503)`);
  }
  limitadasAntes = e.limitadas;
}, 60_000).unref();

const servidor = criarServidor({
  apuracao,
  municipios,
  historico,
  limitador,
  anterior: prior2022,
  historicos: prior2018 ? { 2018: prior2018 } : {},
  meta: { ano: cfg.ano, turno: cfg.turno, demo: cfg.demo, intervalo: cfg.intervalo, cargos: cfg.cargos },
  diretorioPublico: path.resolve(raiz, 'public'),
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
  // Município em segundo plano: começa só depois do primeiro ciclo das UFs, para não competir com ele.
  const eleicaoPresidente = eleicoes.eleicoes[CARGOS[1].pleito]?.[cfg.turno];
  if (cfg.municipios && cfg.cargos.includes(1) && eleicaoPresidente) {
    primeiroCiclo.then(() => municipios.manter({ eleicao: eleicaoPresidente, cargo: 1 }))
      .catch((erro) => log('erro ao carregar municípios:', erro.message));
    log('Carregando em segundo plano os municípios da presidência (use --sem-municipios para desligar).');
  }

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
  municipios.parar();
  // Deixa terminar a gravação em curso do histórico antes de sair.
  historico.esvaziar().finally(() => {
    servidor.close();
    process.exit(0);
  });
};
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
