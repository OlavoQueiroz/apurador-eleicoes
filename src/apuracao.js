// Motor de acompanhamento: a cada ciclo consulta todos os arquivos (cargo × abrangência) numa
// fonte (TSE de verdade ou simulação), guarda o último dado de cada um e avisa o que mudou.

import { EventEmitter } from 'node:events';
import { resumir } from './normalize.js';
import { pedeCalma, recuoDoErro } from './limitador.js';

export class Apuracao extends EventEmitter {
  constructor({ alvos, fonte, intervaloMs = 60_000, concorrencia = 6, limitador = null, agora = Date.now }) {
    super();
    this.limitador = limitador; // ritmo compartilhado com a carga dos municípios; o dado por UF tem prioridade
    this.fonte = fonte;
    this.intervaloMs = intervaloMs;
    this.concorrencia = concorrencia;
    this.agora = agora;
    this.parado = false;
    this.timer = null;
    this.ultimoCiclo = null;
    this.estado = new Map(
      alvos.map((alvo) => [
        alvo.chave,
        { alvo, status: 'aguardando', etag: null, dados: null, resumo: null, verificadoEm: null, alteradoEm: null, erro: null },
      ]),
    );
  }

  // Devolve true se o dado do alvo mudou.
  async verificar(item) {
    let r;
    try {
      await this.limitador?.vez('alta');
      r = await this.fonte.obter(item.alvo, item);
    } catch (erro) {
      if (pedeCalma(erro)) this.limitador?.recuar(recuoDoErro(erro, 0)); // vale também para a carga dos municípios
      throw erro;
    }
    item.verificadoEm = this.agora();
    item.erro = null;

    if (r.status === 'inalterado') {
      item.status = 'ok';
      return false;
    }

    if (r.status === 'indisponivel') {
      // Sem dado nenhum ainda: é o estado normal antes da apuração (ou UF sem esse cargo).
      if (!item.dados) {
        const mudou = item.status !== 'indisponivel';
        item.status = 'indisponivel';
        return mudou;
      }
      // Já tínhamos dado e o arquivo sumiu: mantém o último e sinaliza o problema.
      item.status = 'erro';
      item.erro = 'o arquivo deixou de estar disponível no TSE; exibindo o último dado recebido';
      return true;
    }

    const mudou = !item.dados || item.dados.geracao !== r.dados.geracao || item.etag !== (r.etag ?? null);
    item.dados = r.dados;
    item.resumo = resumir(r.dados);
    item.etag = r.etag ?? null;
    item.status = 'ok';
    if (mudou) item.alteradoEm = item.verificadoEm;
    return mudou;
  }

  async ciclo() {
    const iniciadoEm = this.agora();
    const fila = [...this.estado.values()];
    const chavesAlteradas = [];

    const trabalhador = async () => {
      while (fila.length) {
        const item = fila.shift();
        try {
          if (await this.verificar(item)) chavesAlteradas.push(item.alvo.chave);
        } catch (erro) {
          // Falha de rede/HTTP num arquivo não derruba o ciclo; o último dado continua valendo.
          item.status = 'erro';
          item.erro = erro.message;
          item.verificadoEm = this.agora();
          chavesAlteradas.push(item.alvo.chave);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concorrencia, fila.length) }, trabalhador));

    const itens = [...this.estado.values()];
    this.ultimoCiclo = {
      iniciadoEm,
      terminadoEm: this.agora(),
      total: itens.length,
      comDados: itens.filter((i) => i.dados).length,
      indisponiveis: itens.filter((i) => i.status === 'indisponivel').length,
      erros: itens.filter((i) => i.status === 'erro').length,
      chavesAlteradas,
    };
    this.emit('ciclo', this.ultimoCiclo);
    return this.ultimoCiclo;
  }

  // Roda um ciclo, espera o intervalo e repete (setTimeout em vez de setInterval para que um
  // ciclo lento nunca se sobreponha ao seguinte).
  iniciar() {
    const laco = async () => {
      if (this.parado) return;
      try {
        await this.ciclo();
      } catch (erro) {
        this.emit('erro', erro);
      } finally {
        if (!this.parado) this.timer = setTimeout(laco, this.intervaloMs);
      }
    };
    this.primeiroCiclo = laco();
    return this.primeiroCiclo;
  }

  parar() {
    this.parado = true;
    clearTimeout(this.timer);
  }
}
