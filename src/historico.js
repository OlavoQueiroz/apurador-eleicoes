// Histórico da apuração: a cada vez que o TSE publica um arquivo novo (presidente, governador e senador),
// acrescenta UMA linha JSON a um arquivo (JSONL, só acrescenta, sobrevive a reinício). Cada linha leva o % de
// cada candidato naquele instante e a projeção do resultado final calculada naquele instante: a projeção
// por município não dá para reconstruir depois, então só existe se for gravada na hora.
//
// Linha: { t, chave, cargo, uf, secoes:{total,totalizadas}, validos, candidatos:[{numero,nomeUrna,partido,votos,pct}],
//          proj:{ ingenuo:[{numero,pct}]|null, estratificado:[{numero,pct}]|null } }
// `t` é a hora de geração do arquivo do TSE, não a hora do painel. `null` = modelo indisponível naquele instante.

import { appendFile, existsSync, mkdirSync, readFileSync, writeFile } from 'node:fs';
import path from 'node:path';
import { projetarBrasil, projetarIngenuo, projetarUf, tamanhoUf } from './projecao.js';
import { projetarUfSwing } from './swing.js';

export const CARGOS_HISTORICO = [1, 3, 5];

export class Historico {
  // `zerar`: começa um arquivo novo (demonstração), em vez de continuar o anterior.
  constructor({ arquivo, zerar = false, aviso = console.warn }) {
    this.arquivo = arquivo;
    this.aviso = aviso;
    this.pontosPorChave = new Map();
    this.fila = Promise.resolve();
    mkdirSync(path.dirname(arquivo), { recursive: true });
    if (zerar || !existsSync(arquivo)) {
      this.fila = new Promise((resolve) => { writeFileFechando(arquivo, resolve); });
    } else {
      for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
        if (!linha.trim()) continue;
        try {
          this.#guardar(JSON.parse(linha));
        } catch {
          // linha cortada por uma parada no meio da gravação: ignora
        }
      }
    }
  }

  #guardar(ponto) {
    if (!this.pontosPorChave.has(ponto.chave)) this.pontosPorChave.set(ponto.chave, []);
    this.pontosPorChave.get(ponto.chave).push(ponto);
  }

  ultimoT(chave) {
    const lista = this.pontosPorChave.get(chave);
    return lista?.[lista.length - 1]?.t ?? null;
  }

  // Devolve false se o ponto já estava gravado (mesmo instante do arquivo do TSE).
  registrar(ponto) {
    if (this.ultimoT(ponto.chave) === ponto.t) return false;
    this.#guardar(ponto);
    const linha = `${JSON.stringify(ponto)}\n`;
    this.fila = this.fila.then(() => new Promise((resolve) => {
      appendFile(this.arquivo, linha, (erro) => {
        if (erro) this.aviso(`Histórico: falha ao gravar (${erro.message})`);
        resolve();
      });
    }));
    return true;
  }

  pontos(chave) {
    return this.pontosPorChave.get(chave) ?? [];
  }

  // Aguarda as gravações pendentes (testes e encerramento).
  async esvaziar() {
    await this.fila;
  }
}

function writeFileFechando(arquivo, resolve) {
  writeFile(arquivo, '', () => resolve());
}

const compacto = (lista) => lista.map((c) => ({ numero: c.numero, pct: Math.round(c.pctProjetado * 1000) / 1000 }));

// Candidatos que entram no histórico: todos com 1% ou mais, ou os 6 primeiros (o que for maior).
function escolherCandidatos(candidatos) {
  const topo = candidatos.filter((c, i) => i < 6 || c.pct >= 1);
  return topo;
}

