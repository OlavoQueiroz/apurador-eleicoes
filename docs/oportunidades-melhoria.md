# Oportunidades de Melhoria (Código e Modelagem Analítica)

Diagnóstico técnico e estatístico do projeto: oportunidades na **modelagem das projeções** e na **engenharia de software**. Cada item foi conferido contra o código; os números de linha são aproximados e podem mudar. Contexto dos modelos em [modelos-simulacao.md](modelos-simulacao.md) e da estrutura em [arquitetura.md](arquitetura.md).

## Status da execução

| Item | Resultado |
| :--- | :--- |
| 2.1 Timeout no `fetch` | **Feito** (`comPrazo` em [src/tse.js](../src/tse.js), 15 s, combinado com `signal` externo; teste com servidor que não responde). |
| 1.1 Intervalo crível e P(2º turno) | **Feito e depois removido a pedido.** Foi implementado (Dirichlet sobre os votos que faltam, calibrado no ensaio), mas a faixa e a chance de 2º turno não faziam sentido para o painel e saíram da tela e do código. A faixa original de extremos matemáticos também saiu. |
| 1.2 UFs zeradas pelo histórico de 2022 | **Feito** (`anteriorPorUf` em `projetarBrasil`). No ensaio padrão reduz o erro aos 2–10% apurados (ex.: simples/grandes 9,6 → 8,6 pp aos 2%; swing 1,2 → 0,5 pp aos 2%), mas no ensaio hostil (`--swing-uf 2 --swing-porte 3`) o swing piorou um pouco aos 5–10% (~0,3 pp). Resultado misto, ganho pequeno. |
| 1.3 *Shrinkage* | **Testado e descartado.** Credibilidade `n/(n+K)` das primeiras seções, com ruído por seção de 8 pp: o erro cai um pouco aos 20% apurados, mas piora aos 5–10%; com chegada em ordem aleatória também não houve ganho. O código foi revertido. O ensaio ganhou `--ruido-secoes` para repetir o teste. |
| 1.5 Plano B | **Feito**: tolerância adaptativa (3% no começo, até 4% no meio da apuração, 1% no fim, `toleranciaDescompasso`; o pico no meio veio do arquivo de SP, que o TSE publicou com 2,6% de diferença entre UF e acompanhamento) e, no servidor, a última projeção boa da UF é mantida por até 3 min se os arquivos saírem de sincronia (aviso na tela). A parte de manter a projeção não tem teste automatizado. |
| 2.2 SSE | **Feito**: clientes encerrados ou que falham são removidos; quem acumula mais de 256 KB sem ler é desconectado. |
| 1.4 Swing capitais × interior | **Feito e ligado por padrão** (`swingPorGrupo`). No ensaio, sem heterogeneidade não muda nada; com `--swing-porte 3` o erro aos 20% cai de ~1,6 para ~0,4 pp. |
| 2.3 Modularizar `app.js` | **Não feito**: refatoração sem ganho funcional, para depois da apuração. |
| 2.4 Fila do limitador | **Não feito**: só vale se o polling virar problema medido. |
| 2.5 `Historico` com stream | **Descartado** (ver abaixo). |

---

## 1. Oportunidades Analíticas (Estatística e Modelagem Eleitoral)

Antes de adotar qualquer mudança de modelo, **medir no ensaio** ([scripts/ensaio-apuracao.js](../scripts/ensaio-apuracao.js)), que já simula ordem de chegada, ruído e swing por UF/porte.

