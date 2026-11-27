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
| `ALLOWED_ORIGINS` | vazio | Outras origens que podem conectar, separadas por vírgula. O site servido pelo próprio servidor sempre pode. Para o app: `capacitor://localhost,https://localhost` (iOS e Android; veja "App Android e iOS"). |
| `MAX_ROOMS` | `500` | Teto de salas abertas. Acima disso, "Servidor cheio, tente daqui a pouco". |
| `MAX_CONNECTIONS_PER_IP` | `20` | Conexões simultâneas por IP. Uma família na mesma rede de casa cabe com folga. |
| `SNAPSHOT_FILE` | `data/rooms.json` | Onde as salas ficam gravadas entre um processo e outro. Precisa estar num disco que sobreviva ao deploy (veja abaixo). `off` desliga. |
| `DATABASE_FILE` | `data/oito-maluco.db` | Banco SQLite das contas (apelido, hash da senha, sessões). Tem que ficar no mesmo disco persistente do `SNAPSHOT_FILE` (por exemplo `/data/oito-maluco.db`): sem volume, cada deploy apaga todas as contas. |
| `GOOGLE_CLIENT_ID` | vazio | Liga o "Entrar com o Google" (veja "Login com o Google" abaixo). Vazio, o botão não aparece e só vale apelido e senha. |
| `ANALYSIS_USERS` | vazio | Apelidos de conta, separados por vírgula, que veem na própria vez o que o bot forte jogaria (veja "Análise do bot" abaixo). Vazio, ninguém vê. |
| `ANDROID_CERT_SHA256` | vazio | Impressões digitais SHA-256 do certificado que assina o app Android, separadas por vírgula. Liga o `/.well-known/assetlinks.json` (convites abrem no app; veja "App Android e iOS"). |
| `APPLE_TEAM_ID` | vazio | Team ID da conta de desenvolvedor da Apple. Liga o `/.well-known/apple-app-site-association`. |
| `APP_ID` | o `appId` do `capacitor.config.json` | Id do app nas lojas, usado nesses dois arquivos. Só mude se o app for publicado com outro id. |
| `STUN_URLS` | `stun:stun.l.google.com:19302` | Servidores STUN do chat de voz, separados por vírgula (veja "Chat de voz" abaixo). Vazio, não usa nenhum. |
| `TURN_URLS` | vazio | Servidores TURN do chat de voz, separados por vírgula (por exemplo `turn:turn.seu-dominio:3478,turns:turn.seu-dominio:5349`). Só vale junto com o `TURN_SECRET`. |
| `TURN_SECRET` | vazio | Segredo compartilhado com o TURN (o `static-auth-secret` do coturn). O servidor gera com ele credenciais que vencem. |
| `TURN_TTL_SECONDS` | `21600` (6h) | Validade de cada credencial TURN. |

- **Limites por conexão** (`RATE_LIMITS` em `server/index.js`): 5 salas criadas por minuto, 12 tentativas de entrar por minuto, 30 pedidos da lista de salas por minuto, 10 jogadas, compras ou passes a cada 5s, 400 mensagens de negociação do voz a cada 10s, e 20 a cada 10s nos outros eventos. Mensagens maiores que 16KB derrubam a conexão de quem mandou.
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

### Chat de voz

O áudio vai direto de um aparelho para o outro (WebRTC, uma conexão por par, só áudio), e o servidor do jogo só apresenta as pessoas: quem entra no voz (`voice:join`) recebe a lista de quem já está e os servidores STUN/TURN, e as mensagens de negociação passam pelo `voice:signal`, só entre duas pessoas da mesma sala que estão no voz (`server/voice.js` e os métodos `voice*` de `server/rooms.js`). Cair, sair da sala ou ser removido tira a pessoa do voz e avisa os outros (`voice:peer-left`). Nada do voz vai para o `SNAPSHOT_FILE`.

**Cada pessoa decide.** Não há opção do anfitrião: o voz está disponível em toda sala, e ninguém ouve nem é ouvido sem tocar no botão do fone, no topo da sala de espera ou da mesa. Jogadores, plateia e quem já foi eliminado entram, falam e ouvem do mesmo jeito. Dentro do voz:

