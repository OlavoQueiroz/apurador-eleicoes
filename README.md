# Apurador das eleições

Painel local que acompanha a apuração em tempo real a partir dos **arquivos públicos de resultado do TSE**
(`resultados.tse.jus.br`). Não conta votos: lê o que o TSE publica, normaliza e mostra.

Cargos: presidente, governador, senador, deputado federal e deputado estadual (este só em SP e RJ).
Deputado distrital (DF) fica de fora por padrão (ver [Opções](#opções)).

Além do resultado oficial, o painel tem uma aba separada de **projeção do resultado final** (três modelos, sempre
rotulados como estimativa), o mapa de municípios de cada UF, um gráfico de **evolução da apuração** gravado ao vivo, busca
global e o mapa de cadeiras do Senado e da Câmara.

**Documentação:** [docs/arquitetura.md](docs/arquitetura.md) explica o projeto de ponta a ponta (fontes de dados,
camadas, projeções, histórico, operação e riscos); [docs/modelos-simulacao.md](docs/modelos-simulacao.md) é o plano
original dos modelos de projeção, com o que foi implementado.

## Como rodar

Precisa de **Node.js 20 ou mais novo**. Não há dependências para instalar.

```bash
node server.js
```

O painel abre sozinho no **Safari** (macOS) assim que o primeiro ciclo de consultas termina; se não abrir, é
<http://127.0.0.1:3000>. Ele só escuta no seu computador (`127.0.0.1`).

A abertura automática só acontece quando você roda num terminal interativo, para que testes e scripts não
façam janelas aparecerem sozinhas. Para desligar use `--sem-abrir`; para outro navegador, `--navegador "Google Chrome"`.
Se o app pedido não existir, o painel abre no navegador padrão do sistema.

Para ver o painel funcionando sem resultados reais, use a demonstração:

```bash
node server.js --demo
```

Na demonstração, **candidatos, partidos e votos são fictícios** e há uma faixa vermelha fixa avisando isso.
Os votos "chegam" ao longo de ~8 minutos (`--demo-minutos 1` para acelerar). Candidatos e partidos reais são
trocados por códigos fictícios de propósito: votos inventados nunca ficam atribuídos a pessoas reais, para que um
print do demo não possa ser confundido com resultado.

## Comandos npm

| Comando | O que faz |
| --- | --- |
| `npm start` | Sobe o painel (o mesmo que `node server.js`). |
| `npm run dev` | Sobe o painel e **reinicia sozinho** quando o `server.js` ou algo em `src/` muda; o navegador abre só na primeira vez. Se a porta já estiver ocupada, avisa e sai. Mudanças em `public/` não precisam de reinício: basta recarregar a página. |
| `npm run stop` | Encerra o painel que está rodando (por padrão, o da porta 3000). |
| `npm run demo` | Sobe o painel com dados fictícios. |
| `npm test` | Roda os testes. |

As opções do servidor vão depois de `--`: `npm run dev -- --demo --porta 3001`.

### `npm run stop`

```bash
npm run stop                    # o painel da porta 3000 (ou da variável PORT)
npm run stop -- --porta 3001    # o de outra porta
npm run stop -- --todos         # todos os painéis deste projeto
npm run stop -- --listar        # só mostra o que seria encerrado, sem encerrar
```

Só é encerrado um processo `node` que esteja rodando o `server.js` ou o `scripts/dev.js` **deste projeto**: outro
projeto que também tenha um `server.js`, ou qualquer outro programa, nunca é tocado. Sem `--todos`, painéis deste
projeto em outras portas também não: aparecem só como aviso. O `stop` não usa arquivo de PID; ele consulta `ps` e
`lsof`, então também acha um painel iniciado direto com `node server.js`. Funciona em macOS e Linux; no Windows, use
Ctrl+C no terminal do painel. `npm stop` (sem `run`) faz o mesmo. Para parar um painel no terminal onde ele roda,
Ctrl+C continua valendo.

## Opções

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `--porta N` (`PORT`) | 3000 | Porta do painel. |
| `--intervalo S` (`INTERVALO`) | 60 | Segundos entre consultas ao TSE. Mínimo de 30, para não sobrecarregar o servidor. |
| `--turno N` (`TURNO`) | 1 | `2` acompanha o 2º turno (só presidente e governador). |
| `--cargos LISTA` (`CARGOS`) | `1,3,5,6,7` | Códigos: 1 presidente, 3 governador, 5 senador, 6 dep. federal, 7 dep. estadual (só SP e RJ), 8 dep. distrital. Use `1,3,5,6,7,8` para incluir também o distrital. |
| `--demo` (`DEMO=1`) | desligado | Modo demonstração (dados fictícios). |
| `--demo-minutos N` | 8 | Duração da simulação. |
| `--sem-abrir` (`ABRIR=0`) | abre sozinho em terminal interativo | Não abre o navegador ao iniciar. `--abrir` (ou `ABRIR=1`) força a abertura mesmo fora de um terminal interativo. |
| `--navegador NOME` (`NAVEGADOR`) | `Safari` no macOS | App em que o painel abre, ex.: `"Google Chrome"`. Só vale no macOS; em outros sistemas abre o navegador padrão (não testado). |
| `--verboso` (`VERBOSO=1`) | desligado | Loga todo ciclo de consultas. Por padrão o terminal só mostra o primeiro ciclo e variações de erros ou de arquivos indisponíveis. |
| `--host H` (`HOST`) | `127.0.0.1` | Use `0.0.0.0` só se quiser abrir o painel para outros aparelhos da sua rede. |
| `--ano A` (`ANO`) | 2026 | Ciclo eleitoral. |
| `--sem-municipios` (`MUNICIPIOS=0`) | carga ligada | Desliga a carga, em segundo plano, dos municípios da presidência (usada na projeção do Brasil). Os municípios de uma UF ainda carregam sob demanda. |
| `--municipios-minimo N` (`MUNICIPIOS_MINIMO`) | 30000 | Só municípios com pelo menos N eleitores (mais o maior de cada UF) têm o arquivo baixado; o resto da UF vem do arquivo da UF. |
| `--municipios-ritmo-ms N` (`MUNICIPIOS_RITMO_MS`) | 120 | Milissegundos entre dois pedidos de município ao TSE (120 ≈ 8 por segundo; 200 era o ritmo anterior, ≈ 5 por segundo). Entre 50 e 2000. Se o TSE responder 429, o painel dobra o intervalo sozinho; se acontecer, volte a `200`. |
| `--municipios-todos` | desligado | Baixa todos os municípios (~5,7 mil arquivos), em vez de só os grandes. |

## Como funciona

```
TSE (JSON estático, CDN)  →  poller  →  normalização  →  memória  →  API + SSE  →  navegador
```

- **Descoberta**: ao iniciar, lê `…/oficial/comum/config/ele-c.json` e descobre os códigos das eleições do ano
  (em 2026: federal 6257/6258, estadual 6259/6260). Nada de código de eleição fixo.
- **Arquivos**: um por cargo × abrangência, no padrão
  `…/oficial/ele2026/{eleição}/dados/{uf}/{uf}-c{cargo}-e{eleição}-u.json` (o `-u` é o "resultado unificado").
  São 110 arquivos no 1º turno: presidente (Brasil, 27 UFs e exterior), governador, senador e deputado federal
  (27 UFs cada).
- **Polling educado**: o TSE serve esses arquivos por CDN com `max-age` de ~1 min e `ETag`. O painel reenvia o
  `ETag` (GET condicional) e só reprocessa o que mudou; com no máximo 6 requisições simultâneas. Um limitador de
  ritmo, compartilhado com a camada de municípios, dá **prioridade ao dado por UF** e faz tudo recuar se o TSE
  responder 429 (limite de requisições).
- **Camada de municípios** (só para o mapa e as projeções): separada do ciclo principal, lenta e descartável. Baixa só os
  municípios grandes, guiada pelo arquivo de acompanhamento do TSE, com cache em disco. Detalhes em
  [docs/arquitetura.md](docs/arquitetura.md).
- **Tempo real no navegador**: o servidor avisa a página por SSE (`/events`) a cada ciclo, com a lista de arquivos
  que mudaram. A página só rebusca e redesenha quando algo mudou.
- **Antes da apuração**: os arquivos já existem, mas com votos zerados; o painel mostra "Aguardando apuração".
  Arquivos que o TSE ainda não publicou (ex.: 2º turno) aparecem como indisponíveis, sem erro.

### Mapa de cadeiras

Em **Senador · Brasil** e **Deputado Federal · Brasil** aparece o hemiciclo da composição: um ponto por cadeira, cinza
até o TSE marcar o eleito, depois na cor do partido. O botão **Por partido / Por ideologia** muda o agrupamento, e
clicar num grupo (esquerda, centrão, direita, independente) abre os partidos dele; clicar num partido destaca a
bancada. No Senado, as 27 cadeiras que não estão em disputa em 2026 entram como pontos menores, com o partido atual
do senador (`public/senado-ocupadas.json`, gerado por `node scripts/gerar-senado.js` a partir dos dados abertos do
Senado). A classificação ideológica é **editorial e aproximada**, não um dado oficial: está em `public/ideologia.js`.

### O mapa

O mapa é o contorno real das 27 UFs, desenhado em SVG a partir das malhas do IBGE (qualidade mínima, ~58 KB em
`public/mapa-brasil.js`). Nada é buscado fora do seu computador em tempo de execução. Nos cargos majoritários a UF
leva a cor do partido do mais votado, **mais clara quanto menos seções foram totalizadas**; nos demais, a cor indica só
o quanto foi totalizado. Passe o mouse numa UF para ver o líder e a apuração. Para regerar os contornos:
`node scripts/gerar-mapa.js`.

**Municípios.** Ao abrir uma UF no presidente, governador ou senador, o mapa passa a mostrar os municípios dela,
coloridos pela mesma regra. Os contornos (~1,7 MB no total, um arquivo por UF em `public/municipios/`, carregado só
quando a UF é aberta) também vêm do IBGE e são indexados pelo código de município do TSE, que a lista de municípios
do TSE liga ao código do IBGE. Para regerá-los: `node scripts/gerar-municipios.js`. Os resultados vêm de
`/api/municipios/:cargo/:uf`; se essa rota não existir, o painel continua no mapa do Brasil. Fora do mapa de
municípios ficam o exterior (sem geometria) e o DF (um município só).

### "Sem chance" e "Eleito*" (governador e senador)

Na tabela de governador e senador (visão Brasil) e na lista de candidatos da UF, o painel faz duas contas **suas**, que não são o
resultado do TSE (`public/chances.js`):

- **Sem chance** (escondido por padrão, com botão para mostrar): quem não alcança os classificados (os 2 do 2º turno em
  governador e presidente; as vagas no Senado) nem recebendo todos os votos que faltam, estimados pelo comparecimento e pelos
  votos válidos já medidos, com margem de 15%. No 1º turno, se o líder já passa de 50% dos válidos mesmo sem receber mais
  nenhum voto, os demais ficam sem chance (não há 2º turno).
- **Eleito\***: quem o painel dá como eleito (selo verde com asterisco e explicação ao passar o mouse) quando o TSE ainda não o
  marcou. Vale **só quando há garantia**: os adversários não o alcançam nem recebendo tudo o que falta (garantia matemática, pelo
  teto de eleitores das seções que faltam) ou nem com os votos que faltam estimados pela abstenção medida, com margem de 15%
  (garantia prática). **Não há palpite pelo % atual**: uma regra "provável", que dava como eleito quem passava de 50% mesmo
  descontada uma folga, foi retirada porque, com a apuração em andamento, o % final pode se afastar do atual (as regiões chegam
  em ordens diferentes). O selo oficial "Eleito" continua sendo só o do TSE. Na visão Brasil de governador e senador, uma lista **nome a nome** dos eleitos (TSE ou pela conta) e, no mapa, as UFs com tudo definido ficam em cor cheia, com contorno escuro e ✓ no rótulo (no Senado, contorno tracejado com 1 das 2 vagas).

### Visão Análise (partidos e ideologia)

No seletor da direita, ao lado de **Apuração** e **Projeção**, a visão **Análise** respeita o cargo escolhido à esquerda:
para Governador, Senador, Deputado Federal e Deputado Estadual mostra as bancadas por **bloco ideológico** (Esquerda,
Centrão, Direita, Independente) e por partido; na Presidência mostra o Comparativo (abaixo). Numa linha só ficam o seletor
de análise e o **Agrupar por** (**Ideologia** ou **Partido**, os maiores e as cores de cada um):

- **Placar**: hemiciclos lado a lado das duas últimas eleições (por exemplo 2018 e 2022) e de 2026 e, em cima, um cartão por bloco ou partido com as
  cadeiras de 2026, a variação e uma barra em que a parte da eleição anterior fica clara e a diferença se destaca (a mais,
  cheia; a menos, hachurada), com o valor da eleição anterior embaixo. Ao passar o mouse numa cadeira ou na legenda, o bloco
  ou partido é destacado e uma dica mostra o total em cada eleição mostrada. Em **Governadores**, no lugar dos hemiciclos há o mapa
  em que cada UF é dividida ao meio (esquerda = eleição anterior, direita = 2026): quando mudou, as duas cores; enquanto 2026 não
  está definido, a cor de 2022 e cinza. A metade de 2026 conta o que o TSE já publicou: **cor cheia** = eleito; **clara** =
  na frente com mais de 50% dos válidos (pode fechar no 1º turno); **listrada** = na frente com 50% ou menos (provável 2º
  turno) ou 2º turno já marcado pelo TSE. Há também as listas de viradas e de bastiões.
- **Prévia das vagas de deputado** (Câmara e Assembleias): se o TSE ainda não distribuiu todas as vagas entre os partidos e
  federações, o painel **estima** a distribuição pelo quociente eleitoral com os votos já apurados (quociente = válidos ÷
  vagas; cada lista leva `votos ÷ quociente`; as sobras vão pela maior média `votos ÷ (vagas + 1)`, com todas as listas
  disputando, como decidiu o STF) e mostra essas vagas como "na frente". É uma estimativa e muda até o fim: as regiões
  chegam em ordens diferentes. Os nomes dentro de cada lista vão pelo ranking. Quando o TSE publica a distribuição, vale a dele.
- **Série histórica**: participação de cada bloco (ou dos maiores partidos) desde 2014.
- **Um partido** (só Deputado Federal e Estadual): escolha um partido (o padrão é o **Missão**) e veja quantos deputados ele tem
  até agora: eleitos confirmados pelo TSE, vagas na frente (estimativa pelo quociente, quando for o caso), o total e a
  bancada de 2022. Na Câmara há a tabela por UF (votos da lista, % dos válidos, cadeiras, mais votados do partido) e a distância até a
  **cláusula de desempenho de 2026** (13 deputados em 9 UFs, ou 2,5% dos votos válidos com pelo menos 1,5% em 9 UFs); nas
  Assembleias de SP e RJ, os candidatos mais votados do partido. Endereço: `#/6/br/analise/foco/p-missao`. Federações contam como um partido.
- **Deputado estadual** só existe para SP e RJ (um seletor de UF aparece na linha de seletores): é a Assembleia Legislativa,
  com 94 e 70 cadeiras.

O endereço guarda a escolha (`#/6/br/analise/serie/partido`: Câmara, série histórica por partido; `#/7/rj/analise`: Assembleia do RJ). Os endereços antigos (`#/partidos/...`) redirecionam.

- Os blocos são uma **classificação editorial** (`public/ideologia.js`), não um dado oficial. Edite as listas à vontade.
- Os eleitos de 2014, 2018 e 2022 vêm de `dados-historicos/eleitos.json`, gerado por `node scripts/gerar-eleitos.js` (três
  zips de ~4,5 MB dos dados abertos do TSE). `dados-historicos/partidos-sucessao.json` traduz siglas antigas para o partido de
  hoje (PMDB → MDB, DEM → UNIÃO...) e também é editável; reinicie o painel depois de mudar.
- No Senado, a bancada de um ano soma os eleitos dele e os de quatro anos antes; em 2026 as 27 cadeiras fora de disputa vêm
  de `public/senado-ocupadas.json` (com o partido atual de cada senador).
- Durante a apuração, as vagas que o TSE ainda não marcou como eleitas entram como "na frente" (contorno no hemiciclo e tom
  mais claro no mapa), então os números mudam até a totalização final. A Câmara usa também as vagas já dadas a cada
  partido ou federação. 

### Comparativo com eleições anteriores

Na visão **Análise** de **Presidente**, o **Comparativo** compara o PT (Lula ou Haddad) com ele
mesmo e o campo de Bolsonaro (Flávio ou Bolsonaro) com Bolsonaro, no 1º turno. O seletor do painel escolhe o período:
**2026 × 2022**, **2026 × 2018** (a apuração de 2026 ao vivo) e **2022 × 2018** (as duas encerradas: serve para testar a
página com dados reais antes da apuração). O endereço guarda a escolha (`#/1/br/analise/2022x2018`, com a UF no lugar de `br` se houver uma aberta); o endereço antigo (`#/1/br/comparativo`) redireciona.

A informação principal é o **impacto no saldo nacional**, não a variação dentro da UF: o saldo da UF é a variação do PT
menos a do campo de Bolsonaro (em pontos percentuais dos votos válidos) e o impacto é o saldo multiplicado pelo peso da UF
(votos válidos da eleição base ÷ total). Assim o Acre, que varia muito e pesa 0,4%, quase não aparece, e São Paulo domina.
Só entram na soma as UFs com pelo menos 30% das seções totalizadas (em 2026), porque as regiões chegam em ordens diferentes.
O mapa é pintado pelo saldo de cada UF; clicar numa região do painel destaca ela e lista as UFs. **Variação não é
transferência de votos**: com dados por UF não dá para saber de quem veio cada voto.

### API local

- `GET /api/meta` — configuração, cargos e estado do último ciclo.
- `GET /api/resumo` — uma linha por cargo × abrangência (líder, seções, eleitos).
- `GET /api/resultado/{cargo}/{uf}` — resultado completo (ex.: `/api/resultado/1/br`).
- `GET /api/municipios/{cargo}/{uf}` — líder e apuração de cada município de uma UF (cargos 1, 3 e 5).
- `GET /api/projecao/{modelo}/{cargo}/{uf}` — projeção (`estratificado`, `swing`); pode vir
  `disponivel: false` com o motivo, ou `carregando: true`.
- `GET /api/historico/{cargo}/{uf}?modelo=` — série gravada da evolução da apuração (404 se não houver).
- `GET /api/busca?q=&cargo=&uf=` — busca global de candidatos e municípios.
- `GET /api/comparativo/presidente?periodo=` — base por UF para o comparativo (`2026x2022`, `2026x2018`, `2022x2018`); pode vir `disponivel: false` com o motivo.
- `GET /events` — SSE, evento `ciclo`.

`/api/meta` também traz `requisicoes`: pedidos ao TSE por prioridade, por minuto e quantos 429/503.

### Como ler os números

- A barra de progresso é de **seções totalizadas**, como no app oficial do TSE.
- Percentuais parciais enganam: capitais e interior, ou regiões diferentes, chegam em ordens diferentes. Por isso o
  painel mostra sempre o quanto já foi totalizado e avisa que o resultado é parcial.
- A visão **Apuração** **não faz projeção** nem declara vencedor por conta própria. "Eleito", "2º turno" e
  "matematicamente definido" vêm do TSE.
- A visão **Projeção (estimativa)** é separada e sempre rotulada como estimativa do painel, não dado do TSE. Há três
  modelos, que usam votos válidos e a fração de seções totalizadas (fórmulas em
  [docs/arquitetura.md](docs/arquitetura.md)):
  - A **extrapolação simples** (mantém o % atual) foi retirada da tela por errar de 3 a 5 pp nos ensaios; fica só como plano
    B dos outros modelos. Por isso deputado não tem aba Projeção.
  - **Estratificação por município** (presidente, governador e senador): projeta os **municípios grandes** um a um e o
    **resto do estado** em bloco (arquivo da UF menos os grandes). Estratos ainda sem votos entram pelo eleitorado e
    pela média do medido; a tela mostra quanto da projeção depende disso. Se os arquivos da UF e dos municípios
    estiverem em momentos diferentes (conferência de sincronia), a UF volta para a extrapolação simples e a tela avisa.
    Na presidência soma também o Brasil, depois que as 28 UFs carregam.
  - **Swing histórico (2022)** (só presidente): mede quanto cada candidato está acima ou abaixo do que o campo dele
    teve em 2022 nos lugares já bem apurados e aplica a variação ao que falta, lugar por lugar. Quem herda os votos
    de cada candidato de 2022 está em `dados-historicos/mapeamento-presidente.json` (por padrão só o mesmo partido;
    edite e reinicie). Os votos de 2022 por município (`presidente-2022-t1.json`) são gerados por
    `node scripts/gerar-historico-2022.js`, que lê só ~2 MB de um zip dos dados abertos do TSE.
  A "faixa possível" são os extremos matemáticos, não um intervalo de confiança. O modelo bayesiano com pesquisas
  não está implementado. **Nenhum modelo foi validado com votos reais ainda.**
- Para cargos sem arquivo nacional (governador, senador, deputados), "Brasil" é a **soma das UFs** calculada
  localmente.

### Evolução da apuração (histórico gravado)

O painel só guarda o último estado de cada arquivo, então **grava** cada atualização de presidente, governador e senador
em `dados/historico/ele2026-t1.jsonl` (uma linha JSON por arquivo novo do TSE: o % de cada candidato e a projeção de
cada modelo calculada naquele instante). Alimenta o gráfico de evolução e permite comparar os modelos com o resultado
final depois da eleição. A pasta `dados/` (e `.cache/`, o cache dos municípios) ficam fora do git.

## Na noite da apuração

- Rode com **`npm start`**, não `npm run dev`: o `dev` reinicia o servidor a cada arquivo salvo.
- Mantenha **uma instância só** apontando para o TSE; várias somam requisições.
- Ligue **antes** de a apuração começar: a carga inicial dos municípios leva alguns minutos e é melhor em horário morto.
- Se o TSE responder 429, o painel recua sozinho; acompanhe `requisicoes.limitadas` em `/api/meta`. Não tente contornar o
  limite com várias máquinas ou IPs: o caminho é pedir menos.

## Limitações conhecidas

- O formato lido é o que o próprio app de resultados do TSE usa. A semântica dos campos foi conferida no código
  desse app; a página da especificação oficial bloqueia acesso automatizado e não foi consultada. **Os arquivos
  existentes antes da votação têm todos os votos zerados**, então o comportamento com votos reais só pôde ser
  testado com dados sintéticos construídos sobre a estrutura real. Nos primeiros minutos da apuração, compare com
  o app oficial do TSE.
- Conselheiro Distrital (Fernando de Noronha) não é acompanhado: o TSE ainda não publica esse arquivo.
- Deputado estadual: só SP e RJ (`CARGOS[7]` em `src/tse.js`), sem projeção nem gráfico de evolução; é volumoso e menos testado na interface.
- O modo demonstração simplifica o desfecho (não aplica quociente eleitoral).
- **A visão Análise não foi vista com votos reais**: a prévia das vagas de deputado (estimada pelo quociente eleitoral) e a situação de cada governador no mapa (clara, listrada ou cheia) dependem de como o TSE publica durante a contagem. São estimativas, mudam até o fim e foram desenhadas para o 1º turno (detalhes em [docs/arquitetura.md](docs/arquitetura.md)).
- **As projeções não foram validadas com votos reais.** Os cálculos foram testados com dados sintéticos; o descompasso
  entre os arquivos do TSE só aparece ao vivo. A validação deve usar o histórico gravado, depois da eleição.
- O swing só existe para presidente; governador e senador exigiriam os dados de 2022 por UF (~290 MB).
- Na estratificação, a unidade é o município (não a zona); em capitais grandes a ordem de apuração dentro da cidade
  ainda distorce. O resto do estado supõe que as seções que faltam votam como as que já abriram.
- No auge da apuração a carga dos municípios (~8 req/s por padrão) pode deixar um município até ~20 minutos sem atualizar; o dado por
  UF não é afetado.

## Testes

```bash
node --test
```

Cobrem normalização (com fixtures reais do TSE), regra de situação do candidato, motor de polling (ETag, erros,
recuperação, concorrência), limitador, camada de municípios, projeções e swing, histórico, simulação, configuração e o
servidor HTTP/SSE. O GitHub Actions roda a suíte em Node 20 e 22 a cada push na `main` e em pull requests. Os testes do `dev` e do `stop` usam
processos de verdade em pastas temporárias, incluindo um "estranho" que precisa sobreviver ao `stop`.

As fixtures em `test/fixtures/` são cópias de arquivos públicos de resultado publicados pelo TSE em
`resultados.tse.jus.br`, usadas só para testar a leitura do formato. Foram colhidas antes da votação, então trazem
nomes de candidatos e partidos reais, mas **todos os votos zerados**.

## Estrutura

```
server.js            ponto de entrada
src/tse.js           URLs, descoberta das eleições, fontes reais (GET condicional)
src/normalize.js     JSON bruto do TSE → formato interno
src/apuracao.js      ciclo principal (arquivos por UF)
src/municipios.js    camada de municípios (seleção dos grandes, acompanhamento, cache)
src/cache-disco.js   cache dos municípios em .cache/
src/limitador.js     ritmo único ao TSE: prioridade da UF, recuo em 429, contadores
src/projecao.js      extrapolação simples, estratificação por município, soma do Brasil
src/swing.js         swing histórico (2022)
src/anterior.js      resultado de 2022 traduzido pelo mapeamento de herança
src/partidos.js      eleitos de 2014, 2018 e 2022 por partido, com a tabela de sucessão (/api/partidos)
src/historico.js     gravador do histórico da apuração e leitura da série
src/busca.js         busca global
src/servidor.js      HTTP, API e SSE
src/demo.js          simulação com dados fictícios
src/config.js        opções e variáveis de ambiente
src/abrir.js         abre o painel no navegador ao iniciar
src/supervisor.js    npm run dev: reinicia o servidor quando o código muda
src/parar.js         npm run stop: acha e encerra só o painel deste projeto
public/              interface (HTML, CSS e JS sem build); mapa-brasil.js e municipios/ são gerados
dados-historicos/    2022 e 2018 por município, mapeamentos de herança, eleitos de 2014 a 2022 e sucessão de partidos (versionados)
dados/               histórico da apuração gravado (fora do git)
.cache/              cache dos municípios (fora do git)
scripts/             geradores (gerar-mapa, gerar-municipios, gerar-senado, gerar-eleitos, gerar-historico-2022 e -2018), dev e stop
docs/                arquitetura.md e modelos-simulacao.md
test/                testes e fixtures
```