### 1.1 Intervalos críveis e probabilidade de 2º turno (Monte Carlo)
- **Onde**: [src/projecao.js](../src/projecao.js#L86) (`pctMinimo` / `pctMaximo`, também nas linhas 170 e 316).
- **Diagnóstico**: os limites exibidos são extremos combinatórios (nenhum ou todos os votos faltantes para o candidato), como o próprio código comenta. No começo da apuração dão faixas como 15% a 88%, que não informam.
- **Proposta**:
  - Simulação de Monte Carlo sobre o percentual dos votos faltantes por estrato (Dirichlet/Normal).
  - Duas métricas: **intervalo crível de 95%** e **probabilidade de 2º turno** ($P(\text{válidos} > 50\%)$).
- **Cuidados**: o modelo de erro precisa ser **calibrado** pelo ensaio, incluindo a dependência da ordem de chegada dos municípios; sem isso o intervalo passa falsa precisão. O custo (ex.: 1.000 iterações) deve ser medido, não assumido.

### 1.2 UFs zeradas no `projetarBrasil`
- **Onde**: [src/projecao.js](../src/projecao.js#L406-L413).
- **Diagnóstico**: UF sem apuração recebe a taxa média de válidos por eleitor e a divisão entre candidatos das UFs já apuradas. Como a apuração não começa de forma geograficamente equilibrada, isso distorce a projeção nacional nos primeiros 10%–20% da noite.
- **Proposta**: para UFs com 0% apurado, usar o resultado de 2022 da própria UF (já disponível em [src/anterior.js](../src/anterior.js)), ajustado pelo swing nacional medido até ali.

### 1.3 *Shrinkage* para municípios com poucas seções apuradas
- **Onde**: [src/projecao.js](../src/projecao.js#L133) (`votos / f` no modelo estratificado).
- **Diagnóstico**: com 1 de 200 seções ($f = 0{,}005$) os votos são multiplicados por 200; uma urna atípica estoura a projeção do município. O ganho se concentra no **estratificado**: o modelo de swing já mistura o que o lugar mostra com o esperado pela fração apurada ([src/swing.js](../src/swing.js#L127)).
- **Proposta**: combinação convexa com prior (histórico de 2022 ou média da UF) quando $f$ é pequeno:
  $$\hat{p} = \lambda(f) \cdot p_{\text{observado}} + (1 - \lambda(f)) \cdot p_{\text{prior}}$$
  A forma de $\lambda(f)$ (sigmoide, cúbica) e o corte (ex.: $f < 0{,}15$) são arbitrários: calibrar no ensaio.

### 1.4 Heterogeneidade do swing (capitais × interior)
- **Onde**: [src/swing.js](../src/swing.js#L97).
- **Diagnóstico**: o swing é um único valor por candidato, ponderado pelo tamanho, aplicado a toda a UF. O ensaio já simula comportamentos distintos por porte (`--swing-porte`, [scripts/ensaio-apuracao.js](../scripts/ensaio-apuracao.js#L87)).
- **Proposta**: swing separado para grandes municípios e para o resto do estado.
- **Cuidado**: no início há poucos grandes apurados; dividir a amostra pode aumentar a variância. Só adotar se o ensaio com `--swing-porte` mostrar ganho.

### 1.5 Amortecimento na troca para o "plano B"
- **Onde**: [src/projecao.js](../src/projecao.js#L222) (`tolerancia = 0.01`).
- **Diagnóstico**: se UF e acompanhamento divergem mais de 1% das seções, a UF abandona a estratificação e cai na extrapolação simples; a tela pode oscilar entre modelos de um minuto para o outro.
- **Proposta**: histerese ou tolerância adaptativa (mais permissiva no início). Evitar "clamp" silencioso dos votos, que pode esconder dessincronia real: se houver ajuste, sinalizar na conferência.

---

## 2. Oportunidades de Engenharia e Código

### 2.1 Timeout obrigatório no `fetch`
- **Onde**: [src/tse.js](../src/tse.js#L39) (`getJson`), [src/tse.js](../src/tse.js#L86) e [src/tse.js](../src/tse.js#L154). Os `fetch` estão só em `tse.js`; `server.js` cria as fontes sem `signal` (linhas 45 e 51).
- **Diagnóstico**: sem `signal`, um socket TCP pendurado deixa a promise presa indefinidamente e trava um worker do ciclo.
- **Proposta**: timeout padrão de 10–15 s por requisição, combinando `AbortSignal.timeout(...)` com qualquer `signal` cancelável recebido (`AbortSignal.any`). O erro de timeout deve seguir o caminho de falha já existente (sem acionar o recuo de 429).

### 2.2 Endurecer o envio por SSE
- **Onde**: [src/servidor.js](../src/servidor.js#L275) (laços de `write` sobre `clientes`).
- **Diagnóstico**: o `req.on('close')` já remove o cliente, então o risco é menor do que parece. Falta proteger o `write` contra socket destruído (`res.destroyed || res.writableEnded`) e tratar `write` retornando `false`.
- **Proposta**: `try/catch` e expurgo de clientes inválidos. Endurecimento barato, não correção crítica.

### 2.3 Modularização do frontend (`public/app.js`)
- **Onde**: [public/app.js](../public/app.js) (~1.260 linhas e crescendo).
- **Diagnóstico**: concentra estado, reconexão SSE, renderização, rotas de UI e listeners.
- **Proposta**: submódulos ES puros, sem build (`estado.js`, `conexao.js`, `painel-apuracao.js`, `painel-projecao.js`).
- **Cuidado**: refatoração sem ganho funcional; fazer **fora da janela de apuração**.

### 2.4 Polling do limitador (baixa prioridade)
- **Onde**: [src/limitador.js](../src/limitador.js#L38) e [L42](../src/limitador.js#L42).
- **Diagnóstico**: `while (this.altasEsperando > 0) await dormir(20)` é polling, mas o custo é um timer de 20 ms enquanto há UF esperando.
- **Proposta**: fila por eventos só se o polling virar problema medido. O código atual é simples e testado; a reescrita traz risco de concorrência maior que o ganho.

### 2.5 Descartado: `Historico` com `createWriteStream`
- **Onde**: [src/historico.js](../src/historico.js#L54).
- **Avaliação**: a cadeia `this.fila = this.fila.then(...)` **não acumula memória**: cada elo resolve e é liberado, e a taxa é de ~1 gravação por minuto por chave. O único ganho de um stream seria o tratamento de erro, que já existe. Não vale a troca.

---

## 3. Matriz de Priorização (Impacto vs. Esforço)

| Prioridade | Área | Iniciativa | Impacto | Esforço |
| :---: | :---: | :--- | :---: | :---: |
| **1** | Código | 2.1 Timeout com `AbortSignal.timeout` nas requisições HTTP | **Crítico** | Muito baixo |
| **2** | Analítica | 1.1 Intervalos críveis e probabilidade de 2º turno (Monte Carlo) | **Alto** | Médio |
| **3** | Analítica | 1.2 Histórico de 2022 para UFs zeradas no `projetarBrasil` | **Alto** | Baixo |
| **4** | Analítica | 1.3 *Shrinkage* para municípios com $f < 15\%$ (estratificado) | **Alto** | Médio |
| **5** | Analítica | 1.5 Histerese na troca para o plano B | Médio | Baixo |
| **6** | Código | 2.2 Proteção do SSE contra sockets inválidos | Médio | Baixo |
| **7** | Analítica | 1.4 Swing separado capitais × interior (se o ensaio mostrar ganho) | Médio | Médio |
| **8** | Código | 2.3 Modularização de `public/app.js` (fora da apuração) | Médio | Médio |
| **9** | Código | 2.4 Fila por eventos no limitador | Baixo | Médio |
| — | Código | 2.5 `Historico` com stream | descartado | — |
