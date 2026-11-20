# Melhorias do projeto

Lista de tarefas tirada da análise feita em 06/11/2026, lendo o código e jogando uma partida com 3 bots no navegador (desktop ~800×500 e celular 375×812). Continua de onde o `UI-UX-TASKS.md` parou (as 34 tarefas de lá estão feitas).

**Prioridades:** 🔴 corrigir primeiro · 🟠 experiência de jogo · 🟡 visual e layout · 🟢 recursos novos · 🔧 código e servidor

**Ordem sugerida:** 1 → 4 → 3 → 2 → 5 a 8 → o resto.

**Multiplayer (tarefas 26 a 40, análise do servidor e da conexão em 06/11/2026):** 26 → 27 → 28 → 37 → 36 + 25 → 40 → 29 a 35 → o resto. As 🔴 dessa seção vêm antes de publicar o servidor para gente de fora.

---

## 🔴 Corrigir primeiro

- [x] **1. Margem quebrada na home do celular**
      Em 375px os botões Criar sala, Salas abertas e a linha do código ficam a 16px da borda esquerda e a 2px da direita. O campo de código (`.join-row input`) força a coluna implícita da grade a 357px, maior que os 343px disponíveis.
  - Onde: `.home-menu` em `client/style.css`
  - Pronto quando: `.home-menu` tem `grid-template-columns: minmax(0, 1fr)` e as margens ficam iguais (16px) dos dois lados em 320, 375 e 414px.

- [x] **2. Mão inteira na tela em telas baixas**
      Com 500px de altura a base das cartas fica cortada; no celular a segunda fileira encosta no fim da tela, sem respeitar a área segura do iPhone.
  - Onde: `.hand` e `layoutHand()` em `client/app.js`, `client/style.css`
  - Pronto quando: em 800×500 e 375×667 as cartas aparecem inteiras, e a mão usa `padding-bottom: env(safe-area-inset-bottom)`.
  - Feito: o caso que cortava era o desktop baixo (1024×500 rolava 49px). A mesa agora é quem cede altura (mínimo = assento de cima + montes), e desktops com até 580px de altura usam cartas de 64×92. O assento de cima não sobe mais por cima da barra do topo (`placeSeat()`), os montes descem quando a mesa é baixa e o selo da pinta vai para o lado deles (container query na `.table`). A área segura já vinha do padding de `.game-layout`. Conferido sem rolagem em 1024×500, 800×500, 1280×720 e 375×812, inclusive com 24 cartas em 2 fileiras.
  - Fica de fora: celular deitado (~844×390) ainda rola um pouco.

- [x] **3. Ações do lobby sempre à vista**
      Em ~800px a mesa oval ocupa a primeira tela inteira; "Adicionar bot" e "Começar partida" ficam abaixo da dobra, e o chat embaixo sobra com uns 250px vazios.
  - Onde: tela `#lobby` em `client/index.html` e `client/style.css`
  - Pronto quando: em 800×500 e 1440×900 dá para começar a partida sem rolar (mesa e painel lado a lado, ou as ações fixas no rodapé), e o chat não deixa um bloco vazio.
  - Feito: mesa e chat ficam lado a lado até 700px de largura, e a mesa da sala de espera tem mínimo de 280px. Quando ela fica baixa, o centro fica compacto: código menor e rótulo "Sala" só para leitor de tela. No celular a mesa encolhe conforme a altura, o chat cresce com as mensagens (até 40% da tela) e os dois botões cabem numa linha em 360px. "Começar partida" visível sem rolar em 1280×720, 1024×560, 800×500, 720×480, 375×812 e 360×640.

## 🟠 Experiência de jogo

- [x] **4. Última jogada visível na mesa**
      A partida corre rápido e só dá para saber quem jogou o quê abrindo a gaveta.
  - Onde: `renderCenter()` em `client/app.js`
  - Pronto quando: perto do monte aparece a última ação ("Robô Cida jogou 9♠ · Você compra 2") com o avatar de quem jogou, atualizada a cada jogada e compra.
  - Feito: `#lastMove` acima dos montes, montado por `describeMove()` a partir dos eventos. Mostra o avatar, o nome, a carta como mini carta e os efeitos: "compra 2 e perde a vez", "foi pulado", "todos compram 1" no Joker. Compras e passes também aparecem. A linha fica até a próxima jogada, é anunciada para leitor de tela (com o nome inteiro da carta) e se limpa no começo da rodada. Em mesas baixas ela vai para a esquerda dos montes. Conferido sem sobreposição com 4 e 8 jogadores, de 1440×900 a 375×812.

- [x] **5. Feltro limpo no início da rodada**
      A marca "8 Maluco", o fantasma "Rodada 1" e o "monte vazio" ficam sobrepostos no centro.
  - Onde: `.felt` e o anúncio de rodada em `client/style.css` / `client/app.js`
  - Pronto quando: em nenhum momento dois textos do centro da mesa se sobrepõem.
  - Feito: saiu a marca "8 Maluco" da mesa da partida (no lobby ela continua, e some quando a mesa é baixa). O monte vazio ficou só com o contorno, porque o selo embaixo já diz quem abre. O letreiro "Rodada N" ficou quase opaco (95%), então o que está embaixo não aparece através dele.

- [x] **6. Usar a faixa entre a mesa e a mão no desktop**
      A linha "Você · 0 pts" fica solta, com uma faixa vazia à direita.
  - Onde: `#meInfo` em `client/index.html`
  - Pronto quando: a faixa mostra seu placar com a barra até 100 (ou as cartas crescem para ocupar o espaço).
  - Feito: `#meScore` no canto direito da barra mostra "Seus pontos 12 / 100" e uma barra que fica vermelha a 20 pontos do limite, com dica de quanto falta. No desktop o "Você" perde o "· N pts" para não repetir; no celular o placar não aparece e o "Você · N pts" continua.

