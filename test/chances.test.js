import test from 'node:test';
import assert from 'node:assert/strict';
import { elegiveisPelaConta, folgaProvavel, garantidosNoTopo, vitoriaNoPrimeiroTurno, avaliarChances, MARGEM_SEGURANCA, quantosClassificam, semChanceMatematica, votosRestantes, votosRestantesEstimados } from '../public/chances.js';

test('quantosClassificam: Senado = vagas; presidente e governador = 2 no 1º turno e 1 no 2º', () => {
  assert.equal(quantosClassificam({ cargo: 5, vagas: 2, turno: 1 }), 2);
  assert.equal(quantosClassificam({ cargo: 5, vagas: 1, turno: 1 }), 1);
  assert.equal(quantosClassificam({ cargo: 3, vagas: 1, turno: 1 }), 2);
  assert.equal(quantosClassificam({ cargo: 1, vagas: 1, turno: 2 }), 1);
});

test('votosRestantes: eleitores das seções que faltam; sem o total, não há teto', () => {
  assert.equal(votosRestantes({ total: 1000, comparecimento: 500, abstencao: 100 }), 400);
  assert.equal(votosRestantes({ total: 1000, comparecimento: 900, abstencao: 200 }), 0);
  assert.equal(votosRestantes({ total: 0, comparecimento: 0, abstencao: 0 }), null);
});

test('semChanceMatematica: só quem, com todos os votos que faltam, ainda fica atrás do k-ésimo', () => {
  // 2 classificam; faltam 100 votos: o 3º (300) alcança até 400 > 380 (2º) → ainda tem chance; o 4º (200) chega a 300 < 380 → fora
  assert.deepEqual(semChanceMatematica([500, 380, 300, 200], 2, 100), [false, false, false, true]);
  assert.deepEqual(semChanceMatematica([500, 380, 300, 200], 2, 0), [false, false, true, true]);
  // empate exato no limite ainda não elimina (ele pode igualar o k-ésimo)
  assert.deepEqual(semChanceMatematica([500, 380, 280], 2, 100), [false, false, false]);
  assert.deepEqual(semChanceMatematica([500, 380, 279], 2, 100), [false, false, true]);
  // sem teto confiável ou com menos candidatos que classificados: ninguém é eliminado
  assert.deepEqual(semChanceMatematica([500, 100], 2, null), [false, false]);
  assert.deepEqual(semChanceMatematica([500], 2, 0), [false]);
});

test('votosRestantesEstimados: usa a abstenção e os votos válidos já medidos, com margem, nunca acima do teto', () => {
  // 1000 aptos; apurados 500 (400 comparecem, 100 se abstêm; 320 válidos) → faltam 500 aptos
  const base = { total: 1000, comparecimento: 400, abstencao: 100, validos: 320 };
  assert.equal(votosRestantes(base), 500);
  const esperado = 500 * 0.8 * 0.8 * MARGEM_SEGURANCA; // 80% comparecem, 80% dos que comparecem votam em alguém
  assert.ok(Math.abs(votosRestantesEstimados(base) - esperado) < 1e-9);
  assert.equal(votosRestantesEstimados({ ...base, validos: 400 }), Math.min(500, 500 * 0.8 * 1 * MARGEM_SEGURANCA));
  assert.equal(votosRestantesEstimados({ total: 1000, comparecimento: 0, abstencao: 0, validos: 0 }), 1000); // nada medido: teto
  assert.equal(votosRestantesEstimados({ total: 0, comparecimento: 0, abstencao: 0, validos: 0 }), null);
});

