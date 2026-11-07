# 8 Maluco

Jogo de cartas 8 Maluco multiplayer online, no estilo Gartic: cria uma sala, manda o código ou o link para a galera, completa a mesa com bots e joga.

## Rodando

```bash
npm install
npm run dev     # servidor com recarga automática em http://localhost:3000
npm test        # testes das regras
```

Para jogar com amigos na mesma rede, abra `http://SEU-IP:3000` no celular. Para jogar pela internet, publique o servidor num serviço que aceite Node e WebSocket (Render, Railway, Fly.io…). A porta vem de `PORT`.

## Estrutura

| Pasta | O que tem |
| --- | --- |
| `shared/engine.js` | Regras do jogo, sem rede nem tela. Funciona no servidor e pode ir para o app. |
| `shared/bot.js` | Jogador automático (bots e jogada automática quando o tempo acaba ou alguém cai). |
| `shared/reactions.js` | Lista das reações rápidas (validada no servidor, desenhada no navegador) e o limite de frequência. |
| `server/` | Express + Socket.IO: salas, anfitrião, bots, chat, reações, tempo por vez, reconexão. |
| `public/` | Interface web (HTML/CSS/JS puro), responsiva para celular, instalável (PWA). |
| `test/` | Testes das regras, do avatar e das reações com `node:test`. |

### PWA

- `public/sw.js`: service worker. Página, CSS e JS vêm da rede primeiro (o cache só entra sem internet), então editar o código não exige limpar nada. Fontes, ícones, cartas e sons vêm do cache primeiro: ao trocar um desses arquivos, suba `VERSION` no `sw.js`.
- `public/fonts/`: Russo One e Barlow Semi Condensed (só o subconjunto latino), servidas pelo próprio projeto, com as licenças OFL ao lado.
- `public/icons/`: PNGs gerados a partir de `icon.svg` (192/512 e 32 para favicon) e de `icons/maskable.svg` (versões `maskable` com fundo até a borda e `apple-touch-icon`, de 180px, com a carta maior, porque o iOS ignora SVG e só arredonda os cantos).

## Regras implementadas

- 9 cartas para cada um. Quem dá as cartas na primeira rodada é sorteado; depois o carteador passa para a direita a cada rodada, até o fim da partida.
- Nenhuma carta é virada: quem está à direita de quem deu as cartas abre o monte com a carta que quiser, e o jogo segue para a direita (anti-horário).
- Joga carta da mesma pinta ou do mesmo número do monte. Sem jogada, compra 1. Se a carta comprada servir, pode jogar; se não servir, a vez passa sozinha.
- **Ás** pula o próximo. **7**: o da esquerda compra 1. **8** entra em qualquer carta e escolhe a pinta. **9**: o da direita compra 2 e perde a vez. **Joker** entra em qualquer carta, todos os outros compram 1, e a pinta de baixo continua.
- Quem termina as cartas fecha a rodada. Os outros somam: Ás 1, 2–10 o próprio número, Valete/Dama/Rei 10, Joker 11. Chegou a 100, está fora. O último que sobrar vence.

### Decisões que a regra não definia (fácil de mudar em `shared/engine.js`)

- **Baralho**: 52 cartas + 2 Jokers. Entra mais um baralho a cada 3 jogadores (de 4 a 6 jogadores, 2 baralhos; de 7 a 8, 3). Sem isso, as mesas grandes ficavam sem cartas e travavam. Se até o monte acabar, entra um baralho novo.
- **Abrir o monte com especial**: vale o efeito normal. Se abrir com Joker, não há pinta embaixo, então o próximo joga qualquer carta.
- **A carta que bate ainda vale**: bater com um 9 faz o próximo comprar 2 antes da contagem dos pontos.
- **Tempo por vez**: 30s por padrão, configurável. Se o tempo acaba, o jogo faz uma jogada automática. Jogador desconectado joga no automático até voltar.
- Mesa com 2 a 8 jogadores.

## Próximo passo: app mobile

O motor (`shared/`) não depende do navegador nem do servidor, então dá para:

1. **Capacitor** (o caminho mais rápido): embrulhar a pasta `public/` como app Android/iOS e apontar o `io()` do `app.js` para o servidor publicado. O servidor já aceita conexões de outras origens (CORS aberto).
2. **React Native / Expo**: refazer a interface nativa e reaproveitar `shared/engine.js` e `shared/bot.js`, inclusive para um modo offline contra bots.
