// Busca global de candidatos e municípios (GET /api/busca). Só lê o que o painel já tem em memória: os
// candidatos dos arquivos de resultado de cada cargo × UF e os nomes dos contornos de public/municipios/.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Minúsculas e sem acento: "sao paulo" encontra "SÃO PAULO".
export const normalizarBusca = (texto) =>
  String(texto ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');

// Todos os termos da busca precisam aparecer. Devolve uma nota (menor é melhor) ou null se não casar:
// 0 = o texto começa pelo termo, 1 = uma palavra começa pelo termo, 2 = o termo aparece no meio.
function nota(texto, termos) {
  let pior = 0;
  for (const termo of termos) {
    const i = texto.indexOf(termo);
    if (i < 0) return null;
    const n = i === 0 ? 0 : texto[i - 1] === ' ' ? 1 : 2;
    pior = Math.max(pior, n);
  }
  return pior;
}

// Candidatos de um arquivo, com o texto de busca calculado uma vez por versão do arquivo.
const textosPorDados = new WeakMap();
function textosDoArquivo(dados) {
  if (!textosPorDados.has(dados)) {
    textosPorDados.set(dados, dados.candidatos.map((c) => ({
      nome: normalizarBusca(`${c.nomeUrna} ${c.nome}`),
      outros: `${c.numero} ${normalizarBusca(c.partido)}`,
    })));
  }
  return textosPorDados.get(dados);
}

const resumo = (cargo, uf, c, i) => ({
  cargo, uf, sq: c.sq, nomeUrna: c.nomeUrna, nome: c.nome, numero: c.numero, partido: c.partido,
  situacao: c.situacao, pct: c.pct, votos: c.votos, posicao: i + 1,
});

export function buscarCandidatos(apuracao, consulta, { cargo, uf, limiteAqui = 8, limiteOutros = 12 }) {
  const termos = normalizarBusca(consulta).split(' ').filter(Boolean);
  const aqui = [];
  const outros = [];
  if (!termos.length) {
    // Sem termo: os mais votados do cargo e UF abertos, para a caixa já mostrar algo ao ganhar o foco.
    const dados = apuracao.estado.get(`${cargo}:${uf}`)?.dados;
    dados?.candidatos.slice(0, limiteAqui).forEach((c, i) => aqui.push(resumo(cargo, uf, c, i)));
    return { aqui, outros };
  }

  for (const item of apuracao.estado.values()) {
    const dados = item.dados;
    if (!dados?.candidatos?.length) continue;
    const textos = textosDoArquivo(dados);
    const destino = item.alvo.cargo === cargo && item.alvo.uf === uf ? aqui : outros;
    dados.candidatos.forEach((c, i) => {
      const t = textos[i];
      // O nome tem peso próprio; número e partido só ajudam a achar.
      const n = nota(`${t.nome} ${t.outros}`, termos);
      if (n === null) return;
      destino.push({
        nota: nota(t.nome, termos) ?? 3 + n,
        votos: c.votos,
        candidato: resumo(item.alvo.cargo, item.alvo.uf, c, i),
      });
    });
  }
  const ordenar = (lista, limite) => lista
    .sort((a, b) => a.nota - b.nota || b.votos - a.votos)
    .slice(0, limite)
    .map((x) => x.candidato);
  return { aqui: ordenar(aqui, limiteAqui), outros: ordenar(outros, limiteOutros) };
}

// Nomes dos municípios por UF, lidos uma vez dos contornos. Sem a pasta, a busca só devolve candidatos.
export function criarIndiceMunicipios(diretorioPublico) {
  let promessa = null;
  const carregar = async () => {
    const pasta = path.join(diretorioPublico, 'municipios');
    const indice = [];
    for (const arquivo of await readdir(pasta)) {
      const m = /^([a-z]{2})\.json$/.exec(arquivo);
      if (!m) continue;
      const { municipios } = JSON.parse(await readFile(path.join(pasta, arquivo), 'utf8'));
      for (const [codigo, { n }] of Object.entries(municipios)) {
        indice.push({ uf: m[1], codigo, nome: n, texto: normalizarBusca(n) });
      }
    }
    return indice;
  };
  return async (consulta, { uf, limite = 8 } = {}) => {
    promessa ??= carregar().catch(() => { promessa = null; return []; });
    const termos = normalizarBusca(consulta).split(' ').filter(Boolean);
    if (!termos.length) return [];
    const achados = [];
    for (const m of await promessa) {
      const n = nota(m.texto, termos);
      if (n !== null) achados.push({ ...m, nota: n + (m.uf === uf ? 0 : 0.5) });
    }
    return achados
      .sort((a, b) => a.nota - b.nota || a.nome.length - b.nome.length || a.nome.localeCompare(b.nome))
      .slice(0, limite)
      .map(({ uf: u, codigo, nome }) => ({ uf: u, codigo, nome }));
  };
}