// Calcula a projeção de cada modelo para o arquivo de `item` AGORA. Estratificado só com municípios já
// carregados (não dispara carga nenhuma); sem eles, grava null.
export async function projecoesDoMomento(item, municipios, apuracao, anterior = null) {
  const { cargo, uf, eleicao } = item.alvo;
  const ingenuo = projetarIngenuo(item.dados, { limite: 50 });
  let estratificado = null;
  let swing = null;
  if (municipios) {
    if (uf === 'br') {
      if (cargo === 1) {
        const ufs = [...(await municipios.listar(eleicao)).keys()];
        const fotos = ufs.map((u) => ({ uf: u, foto: municipios.espiar({ eleicao, cargo, uf: u }), ufDados: apuracao?.estado.get(`${cargo}:${u}`)?.dados ?? null }));
        if (fotos.some(({ foto }) => !foto.primeiraCarga)) {
          estratificado = projetarBrasil(fotos.map(({ uf: u, foto, ufDados }) => ({ uf: u, r: projetarUf({ foto, ufDados }), ...tamanhoUf({ foto, ufDados }) })), { limite: 50, anteriorPorUf: anterior?.porUf() ?? null });
          if (anterior) {
            swing = projetarBrasil(fotos.map(({ uf: u, foto, ufDados }) => ({ uf: u, r: projetarUfSwing({ foto, ufDados, anterior }), ...tamanhoUf({ foto, ufDados }) })), { limite: 50, modelo: 'swing', anteriorPorUf: anterior.porUf() });
          }
        }
      }
    } else {
      const foto = municipios.espiar({ eleicao, cargo, uf });
      if (!foto.primeiraCarga) {
        estratificado = projetarUf({ foto, ufDados: item.dados, limite: 50 });
        if (anterior && cargo === 1) swing = projetarUfSwing({ foto, ufDados: item.dados, anterior, limite: 50 });
      }
    }
  }
  return {
    ingenuo: ingenuo.disponivel ? compacto(ingenuo.candidatos) : null,
    estratificado: estratificado?.disponivel ? compacto(estratificado.candidatos) : null,
    swing: swing?.disponivel ? compacto(swing.candidatos) : null,
    // Como cada projeção foi calculada: permite saber depois se um pulo veio de uma troca de plano (ver planoDaProjecao).
    planos: { estratificado: planoDaProjecao(estratificado), swing: planoDaProjecao(swing) },
  };
}

// Plano usado numa projeção: 'normal', 'extrapolacao' (plano B: arquivos fora de sincronia, UF caiu na extrapolação simples)
// ou, no Brasil (soma das UFs), quantas UFs caíram no plano B e quantas entraram sem apuração. `null` se não houve projeção.
export function planoDaProjecao(r) {
  if (!r?.disponivel) return null;
  if (r.ufs) return { plano: r.ufs.planoB > 0 ? 'parcial' : 'normal', planoB: r.ufs.planoB ?? 0, semVotos: r.ufs.semVotos ?? 0, comVotos: r.ufs.comVotos ?? null };
  return { plano: r.plano === 'extrapolacao' ? 'extrapolacao' : 'normal', planoB: r.plano === 'extrapolacao' ? 1 : 0 };
}

// Grava um ponto para cada chave alterada que tenha votos apurados. Nunca lança: o histórico não pode derrubar o ciclo.
export async function registrarCiclo({ chaves, apuracao, municipios, historico, anterior = null }) {
  for (const chave of chaves) {
    try {
      const item = apuracao.estado.get(chave);
      const d = item?.dados;
      if (!d || !CARGOS_HISTORICO.includes(item.alvo.cargo) || !d.geradoEm || !(d.secoes.totalizadas > 0)) continue;
      if (historico.ultimoT(chave) === d.geradoEm) continue;
      const proj = await projecoesDoMomento(item, municipios, apuracao, anterior);
      historico.registrar({
        t: d.geradoEm,
        chave,
        cargo: item.alvo.cargo,
        uf: item.alvo.uf,
        secoes: { total: d.secoes.total, totalizadas: d.secoes.totalizadas },
        validos: d.votos.validos,
        candidatos: escolherCandidatos(d.candidatos).map((c) => ({
          numero: c.numero, nomeUrna: c.nomeUrna, partido: c.partido, votos: c.votos, pct: c.pct,
        })),
        proj,
      });
    } catch (erro) {
      console.warn(`Histórico: não gravei ${chave} (${erro.message})`);
    }
  }
}

// Formato de leitura para o gráfico.
export function lerSerie(historico, chave, modelo = 'ingenuo') {
  const pontos = historico.pontos(chave);
  if (!pontos.length) return null;
  return {
    pontos: pontos.map((p) => {
      const proj = new Map((p.proj?.[modelo] ?? []).map((x) => [x.numero, x.pct]));
      return {
        t: p.t,
        plano: p.proj?.planos?.[modelo] ?? null,
        secoes: { ...p.secoes, pct: p.secoes.total > 0 ? (100 * p.secoes.totalizadas) / p.secoes.total : 0 },
        candidatos: p.candidatos.map((c) => ({
          numero: c.numero, nomeUrna: c.nomeUrna, partido: c.partido, pct: c.pct, projPct: proj.get(c.numero) ?? null,
        })),
      };
    }).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)),
  };
}
