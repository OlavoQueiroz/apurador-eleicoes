// Ritmo de requisições ao TSE, compartilhado entre o ciclo principal (arquivos por UF, prioridade ALTA) e a
// carga dos municípios (prioridade BAIXA). Regras:
//  • o dado por UF sempre passa na frente: enquanto houver requisição de UF esperando, a de município espera;
//  • cada prioridade tem o seu espaçamento mínimo entre inícios de requisição;
//  • um 429/503 de qualquer lado faz os DOIS recuarem (pausa compartilhada) e deixa o ritmo mais lento;
//  • contadores para acompanhar a carga durante a apuração.

// Sem unref: quem chama está ESPERANDO por esta pausa, então ela precisa manter o processo vivo (com unref, um
// processo sem mais nada pendente termina no meio da espera, o que derrubava os testes no CI).
const RECUPERA_APOS_MS = 60_000;
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Limitador {
  constructor({ altaMs = 50, baixaMs = 200, agora = Date.now } = {}) {
    this.altaMs = altaMs;
    this.baixaMs = baixaMs;
    this.altaBase = altaMs; // o ritmo configurado: a recuperação nunca passa dele
    this.baixaBase = baixaMs;
    this.ultimoRecuo = 0;
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
    this.#recuperar();
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
    this.ultimoRecuo = this.agora();
    this.pausaAte = Math.max(this.pausaAte, this.agora() + ms);
    this.altaMs = Math.min(1000, Math.ceil(this.altaMs * 1.5));
    this.baixaMs = Math.min(2000, Math.ceil(this.baixaMs * 2));
  }

  // Depois de um minuto sem nenhum 429/503, volta a acelerar aos poucos (-20% do intervalo por minuto) até o ritmo
  // configurado. Sem isso, uma rajada de 429 deixava o painel lento até alguém reiniciar o servidor.
  #recuperar() {
    const t = this.agora();
    if (t - this.ultimoRecuo < RECUPERA_APOS_MS) return;
    if (this.altaMs <= this.altaBase && this.baixaMs <= this.baixaBase) return;
    this.altaMs = Math.max(this.altaBase, Math.floor(this.altaMs * 0.8));
    this.baixaMs = Math.max(this.baixaBase, Math.floor(this.baixaMs * 0.8));
    this.ultimoRecuo = t; // o próximo passo só depois de mais um minuto calmo
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

// Roda `fn` e, se o TSE pedir calma (429/503), espera e tenta de novo, poucas vezes. Para pedidos únicos que não passam
// pelo ritmo do limitador, como o índice de eleições na partida: um 429 ali encerrava o painel.
export async function comRecuo(fn, { tentativas = 6, aviso = () => {}, dormirMs = dormir } = {}) {
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      return await fn();
    } catch (erro) {
      if (!pedeCalma(erro) || tentativa >= tentativas) throw erro;
      const espera = recuoDoErro(erro, tentativa);
      aviso(`o TSE pediu calma (HTTP ${erro.status}); nova tentativa em ${Math.round(espera / 1000)} s…`);
      await dormirMs(espera);
    }
  }
}
