# Melhorias de UI/UX

Lista de tarefas tirada da análise de UI/UX feita em 03/11/2026, jogando uma partida com 3 bots no desktop (800×600) e no celular (375×812).

**Prioridades:** 🔴 crítico (atrapalha a partida) · 🟠 alto (acessibilidade e mobile) · 🟡 médio (consistência visual) · 🟢 polimento

**Ordem sugerida:** tasks 1, 2 e 12 (mão no celular) → 3 → 4 e 5 → 6 a 10 → 14 a 17 → o resto.

---

## 🔴 Críticos

- [x] **1. Mão do celular legível e fácil de tocar**
  Com 12 cartas de 58px num espaço de 359px, cada carta fica com uns 27px visíveis para tocar (o mínimo é 44px).
  - Onde: `layoutHand()` em `public/app.js`, `.hand` e `--card-w` / `--card-h` em `public/style.css`
  - Pronto quando: toda carta tem pelo menos 44px de área tocável no celular (cartas maiores, duas fileiras ou mão com rolagem horizontal).

- [x] **2. Confirmar antes de jogar a carta**
  Hoje um toque já joga a carta, sem volta, e isso somado à task 1 gera jogadas erradas.
  - Onde: `onCardClick()` em `public/app.js`
  - Pronto quando: o primeiro toque seleciona (a carta sobe) e o segundo toque, ou um botão "Jogar", confirma. Tocar em outra carta troca a seleção. Opcional: arrastar até o monte.

- [x] **3. Histórico das jogadas**
  O evento `play` só toca um som. O log mostra pulos e pintas, mas não quem jogou qual carta.
  - Onde: `announce()` em `public/app.js`
  - Pronto quando: o log mostra "Robô Cida jogou 9 de Paus" para toda jogada e compra. Opcional: mostrar a última jogada (avatar + carta) perto do monte.

- [x] **4. Baralho só brilha quando não há jogada**
  Hoje o baralho pisca sempre que é a sua vez, mesmo com cartas jogáveis na mão, e compete com elas.
  - Onde: `renderCenter()` em `public/app.js` (`canDraw` / classe `can-draw`)
  - Pronto quando: o `glow` só aparece com `g.playable.length === 0`. Comprar continua permitido, só sem o destaque.

- [x] **5. Mensagem certa na abertura do monte**
  "Abra o monte com qualquer carta" aparece para todo mundo, mesmo quando quem abre é outro jogador.
  - Onde: selo `#activeSuit` em `renderCenter()`
  - Pronto quando: quem abre vê "Abra o monte com qualquer carta" e os outros veem "Robô Cida vai abrir o monte".

## 🟠 Altos

- [x] **6. Modais acessíveis e consistentes**
  O Esc só fecha o modal de avatar, e só ele tem `role="dialog"`. Nenhum modal prende o foco, e Regras, Salas e Pinta não fecham clicando fora.
  - Onde: `#suitModal`, `#roundModal`, `#roomsModal`, `#rulesModal` em `public/index.html` e os listeners de `[data-close]` em `public/app.js`
  - Pronto quando: todo modal tem `role="dialog"`, `aria-modal` e `aria-labelledby`, fecha com Esc e clicando fora (menos o resultado da rodada), leva o foco para dentro ao abrir e devolve ao botão de origem ao fechar.

- [x] **7. Jogar pelo teclado**
  As cartas são `div`s com click: não recebem foco e não dá para jogar pelo teclado.
  - Onde: `renderCard()` / `renderHand()` em `public/app.js`
  - Pronto quando: as cartas da mão são `button`s (ou têm `tabindex="0"` + `role="button"`), têm `aria-label` com o nome da carta ("7 de Copas, jogável") e jogam com Enter ou Espaço.

- [x] **8. Gaveta de placar e chat no celular**
  A gaveta não tem botão de fechar, não tem fundo escurecido e não fecha com Esc.
  - Onde: `.side` em `public/style.css` (abaixo de 860px) e `#sideToggle` em `public/app.js`
  - Pronto quando: tem botão "Fechar" visível, fundo escurecido (scrim de 40–60%) e fecha com Esc. O `#sideToggle` informa `aria-expanded`.

