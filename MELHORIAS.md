# Melhorias do projeto

Lista de tarefas tirada da análise feita em 06/11/2026, lendo o código e jogando uma partida com 3 bots no navegador (desktop ~800×500 e celular 375×812). Continua de onde o `UI-UX-TASKS.md` parou (as 34 tarefas de lá estão feitas).

**Prioridades:** 🔴 corrigir primeiro · 🟠 experiência de jogo · 🟡 visual e layout · 🟢 recursos novos · 🔧 código e servidor

**Ordem sugerida:** 1 → 4 → 3 → 2 → 5 a 8 → o resto.

---

## 🔴 Corrigir primeiro

- [x] **1. Margem quebrada na home do celular**
  Em 375px os botões Criar sala, Salas abertas e a linha do código ficam a 16px da borda esquerda e a 2px da direita. O campo de código (`.join-row input`) força a coluna implícita da grade a 357px, maior que os 343px disponíveis.
  - Onde: `.home-menu` em `public/style.css`
  - Pronto quando: `.home-menu` tem `grid-template-columns: minmax(0, 1fr)` e as margens ficam iguais (16px) dos dois lados em 320, 375 e 414px.

- [x] **2. Mão inteira na tela em telas baixas**
  Com 500px de altura a base das cartas fica cortada; no celular a segunda fileira encosta no fim da tela, sem respeitar a área segura do iPhone.
  - Onde: `.hand` e `layoutHand()` em `public/app.js`, `public/style.css`
  - Pronto quando: em 800×500 e 375×667 as cartas aparecem inteiras, e a mão usa `padding-bottom: env(safe-area-inset-bottom)`.
  - Feito: o caso que cortava era o desktop baixo (1024×500 rolava 49px). A mesa agora é quem cede altura (mínimo = assento de cima + montes), e desktops com até 580px de altura usam cartas de 64×92. O assento de cima não sobe mais por cima da barra do topo (`placeSeat()`), os montes descem quando a mesa é baixa e o selo da pinta vai para o lado deles (container query na `.table`). A área segura já vinha do padding de `.game-layout`. Conferido sem rolagem em 1024×500, 800×500, 1280×720 e 375×812, inclusive com 24 cartas em 2 fileiras.
  - Fica de fora: celular deitado (~844×390) ainda rola um pouco.

- [x] **3. Ações do lobby sempre à vista**
  Em ~800px a mesa oval ocupa a primeira tela inteira; "Adicionar bot" e "Começar partida" ficam abaixo da dobra, e o chat embaixo sobra com uns 250px vazios.
  - Onde: tela `#lobby` em `public/index.html` e `public/style.css`
  - Pronto quando: em 800×500 e 1440×900 dá para começar a partida sem rolar (mesa e painel lado a lado, ou as ações fixas no rodapé), e o chat não deixa um bloco vazio.
  - Feito: mesa e chat ficam lado a lado até 700px de largura, e a mesa da sala de espera tem mínimo de 280px. Quando ela fica baixa, o centro fica compacto: código menor e rótulo "Sala" só para leitor de tela. No celular a mesa encolhe conforme a altura, o chat cresce com as mensagens (até 40% da tela) e os dois botões cabem numa linha em 360px. "Começar partida" visível sem rolar em 1280×720, 1024×560, 800×500, 720×480, 375×812 e 360×640.

## 🟠 Experiência de jogo

- [x] **4. Última jogada visível na mesa**
  A partida corre rápido e só dá para saber quem jogou o quê abrindo a gaveta.
  - Onde: `renderCenter()` em `public/app.js`
  - Pronto quando: perto do monte aparece a última ação ("Robô Cida jogou 9♠ · Você compra 2") com o avatar de quem jogou, atualizada a cada jogada e compra.
  - Feito: `#lastMove` acima dos montes, montado por `describeMove()` a partir dos eventos. Mostra o avatar, o nome, a carta como mini carta e os efeitos: "compra 2 e perde a vez", "foi pulado", "todos compram 1" no Joker. Compras e passes também aparecem. A linha fica até a próxima jogada, é anunciada para leitor de tela (com o nome inteiro da carta) e se limpa no começo da rodada. Em mesas baixas ela vai para a esquerda dos montes. Conferido sem sobreposição com 4 e 8 jogadores, de 1440×900 a 375×812.

