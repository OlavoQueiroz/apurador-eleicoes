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
const FOLGA_PRIORIDADE_MS = 20;

export class Limitador {
  // `jitter` (0–1): variação aleatória do espaçamento (±jitter), para os pedidos não saírem em fila regular.
  // `baixaMinMs`: ritmo adaptativo dos municípios. Depois de minutos sem 429, o intervalo pode descer abaixo do configurado
  // (`baixaMs`) até `baixaMinMs`, mas nunca abaixo de `baixaPiso`: o último intervalo que levou 429, mais 25% de folga.
  // `null` desliga (o intervalo nunca fica abaixo do configurado). `baixaPisoInicial` traz o piso aprendido em execuções anteriores.
  constructor({ altaMs = 50, baixaMs = 200, jitter = 0, baixaMinMs = null, baixaPisoInicial = 0, sondagemMinPedidos = 30, aleatorio = Math.random, aoEvento = null, agora = Date.now } = {}) {
    this.jitter = jitter;
    this.aleatorio = aleatorio;
    this.aoEvento = aoEvento; // chamado a cada 429/503 com o ritmo daquele momento (para o registro de métricas)
    this.baixaMinMs = baixaMinMs !== null && baixaMinMs < baixaMs ? baixaMinMs : null;
    this.baixaPiso = Math.max(this.baixaMinMs ?? 0, baixaPisoInicial);
    this.sondagemMinPedidos = sondagemMinPedidos; // só sonda um ritmo mais rápido se o município fez ao menos tantos pedidos desde a última sondagem
    this.baixaDesdeSondagem = 0;
    this.eventos = []; // últimos 429/503: { em, ultimos1s, ultimos10s, ultimos60s, ... }
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
    this.horariosAlta = [];
    this.contagem = { alta: 0, baixa: 0, limitadas: 0 };
    this.janela = []; // instantes dos últimos pedidos, para "requisições por minuto"
  }

  // Espera a vez e devolve quando pode disparar a requisição.
  async vez(prioridade) {
    this.#recuperar();
    if (prioridade === 'alta') {
      this.altasEsperando += 1;
      let horario;
      try {
        horario = Math.max(this.agora(), this.proximaAlta, this.pausaAte);
        this.horariosAlta.push(horario); // quando esta UF vai sair: o município só dá passagem a quem está para sair
        this.proximaAlta = horario + this.#espaco(this.altaMs);
        await this.#ate(horario);
      } finally {
        this.altasEsperando -= 1;
        this.horariosAlta.splice(this.horariosAlta.indexOf(horario), 1);
      }
    } else {
      // Município só sai quando não há UF para sair agora. Com os pedidos de UF espalhados pelo ciclo, "há UF esperando" seria
      // verdade quase o tempo todo e o município nunca andaria; por isso só conta a UF cujo horário está a menos de
      // `FOLGA_PRIORIDADE_MS`. Reserva o horário depois de passar essa porta.
      while (this.#ufParaSair()) await dormir(20);
      const horario = Math.max(this.agora(), this.proximaBaixa, this.pausaAte);
      this.proximaBaixa = horario + this.#espaco(this.baixaMs);
      await this.#ate(horario);
      while (this.#ufParaSair()) await dormir(20); // uma UF chegou enquanto esperava
    }
    this.contagem[prioridade === 'alta' ? 'alta' : 'baixa'] += 1;
    if (prioridade !== 'alta') this.baixaDesdeSondagem += 1;
    const t = this.agora();
    this.janela.push(t);
    while (this.janela.length && t - this.janela[0] > 60_000) this.janela.shift();
  }

  #ufParaSair() {
    const limite = this.agora() + FOLGA_PRIORIDADE_MS;
    return this.horariosAlta.some((h) => h <= limite);
  }

  #espaco(ms) {
    return this.jitter > 0 ? ms * (1 + this.jitter * (this.aleatorio() * 2 - 1)) : ms;
  }

  // Pedidos feitos nos últimos `ms` (até 60 s).
  pedidosNosUltimos(ms) {
    const t = this.agora();
    return this.janela.filter((x) => t - x <= ms).length;
  }

  async #ate(horario) {
    const espera = horario - this.agora();
    if (espera > 0) await dormir(espera);
  }

  // Chamado quando o TSE responde 429/503: pausa tudo e desacelera, mais o município que a UF.
  recuar(ms) {
    this.contagem.limitadas += 1;
    // Registra em que ritmo o TSE reclamou: é o dado que diz onde fica o limite.
    const evento = {
      em: this.agora(), tipo: 'limitado', esperaMs: ms,
      ultimos1s: this.pedidosNosUltimos(1000), ultimos10s: this.pedidosNosUltimos(10_000), ultimos60s: this.pedidosNosUltimos(60_000),
      altaMs: this.altaMs, baixaMs: this.baixaMs,
    };
    // O intervalo de município que levou o 429 não deve ser tentado de novo no ritmo adaptativo (o configurado segue valendo).
    // Só vale se o 429 veio numa sondagem abaixo do configurado; um 429 já no ritmo configurado é tratado pelo recuo normal.
    if (this.baixaMinMs !== null && this.baixaMs < this.baixaBase) this.baixaPiso = Math.max(this.baixaPiso, Math.ceil(this.baixaMs * 1.25));
    evento.baixaPiso = this.baixaPiso;
    this.baixaDesdeSondagem = 0;
    this.eventos.push(evento);
    if (this.eventos.length > 200) this.eventos.shift();
    this.aoEvento?.(evento);
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
    if (this.altaMs > this.altaBase || this.baixaMs > this.baixaBase) {
      this.altaMs = Math.max(this.altaBase, Math.floor(this.altaMs * 0.8));
      this.baixaMs = Math.max(this.baixaBase, Math.floor(this.baixaMs * 0.8));
      this.ultimoRecuo = t; // o próximo passo só depois de mais um minuto calmo
      return;
    }
    // Já no ritmo configurado e sem 429 há um minuto: o município sonda um ritmo mais rápido (-10% por minuto calmo).
    // Minuto calmo sem pedidos de município não prova nada: só conta se houve tráfego dele.
    if (this.baixaMinMs !== null && this.baixaMs > this.baixaPiso && this.baixaDesdeSondagem >= this.sondagemMinPedidos) {
      this.baixaMs = Math.max(this.baixaPiso, Math.floor(this.baixaMs * 0.9));
      this.baixaDesdeSondagem = 0;
      this.ultimoRecuo = t;
    }
  }

  porMinuto() {
    const t = this.agora();
    return this.janela.filter((x) => t - x <= 60_000).length;
  }

  estatisticas() {
    return { ...this.contagem, porMinuto: this.porMinuto(), altaMs: this.altaMs, baixaMs: this.baixaMs, baixaConfiguradoMs: this.baixaBase, baixaPisoMs: this.baixaMinMs === null ? null : this.baixaPiso };
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
