> **Status no painel (atualizado).** Este é o plano original, com quatro modelos. O que existe hoje:
>
> | Modelo | Situação | Como ficou |
> | --- | --- | --- |
> | 1. Extrapolação simples | **Retirado da interface** | `projetarIngenuo` segue como plano B dos outros modelos e como base de comparação. |
> | 2. Estratificação geográfica | Implementado, **com mudanças** | A unidade é o **município** (não a zona). Só os **municípios grandes** (30 mil eleitores ou mais, mais o maior de cada UF) são baixados; o **resto do estado** é o arquivo da UF menos os grandes, projetado em bloco. Não usa abstenção histórica: usa a fração de seções apuradas de cada parte. Presidente, governador e senador. |
> | 3. Swing histórico | Implementado **só para presidente** | Por município e resto do estado, não por "zonas de perfil semelhante": o swing é medido nos lugares já apurados, com peso que cresce até 50% apurado, e aplicado ao que falta. A herança de votos de 2022 é editável (`dados-historicos/mapeamento-presidente.json`). |
> | 4. Bayesiano com pesquisas | **Não implementado** | Depende de pesquisas em formato estruturado e de MRP. A curva de pesos abaixo é uma proposta sem calibração. |
>
> As fórmulas e decisões do que existe estão em [arquitetura.md](arquitetura.md). Nenhum modelo foi validado com votos
> reais ainda. As seções abaixo são o texto original e **não descrevem o código**.

---

# Arquitetura Completa de Simulação de Apuração Eleitoral

Este documento detalha as abordagens para criar um simulador preditivo de resultados finais com base em dados parciais da apuração. Recomendamos a implementação de uma chave de seleção (toggle/dropdown) na interface do usuário, permitindo que o usuário escolha entre **quatro** modelos matemáticos para acompanhar a evolução dos dados.

## Opções de Modelos de Projeção

### Modelo 1: Extrapolação Simples (Modelo Ingênuo)

* **Como funciona:** Aplica o percentual atual de cada candidato ao total de votos válidos que ainda não foram apurados no bolo geral.  
* **Prós:** Fácil implementação.  
* **Contras:** Altamente volátil e sofre forte viés geográfico (miragens de liderança nos primeiros 30% da apuração).  
* **Fórmula:** `Projeção = Votos Atuais + (Votos Faltantes Globais * % Atual do Candidato)`

### Modelo 2: Estratificação Geográfica (Matemático)

* **Como funciona:** Divide a eleição em "baldes" (Zonas Eleitorais) e projeta o resultado de cada balde individualmente com base nos votos já apurados daquela mesma região.  
* **Prós:** Corrige a distorção inicial de apuração; precisão sólida após 15-20% das urnas abertas.  
* **Contras:** Exige cruzamento prévio com o banco de dados (eleitores aptos, histórico de abstenção).  
* **Fórmula base por zona:** `Projeção na Zona = (Votos Atuais na Zona / Votos Válidos Apurados na Zona) * (Eleitores Aptos da Zona * (1 - Taxa de Abstenção Histórica))`

### Modelo 3: Swing Histórico (Baseado em Eleições Anteriores)

* **Como funciona:** Monitora as seções que já chegaram a 100% de apuração e compara o resultado atual com o resultado que o mesmo partido/campo político obteve nelas na eleição passada.  
* **Prós:** Permite capturar "ondas" eleitorais muito cedo, sem depender de pesquisas de opinião.  
* **Contras:** Partidos mudam de nome, alianças se desfazem e candidatos trocam de lado, exigindo um mapeamento prévio robusto para definir quem "herda" os votos da eleição anterior.  
* **Dinâmica:**  
  1. Urnas da Zona X chegam a 100%.  
  2. O sistema calcula a variação: "Partido Y está performando 3% melhor aqui do que em 2022".  
  3. O algoritmo aplica o ganho (+3%) sobre o histórico de todas as zonas com perfil semelhante que ainda estão zeradas na apuração atual.

### Modelo 4: Modelagem Bayesiana com Pesquisas (Avançado)

* **Como funciona:** Utiliza pesquisas de intenção de voto como "conhecimento prévio" (Prior) e realiza uma transição (blending) para os dados reais da urna conforme a apuração avança.  
* **Prós:** Permite projeções altamente precisas logo nos primeiros minutos (0% a 5%). É o padrão ouro de veículos estatísticos modernos.  
* **Contras:** Alta complexidade técnica; exige cruzamento demográfico (MRP) e cálculo dinâmico de viés de erro das pesquisas.  
* **Fórmula de Blending por zona:** `Projeção = (Estimativa_Pesquisa × Peso_Pesquisa) + (Projeção_Estratificada_Real × Peso_Real)`

---

## Detalhamento do Modelo Bayesiano (Modelo 4\)

### 1\. A Curva de Decaimento (Ajuste de Pesos)

A transição da pesquisa para a realidade não é linear, pois uma amostragem real nas urnas rapidamente supera a relevância da pesquisa. O peso da pesquisa cai assim:

- **0% apurado:** Pesquisa vale 100% / Realidade vale 0%  
- **5% apurado:** Pesquisa vale 50% / Realidade vale 50%  
- **15% apurado:** Pesquisa vale 10% / Realidade vale 90%  
- **Acima de 25%:** Pesquisa é descartada (0%) / Realidade assume 100%

### 2\. Regressão Multinível com Pós-estratificação (MRP)

Como as pesquisas costumam ser divulgadas em nível Estadual/Municipal, o modelo as projeta para nível de bairro (Zona Eleitoral) usando demografia:

- Cruza a intenção de voto por faixa de renda/idade com o perfil predominante da Zona.  
- Cria uma "Pesquisa Sintética" hiperlocal como base no minuto zero.

### 3\. Ajuste de Erro de Pesquisa (Polling Error)

O modelo se autocorrige ao identificar o viés sistêmico logo no começo da contagem:

1. Compara o resultado real das primeiras zonas com a previsão que a pesquisa fez para elas.  
2. Calcula a diferença (ex: "Candidato A teve 5% a mais nestas urnas do que a pesquisa esperava").  
3. Aplica esse *Swing de \+5%* em todas as zonas zeradas, recalibrando as expectativas da pesquisa em tempo real.

---

## Estrutura de Dados Necessária

Para suportar uma interface com a escolha entre os 4 modelos, o banco de dados precisará das seguintes chaves (cruzadas com a API de apuração ao vivo):

| Variável | Função no Algoritmo | Utilizado em |
| :---- | :---- | :---- |
| `id_zona_eleitoral` | Agrupamento geográfico e chave primária. | Modelos 2, 3 e 4 |
| `eleitores_aptos` | Teto máximo de votos possíveis. | Modelos 2, 3 e 4 |
| `taxa_abstencao` | Impede projeção de 100% de comparecimento na simulação. | Modelos 2, 3 e 4 |
| `votos_apurados` | Dado dinâmico recebido em tempo real da urna. | Todos (1, 2, 3 e 4\) |
| `resultado_anterior` | % de votos obtidos na eleição anterior pelo mesmo grupo político na mesma zona. | Apenas Modelo 3 |
| `pesquisa_sintetica` | Expectativa % da pesquisa projetada para aquela zona antes das urnas abrirem. | Apenas Modelo 4 |

