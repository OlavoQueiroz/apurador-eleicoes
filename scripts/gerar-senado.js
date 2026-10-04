// Gera public/senado-ocupadas.json: as 27 cadeiras do Senado que NÃO estão em disputa em 2026 (senadores eleitos
// em 2022, mandato até 31/01/2031), com o partido atual de quem as ocupa. O mapa de cadeiras junta essas 27 às 54
// que o TSE apura. Fonte: dados abertos do Senado (lista de parlamentares em exercício).
// Rode de novo se algum senador trocar de partido: node scripts/gerar-senado.js

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const URL_API = 'https://legis.senado.leg.br/dadosabertos/senador/lista/atual';
const SAIDA = fileURLToPath(new URL('../public/senado-ocupadas.json', import.meta.url));
const FIM_DO_MANDATO = '2031'; // quem foi eleito em 2022 tem a segunda legislatura do mandato terminando em 2031

// A API do Senado usa nomes por extenso em alguns partidos; o painel usa as siglas do TSE.
const SIGLA_TSE = { PODEMOS: 'PODE' };

const res = await fetch(URL_API, { headers: { accept: 'application/json', 'user-agent': 'apurador-local/0.1 (gerador do Senado)' } });
if (!res.ok) throw new Error(`HTTP ${res.status} em ${URL_API}`);
const lista = (await res.json()).ListaParlamentarEmExercicio.Parlamentares.Parlamentar;

const cadeiras = lista
  .filter((p) => p.Mandato.SegundaLegislaturaDoMandato?.DataFim?.startsWith(FIM_DO_MANDATO))
  .map((p) => {
    const id = p.IdentificacaoParlamentar;
    const sigla = String(id.SiglaPartidoParlamentar || 'S/Partido').toUpperCase();
    return { uf: id.UfParlamentar.toLowerCase(), nome: id.NomeParlamentar, partido: SIGLA_TSE[sigla] ?? sigla };
  })
  .sort((a, b) => a.uf.localeCompare(b.uf) || a.nome.localeCompare(b.nome, 'pt-BR'));

if (cadeiras.length !== 27) throw new Error(`Esperava 27 cadeiras fora de disputa, vieram ${cadeiras.length}.`);
await writeFile(SAIDA, `${JSON.stringify({ fonte: URL_API, geradoEm: new Date().toISOString(), cadeiras }, null, 1)}\n`);
console.log(`${cadeiras.length} cadeiras gravadas em ${SAIDA}`);
