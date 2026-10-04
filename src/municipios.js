// Resultados por município, numa camada SEPARADA do ciclo principal (apuracao.js): fila própria, poucas
// requisições simultâneas e pausa entre os arquivos, para nunca atrapalhar o painel de apuração.
//
//  • `consultar` devolve na hora o que se sabe de uma UF e, se o dado estiver velho, atualiza em segundo plano.
//  • `espiar` só lê o que já foi carregado, sem disparar nada (usado na soma nacional).
//  • `manter` percorre as UFs de um cargo em sequência, de novo a cada validade (o ciclo lento do nacional).
// Município com todas as seções totalizadas não muda mais e deixa de ser consultado.
//
// Atualização guiada pelo arquivo de acompanhamento: o TSE publica, por UF, UM arquivo com as seções
// totalizadas e o comparecimento de todos os municípios (sem votos por candidato). Uma passada custa uma
// requisição por UF e só baixa o arquivo de votos dos municípios cujo número mudou. Por segurança, a cada
// `revalidarMs` a UF faz uma passada completa (GET condicional em todos os municípios ainda abertos), caso o
// arquivo de votos saia depois do de acompanhamento. Se a fonte não tiver acompanhamento (demonstração),
// toda passada consulta todos os municípios abertos.
//
// Só os municípios GRANDES são baixados (`minimoEleitores`, mais o maior de cada UF): o tamanho de cada um vem do
// arquivo de acompanhamento. O resto da UF é derivado do arquivo da UF (ver projecao.js). `minimoEleitores = null`
// baixa todos.

import { Limitador, pedeCalma, recuoDoErro } from './limitador.js';

const cederVez = () => new Promise((resolve) => setImmediate(resolve));
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

export class Municipios {
  constructor({
    fonte, ciclo, cache = null, limitador = null, minimoEleitores = null, concorrencia = 2, espacamentoMs = 200, validadeMs = 120_000,
    revalidarMs = 600_000, pausaUfMs = 500, agora = Date.now,
  }) {
    this.fonte = fonte;
    this.ciclo = ciclo;
    this.cache = cache;
    this.concorrencia = concorrencia;
    this.validadeMs = validadeMs;
    this.minimoEleitores = minimoEleitores;
    this.revalidarMs = revalidarMs;
    this.pausaUfMs = pausaUfMs;
    // Ritmo das requisições (baixa prioridade). Compartilhado com o ciclo principal quando recebe o mesmo limitador.
    this.limitador = limitador ?? new Limitador({ altaMs: 0, baixaMs: espacamentoMs, agora });
    this.agora = agora;
    this.parado = false;
    this.listas = new Map(); // eleição → Promise<Map uf → municípios>
    this.entradas = new Map(); // eleição:cargo:uf → estado
    this.acompanhamentos = new Map(); // eleição:uf → { etag, mapa, em } (vale para todos os cargos)
  }

  listar(eleicao) {
    if (!this.listas.has(eleicao)) {
      const promessa = this.fonte.listar(this.ciclo, eleicao);
      // Falha não pode ficar guardada: a próxima consulta tenta de novo.
      promessa.catch(() => this.listas.delete(eleicao));
      this.listas.set(eleicao, promessa);
    }
    return this.listas.get(eleicao);
  }

