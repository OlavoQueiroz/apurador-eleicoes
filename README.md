# Apurador das eleições

Painel local que acompanha a apuração em tempo real a partir dos **arquivos públicos de resultado do TSE**
(`resultados.tse.jus.br`). Não conta votos: lê o que o TSE publica, normaliza e mostra.

Cargos: presidente, governador, senador e deputado federal.
Deputado estadual e deputado distrital (DF) ficam de fora por padrão (ver [Opções](#opções)).

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
| `--cargos LISTA` (`CARGOS`) | `1,3,5,6` | Códigos: 1 presidente, 3 governador, 5 senador, 6 dep. federal, 7 dep. estadual, 8 dep. distrital. Use `1,3,5,6,7,8` para incluir estaduais e distrital. |
| `--demo` (`DEMO=1`) | desligado | Modo demonstração (dados fictícios). |
| `--demo-minutos N` | 8 | Duração da simulação. |
| `--sem-abrir` (`ABRIR=0`) | abre sozinho em terminal interativo | Não abre o navegador ao iniciar. `--abrir` (ou `ABRIR=1`) força a abertura mesmo fora de um terminal interativo. |
| `--navegador NOME` (`NAVEGADOR`) | `Safari` no macOS | App em que o painel abre, ex.: `"Google Chrome"`. Só vale no macOS; em outros sistemas abre o navegador padrão (não testado). |
| `--verboso` (`VERBOSO=1`) | desligado | Loga todo ciclo de consultas. Por padrão o terminal só mostra o primeiro ciclo e variações de erros ou de arquivos indisponíveis. |
| `--host H` (`HOST`) | `127.0.0.1` | Use `0.0.0.0` só se quiser abrir o painel para outros aparelhos da sua rede. |
| `--ano A` (`ANO`) | 2026 | Ciclo eleitoral. |

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
  `ETag` (GET condicional) e só reprocessa o que mudou; com no máximo 6 requisições simultâneas.
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

### API local

- `GET /api/meta` — configuração, cargos e estado do último ciclo.
- `GET /api/resumo` — uma linha por cargo × abrangência (líder, seções, eleitos).
- `GET /api/resultado/{cargo}/{uf}` — resultado completo (ex.: `/api/resultado/1/br`).
- `GET /events` — SSE, evento `ciclo`.

### Como ler os números

- A barra de progresso é de **seções totalizadas**, como no app oficial do TSE.
- Percentuais parciais enganam: capitais e interior, ou regiões diferentes, chegam em ordens diferentes. Por isso o
  painel mostra sempre o quanto já foi totalizado e avisa que o resultado é parcial.
- A visão **Apuração** **não faz projeção** nem declara vencedor por conta própria. "Eleito", "2º turno" e
  "matematicamente definido" vêm do TSE.
- A visão **Projeção (estimativa)** é separada e sempre rotulada como estimativa do painel, não dado do TSE.
  Há dois modelos (plano completo em `docs/modelos-simulacao.md`):
  - **Extrapolação simples**: mantém o percentual atual e projeta o total pela fração de seções totalizadas,
    ignorando o viés geográfico da ordem de apuração.
  - **Estratificação por município** (presidente, governador e senador, uma UF por vez): projeta cada município
    pela fração das seções dele já apuradas e soma. Municípios ainda sem votos entram pelo eleitorado e pela média
    da UF; a tela mostra quanto da projeção depende disso. Os arquivos dos municípios são buscados só quando
    alguém abre essa projeção (até ~645 por UF) e atualizados no ritmo do ciclo, com GET condicional.
    Na presidência, o painel também baixa os municípios do país **em segundo plano** ao ligar (~5,7 mil
    arquivos, ~5 por segundo, uns 20 minutos na primeira vez; municípios já 100% apurados deixam de ser
    consultados; e uma UF cujo arquivo (ciclo principal) não mudou desde a última carga é pulada, com revisita
    de segurança a cada 10 minutos). Isso soma o Brasil na projeção. O resultado fica em `.cache/` e um reinício não rebaixa tudo.
    `--sem-municipios` desliga a carga em segundo plano. Se o TSE responder 429 (limite de requisições), o
    painel recua sozinho; o ritmo é deliberadamente baixo.
  - **Swing histórico (2022)** (só presidente): mede quanto cada candidato está acima ou abaixo do que o campo dele
    teve em 2022 nos lugares já bem apurados e aplica essa variação ao que falta, lugar por lugar (os mesmos grandes
    municípios e o resto do estado do modelo anterior). Quem herda os votos de cada candidato de 2022 está em
    `dados-historicos/mapeamento-presidente.json` (por padrão só o mesmo partido; edite e reinicie). Os votos de 2022
    por município estão em `dados-historicos/presidente-2022-t1.json`, gerado por
    `node scripts/gerar-historico-2022.js` (lê só ~2 MB de um zip dos dados abertos do TSE).
  A "faixa possível" são os extremos matemáticos, não um intervalo de confiança.
  API: `GET /api/projecao/{modelo}/{cargo}/{uf}`.
- Para cargos sem arquivo nacional (governador, senador, deputados), "Brasil" é a **soma das UFs** calculada
  localmente.

## Limitações conhecidas

- O formato lido é o que o próprio app de resultados do TSE usa. A semântica dos campos foi conferida no código
  desse app; a página da especificação oficial bloqueia acesso automatizado e não foi consultada. **Os arquivos
  existentes antes da votação têm todos os votos zerados**, então o comportamento com votos reais só pôde ser
  testado com dados sintéticos construídos sobre a estrutura real. Nos primeiros minutos da apuração, compare com
  o app oficial do TSE.
- Conselheiro Distrital (Fernando de Noronha) não é acompanhado: o TSE ainda não publica esse arquivo.
- Deputado estadual: suportado (`--cargos 1,3,5,6,7,8`), mas é volumoso e menos testado na interface.
- O modo demonstração simplifica o desfecho (não aplica quociente eleitoral).

## Testes

```bash
node --test
```

Cobrem normalização (com fixtures reais do TSE), regra de situação do candidato, motor de polling (ETag, erros,
recuperação, concorrência), simulação, configuração e o servidor HTTP/SSE. Os testes do `dev` e do `stop` usam
processos de verdade em pastas temporárias, incluindo um "estranho" que precisa sobreviver ao `stop`.

As fixtures em `test/fixtures/` são cópias de arquivos públicos de resultado publicados pelo TSE em
`resultados.tse.jus.br`, usadas só para testar a leitura do formato. Foram colhidas antes da votação, então trazem
nomes de candidatos e partidos reais, mas **todos os votos zerados**.

## Estrutura

```
server.js            ponto de entrada
src/tse.js           URLs, descoberta das eleições, fonte real (GET condicional)
src/normalize.js     JSON bruto do TSE → formato interno
src/apuracao.js      motor de acompanhamento
src/servidor.js      HTTP, API e SSE
src/demo.js          simulação com dados fictícios
src/config.js        opções e variáveis de ambiente
src/abrir.js         abre o painel no navegador ao iniciar
src/supervisor.js    npm run dev: reinicia o servidor quando o código muda
src/parar.js         npm run stop: acha e encerra só o painel deste projeto
public/              interface (HTML, CSS e JS sem build); mapa-brasil.js é gerado
scripts/gerar-mapa.js  baixa as malhas do IBGE e gera public/mapa-brasil.js
scripts/dev.js       npm run dev (usa src/supervisor.js)
scripts/stop.js      npm run stop (usa src/parar.js)
test/                testes e fixtures
```