- [x] **5. Feltro limpo no início da rodada**
  A marca "8 Maluco", o fantasma "Rodada 1" e o "monte vazio" ficam sobrepostos no centro.
  - Onde: `.felt` e o anúncio de rodada em `public/style.css` / `public/app.js`
  - Pronto quando: em nenhum momento dois textos do centro da mesa se sobrepõem.
  - Feito: saiu a marca "8 Maluco" da mesa da partida (no lobby ela continua, e some quando a mesa é baixa). O monte vazio ficou só com o contorno, porque o selo embaixo já diz quem abre. O letreiro "Rodada N" ficou quase opaco (95%), então o que está embaixo não aparece através dele.

- [x] **6. Usar a faixa entre a mesa e a mão no desktop**
  A linha "Você · 0 pts" fica solta, com uma faixa vazia à direita.
  - Onde: `#meInfo` em `public/index.html`
  - Pronto quando: a faixa mostra seu placar com a barra até 100 (ou as cartas crescem para ocupar o espaço).
  - Feito: `#meScore` no canto direito da barra mostra "Seus pontos 12 / 100" e uma barra que fica vermelha a 20 pontos do limite, com dica de quanto falta. No desktop o "Você" perde o "· N pts" para não repetir; no celular o placar não aparece e o "Você · N pts" continua.

- [x] **7. Contagem de cartas dos adversários em destaque**
  Cartas na mão e pontos aparecem a ~12px, e o número de cartas é a informação mais importante da partida.
  - Onde: `.seat` em `public/style.css` e o render dos assentos em `public/app.js`
  - Pronto quando: a quantidade de cartas aparece num selo legível (16px ou mais) e quem está com 1 carta ganha um aviso visível.
  - Feito: selo com mini carta e número a 18px (16px no celular). Com 1 carta o selo fica vermelho e pulsa duas vezes (sem pulsar com movimento reduzido). Os pontos ficam ao lado em texto menor; no celular, embaixo do selo.

- [ ] **8. Seleção de carta igual no mouse e no toque**
  No desktop o 1º clique já joga a carta; no toque o 1º toque só seleciona.
  - Onde: `onCardClick()` em `public/app.js`
  - Pronto quando: o comportamento é o mesmo nos dois (ou a diferença é intencional e há uma dica de "clique para jogar").

## 🟡 Visual e layout

- [x] **9. Home do desktop com estrutura**
  Logo, perfil, botões e "Como jogar" flutuam em três colunas soltas, com uns 35% da tela vazia embaixo. O perfil é pequeno para o que faz e o carrossel tem contraste e texto fracos.
  - Onde: `#home` em `public/index.html` e `public/style.css`
  - Pronto quando: em 1440×900 a home ocupa a tela com um elemento dominante, o perfil tem mais peso e o texto do "Como jogar" passa de 4.5:1 de contraste.
  - Feito: no desktop ficam dois painéis num degrau de tom (sem contorno nem sombra): "você + jogar" (avatar de 200px, apelido e os três botões) e "Como jogar" (passo com 24px, texto com 18px). A grade da home virou `auto 1fr auto`. Em desktops com até 820px de altura o logo e os espaçamentos diminuem; entre 861 e 1100px de largura os painéis empilham. Sem rolagem e com margens iguais em 1280×720, 1366×768, 1440×900 e 1920×1080. No celular continua a coluna solta de antes.