- [x] **7. Contagem de cartas dos adversários em destaque**
      Cartas na mão e pontos aparecem a ~12px, e o número de cartas é a informação mais importante da partida.
  - Onde: `.seat` em `client/style.css` e o render dos assentos em `client/app.js`
  - Pronto quando: a quantidade de cartas aparece num selo legível (16px ou mais) e quem está com 1 carta ganha um aviso visível.
  - Feito: selo com mini carta e número a 18px (16px no celular). Com 1 carta o selo fica vermelho e pulsa duas vezes (sem pulsar com movimento reduzido). Os pontos ficam ao lado em texto menor; no celular, embaixo do selo.

## 🟡 Visual e layout

- [x] **9. Home do desktop com estrutura**
      Logo, perfil, botões e "Como jogar" flutuam em três colunas soltas, com uns 35% da tela vazia embaixo. O perfil é pequeno para o que faz e o carrossel tem contraste e texto fracos.
  - Onde: `#home` em `client/index.html` e `client/style.css`
  - Pronto quando: em 1440×900 a home ocupa a tela com um elemento dominante, o perfil tem mais peso e o texto do "Como jogar" passa de 4.5:1 de contraste.
  - Feito: no desktop ficam dois painéis num degrau de tom (sem contorno nem sombra): "você + jogar" (avatar de 200px, apelido e os três botões) e "Como jogar" (passo com 24px, texto com 18px). A grade da home virou `auto 1fr auto`. Em desktops com até 820px de altura o logo e os espaçamentos diminuem; entre 861 e 1100px de largura os painéis empilham. Sem rolagem e com margens iguais em 1280×720, 1366×768, 1440×900 e 1920×1080. No celular continua a coluna solta de antes.

- [x] **10. Rótulos sem caixa alta numerada**
      "1. RECEBA AS CARTAS" e o placeholder "C Ó D I G O" com letras espaçadas.
  - Onde: `.howto-card` em `client/index.html`, `.join-row input::placeholder` em `client/style.css`
  - Pronto quando: os títulos ficam em caixa normal, sem número na frente, e o placeholder sem espaçamento extra.
  - Feito: os passos do "Como jogar" perderam o número (a ordem já aparece nas bolinhas e no contador) e a caixa alta. O placeholder "Código" ficou em caixa normal, sem espaçamento; o código digitado continua em caixa alta e espaçado. Os rótulos "Cor" e "Estilo" do editor de avatar também saíram da caixa alta.

- [x] **11. Papel claro de cada ambiente visual**
      A home é carvão com naipes, os modais são feltro verde e os botões são cinza 3D.
  - Pronto quando: há uma regra escrita (por exemplo: feltro só onde há jogo, carvão no menu e nos modais do menu) e todos os modais a seguem.
  - Feito: carvão é o menu (Salas públicas, Avatar, Regras, Erro ao entrar); feltro é a mesa (lobby, partida, pinta do 8, resultado, sair, remover jogador). Salas, Avatar e Erro ao entrar deixaram de usar `.felt-box`, e as áreas internas deles (linhas da lista de salas, palco e abas do avatar) usam degraus de tom (`--surface-2`, `--surface-3`) em vez de preto translúcido, sombra interna e holofote em gradiente. A regra está escrita no comentário do `.modal-box`.

- [x] **12. Sombras, cores e tamanhos em tokens**
      Há 60 `box-shadow`, 10 gradientes, 101 `rgba()` soltos e 5 `font-size` fora da escala (4.2rem, 2.6rem, 2.4rem, 1.3rem, 3.2rem).
  - Onde: `client/style.css`
  - Pronto quando: sombras e véus usam tokens (`--shadow-raised`, `--scrim`…), os tamanhos de texto vêm de `--fs-*` (com um `--fs-display` para o logo e o avatar grande) e os gradientes que sobrarem têm motivo.
  - Feito: tokens novos `--shadow-sm` / `--shadow` / `--shadow-lg` / `--shadow-float` (elevação pelo tamanho do desfoque), `--text-shadow`, `--veil-weak` / `--veil` / `--veil-strong`, `--scrim`, `--felt-surface` e `--fs-4xl` / `--fs-5xl` / `--fs-display`. As 27 sombras soltas com desfoque, as 5 sombras de texto, os 9 véus e fundos de modal e os tamanhos fora da escala passaram a usar esses tokens. `rgba()` fora dos tokens: 94 → 60; gradientes: 9 → 7, todos funcionais (anel de tempo, contador, máscara) ou do material do feltro; tamanhos de fonte soltos: 6 → 0. O relevo 3D dos botões (sombra sem desfoque) ficou como estava.

- [x] **13. Estado vazio de "Salas públicas"**
      Caixa tracejada e o botão "Criar uma sala" pequeno demais.
  - Onde: `#roomsModal` e o render da lista em `client/app.js`
  - Pronto quando: o estado vazio não usa borda tracejada e o botão tem o tamanho do botão principal.
  - Feito: o estado vazio está num degrau de tom (sem contorno tracejado) e o "Criar uma sala" é o mesmo botão principal da home (grande, com ícone de +, 60px de altura).

## 🟢 Recursos novos

