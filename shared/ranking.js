// Regra do ranking, a mesma no servidor (o que grava) e na tela (o que explica).

// A partida vale para o ranking com pelo menos esta quantidade de pessoas na mesa no começo.
// Bots não contam (senão daria para subir jogando sozinho contra bots); convidados sem conta
// contam para chegar ao mínimo, mas só quem tem conta ganha ponto.
export const RANKED_MIN_HUMANS = 3;

export const RANKED_RULE = `Valem as partidas com ${RANKED_MIN_HUMANS} ou mais pessoas na mesa (bots não contam).`;