- [x] **10. Rótulos sem caixa alta numerada**
  "1. RECEBA AS CARTAS" e o placeholder "C Ó D I G O" com letras espaçadas.
  - Onde: `.howto-card` em `public/index.html`, `.join-row input::placeholder` em `public/style.css`
  - Pronto quando: os títulos ficam em caixa normal, sem número na frente, e o placeholder sem espaçamento extra.
  - Feito: os passos do "Como jogar" perderam o número (a ordem já aparece nas bolinhas e no contador) e a caixa alta. O placeholder "Código" ficou em caixa normal, sem espaçamento; o código digitado continua em caixa alta e espaçado. Os rótulos "Cor" e "Estilo" do editor de avatar também saíram da caixa alta.

- [x] **11. Papel claro de cada ambiente visual**
  A home é carvão com naipes, os modais são feltro verde e os botões são cinza 3D.
  - Pronto quando: há uma regra escrita (por exemplo: feltro só onde há jogo, carvão no menu e nos modais do menu) e todos os modais a seguem.
  - Feito: carvão é o menu (Salas públicas, Avatar, Regras, Erro ao entrar); feltro é a mesa (lobby, partida, pinta do 8, resultado, sair, remover jogador). Salas, Avatar e Erro ao entrar deixaram de usar `.felt-box`, e as áreas internas deles (linhas da lista de salas, palco e abas do avatar) usam degraus de tom (`--surface-2`, `--surface-3`) em vez de preto translúcido, sombra interna e holofote em gradiente. A regra está escrita no comentário do `.modal-box`.

- [x] **12. Sombras, cores e tamanhos em tokens**
  Há 60 `box-shadow`, 10 gradientes, 101 `rgba()` soltos e 5 `font-size` fora da escala (4.2rem, 2.6rem, 2.4rem, 1.3rem, 3.2rem).
  - Onde: `public/style.css`
  - Pronto quando: sombras e véus usam tokens (`--shadow-raised`, `--scrim`…), os tamanhos de texto vêm de `--fs-*` (com um `--fs-display` para o logo e o avatar grande) e os gradientes que sobrarem têm motivo.
  - Feito: tokens novos `--shadow-sm` / `--shadow` / `--shadow-lg` / `--shadow-float` (elevação pelo tamanho do desfoque), `--text-shadow`, `--veil-weak` / `--veil` / `--veil-strong`, `--scrim`, `--felt-surface` e `--fs-4xl` / `--fs-5xl` / `--fs-display`. As 27 sombras soltas com desfoque, as 5 sombras de texto, os 9 véus e fundos de modal e os tamanhos fora da escala passaram a usar esses tokens. `rgba()` fora dos tokens: 94 → 60; gradientes: 9 → 7, todos funcionais (anel de tempo, contador, máscara) ou do material do feltro; tamanhos de fonte soltos: 6 → 0. O relevo 3D dos botões (sombra sem desfoque) ficou como estava.

- [x] **13. Estado vazio de "Salas públicas"**
  Caixa tracejada e o botão "Criar uma sala" pequeno demais.
  - Onde: `#roomsModal` e o render da lista em `public/app.js`
  - Pronto quando: o estado vazio não usa borda tracejada e o botão tem o tamanho do botão principal.
  - Feito: o estado vazio está num degrau de tom (sem contorno tracejado) e o "Criar uma sala" é o mesmo botão principal da home (grande, com ícone de +, 60px de altura).

## 🟢 Recursos novos

- [x] **14. Reações rápidas**
  - Pronto quando: há 4–6 reações ("Boa!", "Ops!", risada, bravo) que aparecem num balão em cima do avatar por 2s, com limite de frequência no servidor.
  - Feito: 6 reações em `shared/reactions.js` (Boa!, Haha, Ops!, Grr!, Uau!, Vai logo!), cada uma com uma carinha em SVG no traço dos avatares (símbolos `#r-*` do sprite em `app.js`). O botão "Reagir" fica no topo da mesa e da sala de espera e abre um menu que fecha com Esc, clicando fora ou escolhendo, e que navega pelas setas. O servidor (`Room.react`) só aceita ids da lista e no máximo 3 reações a cada 5s por pessoa (`takeSlot`, janela deslizante); passando disso, quem mandou vê "Calma! Espere um pouquinho para reagir de novo". O balão aparece por 2s em cima do avatar de quem reagiu (assento, sua barra ou cadeira do lobby) e é lido pelo leitor de tela. Testes em `test/reactions.test.js`. Em telas de até 380px, o "Como jogar" do lobby ficou só com o ícone para tudo caber numa linha.