- [x] **14. Reações rápidas**
  - Pronto quando: há 4–6 reações ("Boa!", "Ops!", risada, bravo) que aparecem num balão em cima do avatar por 2s, com limite de frequência no servidor.
  - Feito: 6 reações em `shared/reactions.js` (Boa!, Haha, Ops!, Grr!, Uau!, Vai logo!), cada uma com uma carinha em SVG no traço dos avatares (símbolos `#r-*` do sprite em `app.js`). O botão "Reagir" fica no topo da mesa e da sala de espera e abre um menu que fecha com Esc, clicando fora ou escolhendo, e que navega pelas setas. O servidor (`Room.react`) só aceita ids da lista e no máximo 3 reações a cada 5s por pessoa (`takeSlot`, janela deslizante); passando disso, quem mandou vê "Calma! Espere um pouquinho para reagir de novo". O balão aparece por 2s em cima do avatar de quem reagiu (assento, sua barra ou cadeira do lobby) e é lido pelo leitor de tela. Testes em `test/reactions.test.js`. Em telas de até 380px, o "Como jogar" do lobby ficou só com o ícone para tudo caber numa linha.

- [x] **16. Revanche em um clique**
      Ao fim da partida só existe "Voltar para a sala".
  - Pronto quando: há "Jogar de novo", que reinicia direto com a mesma mesa e as mesmas configurações. Com mais jogadores (multiplayer), o botão vira um "pronto" e a partida nova começa quando todos estiverem prontos.
  - Feito: no fim da partida, quem é o único humano da sala vê "Jogar de novo", que recomeça na hora com a mesma mesa (ordem dos assentos, bots, tempo por vez). Com mais humanos o botão vira "Pronto para a revanche": vira "Pronto!" depois do clique, a linha embaixo diz quem falta e a partida nova começa quando todos os humanos conectados estiverem prontos. Quem caiu ou saiu não segura a revanche e fica fora da mesa nova. "Voltar para a sala" continua para o anfitrião, como opção secundária, e apaga os pedidos. No servidor: `Room.rematch`, `rematchWaitingOn` e `checkRematch`, com o início de partida reunido em `newGame`. O estado leva `rematch` e `rematchWaitingOn`. Testes em `test/rematch.test.js`.

- [ ] **17. Modo solo offline contra bots**
      `shared/engine.js` e `shared/bot.js` já rodam no navegador.
  - Pronto quando: dá para jogar contra bots sem servidor (e sem internet, junto com a tarefa 18).

- [x] **18. PWA completo**
      Não há service worker, o único ícone é `icon.svg` (o iOS precisa de PNG em `apple-touch-icon`) e as fontes vêm do Google Fonts.
  - Pronto quando: há service worker com cache dos arquivos estáticos, ícones PNG 192/512 (e maskable), `apple-touch-icon` e fontes servidas pelo próprio projeto.
  - Feito: `public/sw.js` guarda a casca do jogo (página, CSS, JS, `/shared`, cliente do socket.io), as fontes, os ícones, as cartas e os sons (38 arquivos). Página, CSS e JS vêm da rede primeiro, então o código está sempre atualizado com internet; fontes, ícones, cartas e sons vêm do cache primeiro. O tempo real (`/socket.io/`) nunca passa pelo cache. As fontes ficam em `public/fonts` (6 woff2 do subconjunto latino, ~120KB, com as licenças OFL), e as três mais usadas são pré-carregadas. Os ícones PNG ficam em `public/icons`: 32, 192 e 512, `maskable` 192 e 512 e `apple-touch-icon` 180, com metas do iOS. O manifest ganhou `id`, `scope`, `lang` e os PNGs. Conferido: nenhuma requisição externa, e com o servidor desligado a página (inclusive `/?sala=…`) abre do cache com as fontes e mostra "Reconectando".

- [ ] **20. Mais avatar**
  - Pronto quando: há acessórios (boné, brinco, fone) como nova parte em `shared/avatar.js`, dá para guardar alguns avatares prontos e o vencedor aparece com o avatar grande na tela final.
  - Feito (acessórios e mais opções): duas partes novas, `accessory` e `accessoryColor` (mesma paleta das roupas), com a aba "Extras" no editor: boné, gorro, fone, brincos, cartola, coroa, laço, faixa, viseira de crupiê, flor e bandana. Com chapéu, o cabelo dentro de uma cúpula um pouco maior que ele é recortado, e o que passa dela (volume do black power, rabo de cavalo, chiquinhas) continua aparecendo. Avatares salvos antes (no navegador e no banco) não têm essas chaves: o `sanitizeAvatar` as completa com "Nenhum" em vez de descartar o avatar. Também entraram 6 cabelos (rabo de cavalo, tranças, tigela, ondulado, raspado, dreads), 6 rostos (gargalhada, estrelas, desconfiado, triste, barba, cavanhaque) e 5 roupas (camisa 8, xadrez, macacão, crupiê, florida). O desenho ganhou brilho nos olhos, o detalhe de dentro da orelha, a sombra do queixo no pescoço e reflexo em mais cabelos. Faltam os avatares prontos e o avatar grande do vencedor.

## 🔧 Código e servidor

