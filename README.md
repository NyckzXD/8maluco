# 8 Maluco

Jogo de cartas multiplayer online: cria uma sala, manda o código ou o link para a galera, completa a mesa com bots e joga.

## Rodando

```bash
npm install
npm run dev     # servidor + Vite em http://localhost:3000 (a página recarrega ao salvar)
npm test        # testes das regras e do multiplayer
```

Antes de mandar código, `npm run check` roda tudo o que o CI roda:

| Comando | O que faz |
| --- | --- |
| `npm run lint` | ESLint em todo o projeto. |
| `npm run typecheck` | `tsc` checando os tipos de `shared/` e `server/` (`tsconfig.json`) e do cliente (`client/tsconfig.json`). O código continua JS; tipos via JSDoc onde precisa. |
| `npm run format` / `format:check` | Prettier (aspas simples, linhas de até 120). Markdown e HTML ficam de fora. |
| `npm run build` | Vite: junta e minifica o cliente em `dist/`. |

O GitHub Actions (`.github/workflows/ci.yml`) roda lint, tipos, formatação, testes e build a cada push na `main` e em todo pull request, no Node 20, 22 e 24.

Para jogar com amigos na mesma rede, abra `http://SEU-IP:3000` no celular. Para jogar pela internet, publique o servidor num serviço que aceite Node e WebSocket (Render, Railway, Fly.io…).

## Publicando

Em produção o servidor serve o `dist/`, então a plataforma precisa gerar o build antes de subir:

- **Build command**: `npm ci --include=dev && npm run build` (o Vite é dependência de desenvolvimento; o `--include=dev` garante que ele seja instalado mesmo com `NODE_ENV=production`).
- **Start command**: `npm start`.

Sem `NODE_ENV=production`, o `npm start` sobe o Vite no lugar do `dist/` (bom para testar em casa, lento para publicar).

Tudo o mais vem de variáveis de ambiente. Em casa, o jeito mais fácil é um arquivo `.env` na raiz: copie o `.env.example` para `.env` e preencha. O servidor lê o arquivo ao iniciar (reinicie depois de mudar), o `.env` fica fora do git, e uma variável definida no terminal ou no painel da plataforma vale mais que o arquivo. Nas plataformas, use o painel delas.

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `PORT` | `3000` | Porta do servidor. |
| `NODE_ENV` | — | Com `production`, o `TRUST_PROXY` passa a valer 1. |
| `TRUST_PROXY` | `1` em produção, `0` fora | Quantos proxies ficam na frente do servidor (Render, Railway e Fly têm 1). Serve para pegar o IP real nos limites por IP. Sem proxy, deixe `0`, senão qualquer um inventa o IP no `X-Forwarded-For`. |
| `ALLOWED_ORIGINS` | vazio | Outras origens que podem conectar, separadas por vírgula. O site servido pelo próprio servidor sempre pode. Para o app Capacitor: `capacitor://localhost,http://localhost`. |
| `MAX_ROOMS` | `500` | Teto de salas abertas. Acima disso, "Servidor cheio, tente daqui a pouco". |
| `MAX_CONNECTIONS_PER_IP` | `20` | Conexões simultâneas por IP. Uma família na mesma rede de casa cabe com folga. |
| `SNAPSHOT_FILE` | `data/rooms.json` | Onde as salas ficam gravadas entre um processo e outro. Precisa estar num disco que sobreviva ao deploy (veja abaixo). `off` desliga. |
| `DATABASE_FILE` | `data/oito-maluco.db` | Banco SQLite das contas (apelido, hash da senha, sessões). Tem que ficar no mesmo disco persistente do `SNAPSHOT_FILE` (por exemplo `/data/oito-maluco.db`): sem volume, cada deploy apaga todas as contas. |
| `GOOGLE_CLIENT_ID` | vazio | Liga o "Entrar com o Google" (veja "Login com o Google" abaixo). Vazio, o botão não aparece e só vale apelido e senha. |
| `ANALYSIS_USERS` | vazio | Apelidos de conta, separados por vírgula, que veem na própria vez o que o bot forte jogaria (veja "Análise do bot" abaixo). Vazio, ninguém vê. |

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

### Login com o Google

