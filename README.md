# 8 Maluco

Jogo de cartas 8 Maluco multiplayer online, no estilo Gartic: cria uma sala, manda o código ou o link para a galera, completa a mesa com bots e joga.

## Rodando

```bash
npm install
npm run dev     # servidor com recarga automática em http://localhost:3000
npm test        # testes das regras
```

Para jogar com amigos na mesma rede, abra `http://SEU-IP:3000` no celular. Para jogar pela internet, publique o servidor num serviço que aceite Node e WebSocket (Render, Railway, Fly.io…).

## Publicando

Tudo vem de variáveis de ambiente:

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `PORT` | `3000` | Porta do servidor. |
| `NODE_ENV` | — | Com `production`, o `TRUST_PROXY` passa a valer 1. |
| `TRUST_PROXY` | `1` em produção, `0` fora | Quantos proxies ficam na frente do servidor (Render, Railway e Fly têm 1). Serve para pegar o IP real nos limites por IP. Sem proxy, deixe `0`, senão qualquer um inventa o IP no `X-Forwarded-For`. |
| `ALLOWED_ORIGINS` | vazio | Outras origens que podem conectar, separadas por vírgula. O site servido pelo próprio servidor sempre pode. Para o app Capacitor: `capacitor://localhost,http://localhost`. |
| `MAX_ROOMS` | `500` | Teto de salas abertas. Acima disso, "Servidor cheio, tente daqui a pouco". |
| `MAX_CONNECTIONS_PER_IP` | `20` | Conexões simultâneas por IP. Uma família na mesma rede de casa cabe com folga. |
| `SNAPSHOT_FILE` | `data/rooms.json` | Onde as salas ficam gravadas entre um processo e outro. Precisa estar num disco que sobreviva ao deploy (veja abaixo). `off` desliga. |

- **Limites por conexão** (`RATE_LIMITS` em `server/index.js`): 5 salas criadas por minuto, 12 tentativas de entrar por minuto, 30 pedidos da lista de salas por minuto, 10 jogadas, compras ou passes a cada 5s, e 20 a cada 10s nos outros eventos. Mensagens maiores que 16KB derrubam a conexão de quem mandou.
- **Desligamento e volta**: no `SIGTERM` (o que as plataformas mandam no deploy) e no Ctrl+C, o servidor avisa todas as salas ("O servidor vai reiniciar. A partida continua quando ele voltar!"), para os timers dos bots, grava as salas em `SNAPSHOT_FILE` e fecha. Ao subir, ele lê o arquivo, apaga-o e recria as salas com todo mundo desconectado. A partida fica parada até a primeira pessoa voltar; aí a vez de quem estava jogando recomeça com o prazo cheio. Os clientes reconectam sozinhos e voltam pelo token para o mesmo lugar, com as mesmas cartas. Gravações com mais de 10 minutos são ignoradas. O arquivo tem os tokens dos jogadores, por isso a pasta `data/` fica fora do git. Uma queda sem aviso (falta de memória, `kill -9`) não grava nada, e aí as partidas se perdem.
- **Uma instância só**: veja abaixo.
- **`/health`**: `{ ok, rooms, games, players, connections, uptime }`. Serve para o health check da plataforma e para ver quantas pessoas estão jogando.
- **Log**: erros em eventos e timers saem no log com o código da sala (`[game:play] sala AB12C: ...`).

### Uma instância só

As salas, as partidas e os timers dos bots vivem na memória de **um** processo Node. Com duas instâncias, cada uma tem as suas salas: quem cai na outra recebe "Sala não encontrada", e a conexão do Socket.IO quebra quando o balanceador alterna entre elas (o polling precisa voltar sempre ao mesmo processo). Então:

- **Uma instância**, sem autoscaling. Para aguentar mais gente, aumente a máquina (CPU e memória), não o número de instâncias. Um processo dá conta de bem mais salas que o teto padrão de `MAX_ROOMS` (500).
- **Sempre ligada.** Serviço que "dorme" quando ninguém acessa apaga todas as salas ao dormir.
- **Disco que sobrevive ao deploy.** Nas três plataformas, cada deploy sobe um contêiner novo e o disco comum dele começa vazio. Para as partidas continuarem depois de um deploy, monte um disco persistente (volume) e aponte `SNAPSHOT_FILE` para ele. Sem volume, o deploy derruba as partidas: o servidor avisa antes e os jogadores reconectam, mas voltam para uma sala que não existe mais. Nesse caso, prefira publicar quando houver pouca gente jogando (o `/health` mostra quantas partidas estão rolando).

Em cada plataforma:

- **Render**: crie um *Web Service* (aceita WebSocket) e deixe a contagem de instâncias em 1, sem autoscaling. O plano gratuito dorme depois de um tempo sem acesso, então use um plano pago para manter as salas vivas. Coloque `/health` como *Health Check Path*. Para guardar as partidas, adicione um *Disk* (por exemplo em `/var/data`) e defina `SNAPSHOT_FILE=/var/data/rooms.json`.
- **Railway**: nas configurações do serviço, deixe *Replicas* em 1 (o padrão). O Railway já entrega `PORT` e passa o WebSocket direto. Para guardar as partidas, crie um *Volume* montado no serviço (por exemplo em `/data`) e defina `SNAPSHOT_FILE=/data/rooms.json`.
- **Fly.io**: o `fly launch` costuma criar duas máquinas, então rode `fly scale count 1` depois dele. No `fly.toml`, dentro de `[http_service]`, use `auto_stop_machines = "off"` e `min_machines_running = 1` para a máquina não desligar quando a mesa esvazia, e aponte o health check para `/health`. Para guardar as partidas, crie um volume (`fly volumes create data --size 1`), monte-o com `[mounts]` (`source = "data"`, `destination = "/data"`) e defina `SNAPSHOT_FILE=/data/rooms.json`.