- [x] **22. Dividir `app.js` e `style.css`**
      `app.js` tem 3.397 linhas e `style.css` 4.462.
  - Pronto quando: o cliente é dividido em módulos ES sem build (rede, mesa, animações, modais, editor de avatar) e o CSS por tela, sem mudar o comportamento.
  - Feito (JS): `client/app.js` virou 22 módulos em `client/src/` (`main.js` é a entrada; `core.js` tem o estado da sala e as utilidades; um módulo por parte da tela: `lobby`, `table`, `hand`, `drag`, `suit-picker`, `audio`, `avatar-editor`...). O Vite junta tudo no build. O estado compartilhado (`state`, `roomCode`...) só muda pelas funções `set...` do `core.js`. Os tipos do cliente entram no `npm run typecheck`. Conferido no navegador: partida com bots, arrastar, pinta do 8, reações, resultado e rodada 2, no desenvolvimento e no build de produção.
  - Feito (CSS): `client/style.css` virou 24 arquivos em `client/styles/` (`base`, `components`, `home`, `account`, `howto`, `rooms`, `ranking`, `lobby`, `chat`, `table`, `seats`, `reactions`, `hand`, `cards`, `scores`, `modals`, `results`, `rules`, `feedback`, `card-tip`, `mobile`, `avatar`, `motion`, `analysis`). O `style.css` ficou só com os `@import`, na ordem da cascata, e o `index.html` continua apontando para ele; o Vite junta tudo num CSS só no build. As regras estão na mesma ordem de antes, com duas exceções sem efeito: os pedaços da tela inicial (menu, entrar com código, rodapé) foram juntados no `home.css` antes da conta e do "Como jogar", e as salas abertas vêm antes do ranking (os seletores não se cruzam). O balão do chat foi para o `reactions.css`, depois das regras de `.reaction`. Conferido: o build sai com o mesmo tamanho e as mesmas 688 regras, e no navegador o estilo calculado de cada elemento é igual ao do CSS antigo (comparando os dois na mesma página) na tela inicial, no lobby e na partida com bots, no celular e no desktop.

- [x] **23. Testes do servidor**
      Só o motor e o avatar têm testes.
  - Pronto quando: `server/rooms.js` tem testes para entrar, sair, remover jogador, reconectar, adicionar bot e jogada automática por tempo.
  - Feito: `test/rooms.test.js` (16 testes, com relógio simulado) cobre:
    - entrar: o primeiro vira anfitrião, sem token não entra, apelido vazio vira "Jogador" e quem entra recebe o histórico do chat;
    - sair: no lobby e no meio da partida (a vez passa); o último humano fecha a sala, e quem cai no lobby perde o lugar em 30s;
    - remover: só o anfitrião remove, ninguém remove a si mesmo, e o removido recebe `room:kicked`;
    - reconectar: o mesmo lugar e as mesmas cartas, o lugar guardado por 30s no lobby, e a queda de uma conexão velha não derruba a nova;
    - bots: só o anfitrião adiciona, fora da partida, até encher a mesa e com nomes diferentes; o bot joga sozinho em 3 a 5s (mais 3,5s se abre a rodada);
    - tempo esgotado: 15s mais a distribuição, depois a jogada automática com aviso no chat;
    - configurações.

    O resto do `rooms.js` ficou coberto pelos testes das tarefas 26–37: `host`, `away`, `names`, `kick`, `spectators`, `rematch`, `reactions`, `multiplayer` e `production`. Rodei `rooms.test.js` 30 vezes seguidas, sem nenhuma falha.

- [x] **24. Queda do servidor**
      As salas ficam só na memória: reiniciar o servidor derruba todas as partidas.
  - Pronto quando: o cliente avisa que a conexão caiu, tenta reconectar sozinho e volta para a home com uma mensagem clara se a sala sumiu.
  - Feito: o cliente já fazia quase tudo; faltava conferir e acertar dois detalhes. Conferido no navegador derrubando o processo do servidor à força no meio de uma partida, sem recarregar a página. A faixa "Reconectando" aparece na hora. Com o servidor de volta (vazio), o Socket.IO reconecta sozinho, o cliente tenta voltar para a sala, volta para a home e abre o modal "A sala fechou". **Acertos:** (1) o texto do modal agora explica o que houve: "A conexão caiu e, quando voltou, a sala X não existia mais. Isso acontece quando o servidor reinicia ou quando a sala fica vazia por muito tempo." (2) Quando a queda acontecia durante a distribuição, as cartas continuavam voando por cima da home. Agora `show()` chama `stopFlights()` ao sair da mesa, o que cancela os voos agendados e a distribuição, e isso também vale para quem é removido ou sai no meio da animação. O aviso antes de um reinício planejado veio com a 37 (`server:restart`). Manter as partidas depois de reiniciar é a tarefa 38.

- [x] **25. Limites no servidor**
      O chat já tem 400ms entre mensagens.
  - Pronto quando: há limite de tentativas de código de sala por conexão e `compression` nos arquivos estáticos.
  - Feito: o limite de tentativas de código entrou com a 36 (12 `room:join` por minuto). O pacote `compression` está no `package.json` e roda antes do `express.static`, comprimindo HTML, CSS e JS (inclusive `/shared`). Medido no servidor local: `app.js` caiu de 131KB para 41KB, `style.css` de 97KB para 23KB e `index.html` de 27KB para 6KB. O Socket.IO não passa pelo Express, então o tempo real não é afetado. Teste em `test/production.test.js`. Conferido no navegador: a página, as fontes e a conexão carregam sem erro.

## 🌐 Pronto para multiplayer

O que falta para várias pessoas jogarem juntas pela internet sem travar, trapacear ou derrubar a sala. O que já funciona: as mãos dos outros não vazam (`viewFor` e os eventos só levam contagem), o servidor valida vez e jogada, há reconexão pelo token, plateia para quem entra no meio, selo de desconectado e revanche com "pronto".

### 🔴 Antes de abrir para o público

