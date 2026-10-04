# Arquitetura

Este documento explica o projeto de ponta a ponta: de onde vêm os dados, como o painel os busca sem sobrecarregar o
TSE, como as projeções são calculadas e o que é gravado. O [README](../README.md) cobre uso e comandos; o plano dos
modelos de projeção está em [modelos-simulacao.md](modelos-simulacao.md).

## Visão geral

```
                          ┌──────────────── TSE (arquivos JSON estáticos, CDN) ────────────────┐
                          │ UF (110 arquivos)   municípios   acompanhamento   lista de munic. │
                          └──────┬───────────────────┬─────────────┬──────────────────┬───────┘
                                 │ prioridade ALTA   │ prioridade BAIXA (devagar)     │
                                 ▼                   ▼                                │
                       ┌──────────────────┐  ┌─────────────────┐                      │
        Limitador ───▶ │ Apuracao         │  │ Municipios      │ ◀────────────────────┘
        compartilhado  │ ciclo de 60 s    │  │ fila própria    │
                       └────────┬─────────┘  └───────┬─────────┘
                                │ memória             │ memória + .cache/ (disco)
                                ▼                     ▼
                       ┌───────────────────────────────────────┐        ┌───────────────────────┐
                       │ projecao.js · swing.js (puros)        │───────▶│ historico.js          │
                       └───────────────────┬───────────────────┘        │ dados/historico/*.jsonl│
                                           ▼                            └───────────────────────┘
                              servidor.js (API JSON + SSE)
                                           ▼
                                  public/ (navegador, sem build)
```

Duas ideias organizam tudo:

1. **O dado por UF é o mais importante e sempre passa na frente.** O resto (municípios) é uma camada separada, lenta e
   descartável: se ela atrasar ou falhar, o painel principal continua igual.
2. **O painel é educado com o TSE.** Os arquivos são estáticos, cacheados por CDN (~60 s). O painel faz consulta
   condicional (`ETag`), limita o ritmo e recua sozinho quando recebe 429.

## De onde vêm os dados

Tudo vem de arquivos públicos em `https://resultados.tse.jus.br/oficial/…`, o mesmo que o app oficial de
resultados lê. **Não existe API de consulta**: cada arquivo é baixado inteiro. O formato foi conferido no código do app
oficial; a página da especificação oficial bloqueia acesso automatizado.