- [x] **9. Áreas de toque de 44px**
  Botões abaixo do mínimo: Sair, som e chat (31px de altura), o "×" de remover jogador e as bolinhas do "Como jogar" (10px).
  - Onde: `.btn-small` na `.game-top`, `.member-grid .kick` e `.howto-dots button` em `public/style.css`
  - Pronto quando: todos têm pelo menos 44×44px de área tocável (pode ser só a área, com padding ou pseudo-elemento) e o "×" tem `aria-label="Remover <nome>"`.

- [x] **10. Anunciar eventos para leitores de tela**
  Não existe nenhum `aria-live`: toasts, "Sua vez!" e erros não são anunciados.
  - Onde: `#toasts`, `#turnBanner` e `flash()` em `public/app.js`
  - Pronto quando: toasts e banner usam `aria-live="polite"` e os erros usam `role="alert"`.

- [x] **11. Respeitar o reduced-motion em todas as animações**
  Ficam rodando sem parar, mesmo com reduced-motion: a seta de direção (`spin-ccw`), o avatar da vez (`bob`), o baralho (`glow`) e os efeitos `pulse`, `shake`, `gain` e `fresh`.
  - Onde: `public/style.css` (hoje só o carrossel tem `@media (prefers-reduced-motion)`)
  - Pronto quando: um bloco global de `prefers-reduced-motion: reduce` desliga as animações infinitas e encurta as outras.

- [x] **12. Usar melhor o espaço da mesa no celular**
  Sobram uns 120px vazios embaixo do feltro enquanto a mão fica espremida.
  - Onde: `.table`, `.felt` e `seatPosition()` em `public/app.js`
  - Pronto quando: a mesa encolhe na vertical no celular e o espaço que sobra vai para a mão (task 1).

- [x] **13. Aviso de erro longe da mão**
  "Essa carta não combina…" aparece em cima da mão (`.flash` com `bottom: 24px`), onde o jogador está olhando e tocando.
  - Onde: `.flash` em `public/style.css`
  - Pronto quando: durante a partida, o aviso aparece acima do banner da vez ou no topo, sem cobrir as cartas.

## 🟡 Médios

- [x] **14. Fundo mais calmo na mesa**
  O fundo 3D (corações, espadas, linhas e quadradinhos vermelhos) compete com o jogo. Os quadradinhos perto da mão parecem notificação.
  - Onde: `body::before` / `public/bg-scene.svg`
  - Pronto quando: na tela `#game` o fundo fica escurecido ou desfocado (por exemplo, `opacity` de 0.3–0.4 ou `filter: blur()`), e a home continua com a cena completa.

- [x] **15. Botões de largura total alinhados**
  A sombra deslocada do `.btn` empurra a face 4px para a esquerda, então o "Adicionar bot" fica fora da grade de jogadores. Com a camada prata em todos os botões, a sombra clara chama ainda mais atenção.
  - Onde: `.btn` em `public/style.css`
  - Pronto quando: botões de largura total ficam alinhados com o conteúdo (compensar com `margin` ou só deslocar a sombra, sem `translate` no repouso) e a cor da camada é revista por variante.

- [x] **16. Tokens de raio de canto**
  Hoje são 8, 9, 12, 14, 16, 18 e 28px.
  - Onde: `public/style.css`
  - Pronto quando: existem só `--r-sm` / `--r-md` / `--r-lg` (+ `--r-pill` e o raio da carta) e todos os componentes usam esses tokens.

- [x] **17. Hierarquia dos botões da home**
  O "Salas" prata chama tanto atenção quanto o "Criar sala" vermelho, e parecem dois botões principais. O "Entrar" tem altura diferente do campo de código.
  - Onde: `.btn-rooms` e `.join-row` em `public/style.css`
  - Pronto quando: há um só botão principal (Criar sala). "Salas" vira secundário, como os ghost, e o "Entrar" tem a mesma altura do campo.

- [x] **18. Estado desabilitado claro**
  "Precisa de 2 jogadores" vira um vermelho lamacento com 50% de opacidade e parece quebrado.
  - Onde: `.btn:disabled` em `public/style.css` e `renderLobby()` em `public/app.js`
  - Pronto quando: o botão desabilitado fica neutro (cinza) e mantém o texto "Começar partida", com "Precisa de pelo menos 2 jogadores" como texto de ajuda embaixo.

- [x] **19. Naipes em SVG em todo o jogo**
  ♥♦♠♣ aparecem como texto no modal de pinta, no "Como jogar" e no selo "Pinta:". Em alguns celulares esses símbolos viram emoji.
  - Onde: `.suit-btn` e `.howto-card` em `public/index.html`, `renderCenter()` em `public/app.js`
  - Pronto quando: todos os naipes usam os `<symbol id="suit-*">` que já existem. Trocar também o ★ das cartas especiais e o "×" por ícones SVG.