- [x] **26. Mensagem malformada derruba o servidor**
      Conferido: um único `socket.emit('room:join', null)` derruba o processo (`TypeError: Cannot read properties of null (reading 'code')` em `server/index.js:51`) e todas as salas caem juntas. O mesmo vale para `room:create` com `null`. O Socket.IO não protege os handlers, e não há `process.on('uncaughtException')`.
  - Onde: `server/index.js`
  - Pronto quando: todo handler normaliza `data` (objeto ou `{}`) e roda dentro de um `try/catch` que responde `{ ok: false, error: 'Erro no servidor' }` e registra o erro. Um teste manda `null`, número, string, array e objeto gigante para cada evento, e o servidor continua de pé.
  - Feito: todos os eventos passam por `on()` em `server/index.js`, que pega o ack como último argumento, troca qualquer coisa que não seja objeto por `{}` e, se o handler der erro, responde "Erro no servidor" e registra no log com o código da sala. Erros que escapam (num timer de bot, por exemplo) vão para o log por `uncaughtException`/`unhandledRejection` em vez de derrubar o processo. O servidor agora é montado por `createGameServer()` e só liga a porta quando roda direto, para os testes subirem um numa porta qualquer. `test/multiplayer.test.js` manda `null`, número, string, array e objetos com tipos errados, com e sem ack, para os 16 eventos, e depois cria uma sala normalmente. O objeto gigante fica com a tarefa 36 (`maxHttpBufferSize`).

- [x] **27. Duas abas controlam o mesmo jogador**
      O token fica no `localStorage`, então duas abas do mesmo navegador são o mesmo jogador. Quando a segunda entra, `join()` só tira a primeira do canal da sala: o `socket.data` dela continua apontando para o mesmo `memberId`, então a aba antiga para de receber o estado, mas ainda consegue jogar, comprar e mandar chat.
  - Onde: `Room.join()` em `server/rooms.js`, `socket.on(...)` em `client/app.js`
  - Pronto quando: a conexão antiga recebe `room:replaced`, tem `socket.data.code`/`memberId` limpos, e a aba antiga mostra "Você abriu esta sala em outra aba" com um botão "Jogar aqui" (que reentra e passa a outra aba para esse estado).
  - Feito: `Room.join()` faz isso com a conexão antiga. A aba antiga fecha os modais abertos, volta para a home sem `?sala=` na URL, não reentra sozinha quando reconecta e abre o modal `#replacedModal` (carvão, como o "Erro ao entrar"): "Sala aberta em outra aba", com "Ficar no início" e "Jogar aqui". Conferido no navegador com duas abas, nos dois sentidos. Em `test/multiplayer.test.js`: com clientes reais, a aba antiga não consegue mandar chat nem adicionar bot, a nova consegue, e a queda da antiga não marca o jogador como desconectado.

- [x] **28. Anfitrião que cai trava a sala**
      O `hostId` só muda em `leave()`. Se o anfitrião cai no lobby, ninguém consegue começar, adicionar bot ou remover jogador por 30s; se cai na partida, ninguém volta para a sala até ele voltar. Em `leave()`, o novo anfitrião é o primeiro humano da lista, mesmo desconectado.
  - Onde: `Room.disconnect()` e `Room.leave()` em `server/rooms.js`
  - Pronto quando: o anfitrião passa para o próximo humano conectado (na ordem dos assentos) depois de uns 5s sem conexão, com aviso no chat ("Fulano agora é o anfitrião"), e não volta sozinho quando o antigo reconecta. Sem nenhum humano conectado, o cargo fica com quem voltar primeiro.
  - Feito: `HOST_GRACE_MS` (5s), `passHost()`, `setHost()` e `nextHuman()` em `server/rooms.js`. Vale no lobby e na partida, e pula bots e desconectados. Se o anfitrião volta antes dos 5s, continua com o cargo. Sem ninguém para assumir, a sala marca `hostOrphan` e quem entrar ou voltar primeiro vira anfitrião. Em `leave()` o cargo também prefere um humano conectado e é anunciado no chat. Testes em `test/host.test.js`, com relógio simulado.

### 🟠 Partida justa com gente de verdade

- [x] **29. Queda rápida não vira jogada automática na hora**
      Quem cai na própria vez (celular bloqueou, trocou de app, túnel) joga no automático em 1,5s (`AWAY_DELAY_MS`), e nas vezes seguintes também. No celular isso acontece toda hora.
  - Onde: `Room.schedule()` em `server/rooms.js`
  - Pronto quando: na vez em que cai, o jogador mantém o prazo que já tinha (ou pelo menos 10s); a jogada rápida só começa a partir da vez seguinte. Quem volta dentro do prazo joga normalmente.
  - Feito: a sala conta as vezes (`turnSeq`) e `disconnect()` anota em qual vez o jogador caiu (`droppedTurn`). Nessa vez, `schedule()` mantém o prazo e garante pelo menos 10s (`DROP_GRACE_MS`). O mínimo vale uma vez só por vez, para que cair e voltar várias vezes não estique o prazo. Cair não conta como tempo esgotado para a tarefa 30. Quem volta dentro do prazo continua com o mesmo prazo. Da vez seguinte em diante, o desconectado joga no automático em 1,5s, como antes. Testes em `test/away.test.js`.

- [x] **30. Jogador parado (conectado, mas sem jogar)**
      Quem deixa a aba aberta e sai segura cada vez por 30s, rodada após rodada.
  - Onde: `Room.schedule()` / `autoplay()` em `server/rooms.js`, assentos em `client/app.js`
  - Pronto quando: depois de 2 vezes seguidas por tempo esgotado, o jogador fica "ausente": joga no automático rápido como um desconectado, com selo "Ausente" no assento, e as rodadas não esperam o "pronto" dele. Qualquer ação dele tira o estado. Ausente também não segura a revanche.
  - Feito: `idleTimeouts` conta os tempos esgotados seguidos. No segundo (`IDLE_TIMEOUTS`), o jogador fica `away`, o chat avisa "Fulano está ausente, jogadas automáticas até voltar" e `schedule()` passa a jogar por ele em 1,5s. `waitingOn()` e `rematchWaitingOn()` não esperam por ele. Todo evento da sala passa por `Room.touch()` (em `inRoom`, no `server/index.js`), que zera a contagem e tira o ausente; se for a vez dele, o prazo volta cheio, e o chat avisa "Fulano voltou". No cliente: o assento mostra o selo "Ausente" em dourado (e a cadeira do lobby diz "ausente"). Na sua própria barra aparece "Ausente · toque na tela para voltar", com um aviso quando o estado começa. Qualquer toque ou tecla manda `presence` (no máximo uma vez por segundo). Conferido no navegador: dois tempos esgotados deixam o jogador ausente, o aviso aparece na barra, e um toque na mesa tira o estado. O selo no assento de outro jogador só foi conferido no código, porque isso pedia um segundo humano com outro navegador. Testes em `test/away.test.js`.