  #entrada({ eleicao, cargo, uf }) {
    const chave = `${eleicao}:${cargo}:${uf}`;
    if (!this.entradas.has(chave)) {
      this.entradas.set(chave, {
        chave, itens: new Map(), total: 0, feitos: 0, carregando: false, doDisco: false,
        atualizadoEm: null, validadoEm: 0, erro: null, promessa: null, buscas: 0,
        selecionados: null, detalhes: null, alvos: 0,
      });
    }
    return this.entradas.get(chave);
  }

  #instantaneo(entrada) {
    return {
      carregando: entrada.carregando,
      primeiraCarga: entrada.atualizadoEm === null && !entrada.doDisco,
      progresso: { feitos: entrada.feitos, total: entrada.alvos || entrada.total },
      completo: this.minimoEleitores === null, // true = todos os municípios; false = só os grandes (o resto vem da UF)
      detalhes: entrada.detalhes, // município → { aptos, secoes } de TODOS os municípios da UF, ou null
      atualizadoEm: entrada.atualizadoEm,
      erro: entrada.erro,
      total: entrada.total,
      dados: [...entrada.itens]
        .filter(([codigo, i]) => i.dados && (!entrada.selecionados || entrada.selecionados.has(codigo)))
        .map(([, i]) => i.dados),
      pendente: entrada.promessa, // só para testes aguardarem o fim da carga
    };
  }

  espiar(consulta) {
    return this.#instantaneo(this.#entrada(consulta));
  }

  consultar(consulta) {
    const entrada = this.#entrada(consulta);
    const velha = entrada.atualizadoEm === null || this.agora() - entrada.atualizadoEm >= this.validadeMs;
    if (!entrada.carregando && velha) entrada.promessa = this.#carregar(entrada, consulta);
    return this.#instantaneo(entrada);
  }

  // Passada completa por todas as UFs de um cargo, uma de cada vez, repetida a cada validade.
  async manter({ eleicao, cargo }) {
    while (!this.parado) {
      const ufs = [...(await this.listar(eleicao)).keys()];
      for (const uf of ufs) {
        if (this.parado) return;
        const entrada = this.#entrada({ eleicao, cargo, uf });
        const buscasAntes = entrada.buscas;
        await this.consultar({ eleicao, cargo, uf }).pendente;
        if (entrada.buscas !== buscasAntes) await dormir(this.pausaUfMs); // UF sem novidade não gasta pausa
      }
      await dormir(this.validadeMs);
    }
  }

  parar() {
    this.parado = true;
  }

  // Executa uma requisição respeitando o limite (e a prioridade do dado por UF). Em 429/503 todo mundo recua e a
  // requisição é repetida algumas vezes; outros erros sobem na hora.
  async #comLimite(pedido) {
    for (let tentativa = 0; ; tentativa += 1) {
      await this.limitador.vez('baixa');
      try {
        return await pedido();
      } catch (erro) {
        if (!pedeCalma(erro) || tentativa >= 4 || this.parado) throw erro;
        this.limitador.recuar(recuoDoErro(erro, tentativa));
      }
    }
  }

  // Marca (seções totalizadas:comparecimento) e detalhes (tamanho, seções) de cada município da UF, ou null se não der para saber
  // (fonte sem acompanhamento, arquivo indisponível ou falha). Vale para todos os cargos da mesma eleição.
  async #acompanhamento(eleicao, uf) {
    if (!this.fonte.acompanhar) return null;
    const chave = `${eleicao}:${uf}`;
    const anterior = this.acompanhamentos.get(chave);
    if (anterior && this.agora() - anterior.em < this.validadeMs / 2) return anterior;
    try {
      const r = await this.#comLimite(() => this.fonte.acompanhar({ ciclo: this.ciclo, eleicao, uf }, anterior ?? null));
      if (r.status === 'novo') {
        const novo = { etag: r.etag ?? null, mapa: r.mapa, detalhes: r.detalhes ?? null, em: this.agora() };
        this.acompanhamentos.set(chave, novo);
        return novo;
      }
      if (r.status === 'inalterado' && anterior) {
        anterior.em = this.agora();
        return anterior;
      }
    } catch {
      // sem acompanhamento nesta passada
    }
    return null;
  }

  async #carregar(entrada, { eleicao, cargo, uf }) {
    entrada.carregando = true;
    entrada.erro = null;
    entrada.feitos = 0;
    try {
      if (!entrada.doDisco && entrada.atualizadoEm === null && this.cache) await this.#lerDisco(entrada);
      const todos = (await this.listar(eleicao)).get(uf) ?? [];
      entrada.total = todos.length;

      const completa = this.agora() - entrada.validadoEm >= this.revalidarMs;
      const comAcompanhamento = Boolean(this.fonte.acompanhar);
      const acompanhamento = await this.#acompanhamento(eleicao, uf);
      const mapa = acompanhamento?.mapa ?? null;
      if (acompanhamento?.detalhes) entrada.detalhes = acompanhamento.detalhes;
      const municipios = this.#escolher(entrada, todos);
      entrada.alvos = municipios.length;
      // Com acompanhamento disponível, só baixa o que mudou; sem ele (e fora da passada completa) não há
      // como saber, então espera a próxima passada completa em vez de varrer tudo.
      const guiada = comAcompanhamento && !completa;

      const fila = [...municipios];
      let falhas = 0;
      let primeiroErro = '';
      const trabalhador = async () => {
        while (fila.length && !this.parado) {
          const { codigo, nome, cdi = null } = fila.shift();
          const item = entrada.itens.get(codigo) ?? { dados: null, etag: null, marca: null };
          entrada.itens.set(codigo, item);
          const marca = mapa?.get(codigo) ?? null;
          const inalterado = item.dados && marca !== null && marca === item.marca;
          if (item.dados?.totalizacaoFinal || (guiada && (mapa ? inalterado : true) && item.dados)) {
            entrada.feitos += 1; // fechado, ou sem mudança desde a última carga
            continue;
          }
          try {
            const alvo = { chave: `${cargo}:${uf}:${codigo}`, cargo, uf, municipio: codigo, nome, eleicao, ciclo: this.ciclo };
            entrada.buscas += 1;
            const r = await this.#comLimite(() => this.fonte.obter(alvo, item));
            if (r.status === 'novo') {
              item.dados = { ...r.dados, codigoMunicipio: codigo, nomeMunicipio: nome, codigoIbge: cdi };
              item.etag = r.etag ?? null;
            }
            if (r.status === 'novo' || r.status === 'inalterado') item.marca = marca;
          } catch (erro) {
            falhas += 1; // mantém o último dado deste município, se houver
            primeiroErro ||= erro.message;
          }
          entrada.feitos += 1;
          await cederVez(); // deixa o servidor responder ao painel entre um arquivo e outro
        }
      };
      await Promise.all(Array.from({ length: Math.min(this.concorrencia, fila.length) }, trabalhador));
      if (falhas) entrada.erro = `${falhas} município(s) não puderam ser atualizados (${primeiroErro})`;
      // Mesmo com falhas: quem falhou continua sem dado/marca e é retomado na próxima passada guiada.
      if (completa) entrada.validadoEm = this.agora();
      if (this.cache) {
        await this.cache.gravar(entrada.chave, {
          validadoEm: entrada.validadoEm,
          itens: [...entrada.itens].map(([codigo, i]) => [codigo, { dados: i.dados, etag: i.etag, marca: i.marca }]),
        });
      }
    } catch (erro) {
      entrada.erro = erro.message;
    } finally {
      entrada.atualizadoEm = this.agora();
      entrada.carregando = false;
    }
  }

  // Quais municípios baixar. Todos, ou só os grandes (tamanho vindo do acompanhamento). Sem o acompanhamento não
  // dá para escolher: mantém a seleção anterior, ou desiste desta passada em vez de baixar a UF inteira.
  #escolher(entrada, todos) {
    if (this.minimoEleitores === null) return todos;
    if (!entrada.detalhes) {
      if (entrada.selecionados) return todos.filter((m) => entrada.selecionados.has(m.codigo));
      throw new Error('arquivo de acompanhamento indisponível: não deu para escolher os municípios grandes');
    }
    const tamanho = (m) => entrada.detalhes.get(m.codigo)?.aptos ?? 0;
    const ordenados = [...todos].sort((a, b) => tamanho(b) - tamanho(a));
    const grandes = ordenados.filter((m, i) => i === 0 || tamanho(m) >= this.minimoEleitores);
    entrada.selecionados = new Set(grandes.map((m) => m.codigo));
    return grandes;
  }

  async #lerDisco(entrada) {
    const salvo = await this.cache.ler(entrada.chave);
    for (const [codigo, item] of salvo?.itens ?? []) {
      entrada.itens.set(codigo, { dados: item.dados ?? null, etag: item.etag ?? null, marca: item.marca ?? null });
    }
    entrada.validadoEm = salvo?.validadoEm ?? 0;
    entrada.doDisco = entrada.itens.size > 0;
  }
}