O botão é o oficial do Google (Google Identity Services). O navegador recebe um token assinado do Google, o servidor confere a assinatura, o emissor, o destinatário e a validade (`server/google.js`) e guarda só o `sub`, o id fixo da pessoa no Google. Nada de e-mail, nome ou foto. Na primeira vez a pessoa escolhe o apelido.

Para ligar:

1. No [Google Cloud Console](https://console.cloud.google.com/), crie (ou escolha) um projeto.
2. Em **APIs e serviços → Tela de consentimento OAuth** (no console novo, **Google Auth Platform → Branding**), preencha o nome do app e o e-mail de suporte. O público é **Externo**. Os escopos padrão (`openid`, `email`, `profile`) bastam: não precisa pedir nada a mais.
3. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo da Web**. Em **Origens JavaScript autorizadas**, ponha `http://localhost:3000` (desenvolvimento) e o endereço publicado (por exemplo `https://8maluco.onrender.com`). Não precisa de URI de redirecionamento.
4. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`) para a variável `GOOGLE_CLIENT_ID` do servidor. Ele não é segredo: vai para o navegador pelo `/api/config`.

- O Google só aceita origens `https` ou `http://localhost`. Pela rede de casa (`http://192.168.x.x:3000`) o botão não funciona; o login com apelido e senha funciona.
- Enquanto o app estiver em modo **Teste** na tela de consentimento, só entram os e-mails da lista de testadores. Para abrir para todo mundo, publique o app (com só os escopos padrão, o Google não pede verificação).
- O app Capacitor vai precisar de um plugin nativo de login do Google (o Google bloqueia o login dentro de WebView) e dos IDs de cliente Android/iOS no servidor.

## Estrutura

| Pasta | O que tem |
| --- | --- |
| `shared/engine.js` | Regras do jogo, sem rede nem tela. Funciona no servidor e pode ir para o app. |
| `shared/bot.js` | Os bots: a heurística simples (`chooseMoveBasic`, que joga nas salas) e a busca forte (`chooseMove`/`evaluateMoves`, usada na análise). Veja "Como o bot joga" abaixo. |
| `shared/ranking.js` | Regra do ranking (partida vale com 4 ou mais pessoas na mesa; bots não contam), usada pelo servidor e pela tela. |
| `shared/names.js` | Regras de apelido que valem no servidor e na tela (nomes "Robô …" são só dos bots) e as de apelido e senha de conta. |
| `shared/reactions.js` | Lista das reações rápidas (validada no servidor, desenhada no navegador) e o limite de frequência. |
| `server/` | Express + Socket.IO: salas, anfitrião, bots, chat, reações, tempo por vez, reconexão e as salas gravadas entre reinícios (`snapshot.js`). Contas em `/api` (`api.js`: cadastro, entrar, sair, `/me`, apagar conta; `auth.js`: senha com scrypt, sessões e contas do Google; `google.js`: confere o token do Google; no fim de cada partida com alguém logado, a sala manda o resumo para o banco, e `/api/leaderboard` monta o ranking; `db.js`: o SQLite e as migrações). No desenvolvimento, monta o Vite como middleware na mesma porta; em produção, serve o `dist/`. |
| `client/` | Interface web (`index.html`, `style.css` e os módulos em `src/`, JS puro sem framework), responsiva para celular. Entrada do Vite (`vite.config.js`). |
| `client/styles/` | O CSS, um arquivo por tela ou parte da tela, juntados pelos `@import` do `style.css` na ordem da cascata (o Vite gera um CSS só). Base: `base` (fontes, cores, medidas), `components` (botões, ícones). Tela inicial: `home`, `account`, `howto`, `rooms`, `ranking`. `lobby`, `chat`. Partida: `table`, `seats`, `reactions`, `hand`, `cards`, `scores`. `modals` (inclui a escolha da pinta), `results`, `rules`, `feedback` (espera, conexão caída, confirmações, avisos), `card-tip`. No fim, porque sobrescrevem o que vem antes: `mobile`, `avatar`, `motion` (movimento reduzido), `analysis`. |
| `client/src/` | Um módulo por parte da tela. `main.js` é a entrada (conexão e convite) e carrega os outros; `core.js` tem atalhos do DOM, o socket e o estado da sala, que os outros leem direto e só mudam pelas funções `set...`. Telas: `home`, `ranking` (os primeiros e a sua posição), `account` (entrar, criar conta, sair e apagar; a sessão vai no handshake do socket), `howto`, `avatar-editor`, `lobby`, `results`. Mesa: `table` (assentos e voos), `deal`, `pile`, `hand`, `card-tip`, `drag`, `suit-picker`, `scores`, `clock`, `render` (desenha cada atualização). Gerais: `modals`, `chat`, `reactions`, `cards` (desenho das cartas e ícones), `audio`, `analysis` (o painel da análise do bot). |
| `public/` | Arquivos que vão para o build do jeito que estão, sempre no mesmo caminho: fontes, ícones, cartas, sons, `manifest.json` e o service worker (PWA). |
| `dist/` | Saída do `npm run build` (fora do git). |
| `test/` | Testes com `node:test`: regras (`engine`), bots (`bot`, `analysis`), salas (`rooms`, `host`, `away`, `names`, `kick`, `spectators`, `rematch`, `reactions`), avatar, e rede de ponta a ponta com clientes socket.io reais (`multiplayer`, `production`, `restart`). |

### PWA

- `public/sw.js`: service worker. A página vem da rede primeiro (o cache só entra sem internet), então editar o código não exige limpar nada. O JS e o CSS do build (`/assets/`, com hash no nome) vêm do cache primeiro: cada build gera nomes novos, e o service worker descobre quais são lendo a própria página na instalação. Fontes, ícones, cartas e sons também vêm do cache primeiro: ao trocar um desses arquivos, suba `VERSION` no `sw.js`.
- `public/fonts/`: Russo One e Barlow Semi Condensed (só o subconjunto latino), servidas pelo próprio projeto, com as licenças OFL ao lado.
- `public/icons/`: PNGs gerados a partir de `icon.svg` (192/512 e 32 para favicon) e de `icons/maskable.svg` (versões `maskable` com fundo até a borda e `apple-touch-icon`, de 180px, com a carta maior, porque o iOS ignora SVG e só arredonda os cantos).

## Regras implementadas

- 9 cartas para cada um. Quem dá as cartas na primeira rodada é sorteado; depois o carteador passa para a direita a cada rodada, até o fim da partida.
- Nenhuma carta é virada: quem está à direita de quem deu as cartas abre o monte com a carta que quiser, e o jogo segue para a direita (anti-horário).
- Joga carta da mesma pinta ou do mesmo número do monte. Sem jogada, compra 1. Se a carta comprada servir, pode jogar; se não servir, a vez passa sozinha.
- **Ás** pula o próximo. **7**: o da esquerda compra 1 (numa mesa de dois, o outro também perde a vez e quem jogou o 7 joga de novo). **8** entra em qualquer carta e escolhe a pinta. **9**: o da direita compra 2 e perde a vez. **Joker** entra em qualquer carta, todos os outros compram 1, e a pinta e o número da carta de baixo continuam valendo.
- Quem termina as cartas fecha a rodada. Os outros somam: Ás 1, 2–10 o próprio número, Valete/Dama/Rei 10, Joker 11. Chegou a 100, está fora. O último que sobrar vence.

### Decisões que a regra não definia (fácil de mudar em `shared/engine.js`)

- **Baralho**: 52 cartas + 2 Jokers. Entra mais um baralho a cada 3 jogadores (de 4 a 6 jogadores, 2 baralhos; de 7 a 8, 3). Sem isso, as mesas grandes ficavam sem cartas e travavam. Se até o monte acabar, entra um baralho novo.
- **Abrir o monte com especial**: vale o efeito normal. Se abrir com Joker, não há pinta embaixo, então o próximo joga qualquer carta.
- **A carta que bate não tem efeito**: bater com 9, 7 ou Joker encerra a rodada na hora, sem ninguém comprar, e a contagem usa as mãos como estavam.
- **Tempo por vez**: 30s por padrão, configurável. Se o tempo acaba, o jogo faz uma jogada automática. Jogador desconectado joga no automático até voltar.
- Mesa com 2 a 8 jogadores.

## Como o bot joga

Há dois bots em `shared/bot.js`:

- **Simples** (`chooseMoveBasic`): uma heurística rápida (livra-se das cartas que valem mais, guarda o 8, ataca com 9, Ás e 7 quando o próximo está quase batendo). É ele que joga nas salas, inclusive a jogada automática de quem fica sem tempo ou cai.
- **Forte** (`chooseMove` / `evaluateMoves`): não joga nas salas. Aparece só como análise ao vivo para as contas liberadas (veja "Análise do bot" abaixo).

O forte faz busca Monte Carlo com mundos sorteados, a técnica usada em jogos de cartas com informação escondida:

1. **Só vê o que um jogador atento veria**: a própria mão, as cartas que já caíram no monte, quantas cartas cada um tem e o histórico público da rodada (`state.log`, gravado pelo motor). Quem comprou sem jogar não tinha nada da pinta nem do número do monte, nem 8, nem Joker; o bot guarda isso para as cartas que a pessoa já tinha, e esquece quando a dedução se mostra errada. Ele nunca olha a mão dos outros nem a ordem do baralho (há um teste que garante isso).
2. **Sorteia mundos possíveis**: distribui as cartas que ele não vê entre os adversários (respeitando o que deduziu) e o baralho.
3. **Simula cada jogada até o fim da rodada** em cada mundo, com uma heurística rápida para todos. Cada jogada candidata (cada carta, o 8 com cada naipe, comprar ou passar) passa pelos mesmos mundos com a mesma sorte, e as que ficam claramente atrás são largadas no caminho para sobrar tempo para as que estão perto.
4. **Escolhe a de melhor resultado médio**: os pontos que ele leva (zero se bate), os pontos que os adversários levam e o risco de alguém passar de 100.

Pensa até 20 mil simulações ou 150 ms por jogada (`BOT_DEFAULTS`); dá para mudar por chamada (`chooseMove(state, id, { maxRollouts, maxMs })`). `evaluateMoves` devolve a nota de cada jogada, útil para depurar. A heurística antiga continua em `chooseMoveBasic`.

Contra o bot simples, numa mesa com mais N−1 deles, o bot forte ganha a partida bem mais que a fatia justa de 1/N:

| Jogadores na mesa | Partidas | Vitórias do bot forte | Fatia justa |
| --- | --- | --- | --- |
| 2 | 240 | 87% | 50% |
| 3 | 200 | 70% | 33% |
| 4 | 160 | 49% | 25% |
| 6 | 60 | 42% | 17% |

Gasta de 40 a 70 ms por jogada em média.

### Análise do bot

Para aprender a jogar melhor: na sua vez, um painel no canto da mesa mostra o que o bot forte jogaria e quanto cada opção perde para a melhor ("−2,3" = em média, termina a rodada 2,3 pontos pior). A carta sugerida fica marcada na mão. Depois que você joga, o painel compara a sua jogada com a do bot.

- **Quem vê**: só as contas cujo apelido está em `ANALYSIS_USERS` (sem acento nem caixa: `ANALYSIS_USERS=Zé` libera "ze"). Convidados nunca veem. O servidor confere no `game:analyze`, então esconder o painel na tela não é a única barreira.
- **Quando**: só na sua vez, ao vivo; nada é gravado. Com "sempre" marcado, a análise vem sozinha a cada vez; sem, aparece o botão "O que o bot jogaria?". O botão × esconde o painel e deixa só um "Mostrar análise" no canto; escondida, nada aparece (nem a carta marcada) e nada é pedido ao servidor, mesmo com "sempre". A escolha fica guardada no navegador.
- **Custo**: cada análise pensa até 400 ms (`ANALYSIS_MS` em `server/rooms.js`) e é reaproveitada se você pedir de novo na mesma situação. Limite de 6 pedidos a cada 10 s.
- **Atenção**: é ajuda de verdade durante a partida, inclusive nas que valem ranking.

## Próximo passo: app mobile

O motor (`shared/`) não depende do navegador nem do servidor, então dá para:

1. **Capacitor** (o caminho mais rápido): embrulhar a pasta `dist/` (o `webDir` do Capacitor) como app Android/iOS e apontar o `io()` do `client/src/core.js` para o servidor publicado. O cliente do Socket.IO já vem no build, então o app não depende do servidor para carregar a tela. Para o servidor aceitar o app, coloque a origem dele em `ALLOWED_ORIGINS` (veja "Publicando").
2. **React Native / Expo**: refazer a interface nativa e reaproveitar `shared/engine.js` e `shared/bot.js`, inclusive para um modo offline contra bots.