- [x] **31. Quem sumiu de vez sai da mesa**
      Um jogador desconectado continua sentado e jogando no automático até a partida acabar, por mais longa que seja.
  - Onde: `Room.disconnect()` em `server/rooms.js`
  - Pronto quando: depois de uns 3 minutos desconectado, o jogador sai da mesa (`removePlayer`, como quem clica em sair) com aviso no chat. Se ele voltar antes, nada muda.
  - Feito: quando quem está na partida cai, `disconnect()` arma o `seatTimer` (`armSeatTimer()`, `SEAT_GRACE_MS` = 3 minutos), e o `join()` desarma esse timer quando a pessoa volta. Se o timer chega ao fim, o chat avisa "Fulano ficou 3 minutos desconectado" e depois "Fulano saiu da mesa". O `removePlayer` devolve as cartas dele para o baralho e passa a vez (se sobrar um só jogador, a partida acaba). A pessoa continua na sala até a partida acabar: se voltar depois, aparece como "Você está fora", e a volta para a sala ou a revanche tiram quem ainda estiver desconectado, como já acontecia. Teste em `test/names.test.js`.

- [x] **33. Nomes repetidos na mesma sala**
      Dois "Jogador" (o padrão) ou dois "Ana" ficam iguais no chat, no placar e no "Fulano jogou", e o chat manda só o nome (`from`), sem o id. Também dá para se chamar "Robô Zeca".
  - Onde: `Room.join()` e `Room.say()` em `server/rooms.js`, `addChat()` em `client/app.js`
  - Pronto quando: o servidor acrescenta um número a nomes repetidos ("Ana 2"), não aceita nomes começando com "Robô", e as mensagens do chat levam o `id` de quem mandou (o cliente pode mostrar o avatar).
  - Feito: `Room.uniqueName()` compara os nomes sem diferenciar maiúsculas e minúsculas e acrescenta " 2", " 3"… Quando o nome passa de 16 caracteres, ele é cortado para o número caber. Quem reconecta com o mesmo apelido continua com o nome que tinha na sala (o "Ana 2" não vira "Ana" porque a outra Ana saiu). A regra do "Robô" ficou em `shared/names.js` (`isBotName`, que aceita "Robo"/"Robô" em qualquer caixa e deixa "Roberto" passar), e o servidor e a home usam a mesma regra. Na home, o aviso aparece embaixo do campo de apelido antes de criar ou entrar numa sala (conferido no navegador). O `names.js` foi adicionado ao cache do `sw.js`. O chat agora leva `fromId`, e o `addChat()` grava esse id em `data-from` na linha. O avatar no chat ficou de fora. Testes em `test/names.test.js`.

- [x] **34. Plateia com regras claras**
      Quem entra no meio da partida vira plateia e entra na próxima partida (inclusive na revanche, via `newGame`), mas: a plateia conta no limite de 8, então uma mesa cheia não aceita nem quem só quer assistir; a lista de salas mostra "jogando" sem dizer que dá para assistir; e quem entra não recebe aviso de que é plateia.
  - Onde: `Room.join()`, `listPublic()` e `newGame()` em `server/rooms.js`, lista de salas em `client/app.js`
  - Pronto quando: há até 8 na mesa e mais alguns (por exemplo 4) na plateia; a lista mostra "Em jogo · entrar como plateia"; quem entra assim vê um aviso; na partida nova entra quem couber na mesa, pela ordem de chegada. Teste em `test/` para os três casos.
  - Feito: a sala aceita `MAX_PLAYERS` (8) na mesa e mais `MAX_SPECTATORS` (4) na plateia. `seated()` diz quem está sentado: na partida, quem está nela; fora dela, os 8 primeiros a chegar. Quem não está sentado é plateia (`spectating()`). O `join()` responde `spectator: true`, e o estado leva `spectators` e `maxSpectators`. `newGame()` senta os 8 primeiros da lista, e a revanche só espera por quem vai sentar: quem fica na plateia não segura ninguém. Na lista de salas, cada sala vem com `players` (só a mesa), `watching` e `full` (sem vaga nem na plateia). Uma sala em jogo ou com a mesa cheia aparece como "Em jogo · entrar como plateia" (ou "Mesa cheia · …"), com o botão "Assistir"; "Cheia" só quando não sobra lugar nem na plateia. Quem entra como plateia vê o aviso "Você entrou na plateia: assiste agora e senta na próxima partida, se tiver lugar". No lobby, a mesa mostra só quem está sentado ("8 de 8 jogadores"), e embaixo dela aparece a faixa "Plateia · N de 4", com o avatar de cada um e o "×" do anfitrião. Conferido no navegador (desktop e 375×812) com uma sala de 8 jogadores falsos. Testes em `test/spectators.test.js`.
  - Fica de fora: no celular, com plateia no lobby, a faixa empurra "Começar partida" do anfitrião um pouco para baixo (só quando a mesa já está cheia).

