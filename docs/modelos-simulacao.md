# Arquitetura de Simulação de Apuração Eleitoral

Este documento detalha as abordagens para criar um simulador de resultados finais com base em dados parciais da apuração. Recomendamos a implementação de uma chave de seleção (toggle/dropdown) na interface do usuário, permitindo que o usuário ou analista escolha qual modelo matemático deseja usar para acompanhar a evolução dos dados.

## Opções de Modelos de Projeção

### Modelo 1: Extrapolação Simples (Modelo Ingênuo)

* **Como funciona:** Aplica o percentual atual de cada candidato ao total de votos válidos que ainda não foram apurados em todo o cenário global.  
* **Prós:** Fácil implementação; não exige dados históricos.  
* **Contras:** Altamente volátil. Sofre forte viés geográfico (ex: áreas rurais apuram mais rápido que capitais, criando "miragens" de liderança nos primeiros 30% da apuração).  
* **Fórmula:** `Projeção = Votos Atuais + (Votos Faltantes Globais * % Atual do Candidato)`

### Modelo 2: Estratificação Geográfica (Matemático)

* **Como funciona:** Divide a eleição em "baldes" (Zonas Eleitorais) e projeta o resultado de cada balde individualmente com base nos votos já apurados daquela mesma região, somando-os no final.  
* **Prós:** Corrige a distorção inicial de apuração; possui precisão matemática sólida após 15% das urnas abertas.  
* **Contras:** Exige cruzamento estático prévio com o banco de dados (eleitores aptos e histórico de abstenção).  
* **Fórmula base por zona:** `Projeção na Zona = (Votos Atuais na Zona / Votos Válidos Apurados na Zona) * (Eleitores Aptos da Zona * (1 - Taxa de Abstenção Histórica))`

### Modelo 3: Modelagem Bayesiana com Pesquisas (Avançado)

* **Como funciona:** Utiliza pesquisas de intenção de voto como "conhecimento prévio" e realiza uma transição (blending) para os dados reais da urna conforme a apuração avança.  
* **Prós:** Permite projeções altamente precisas logo nos primeiros minutos de apuração (0% a 5%). Ideal para grandes veículos de mídia.  
* **Contras:** Alta complexidade técnica; exige dados demográficos cruzados (MRP) e cálculo de viés de pesquisa em tempo real.  
* **Fórmula de Blending por zona:** `Projeção = (Estimativa_Pesquisa × Peso_Pesquisa) + (Projeção_Estratificada_Real × Peso_Real)`

---

## Detalhamento do Modelo Bayesiano (Modelo 3\)

### 1\. A Curva de Decaimento (Ajuste de Pesos)

A transição da pesquisa para a realidade não é linear, pois uma amostra real de 10% já é estatisticamente mais relevante que qualquer pesquisa. O peso da pesquisa cai rapidamente:

- **0% apurado:** Pesquisa vale 100% / Realidade vale 0%  
- **5% apurado:** Pesquisa vale 50% / Realidade vale 50%  
- **15% apurado:** Pesquisa vale 10% / Realidade vale 90%  
- **Acima de 25%:** Pesquisa vale 0% / Realidade assume 100%

### 2\. Regressão Multinível com Pós-estratificação (MRP)

Como as pesquisas costumam ser divulgadas em nível Estadual/Municipal, o modelo projeta os dados para nível de bairro (Zona Eleitoral) usando demografia:

- Cruza a intenção de voto por faixa de renda/idade com o perfil demográfico predominante da Zona Eleitoral.  
- Cria uma "Pesquisa Sintética" hiperlocal para servir de base no minuto zero.

### 3\. Ajuste de Erro de Pesquisa (Polling Error)

O modelo se autocorrige identificando o viés das pesquisas nos primeiros minutos:

1. Compara o resultado real das primeiras zonas que abrem com o que a pesquisa previu para elas.  
2. Calcula a diferença (ex: "O Candidato A teve 5% a mais nestas urnas do que a pesquisa esperava").  
3. Aplica esse *Swing de \+5%* em todas as zonas que ainda estão zeradas, recalibrando a expectativa da pesquisa para o resto do estado/cidade.

---

## Estrutura de Dados Necessária

Para rodar a interface com a opção de escolha entre os 3 modelos, seu banco precisa cruzar as informações recebidas da API de apuração com a seguinte tabela estática:

| Variável | Função no Algoritmo | Utilizado em |
| :---- | :---- | :---- |
| `id_zona_eleitoral` | Agrupamento geográfico e chave primária. | Modelos 2 e 3 |
| `eleitores_aptos` | Teto máximo de votos possíveis. | Modelos 2 e 3 |
| `taxa_abstencao` | Impede projeção irreal de 100% de comparecimento. | Modelos 2 e 3 |
| `votos_apurados` | Dado dinâmico recebido em tempo real. | Modelos 1, 2 e 3 |
| `pesquisa_sintetica` | Expectativa de % do candidato naquela zona antes de abrir. | Apenas Modelo 3 |