test('avaliarChances: matemática, prática (pela abstenção) e vitória do líder sem 2º turno', () => {
  const eleitorado = { total: 1000, comparecimento: 400, abstencao: 100 };
  // Faltam 500 aptos (teto); estimado ≈ 500·0,8·0,8·1,15 = 368. O 3º (100) ainda alcançaria o 2º (250): 100+368 > 250.
  assert.deepEqual(avaliarChances({ votos: [260, 250, 100], k: 2, validos: 320, eleitorado }), [null, null, null]);
  // Só a abstenção elimina: faltam 150 aptos (total 650); estimado = 150·0,8·0,8·1,15 = 110 → 3º (10) chega a 120 < 140 (2º),
  // mas com o teto (150) chegaria a 160 > 140, então não é matemática.
  assert.deepEqual(avaliarChances({ votos: [150, 140, 10], k: 2, validos: 320, eleitorado: { total: 650, comparecimento: 400, abstencao: 100 } }), [null, null, 'pratica']);
  // Sem ninguém por apurar, o teto já elimina: matemática.
  assert.deepEqual(avaliarChances({ votos: [150, 140, 10], k: 2, validos: 320, eleitorado: { total: 500, comparecimento: 400, abstencao: 100 } }), [null, null, 'matematica']);
  // Quem pode ir ao 2º turno, mesmo sem chance de ser o 1º, continua: o 2º colocado nunca é eliminado por ficar atrás do líder.
  assert.equal(avaliarChances({ votos: [300, 20, 10], k: 2, primeiroTurno: true, validos: 330, eleitorado: { total: 1000, comparecimento: 400, abstencao: 100 } })[1], null);
  // Líder com mais da metade dos válidos, mesmo que todos os que faltam sejam dos outros: 2º e 3º também ficam sem chance
  assert.deepEqual(avaliarChances({ votos: [700, 200, 100], k: 2, primeiroTurno: true, validos: 1000, eleitorado: { total: 1100, comparecimento: 1000, abstencao: 50 } }),
    [null, 'matematica', 'matematica']);
  // No Senado (sem 2º turno) a vitória do líder não elimina o 2º: só o 3º, que não alcança os 2 primeiros
  assert.deepEqual(avaliarChances({ votos: [700, 200, 100], k: 2, primeiroTurno: false, validos: 1000, eleitorado: { total: 1100, comparecimento: 1000, abstencao: 50 } }), [null, null, 'matematica']);
  // Sem dados do eleitorado, ninguém é eliminado
  assert.deepEqual(avaliarChances({ votos: [500, 100, 5], k: 2, eleitorado: null }), [null, null, null]);
});

test('avaliarChances sem o eleitorado (servidor antigo): usa a proporção de seções apuradas', () => {
  // DF da tela: 85,59% apurado; 1º 49,71%, 2º 34,62%, 3º 8,45% (em % dos válidos)
  const votos = [497100, 346200, 84500];
  const r = avaliarChances({ votos, k: 2, primeiroTurno: true, validos: 1000000, eleitorado: null, pctSecoes: 85.59 });
  assert.deepEqual(r, [null, null, 'pratica']);
  assert.deepEqual(avaliarChances({ votos, k: 2, validos: 1000000, eleitorado: null, pctSecoes: 5 }), [null, null, null]); // muito cedo: ainda cabe tudo
  assert.deepEqual(avaliarChances({ votos, k: 2, validos: 1000000, eleitorado: null, pctSecoes: null }), [null, null, null]);
});

test('vitoriaNoPrimeiroTurno: o líder passa de 50% mesmo sem receber mais voto algum', () => {
  const eleitorado = { total: 1100, comparecimento: 1000, abstencao: 50 }; // faltam 50 aptos
  assert.equal(vitoriaNoPrimeiroTurno({ votos: [700, 200, 100], validos: 1000, eleitorado }), 'matematica');
  // 55%: com o teto (todos os aptos que faltam) ainda não fecha; só pela abstenção medida
  const folgado = { total: 1500, comparecimento: 800, abstencao: 200 }; // faltam 500 aptos
  assert.equal(vitoriaNoPrimeiroTurno({ votos: [600, 100, 50], validos: 750, eleitorado: folgado }), 'pratica'); // 1200 > 750 + 500·0,8·0,94·1,15 = 1156
  assert.equal(vitoriaNoPrimeiroTurno({ votos: [450, 300], validos: 750, eleitorado: folgado }), null);
  // sem o eleitorado: pela proporção de seções (68% apurado, líder com 67% dos válidos não fecha; 90% apurado fecha)
  assert.equal(vitoriaNoPrimeiroTurno({ votos: [670, 230, 100], validos: 1000, pctSecoes: 68 }), null);
  assert.equal(vitoriaNoPrimeiroTurno({ votos: [670, 230, 100], validos: 1000, pctSecoes: 90 }), 'pratica');
  assert.equal(vitoriaNoPrimeiroTurno({ votos: [0, 0], validos: 0, pctSecoes: 50 }), null);
});