- o botão do microfone liga e desliga o próprio microfone (a escolha fica guardada no navegador);
- o botão do fone mostra quantos estão no voz e abre o menu com cada pessoa: dá para silenciar alguém só para você (vale enquanto você estiver na sala) e sair do voz;
- sem microfone (permissão negada, nenhum microfone ou página sem https, como `http://192.168...` na rede de casa), a pessoa entra só ouvindo; o botão do microfone fica desligado e tocar nele pede o microfone de novo, sem sair do voz;
- nos avatares: selo de fone (no voz), de microfone cortado (desligou) ou de alto-falante cortado (você silenciou), e um anel verde em quem está falando. A plateia não tem assento na partida, então quem dela está no voz aparece numa fileira no canto da mesa; um eliminado fica aceso enquanto fala.

A conexão fica em `client/src/voice.js` e a tela em `client/src/voice-ui.js`.

- **STUN** descobre o endereço público de cada aparelho. Basta para a maioria das redes de casa.
- **TURN** retransmite o áudio quando a conexão direta não passa (operadora de celular, rede de empresa, NAT simétrico): sem ele, o voz falha em parte das conexões. Em produção, o servidor avisa no log quando falta. Pode ser um [coturn](https://github.com/coturn/coturn) próprio numa VPS (com `use-auth-secret` e `static-auth-secret=<o mesmo TURN_SECRET>`) ou um serviço que aceite o mesmo padrão de credencial temporária. O segredo fica só no servidor do jogo; o cliente recebe um usuário e senha que vencem em `TURN_TTL_SECONDS`, e só quem está numa sala e no voz recebe. Render, Railway e Fly não aceitam o UDP de que o TURN precisa: ele fica noutra máquina.

**Hoje o servidor publicado roda sem TURN** (decisão de 26/11/2026): só STUN. Na maioria das redes de casa o áudio conecta; em parte do 4G e das redes de empresa, não. Quando a conexão com alguém falha, o cliente tenta outro caminho duas vezes e, depois de 10s falhando, avisa quem está na mesa ("Não deu para conectar o áudio com Ana...") e o menu do voz mostra "sem conexão" ao lado da pessoa. Para ligar o TURN depois, basta subir um e preencher `TURN_URLS` e `TURN_SECRET`: nada muda no código. O `/health` diz o que está configurado (`voice: { stun, turn }`) e quantas pessoas estão no voz agora (`inVoice`).

#### Testando o voz

- **No computador, sozinho:** abra a sala em `http://localhost:3000` num navegador e em `http://127.0.0.1:3000` noutro (ou numa janela anônima). Duas abas da mesma origem dividem o token e uma derruba a outra.
- **No celular, pela rede de casa:** `http://192.168.x.x:3000` não é https, então o celular entra só ouvindo. Para testar o microfone do celular, use o servidor publicado (https).

Roteiro com gente de verdade, no servidor publicado. Cada item vale com fone de ouvido e sem fone (sem fone, o cancelamento de eco do navegador é quem segura a microfonia):

1. **Dois computadores na mesma rede:** os dois se ouvem, o anel verde acompanha a fala, e o microfone desligado corta o áudio e mostra o selo.
2. **Computador e celular (Android, Chrome) no Wi-Fi:** o mesmo, mais bloquear e desbloquear a tela: ao voltar, o voz reconecta sozinho.
3. **iPhone (Safari) no Wi-Fi:** o mesmo. Conferir se o som do jogo continua saindo depois de abrir o microfone e se a voz sai pelo alto-falante, não pelo fone de ouvido do aparelho.
4. **Celular no 4G com alguém no Wi-Fi de casa:** é onde o STUN pode não bastar. Anote se conectou; se aparecer o aviso de "não deu para conectar", é o caso do TURN.
5. **Mesa cheia (6 a 8 pessoas no voz):** o áudio continua limpo e o celular não esquenta demais. Cada pessoa manda o áudio para cada uma das outras, então é aqui que a malha mostra o limite.
6. **Trocar de rede no meio (Wi-Fi para 4G):** o voz volta sozinho ou mostra o aviso, sem travar a partida.

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
| `server/` | Express + Socket.IO: salas, anfitrião, bots, chat, reações, tempo por vez, reconexão e as salas gravadas entre reinícios (`snapshot.js`). Contas em `/api` (`api.js`: cadastro, entrar, sair, `/me`, apagar conta; `auth.js`: senha com scrypt, sessões e contas do Google; `google.js`: confere o token do Google; no fim de cada partida com alguém logado, a sala manda o resumo para o banco, e `/api/leaderboard` monta o ranking; `db.js`: o SQLite e as migrações). `app-links.js`: os arquivos `/.well-known/` que fazem os convites abrirem no app. No desenvolvimento, monta o Vite como middleware na mesma porta; em produção, serve o `dist/`. |
| `client/` | Interface web (`index.html`, `style.css` e os módulos em `src/`, JS puro sem framework), responsiva para celular. Entrada do Vite (`vite.config.js`). |
| `client/styles/` | O CSS, um arquivo por tela ou parte da tela, juntados pelos `@import` do `style.css` na ordem da cascata (o Vite gera um CSS só). Base: `base` (fontes, cores, medidas), `components` (botões, ícones). Tela inicial: `home`, `account`, `howto`, `rooms`, `ranking`. `lobby`, `chat`. Partida: `table`, `seats`, `reactions`, `hand`, `cards`, `scores`. `modals` (inclui a escolha da pinta), `results`, `rules`, `feedback` (espera, conexão caída, confirmações, avisos), `card-tip`. No fim, porque sobrescrevem o que vem antes: `mobile`, `avatar`, `motion` (movimento reduzido), `analysis`. |
| `client/src/` | Um módulo por parte da tela. `main.js` é a entrada (conexão e convite) e carrega os outros; `core.js` tem atalhos do DOM, o socket e o estado da sala, que os outros leem direto e só mudam pelas funções `set...`. Telas: `home`, `ranking` (os primeiros e a sua posição), `account` (entrar, criar conta, sair e apagar; a sessão vai no handshake do socket), `howto`, `avatar-editor`, `lobby`, `results`. Mesa: `table` (assentos e voos), `deal`, `pile`, `hand`, `card-tip`, `drag`, `suit-picker`, `scores`, `clock`, `render` (desenha cada atualização). Gerais: `modals`, `chat`, `reactions`, `cards` (desenho das cartas e ícones), `audio`, `analysis` (o painel da análise do bot). |
| `public/` | Arquivos que vão para o build do jeito que estão, sempre no mesmo caminho: fontes, ícones, cartas, sons, `manifest.json` e o service worker (PWA). |
| `dist/` | Saída do `npm run build` (fora do git). |
| `android/`, `ios/` | Projetos nativos do app (Capacitor), configurados em `capacitor.config.json`. Veja "App Android e iOS". |
| `scripts/` | `app-links.mjs`: grava o domínio do servidor nos projetos nativos a cada `build:mobile`. |
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

Para aprender a jogar melhor: na sua vez, um painel no canto da mesa mostra o que o bot forte jogaria e as 3 melhores opções, com quanto cada uma perde para a melhor ("−2,3" = em média, termina a rodada 2,3 pontos pior; a explicação aparece ao passar o mouse no número). A carta sugerida fica marcada na mão. Depois que você joga, o painel compara a sua jogada com a do bot.

- **Quem vê**: só as contas cujo apelido está em `ANALYSIS_USERS` (sem acento nem caixa: `ANALYSIS_USERS=Zé` libera "ze"). Convidados nunca veem. O servidor confere no `game:analyze`, então esconder o painel na tela não é a única barreira.
- **Quando**: só na sua vez, ao vivo; nada é gravado. Com "sempre" marcado, a análise vem sozinha a cada vez; sem, aparece o botão "O que o bot jogaria?". O botão × esconde o painel e deixa só um "Mostrar análise" no canto; escondida, nada aparece (nem a carta marcada) e nada é pedido ao servidor, mesmo com "sempre". A escolha fica guardada no navegador.
- **Custo**: cada análise pensa até 400 ms (`ANALYSIS_MS` em `server/rooms.js`) e é reaproveitada se você pedir de novo na mesma situação. Limite de 6 pedidos a cada 10 s.
- **Atenção**: é ajuda de verdade durante a partida, inclusive nas que valem ranking.

## App Android e iOS

O app é o mesmo cliente embrulhado com o [Capacitor](https://capacitorjs.com/): o `npm run build:mobile` gera o `dist/` e copia para os projetos nativos em `android/` e `ios/` (que ficam no git; os arquivos copiados não). Os arquivos da tela vão dentro do app, então ela abre sem depender do servidor, e só o tempo real e as contas vão pela rede.

Para gerar:

1. Copie o `.env.mobile.example` para `.env.mobile` e ponha em `VITE_SERVER_URL` o endereço do servidor publicado, com `https`. Sem ele, o build do app para com erro.
2. No servidor, defina `ALLOWED_ORIGINS=capacitor://localhost,https://localhost`: é a origem da página dentro do app no iOS e no Android.
3. `npm run android` abre o projeto no Android Studio; `npm run ios` abre no Xcode (só no macOS). Os dois rodam o `build:mobile` antes. Depois de mudar o cliente, `npm run build:mobile` atualiza os dois projetos.

| Comando | O que faz |
| --- | --- |
| `npm run build:mobile` | `vite build --mode mobile` (lê o `.env.mobile`), `scripts/app-links.mjs` (põe o domínio do `VITE_SERVER_URL` nos projetos nativos) e `cap sync` (copia o `dist/` para `android/` e `ios/` e atualiza os plugins). |
| `npm run android` / `npm run ios` | O mesmo, e abre o projeto nativo. |

No código, `client/src/platform.js` diz se está no app (`isNative`) e para onde conectar (`SERVER_URL`, vazio no navegador), e tem as funções que mudam entre o site e o app: `vibrate` (no app, o motor de vibração do sistema, que no iOS a web não tem), `shareLink` e `copyText` (no app, o compartilhamento e a área de transferência nativos). No app, o socket e o `/api` vão para o `SERVER_URL`, o link de convite também aponta para ele, e o service worker não é registrado. O resto do cliente é igual ao do site. O id do app (`appId` em `capacitor.config.json`) não muda depois de publicado nas lojas.

`client/src/native.js` só age dentro do app:

- **Voltar do Android**: fecha o que estiver aberto, como o Esc (`closeTopLayer` em `modals.js`). Na sala, faz o mesmo que o botão "Sair" (no meio da partida, pede confirmação). Na tela inicial, minimiza o app em vez de fechar.
- **Volta do segundo plano**: reconecta se a conexão caiu. Depois de mais de 15s fora, reconecta de qualquer jeito, porque o iOS congela o app e a conexão pode parecer aberta sem estar. A sala volta pelo token, como em qualquer queda.
- **Convites**: um link `https://servidor/?sala=CODIGO` aberto no celular com o app instalado abre o app, que entra na sala (`openInvite` em `home.js`, o mesmo do `?sala=` do site).

### Convites abrindo no app

O Android e o iOS só abrem o app por um link `https://` se o servidor provar que o app é dele. O `npm run build:mobile` já põe o domínio do `VITE_SERVER_URL` nos projetos nativos (o `AndroidManifest.xml` e o `ios/App/App/App.entitlements` mudam no primeiro build: commite). No servidor publicado:

1. **Android**: defina `ANDROID_CERT_SHA256` com a impressão digital SHA-256 do certificado que assina o app. Com o Play App Signing, é a do Google (Play Console → Testar e lançar → Integridade do app → Assinatura do app). Para testar o build de debug, inclua também a da chave de debug (`keytool -list -v -keystore ~/.android/debug.keystore -storepass android`), separada por vírgula. Confira em `https://servidor/.well-known/assetlinks.json`.
2. **iOS**: defina `APPLE_TEAM_ID` (Apple Developer → Membership) e ligue o "Associated Domains" no App ID (o Xcode faz isso sozinho com a assinatura automática). Confira em `https://servidor/.well-known/apple-app-site-association`.

O Android filtra só pelo caminho, então qualquer link para a raiz do site abre o app; o iOS abre só os que têm `?sala=`. Sem as variáveis, o link abre no navegador, como hoje.

Falta para publicar: login do Google nativo (o botão do site não funciona dentro do app) e "Entrar com a Apple", ícones e tela de abertura, barra de status e teclado, e o que as lojas pedem (moderação do chat, política de privacidade).