- [ ] **20. Tamanho mínimo de texto**
  Abaixo de 12px: selo do carteador (0.7rem), "pronto" (0.7rem), `.tag` (0.75rem), nomes nos assentos no celular (0.78rem).
  - Onde: `public/style.css`
  - Pronto quando: nenhum texto fica abaixo de 12px e há uma escala de tipografia em tokens (por exemplo, 12 / 14 / 16 / 18 / 24 / 32).

- [ ] **21. Selo do carteador legível**
  O "D" fica por cima do anel de tempo e é pequeno demais para ser entendido.
  - Onde: `.badge.dealer` em `public/style.css`
  - Pronto quando: o selo fica fora do anel, é maior e tem `title` / `aria-label` "Deu as cartas".

## 🟢 Polimento

- [ ] **22. Rótulo e erro no campo de apelido**
  O apelido só tem placeholder como rótulo, e o erro aparece num toast no rodapé.
  - Pronto quando: há um rótulo visível "Seu apelido", e o erro aparece logo abaixo do campo com o foco nele.

- [ ] **23. Campo de código melhor**
  - Pronto quando: o campo tem `autocapitalize="characters"`, `enterkeyhint="go"` e `spellcheck="false"`, e colar o link inteiro da sala extrai o código.

- [ ] **24. Trocar `confirm()` e `prompt()` nativos**
  Usados para sair da partida e copiar o link.
  - Pronto quando: sair usa um modal próprio no estilo do jogo, e no celular "Convidar" usa `navigator.share` (com cópia como alternativa).

- [ ] **25. Configurações visíveis para todos no lobby**
  Quem não é anfitrião não vê o tempo por vez nem se a sala é pública.
  - Pronto quando: os outros jogadores veem as configurações em modo só leitura.

- [ ] **26. Lugares vazios menos poluídos**
  Sete caixas pontilhadas de "lugar vazio" fazem barulho visual.
  - Pronto quando: aparece uma única caixa "Convide amigos" com ação de copiar/compartilhar o link e o contador de vagas.

- [ ] **27. Confirmar antes de remover jogador**
  - Pronto quando: o "×" pede confirmação (ou tem "desfazer"), mas para bots não precisa.

- [x] **28. Timer mais claro**
  - Pronto quando: aparecem os segundos restantes, um som/vibração nos últimos 5s e o título da aba vira "Sua vez! · 8 Maluco" quando a aba está em segundo plano.

- [x] **29. Explicar as cartas especiais na mão**
  As cartas têm ★, mas sem explicação do efeito.
  - Pronto quando: passar o mouse ou dar um toque longo mostra o efeito ("9: o da direita compra 2 e perde a vez").

- [x] **30. Direção do jogo e alvo dos efeitos**
  A seta girando com 8% de opacidade quase não aparece. 7 (esquerda) e 9 (direita) confundem.
  - Pronto quando: a direção fica visível (setas no feltro ou entre os assentos), e ao jogar 7/9 aparece uma seta até o jogador que vai comprar.

- [ ] **31. Carrossel do "Como jogar"**
  Avança sozinho mesmo com reduced-motion, não pausa ao passar o mouse e não aceita deslizar.
  - Pronto quando: pausa com mouse/foco, não avança sozinho com reduced-motion, aceita deslizar no celular e tem setas de anterior/próximo.

- [ ] **32. Rodapé da home sem repetição**
  O rodapé repete o que o "Como jogar" já explica.
  - Pronto quando: o rodapé fica só com o crédito (ou com links úteis).

- [ ] **33. Placar com mais contexto**
  - Pronto quando: o placar destaca você e quem está jogando agora, e mostra quanto falta para 100.

- [ ] **34. Resultado da rodada no celular**
  A classe `.hide-sm` existe no CSS mas não é usada no HTML, então a tabela de 4 colunas provavelmente aperta no celular (não confirmado: não cheguei ao fim de uma rodada).
  - Onde: `#roundModal` em `public/index.html` e `renderRoundModal()` em `public/app.js`
  - Pronto quando: em 375px a tabela cabe sem rolagem horizontal (esconder a coluna "Cartas na mão" ou virar lista).