| Arquivo | Endereço (após `…/oficial/`) | Para que serve |
| --- | --- | --- |
| Índice de eleições | `comum/config/ele-c.json` | Descobre os códigos das eleições do ano (em 2026: federal 6257/6258, estadual 6259/6260). |
| Resultado por UF | `{ciclo}/{eleição}/dados/{uf}/{uf}-c{cargo:4}-e{eleição:6}-u.json` | Votos por candidato de um cargo numa UF (`br` e `zz` na presidência). 110 arquivos no 1º turno. |
| Lista de municípios | `{ciclo}/{eleição}/config/mun-e{eleição:6}-cm.json` | Código do município no TSE (`cd`, 5 dígitos), código IBGE (`cdi`), nome e zonas. |
| Acompanhamento | `{ciclo}/{eleição}/dados/{uf}/{uf}-e{eleição:6}-ab.json` | **Um arquivo por UF** com seções totalizadas, eleitorado e comparecimento de todos os municípios (sem votos por candidato). |
| Resultado por município | `{ciclo}/{eleição}/dados/{uf}/{uf}{município:5}-c{cargo:4}-e{eleição:6}-u.json` | Votos por candidato num município. |
| 2022 por município | `cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/…_2022.zip` | Histórico do modelo de swing (dados abertos, ver [Histórico de 2022](#histórico-de-2022)). |

O arquivo por zona (`…-z{zona:4}-…`) também existe e não é usado hoje.

Os arquivos **não têm geração comum**: o da UF, o do município e o de acompanhamento são regenerados em momentos
diferentes (cada um carrega o próprio `idg`/hora). Isso importa na conferência de sincronia (abaixo).

Antes da apuração os arquivos já existem, com votos zerados; arquivos ainda não publicados respondem 404 e aparecem
como "indisponíveis", sem erro.

## Camadas

### 1. Ciclo principal: `src/apuracao.js`

A cada 60 s consulta os 110 arquivos de UF (cargo × abrangência), 6 por vez, com `If-None-Match`. Guarda o último dado
de cada um, avisa o que mudou por SSE (`/events`) e alimenta a API. Não sabe nada de municípios ou projeções.
Para governador, senador e deputados o "Brasil" é a soma das UFs, calculada na interface.

### 2. Municípios: `src/municipios.js`

Camada separada, só para o mapa de municípios e as projeções. Pontos principais:

- **Só os municípios grandes são baixados.** O corte é de 30 mil eleitores (`--municipios-minimo`), mais o maior
  município de cada UF. O tamanho de cada município vem do arquivo de acompanhamento. Numa amostra de 15 UFs
  medida no cache, ~14% dos municípios concentravam ~62% do eleitorado. `--municipios-todos` baixa todos.
- **Atualização guiada pelo acompanhamento.** Cada passada pede o acompanhamento da UF (1 requisição) e só rebaixa os
  municípios cuja marca (seções totalizadas + comparecimento) mudou. A cada 10 minutos há uma passada completa de
  segurança, caso o arquivo de votos saia depois do de acompanhamento.
- **Município 100% apurado deixa de ser consultado.**
- **Cache em disco** em `.cache/municipios/`: um reinício não rebaixa tudo, só o que mudou.
- **Sob demanda e em segundo plano.** Governador e senador carregam quando alguém abre a UF. A presidência carrega
  as 28 UFs em sequência ao ligar o servidor (`manter`), para somar o Brasil; `--sem-municipios` desliga.
- Se o acompanhamento falha e não há seleção anterior, **não** baixa a UF inteira: espera a próxima passada.

### 3. Limitador compartilhado: `src/limitador.js`

Um único ritmo para tudo o que sai para o TSE:

- **Prioridade:** enquanto houver requisição de UF esperando, a de município espera.
- **Espaçamento:** UF ~50 ms entre inícios (até ~20/s), município 200 ms (~5/s). Município usa no máximo 2 conexões.
- **Recuo compartilhado:** um 429/503 em qualquer camada pausa as duas e deixa o ritmo mais lento (município mais que
  UF). Respeita `Retry-After` quando existe.
- **Contadores** em `/api/meta` (`requisicoes`: por prioridade, por minuto e quantos 429) e uma linha por minuto no
  terminal quando houver 429 (ou com `--verboso`).

### 4. Projeções: `src/projecao.js`, `src/swing.js`

Funções puras: recebem os dados e devolvem a projeção. Todas são **estimativas do painel**, não dado do TSE, e ficam na
aba "Projeção" da interface. Detalhes em [Modelos de projeção](#modelos-de-projeção).

### 5. Histórico: `src/historico.js`

Grava a evolução da apuração para o gráfico. Ver [Histórico da apuração](#histórico-da-apuração).

### 6. Servidor e interface

`src/servidor.js` serve a API JSON, o SSE e os arquivos de `public/` (HTML, CSS e JS sem build). A interface tem o mapa
do Brasil e, ao abrir uma UF, o mapa de municípios; a aba de projeção; o gráfico de evolução; a busca global; e o
mapa de cadeiras do Senado e da Câmara. Os contornos vêm do IBGE e estão em `public/` (gerados por scripts).

## Modelos de projeção

Todas as projeções usam **votos válidos** e a fração de **seções totalizadas** como medida de avanço.

### Extrapolação simples (`projetarIngenuo`): não é mais um modelo da interface

Foi retirada do seletor e da API (`/api/projecao/ingenuo/...` responde 404) por errar de 3 a 5 pontos percentuais nos ensaios. A função
continua como plano B dos outros dois modelos, como base de comparação no ensaio e como linha `proj.ingenuo` do histórico.

Mantém o percentual atual de cada candidato e projeta o total de votos válidos por `válidos ÷ fração de seções`. O
percentual projetado é igual ao atual; o que muda é o tamanho esperado do total. Ignora a ordem geográfica da apuração
(interior apura antes das capitais), então no começo pode ser uma miragem. Vale para qualquer arquivo de UF.

### Estratificação por município (`projetarComResto`, `projetarUf`)

Presidente, governador e senador, uma UF por vez.

1. Os municípios grandes são projetados **um a um**: `votos atuais ÷ fração de seções do município`.
2. O **resto do estado** não tem arquivo próprio: é o arquivo da UF menos a soma dos grandes, projetado em bloco pela
   fração de seções dele (as seções do resto vêm do acompanhamento, que lista todos os municípios).
3. Um estrato sem votos ainda (um grande, ou o resto) entra pelo eleitorado e pela média do que já foi medido; um
   estrato que já tem votos serve de referência para o que não tem.
4. Soma-se tudo. A tela mostra quanto da projeção vem de partes sem apuração.

**Conferência de sincronia.** Como os arquivos têm horários diferentes, a subtração pode dar um resto inconsistente.
O painel compara as seções do arquivo da UF, do acompanhamento e dos grandes; se a diferença passar de 1% do total de
seções da UF, ou se o resto der negativo, a UF usa a **extrapolação simples** naquele ciclo (plano B) e a tela avisa.
Se aparecerem muitos planos B, o corte de eleitores provavelmente precisa subir/descer ou convém `--municipios-todos`.

**Brasil (presidência).** `projetarBrasil` soma as projeções de cada UF. Uma UF sem nada apurado entra pelo
eleitorado e pela média nacional das demais. Só é calculado quando as 28 UFs terminaram a carga (um total sem SP ou
MG enganaria).

### Swing histórico (`projetarSwing`)

Só presidente. Compara o que cada candidato tem agora com o que o **campo político dele teve em 2022** nos mesmos
lugares (os mesmos grandes municípios e o resto do estado do modelo anterior):

1. O prior de cada lugar é o resultado de 2022, traduzido para os candidatos de 2026 pelo mapeamento de herança.
2. O **swing** de cada candidato é a média, ponderada, de (% atual − % herdado) nos lugares já apurados. O peso de cada lugar
   é o tamanho dele vezes (fração apurada ÷ 50%)², até 1: ele entra aos poucos, sem salto quando cruza 50% (`pesoGradual`;
   com `pesoGradual: false`, o corte seco antigo, só os lugares com 50% ou mais). No ensaio (`--oscilacao`) isso reduz o
   salto médio da projeção entre atualizações sem piorar o erro; não foi validado com votos reais.
3. O % esperado de cada lugar é o % herdado mais o swing, normalizado para somar 100%.
4. O que falta de cada lugar é dividido entre o % já visto ali e o esperado, na proporção da apuração dele.
5. O tamanho de um lugar sem votos é o total de 2022 vezes o crescimento medido nos lugares já apurados.

Votos de 2022 sem herdeiro (por exemplo, candidatos de partidos que não concorrem em 2026) não vão para ninguém e são
redistribuídos pela própria variação. Candidatos sem base em 2022 entram pela média observada.

### Faixa possível

A coluna "faixa possível" são os extremos matemáticos (nenhum ou todos os votos que faltam para o candidato). **Não é
intervalo de confiança** e não indica probabilidade.

### Não implementado

O modelo bayesiano com pesquisas continua indisponível: depende de pesquisas em formato estruturado.

## Histórico de 2022

`dados-historicos/presidente-2022-t1.json` guarda os votos de cada candidato a presidente em 2022 (1º turno) por
município, a partir dos dados abertos do TSE. É gerado por `node scripts/gerar-historico-2022.js`, que lê **só a entrada
da presidência (~2 MB)** de dentro do zip de 642 MB por requisições de faixa (`Range`). Os totais conferem com o resultado
oficial de 2022.

`dados-historicos/mapeamento-presidente.json` diz de quais candidatos de 2022 cada candidato de 2026 herda votos e que
fração (peso de 0 a 1). Por padrão só o **mesmo partido** herda (PT→Lula, PL→Flávio Bolsonaro, NOVO→Zema e os
pequenos que repetiram). É uma **decisão política editável**: reinicie o painel depois de mudar. O painel avisa se a
herança de um candidato de 2022 passar de 100%.

### Eleitos de 2014, 2018 e 2022 (visão Análise)

`dados-historicos/eleitos.json` guarda o partido de cada governador, senador, deputado federal e deputado estadual eleito (por UF), a partir dos zips
`consulta_cand_AAAA.zip` dos dados abertos do TSE (~4,5 MB cada, baixados inteiros). É gerado por
`node scripts/gerar-eleitos.js`, que confere as contagens (27 governadores, 513 deputados federais, 1.035 estaduais, 27 ou 54 senadores por eleição).
Só a eleição ordinária conta, com uma exceção no Senado: em MT 2018 a eleita (Selma Arruda, PSL) teve a votação anulada e
a cadeira é de Carlos Fávaro (PSD), eleito em suplementar. `src/partidos.js` aplica `partidos-sucessao.json` (renomeações
e fusões) e serve o resultado em `/api/partidos`. O PSL não entra na tabela de propósito: em 2018 era o partido de Bolsonaro.
A interface (`public/partidos.js`) monta tudo a partir disso e de `/api/resumo`; para a Câmara o resumo traz
`cadeirasPorPartido` (eleitos mais as vagas `vag` já dadas ao partido/federação, ver `normalize.js`).

### Histórico de 2018

`dados-historicos/presidente-2018-t1.json` tem o mesmo formato, para o 1º turno de 2018, e é gerado por
`node scripts/gerar-historico-2018.js` (também lê só a entrada da presidência do zip dos dados abertos do TSE). Os totais
conferem com a apuração oficial (Bolsonaro 49.277.010, Haddad 31.342.051, 107.050.749 votos válidos; há um teste para isso).
`dados-historicos/mapeamento-presidente-2018.json` liga os candidatos de 2022 e 2026 aos de 2018 para o comparativo:
PT→Haddad (13) e PL→Bolsonaro, que em 2018 concorreu pelo PSL com o número 17. O comparativo usa só essas duas ligações.

Governador e senador não têm swing: exigiriam os arquivos de 2022 por UF (~290 MB, porque cada um traz todos os cargos).

## Histórico da apuração

O painel só guarda o último estado de cada arquivo; para o gráfico de evolução, `src/historico.js` **grava** cada
atualização, porque a projeção calculada naquele instante (principalmente a por município) não dá para reconstruir
depois.

- A cada arquivo novo do TSE de presidente, governador ou senador com seções totalizadas, acrescenta **uma linha
  JSON** em `dados/historico/ele2026-t1.jsonl` (JSONL; só acrescenta; sobrevive a reinício; ignora linha cortada).
- Linha: `{ t, chave, cargo, uf, secoes, validos, candidatos, proj: { ingenuo, estratificado, swing } }`. `t` é a hora de
  geração **do arquivo do TSE**, não a do painel. Um modelo indisponível naquele instante grava `null`, sem inventar.
- Candidatos gravados: todos com 1% ou mais, ou os 6 primeiros.
- Não duplica ponto: mesma chave e mesmo `t` é ignorado.
- A demonstração grava em `…-demo.jsonl` e recomeça do zero a cada execução.
- Leitura: `GET /api/historico/{cargo}/{uf}?modelo=estratificado|swing`.

Esse arquivo também serve para **validar os modelos depois da eleição**: compare o que cada um projetava ao longo da noite
com o resultado final.

## API local

| Rota | O que devolve |
| --- | --- |
| `GET /api/meta` | Configuração, cargos, modelos de projeção (com disponibilidade), contadores de requisições ao TSE e estado do último ciclo. |
| `GET /api/resumo` | Uma linha por cargo × abrangência (líder, seções, eleitos). |
| `GET /api/resultado/{cargo}/{uf}` | Resultado completo de um arquivo (ex.: `/api/resultado/1/br`). |
| `GET /api/municipios/{cargo}/{uf}` | Líder e apuração de cada município de uma UF (cargos 1, 3 e 5). Dispara a carga da UF se preciso. |
| `GET /api/projecao/{modelo}/{cargo}/{uf}` | Projeção (`estratificado`, `swing`). Pode vir `disponivel: false` com o motivo, ou `carregando: true`. |
| `GET /api/historico/{cargo}/{uf}?modelo=` | Série gravada para o gráfico; 404 se não houver gravação. |
| `GET /api/partidos` | Eleitos de 2014, 2018 e 2022 por partido (governador, senador e deputado federal), com as siglas já traduzidas para o partido de hoje; `disponivel: false` sem `eleitos.json`. |
| `GET /api/busca?q=&cargo=&uf=` | Busca global de candidatos e municípios. |
| `GET /events` | SSE: evento `ciclo` a cada rodada de consultas, com os arquivos que mudaram. |

## Estrutura do código

```
server.js                    ponto de entrada: liga as camadas
src/tse.js                   URLs, descoberta das eleições, fontes reais (GET condicional)
src/normalize.js             JSON bruto do TSE → formato interno
src/apuracao.js              ciclo principal (arquivos por UF)
src/municipios.js            camada de municípios (seleção, acompanhamento, cache)
src/cache-disco.js           cache dos municípios em .cache/
src/limitador.js             ritmo único ao TSE: prioridade, recuo em 429, contadores
src/projecao.js              extrapolação simples, estratificação por município, soma do Brasil
src/swing.js                 swing histórico
src/anterior.js              resultado de 2022 traduzido pelo mapeamento de herança
src/partidos.js              eleitos de 2014, 2018 e 2022 por partido, com a tabela de sucessão (/api/partidos)
src/historico.js             gravador do histórico e leitura da série
src/busca.js                 busca global
src/servidor.js              HTTP, API e SSE
src/demo.js                  simulação com dados fictícios (não baixa municípios do TSE)
src/config.js                opções e variáveis de ambiente
src/abrir.js, supervisor.js, parar.js   abrir navegador, npm run dev, npm run stop
public/                      interface (app.js, municipios.js, grafico.js, busca.js, cadeiras.js, comparativo-eleicoes.js,
                             partidos.js e ideologia.js da visão Análise, CSS)
public/municipios/           contornos municipais por UF (IBGE), indexados pelo código do TSE
dados-historicos/            2022 e 2018 por município, mapeamentos de herança, eleitos de 2014 a 2022 e sucessão de
                             partidos (versionados)
dados/                       histórico da apuração gravado (fora do git)
.cache/                      cache de municípios (fora do git)
scripts/                     geradores (mapa, municípios, senado, eleitos, histórico de 2022 e 2018), dev e stop
test/                        testes e fixtures
```

## Operar durante a apuração

- **Use `npm start`**, não `npm run dev`. O `dev` reinicia o servidor a cada arquivo salvo, e cada reinício recomeça a
  carga dos municípios. O cache em disco ameniza, mas no dia da apuração não vale o risco.
- **Uma instância só** apontando para o TSE. Várias (incluindo demonstrações em outras portas) somam requisições.
  O modo `--demo` não baixa arquivos de município, mas ainda consulta o índice, os arquivos de UF e a lista de municípios.
- **Ligue antes da apuração.** Os arquivos já existem zerados e a carga inicial dos municípios (uns minutos) acontece
  em horário morto. Durante a apuração, o custo por ciclo é só o que mudou.
- **O TSE pode responder 429.** Já aconteceu uma vez num teste com carga sem freio (bloqueio de alguns minutos por IP).
  O painel recua sozinho. Acompanhe `requisicoes.limitadas` em `/api/meta`. Não tente contornar o limite com várias
  máquinas ou IPs: o caminho é pedir menos.
- **Veja se já há um painel rodando antes de subir outro.** Se `npm start` disser que a porta 3000 está em uso, é quase
  sempre o próprio painel (confira com `lsof -nP -iTCP:3000 -sTCP:LISTEN`). Demonstrações em outras portas também somam
  pedidos ao TSE: encerre-as com `npm run stop -- --porta N`.
- **Antes de abrir:** confira em `/api/projecao/estratificado/1/br` se a carga das 28 UFs terminou, e se
  `dados/historico/ele2026-t1.jsonl` começa a crescer quando entrarem as primeiras urnas.

## Limitações e riscos conhecidos

- **Nenhum modelo foi validado com votos reais.** Os arquivos existentes antes da votação têm votos zerados; os cálculos
  foram testados com dados sintéticos e a lógica com testes, mas o comportamento sob apuração real (sobretudo o
  descompasso entre arquivos) só aparece ao vivo. A validação deve ser feita depois, com o histórico gravado.
- **Descompasso entre arquivos** (UF, município, acompanhamento): tratado com tolerância adaptativa (1% no fim, 3% no começo, até 4% no meio da apuração) e plano B, mas o tamanho
  real do descompasso é desconhecido.
- **No resto do estado** a projeção supõe que as seções que faltam votam como as que já abriram. Em capitais grandes a
  ordem de apuração dentro da cidade ainda distorce (a unidade é o município, não a zona).
- **Swing só para presidente**, e a herança de votos é uma escolha editorial.
- **Atraso na carga dos municípios no auge** da apuração: o teto de ~8 req/s (`--municipios-ritmo-ms`, 120 ms; era ~5 req/s) significa que um município pode ficar até
  ~20 minutos sem atualizar; o dado por UF não é afetado.
- **A visão Análise não foi vista com votos reais.** Duas partes dependem de como o TSE publica durante a contagem: a
  prévia das vagas de deputado (estimada pelo quociente eleitoral se o TSE ainda não distribuiu as vagas entre as listas;
  precisa do campo de votos por lista preenchido) e a situação de cada governador no mapa (clara se lidera com mais de 50%
  dos válidos, listrada com 50% ou menos ou com 2º turno marcado). Ambas são estimativas e mudam até o fim. A visão foi
  desenhada para o 1º turno; no 2º (`--turno 2`) valem só presidente e governador, e o mapa de governadores compara 2022 com o
  turno em curso sem tratamento próprio.
- Conselheiro Distrital (Fernando de Noronha) não é acompanhado; deputado estadual só é acompanhado em SP e RJ (sem projeção) e é
  volumoso e menos testado; a classificação ideológica do mapa de cadeiras é editorial e aproximada.

## Testes e CI

`node --test` roda tudo (normalização com fixtures reais do TSE, motor de polling, limitador, municípios, projeções,
swing, histórico, servidor, configuração e os utilitários de `dev`/`stop`). O GitHub Actions
(`.github/workflows/ci.yml`) roda a suíte em Node 20 e 22 a cada push na `main` e em pull requests.
