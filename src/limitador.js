// Ritmo de requisições ao TSE, compartilhado entre o ciclo principal (arquivos por UF, prioridade ALTA) e a
// carga dos municípios (prioridade BAIXA). Regras:
//  • o dado por UF sempre passa na frente: enquanto houver requisição de UF esperando, a de município espera;
//  • cada prioridade tem o seu espaçamento mínimo entre inícios de requisição;
//  • um 429/503 de qualquer lado faz os DOIS recuarem (pausa compartilhada) e deixa o ritmo mais lento;
//  • contadores para acompanhar a carga durante a apuração.

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

export class Limitador {
  constructor({ altaMs = 50, baixaMs = 200, agora = Date.now } = {}) {
    this.altaMs = altaMs;
    this.baixaMs = baixaMs;
    this.agora = agora;
    this.proximaAlta = 0;
    this.proximaBaixa = 0;
    this.pausaAte = 0;
    this.altasEsperando = 0;
    this.contagem = { alta: 0, baixa: 0, limitadas: 0 };
    this.janela = []; // instantes dos últimos pedidos, para "requisições por minuto"
  }

  // Espera a vez e devolve quando pode disparar a requisição.
  async vez(prioridade) {
    if (prioridade === 'alta') {
      this.altasEsperando += 1;
      try {
        const horario = Math.max(this.agora(), this.proximaAlta, this.pausaAte);
        this.proximaAlta = horario + this.altaMs;
        await this.#ate(horario);
      } finally {
        this.altasEsperando -= 1;
      }
    } else {
      // Município só sai quando não há UF esperando; reserva o horário depois de passar essa porta.
      while (this.altasEsperando > 0) await dormir(20);
      const horario = Math.max(this.agora(), this.proximaBaixa, this.pausaAte);
      this.proximaBaixa = horario + this.baixaMs;
      await this.#ate(horario);
      while (this.altasEsperando > 0) await dormir(20); // uma UF chegou enquanto esperava
    }
    this.contagem[prioridade === 'alta' ? 'alta' : 'baixa'] += 1;
    const t = this.agora();
    this.janela.push(t);
    while (this.janela.length && t - this.janela[0] > 60_000) this.janela.shift();
  }

  async #ate(horario) {
    const espera = horario - this.agora();
    if (espera > 0) await dormir(espera);
  }

  // Chamado quando o TSE responde 429/503: pausa tudo e desacelera, mais o município que a UF.
  recuar(ms) {
    this.contagem.limitadas += 1;
    this.pausaAte = Math.max(this.pausaAte, this.agora() + ms);
    this.altaMs = Math.min(1000, Math.ceil(this.altaMs * 1.5));
    this.baixaMs = Math.min(2000, Math.ceil(this.baixaMs * 2));
  }

  porMinuto() {
    const t = this.agora();
    return this.janela.filter((x) => t - x <= 60_000).length;
  }

  estatisticas() {
    return { ...this.contagem, porMinuto: this.porMinuto(), altaMs: this.altaMs, baixaMs: this.baixaMs };
  }
}

// Ao falhar com 429/503, quanto esperar: o que o TSE pediu, ou um recuo que cresce a cada tentativa.
export const recuoDoErro = (erro, tentativa) => erro.esperarMs ?? Math.min(30_000, 2000 * 2 ** tentativa);
export const pedeCalma = (erro) => erro?.status === 429 || erro?.status === 503;