Nas três, defina `NODE_ENV=production` (que liga o `TRUST_PROXY=1`) e, se for usar o app, `ALLOWED_ORIGINS`. Em casa, ou num servidor próprio com o disco de sempre, o padrão `data/rooms.json` já funciona.

**Se um dia precisar de mais de uma instância:** as salas teriam que sair da memória para um lugar compartilhado (Redis), os eventos teriam que passar entre as instâncias com o `@socket.io/redis-adapter`, e o balanceador precisaria de sessão fixa (*sticky sessions*). Os timers dos bots também precisariam de um dono por sala. É uma mudança grande, que só vale a pena se uma máquina grande não der mais conta.

## Estrutura

| Pasta | O que tem |
| --- | --- |
| `shared/engine.js` | Regras do jogo, sem rede nem tela. Funciona no servidor e pode ir para o app. |
| `shared/bot.js` | Jogador automático (bots e jogada automática quando o tempo acaba ou alguém cai). |
| `shared/names.js` | Regras de apelido que valem no servidor e na tela (nomes "Robô …" são só dos bots). |
| `shared/reactions.js` | Lista das reações rápidas (validada no servidor, desenhada no navegador) e o limite de frequência. |
| `server/` | Express + Socket.IO: salas, anfitrião, bots, chat, reações, tempo por vez, reconexão e as salas gravadas entre reinícios (`snapshot.js`). |
| `public/` | Interface web (HTML/CSS/JS puro), responsiva para celular, instalável (PWA). |
| `test/` | Testes com `node:test`: regras (`engine`), salas (`rooms`, `host`, `away`, `names`, `kick`, `spectators`, `rematch`, `reactions`), avatar, e rede de ponta a ponta com clientes socket.io reais (`multiplayer`, `production`, `restart`). |

### PWA

- `public/sw.js`: service worker. Página, CSS e JS vêm da rede primeiro (o cache só entra sem internet), então editar o código não exige limpar nada. Fontes, ícones, cartas e sons vêm do cache primeiro: ao trocar um desses arquivos, suba `VERSION` no `sw.js`.
- `public/fonts/`: Russo One e Barlow Semi Condensed (só o subconjunto latino), servidas pelo próprio projeto, com as licenças OFL ao lado.
- `public/icons/`: PNGs gerados a partir de `icon.svg` (192/512 e 32 para favicon) e de `icons/maskable.svg` (versões `maskable` com fundo até a borda e `apple-touch-icon`, de 180px, com a carta maior, porque o iOS ignora SVG e só arredonda os cantos).

## Regras implementadas

- 9 cartas para cada um. Quem dá as cartas na primeira rodada é sorteado; depois o carteador passa para a direita a cada rodada, até o fim da partida.
- Nenhuma carta é virada: quem está à direita de quem deu as cartas abre o monte com a carta que quiser, e o jogo segue para a direita (anti-horário).
- Joga carta da mesma pinta ou do mesmo número do monte. Sem jogada, compra 1. Se a carta comprada servir, pode jogar; se não servir, a vez passa sozinha.
- **Ás** pula o próximo. **7**: o da esquerda compra 1 (numa mesa de dois, o outro também perde a vez e quem jogou o 7 joga de novo). **8** entra em qualquer carta e escolhe a pinta. **9**: o da direita compra 2 e perde a vez. **Joker** entra em qualquer carta, todos os outros compram 1, e a pinta de baixo continua.
- Quem termina as cartas fecha a rodada. Os outros somam: Ás 1, 2–10 o próprio número, Valete/Dama/Rei 10, Joker 11. Chegou a 100, está fora. O último que sobrar vence.

### Decisões que a regra não definia (fácil de mudar em `shared/engine.js`)

- **Baralho**: 52 cartas + 2 Jokers. Entra mais um baralho a cada 3 jogadores (de 4 a 6 jogadores, 2 baralhos; de 7 a 8, 3). Sem isso, as mesas grandes ficavam sem cartas e travavam. Se até o monte acabar, entra um baralho novo.
- **Abrir o monte com especial**: vale o efeito normal. Se abrir com Joker, não há pinta embaixo, então o próximo joga qualquer carta.
- **A carta que bate ainda vale**: bater com um 9 faz o próximo comprar 2 antes da contagem dos pontos.
- **Tempo por vez**: 30s por padrão, configurável. Se o tempo acaba, o jogo faz uma jogada automática. Jogador desconectado joga no automático até voltar.
- Mesa com 2 a 8 jogadores.

## Próximo passo: app mobile

O motor (`shared/`) não depende do navegador nem do servidor, então dá para:

1. **Capacitor** (o caminho mais rápido): embrulhar a pasta `public/` como app Android/iOS e apontar o `io()` do `app.js` para o servidor publicado. Para o servidor aceitar o app, coloque a origem dele em `ALLOWED_ORIGINS` (veja "Publicando").
2. **React Native / Expo**: refazer a interface nativa e reaproveitar `shared/engine.js` e `shared/bot.js`, inclusive para um modo offline contra bots.