- [x] **35. Quem foi removido volta na hora**
      `kick()` só tira o membro: com o mesmo token, o removido entra de novo pelo mesmo link no segundo seguinte.
  - Onde: `Room.kick()` / `join()` em `server/rooms.js`
  - Pronto quando: a sala guarda os tokens removidos e recusa a entrada com "Você foi removido desta sala". O anfitrião pode desfazer (ou a lista é limpa quando a sala fecha).
  - Feito: `kick()` guarda o token da pessoa em `Room.banned`, e o `join()` recusa esse token com "Você foi removido desta sala". Remover bot não barra nada. A lista vive no objeto da sala, então some quando a sala fecha, e a barreira não vale em outras salas. Não há botão para desfazer. No cliente, essa recusa abre o modal de erro ao entrar ("Você foi removido", com "Ver salas abertas" e "Criar uma sala"), conferido no navegador com um anfitrião falso removendo o jogador. A confirmação de remover agora diz "não consegue voltar enquanto ela estiver aberta". Limite conhecido: quem limpa os dados do navegador ganha um token novo e consegue entrar de novo. Testes em `test/kick.test.js`.

### 🔧 Servidor para produção

- [x] **36. Limites que faltam (junto com a 25)**
      Hoje só o chat (400ms) e as reações têm limite. Qualquer conexão pode criar salas sem parar (cada uma fica 5 minutos na memória), mandar mensagens de até 1MB (padrão do Socket.IO) e disparar ações de jogo sem pausa.
  - Onde: `server/index.js`, `RoomManager` em `server/rooms.js`
  - Pronto quando: `maxHttpBufferSize` em uns 16KB; `room:create` com limite por conexão (e um teto geral de salas, com a mensagem "Servidor cheio, tente daqui a pouco"); ações de jogo, `room:list` e `room:join` passam por `takeSlot`; limite de conexões por IP.
  - Feito: o `on()` do `server/index.js` aplica limite em **todo** evento, por conexão, com o `takeSlot`. Os valores ficam em `RATE_LIMITS`: 5 `room:create` por minuto, 12 `room:join` por minuto (o limite de tentativas de código da tarefa 25), 30 `room:list` por minuto (a lista se atualiza a cada 5s, ou seja, 12 por minuto), 10 jogadas, compras ou passes a cada 5s e 20 a cada 10s nos demais eventos. Cada limite tem sua mensagem ("Muitas tentativas de entrar. Espere um minuto." e outras). `maxHttpBufferSize` ficou em 16KB: uma mensagem maior derruba só a conexão de quem mandou. O teto geral de salas é `MAX_ROOMS` (500), com "Servidor cheio, tente daqui a pouco". As conexões por IP passam pelo middleware do `io.use`, com `MAX_CONNECTIONS_PER_IP` (20), e o cliente mostra o motivo da recusa. Testes em `test/production.test.js`.

- [x] **37. Configuração de produção**
      O CORS está aberto para qualquer site (`origin: '*'`), não há desligamento limpo e o `/health` não diz nada sobre as salas.
  - Onde: `server/index.js`, `README.md`
  - Pronto quando: as origens permitidas vêm de uma variável (`ALLOWED_ORIGINS`, com o app Capacitor incluído) e o padrão é só a própria origem; `trust proxy` ligado para pegar o IP certo atrás do Render/Railway/Fly; `pingInterval`/`pingTimeout` ajustados para celular; no `SIGTERM` o servidor avisa as salas ("O servidor vai reiniciar"), para os timers e fecha; `/health` mostra salas, partidas e conexões; erros vão para o log com o código da sala.
  - Feito: a configuração vem de `configFromEnv()`, e as variáveis estão no README, na seção "Publicando". **Origens:** `allowRequest` só aceita a própria origem e as de `ALLOWED_ORIGINS` (para o Capacitor: `capacitor://localhost,http://localhost`). Isso vale também para WebSocket, que o CORS sozinho não barra. Conexões sem `Origin` (app nativo, curl) passam. **Proxy:** `TRUST_PROXY` vale 1 em produção e 0 fora dela. O IP sai do `X-Forwarded-For` contando da direita (`clientIp()`), então sem proxy não dá para inventar o IP. **Ping:** `pingInterval` 20s e `pingTimeout` 30s. **Desligamento:** no `SIGTERM` e no Ctrl+C, `shutdown()` avisa as salas no chat e com o evento `server:restart` (o cliente mostra o aviso), para os timers, fecha as conexões e a porta, e sai em até 5s de qualquer jeito. **`/health`:** `rooms`, `games`, `players`, `connections` e `uptime`. **Log:** os timers da sala passam por `Room.later()`, então um erro de bot ou de prazo sai no log com o código da sala em vez de derrubar o processo. Conferido no navegador: a partida continua funcionando na mesma origem e o `/health` responde. O `SIGTERM` foi testado só pelo `shutdown()` em `test/production.test.js`, porque o Windows não manda esse sinal.