- [ ] **15. Dificuldade dos bots**
  Hoje existe uma só heurística em `shared/bot.js`.
  - Pronto quando: o anfitrião escolhe Fácil (joga aleatório), Normal (atual) ou Difícil (conta cartas, segura 8 e 9 para o fim), e há testes para os três.

- [ ] **16. Revanche em um clique**
  Ao fim da partida só existe "Voltar para a sala".
  - Pronto quando: há "Jogar de novo", que reinicia direto com a mesma mesa e as mesmas configurações.

- [ ] **17. Modo solo offline contra bots**
  `shared/engine.js` e `shared/bot.js` já rodam no navegador.
  - Pronto quando: dá para jogar contra bots sem servidor (e sem internet, junto com a tarefa 18).

- [x] **18. PWA completo**
  Não há service worker, o único ícone é `icon.svg` (o iOS precisa de PNG em `apple-touch-icon`) e as fontes vêm do Google Fonts.
  - Pronto quando: há service worker com cache dos arquivos estáticos, ícones PNG 192/512 (e maskable), `apple-touch-icon` e fontes servidas pelo próprio projeto.
  - Feito: `public/sw.js` guarda a casca do jogo (página, CSS, JS, `/shared`, cliente do socket.io), as fontes, os ícones, as cartas e os sons (38 arquivos). Página, CSS e JS vêm da rede primeiro, então o código está sempre atualizado com internet; fontes, ícones, cartas e sons vêm do cache primeiro. O tempo real (`/socket.io/`) nunca passa pelo cache. As fontes ficam em `public/fonts` (6 woff2 do subconjunto latino, ~120KB, com as licenças OFL), e as três mais usadas são pré-carregadas. Os ícones PNG ficam em `public/icons`: 32, 192 e 512, `maskable` 192 e 512 e `apple-touch-icon` 180, com metas do iOS. O manifest ganhou `id`, `scope`, `lang` e os PNGs. Conferido: nenhuma requisição externa, e com o servidor desligado a página (inclusive `/?sala=…`) abre do cache com as fontes e mostra "Reconectando".

- [ ] **19. Estatísticas locais**
  - Pronto quando: partidas, vitórias, maior sequência e "bateu com 9" ficam guardados no `localStorage` e aparecem no perfil da home.

- [ ] **20. Mais avatar**
  - Pronto quando: há acessórios (boné, brinco, fone) como nova parte em `shared/avatar.js`, dá para guardar alguns avatares prontos e o vencedor aparece com o avatar grande na tela final.

- [ ] **21. Volume e vibração**
  Hoje o som só liga e desliga.
  - Pronto quando: há controle de volume e uma opção para desligar a vibração, guardados no `localStorage`.

## 🔧 Código e servidor

- [ ] **22. Dividir `app.js` e `style.css`**
  `app.js` tem 3.397 linhas e `style.css` 4.462.
  - Pronto quando: o cliente é dividido em módulos ES sem build (rede, mesa, animações, modais, editor de avatar) e o CSS por tela, sem mudar o comportamento.

- [ ] **23. Testes do servidor**
  Só o motor e o avatar têm testes.
  - Pronto quando: `server/rooms.js` tem testes para entrar, sair, remover jogador, reconectar, adicionar bot e jogada automática por tempo.

- [ ] **24. Queda do servidor**
  As salas ficam só na memória: reiniciar o servidor derruba todas as partidas.
  - Pronto quando: o cliente avisa que a conexão caiu, tenta reconectar sozinho e volta para a home com uma mensagem clara se a sala sumiu.

- [ ] **25. Limites no servidor**
  O chat já tem 400ms entre mensagens.
  - Pronto quando: há limite de tentativas de código de sala por conexão e `compression` nos arquivos estáticos.
