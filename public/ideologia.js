// Classificação ideológica dos partidos para o mapa de cadeiras. É uma simplificação editorial, não um dado
// oficial: não existe classificação consensual, e partidos mudam de posição. Ajuste as listas abaixo à vontade.
// Critério aproximado: posição do partido na maioria das votações recentes no Congresso e no governo federal.
// Partidos fora das listas (e senadores sem partido) caem em "Independente" — é o caso do Missão, que se
// posiciona contra o governo Lula e contra o bolsonarismo.

export const GRUPOS = [
  { id: 'esquerda', nome: 'Esquerda', cor: '#d9363e' },
  { id: 'centrao', nome: 'Centrão', cor: '#e8a317' },
  { id: 'direita', nome: 'Direita', cor: '#2563c9' },
  { id: 'independente', nome: 'Independente', cor: '#8a94a3' },
];

const PARTIDOS = {
  esquerda: ['PT', 'PCDOB', 'PV', 'PSOL', 'REDE', 'PSB', 'PDT', 'PCB', 'PSTU', 'PCO', 'UP'],
  centrao: ['MDB', 'PSD', 'PP', 'UNIAO', 'REPUBLICANOS', 'PSDB', 'CIDADANIA', 'PODE', 'AVANTE', 'SOLIDARIEDADE', 'PRD', 'MOBILIZA'],
  direita: ['PL', 'NOVO', 'DC', 'DEMOCRATA', 'AGIR', 'PRTB', 'PMB'],
};

// "PC do B", "PCdoB" e "PC DO B" são o mesmo partido; "UNIÃO" e "UNIAO" também.
const chave = (sigla) =>
  String(sigla ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const GRUPO_DO_PARTIDO = new Map(
  Object.entries(PARTIDOS).flatMap(([grupo, siglas]) => siglas.map((s) => [s, grupo])),
);

export const grupoDoPartido = (sigla) => GRUPO_DO_PARTIDO.get(chave(sigla)) ?? 'independente';
export const grupoPorId = (id) => GRUPOS.find((g) => g.id === id);