test('garantidosNoTopo (Senado, 2 vagas): quem fica entre os 2 primeiros mesmo sem receber mais voto', () => {
  const eleitorado = { total: 1000, comparecimento: 640, abstencao: 160 }; // faltam 200 aptos (teto); estimado ≈ 184
  // 1º 600 e 2º 500: o 3º (150) chega a 334 < 500 → os dois estão garantidos
  assert.deepEqual(garantidosNoTopo({ votos: [600, 500, 150], k: 2, validos: 1100, eleitorado }), ['pratica', 'pratica', null].map((_, i) => (i < 2 ? 'matematica' : null)));
  // 3º com 400: pode chegar a 600 > 500 → o 2º não está garantido; o 1º (600) só é ultrapassado se o 3º passar de 600: 400+200=600, não passa → garantido
  assert.deepEqual(garantidosNoTopo({ votos: [600, 500, 400], k: 2, validos: 1100, eleitorado }), ['matematica', null, null]);
  // sem o eleitorado, pela proporção de seções
  assert.deepEqual(garantidosNoTopo({ votos: [600, 500, 150], k: 2, validos: 1250, pctSecoes: 90 }), ['pratica', 'pratica', null]);
  assert.deepEqual(garantidosNoTopo({ votos: [0, 0, 0], k: 2, validos: 0, eleitorado }), [null, null, null]);
});

test('folgaProvavel: grande no começo, cai com a apuração, nunca abaixo do piso', () => {
  assert.equal(folgaProvavel(0), null);
  assert.ok(Math.abs(folgaProvavel(10) - 22.5) < 1e-9);
  assert.ok(Math.abs(folgaProvavel(80) - 5) < 1e-9);
  assert.equal(folgaProvavel(100), 4);
});

test('elegiveisPelaConta: governador do MS (67% aos 68% apurado) é dado como eleito; com 24% apurado, não', () => {
  const votos = [671300, 231100, 76900];
  const mS = elegiveisPelaConta({ votos, k: 2, primeiroTurno: true, validos: 1000000, pctSecoes: 68 });
  assert.deepEqual(mS, ['provavel', null, null]); // 67,13 − 8 > 50, mas a garantia (pior caso) ainda não fecha
  assert.deepEqual(elegiveisPelaConta({ votos, k: 2, primeiroTurno: true, validos: 1000000, pctSecoes: 24 }), [null, null, null]);
  assert.deepEqual(elegiveisPelaConta({ votos: [510000, 300000], k: 2, primeiroTurno: true, validos: 1000000, pctSecoes: 68 }), [null, null]); // 51% com folga de 8: não
  assert.deepEqual(elegiveisPelaConta({ votos, k: 2, primeiroTurno: true, validos: 1000000, pctSecoes: 59 }), [null, null, null], 'antes de 60% apurado, só a garantia vale');
  // quando a garantia fecha, ela prevalece sobre a folga
  assert.deepEqual(elegiveisPelaConta({ votos: [700, 200, 100], k: 2, primeiroTurno: true, validos: 1000, eleitorado: { total: 1100, comparecimento: 1000, abstencao: 50 }, pctSecoes: 90 }), ['matematica', null, null]);
});

test('elegiveisPelaConta no Senado (2 votos por eleitor): os 2 primeiros isolados são dados como eleitos', () => {
  // % sobre 2 votos por eleitor: 1º 30%, 2º 25%, 3º 12%, 4º 8%; 85% apurado
  const votos = [300000, 250000, 120000, 80000];
  const r = elegiveisPelaConta({ votos, k: 2, validos: 1000000, pctSecoes: 85, votosPorEleitor: 2 });
  assert.deepEqual(r, ['pratica', 'pratica', null, null]); // a garantia (pela abstenção medida) já fecha e prevalece sobre a folga
  // um líder de SP com 55% aos 60% apurado (folga de 10 pp) não é dado como eleito
  assert.deepEqual(elegiveisPelaConta({ votos: [550000, 380000], k: 2, primeiroTurno: true, validos: 1000000, pctSecoes: 60 }), [null, null]);
  // 3º colado no 2º: o 2º não está garantido
  assert.deepEqual(elegiveisPelaConta({ votos: [300000, 250000, 245000], k: 2, validos: 1000000, pctSecoes: 85, votosPorEleitor: 2 }), ['provavel', null, null]);
});