- [x] **38. Reiniciar o servidor sem perder as partidas**
      As salas vivem só na memória: todo deploy derruba todas as partidas. O cliente já tenta reconectar e mostra "A sala fechou" (parte da 24), mas a partida se perde.
  - Onde: `RoomManager` em `server/rooms.js`
  - Pronto quando: no `SIGTERM` (tarefa 37) o servidor grava as salas (membros com token, configurações, estado do motor com `seed`, chat) num arquivo ou Redis e lê de volta ao subir; os jogadores reconectam pelo token e a partida continua da mesma vez, com o prazo cheio.
  - Feito (em arquivo):
    - **Gravar:** `RoomManager.snapshot()` e `Room.toJSON()` gravam membros com token, apelido, avatar e cor, além de configurações, anfitrião, chat, estado do motor (com a `seed`), quem está pronto, os pedidos de revanche e os removidos. O estado do motor é só dados simples, então volta idêntico.
    - **Arquivo:** `server/snapshot.js` grava em `SNAPSHOT_FILE` (padrão `data/rooms.json`, `off` desliga). Escreve num arquivo ao lado e troca de uma vez, para não ficar pela metade. Na leitura, o arquivo é apagado, e cada gravação volta uma vez só. Gravações com mais de 10 minutos são ignoradas. A pasta `data/` entrou no `.gitignore`, porque o arquivo tem os tokens.
    - **Desligar:** no `SIGTERM` ou Ctrl+C, `shutdown({ snapshotFile })` avisa "A partida continua quando ele voltar!" e grava as salas.
    - **Subir:** o servidor lê o arquivo antes de abrir a porta. `Room.fromJSON()` recria as salas com todos os humanos desconectados, com os mesmos prazos de uma queda (`armAbsence()`: 30s no lobby, 3 minutos na mesa, 5 minutos de sala vazia, 15s para o anfitrião voltar), e escreve "O servidor reiniciou" no chat.
    - **Retomar:** com `resumePending`, o relógio fica parado e nenhum bot joga sozinho até a primeira pessoa voltar. Aí `resume()` recomeça a vez de quem estava jogando com o prazo cheio, mesmo que essa pessoa ainda não tenha voltado.

    Testes em `test/restart.test.js`, entre eles um reinício de ponta a ponta: o servidor A grava, o servidor B lê, Ana e Bia reconectam pelo token e recebem o mesmo lugar, as mesmas cartas, a mesma vez e um prazo de 30s.
  - Fica de fora:
    - Nas plataformas, o arquivo precisa de um disco persistente (Render *Disk*, Railway *Volume*, Fly *volume*; o README explica). Sem ele, cada deploy começa vazio.
    - Uma queda sem aviso (falta de memória, `kill -9`) não grava nada.
    - O `SIGTERM` real não foi testado aqui, porque no Windows o processo morre sem rodar o handler. O caminho do `shutdown()` é o que o teste de ponta a ponta usa.
    - Não há versão com Redis.

- [x] **39. Um processo só (documentar ou escalar)**
      Tudo depende de um único processo: duas instâncias não enxergam as salas uma da outra, e o polling do Socket.IO quebra sem sessão fixa.
  - Onde: `README.md` (e, se precisar escalar, `server/`)
  - Pronto quando: o README diz que o servidor roda em uma instância só (e como configurar isso no Render/Railway/Fly). Só se o jogo crescer: estado das salas em Redis, `@socket.io/redis-adapter` e sessão fixa no balanceador.
  - Feito (documentar): a seção "Uma instância só" do README, dentro de "Publicando", explica por que o servidor precisa de uma instância só e dá três regras: uma instância sem autoscaling (para crescer, aumente a máquina), sempre ligada (serviço que dorme apaga as salas) e deploy derruba as partidas (publique quando o `/health` mostrar pouca gente). Também diz como configurar cada plataforma: Render (Web Service com 1 instância, sem o plano gratuito que dorme, health check em `/health`), Railway (*Replicas* = 1) e Fly.io (`fly scale count 1`, e `auto_stop_machines = "off"` com `min_machines_running = 1` no `fly.toml`). Por fim, resume o caminho se um dia precisar escalar: Redis, `@socket.io/redis-adapter`, sessão fixa e um dono para os timers de cada sala. A parte de escalar ficou de fora, como a tarefa permite. Os nomes das telas e opções de cada plataforma vieram do que conheço delas e não foram conferidos agora nos painéis.

- [x] **40. Testes de multiplayer de ponta a ponta**
      Os testes de hoje chamam o motor e o `Room` direto; nada passa por conexões reais. A tarefa 23 cobre as regras de sala; esta cobre a rede.
  - Onde: `server/index.js` (exportar uma função que cria o servidor numa porta qualquer, sem `listen` ao importar), `test/multiplayer.test.js` com `socket.io-client`
  - Pronto quando: com 2 ou 3 clientes reais, há testes para: criar e entrar pelo código; todos recebem o estado e ninguém recebe a mão do outro; reconectar com o mesmo token mantém o lugar e as cartas; segunda aba substitui a primeira (27); anfitrião cai e o cargo passa (28); entrar no meio vira plateia (34); payload malformado não derruba o servidor (26).
  - Feito: o `createGameServer()` já existia desde a 26 e agora também aceita `timing`. O `RoomManager` recebe os tempos de espera, e os testes usam 200ms para o anfitrião em vez de 5s. Em `test/multiplayer.test.js` há 7 testes com 2 ou 3 clientes `socket.io-client` reais contra um servidor numa porta qualquer:
    - criar e entrar pelo código (inclusive em minúsculas), com o estado e o chat chegando para todos;
    - cada um recebe só a própria mão: as três mãos são diferentes, nenhuma carta de um aparece em nada que chegou pela rede para os outros, dos outros só vem `cardCount`, e só quem tem a vez recebe `playable`. Há um controle positivo para a busca não passar à toa;
    - reconectar com o mesmo token mantém o lugar e as mesmas cartas;
    - a segunda aba assume o lugar (27);
    - o anfitrião cai e o cargo passa, com aviso no chat, e só o novo anfitrião consegue adicionar bot (28);
    - quem entra no meio vira plateia, sem mão, sem poder jogar e aparecendo na lista (34);
    - payloads malformados em todos os 17 eventos, depois disso uma sala nova funciona (26).

    O `test/server.test.js` foi absorvido aqui, e as referências a ele nas tarefas 26 e 27 foram atualizadas. Rodei o arquivo 10 vezes seguidas, sem nenhuma falha.