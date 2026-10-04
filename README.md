# Apurador das eleições

Painel local que acompanha a apuração em tempo real a partir dos **arquivos públicos de resultado do TSE**
(`resultados.tse.jus.br`). Não conta votos: lê o que o TSE publica, normaliza e mostra.

Cargos: presidente, governador, senador, deputado federal e deputado distrital (DF).
Deputado estadual fica de fora por padrão (ver [Opções](#opções)).

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

## Opções

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `--porta N` (`PORT`) | 3000 | Porta do painel. |
| `--intervalo S` (`INTERVALO`) | 60 | Segundos entre consultas ao TSE. Mínimo de 30, para não sobrecarregar o servidor. |
| `--turno N` (`TURNO`) | 1 | `2` acompanha o 2º turno (só presidente e governador). |
| `--cargos LISTA` (`CARGOS`) | `1,3,5,6,8` | Códigos: 1 presidente, 3 governador, 5 senador, 6 dep. federal, 7 dep. estadual, 8 dep. distrital. Use `1,3,5,6,7,8` para incluir estaduais. |
| `--demo` (`DEMO=1`) | desligado | Modo demonstração (dados fictícios). |
| `--demo-minutos N` | 8 | Duração da simulação. |
| `--sem-abrir` (`ABRIR=0`) | abre sozinho em terminal interativo | Não abre o navegador ao iniciar. `--abrir` (ou `ABRIR=1`) força a abertura mesmo fora de um terminal interativo. |
| `--navegador NOME` (`NAVEGADOR`) | `Safari` no macOS | App em que o painel abre, ex.: `"Google Chrome"`. Só vale no macOS; em outros sistemas abre o navegador padrão (não testado). |
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
  São 111 arquivos no 1º turno: presidente (Brasil, 27 UFs e exterior), governador, senador e deputado federal
  (27 UFs cada) e deputado distrital (DF).
- **Polling educado**: o TSE serve esses arquivos por CDN com `max-age` de ~1 min e `ETag`. O painel reenvia o
  `ETag` (GET condicional) e só reprocessa o que mudou; com no máximo 6 requisições simultâneas.
- **Tempo real no navegador**: o servidor avisa a página por SSE (`/events`) a cada ciclo, com a lista de arquivos
  que mudaram. A página só rebusca e redesenha quando algo mudou.
- **Antes da apuração**: os arquivos já existem, mas com votos zerados; o painel mostra "Aguardando apuração".
  Arquivos que o TSE ainda não publicou (ex.: 2º turno) aparecem como indisponíveis, sem erro.

### API local

- `GET /api/meta` — configuração, cargos e estado do último ciclo.
- `GET /api/resumo` — uma linha por cargo × abrangência (líder, seções, eleitos).
- `GET /api/resultado/{cargo}/{uf}` — resultado completo (ex.: `/api/resultado/1/br`).
- `GET /events` — SSE, evento `ciclo`.

### Como ler os números

- A barra de progresso é de **seções totalizadas**, como no app oficial do TSE.
- Percentuais parciais enganam: capitais e interior, ou regiões diferentes, chegam em ordens diferentes. Por isso o
  painel mostra sempre o quanto já foi totalizado e avisa que o resultado é parcial.
- O painel **não faz projeção** nem declara vencedor por conta própria. "Eleito", "2º turno" e "matematicamente
  definido" vêm do TSE.
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
recuperação, concorrência), simulação, configuração e o servidor HTTP/SSE.

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
public/              interface (HTML, CSS e JS sem build)
test/                testes e fixtures
```
