# Validação

## Criação no editor novo da Yampi na 0.10.6, em 11/11/2026

Relato: o envio real parou no primeiro texto novo com "o botão + não abriu nenhuma janela".

- **Módulo do editor, lido como dado e sem executar.** `https://lisa.yampi.com.br/manifest.json` (modificado em 05/11/2026) aponta `src/web-component.ts` para `code-editor-9121cad2.js` e `web-component-030ca37f.js`. Nele, o "+" de uma pasta comum abre a linha `NewFileInput` na árvore, e não mais a janela. Comparado ao módulo de 01/10, continuam iguais **Salvar arquivo**, `tab-item`, `cm-content`, o cabeçalho, a leitura `file/get`, `merchant-identity` e o componente padrão do `.vue`. A marca de alteração não salva da aba mudou.
- **Painel no Chromium** (`npm run test:bare`), com o editor fictício reproduzindo a linha nova. O envio cria um texto novo pelo campo. Com a recusa do servidor, para em segundos com "A Yampi recusou … Erro ao criar o arquivo." e fecha a linha. Na janela antiga (`fixture-creation=janela`), para com a recusa silenciosa reconhecida. **Continuar** cria o arquivo uma vez.
- **Aba com alteração não salva** (`test:e2e`): a marca nova (`close-button has-changes`) e a antiga impedem a operação.
- **Conjunto** (Node 24): `npm run package` passou no typecheck, nos 393 testes de 27 arquivos e no build, e gerou `releases/zirtuno-sync-yampi/` na 0.10.6. `test:bare`, `test:panel` e `test:update` passaram. O `test:e2e` rodou três vezes. Nas três, passaram a exportação, a importação, o envio com o texto novo criado pelo campo e a imagem pela janela, o painel fechado no meio do envio e o backup. Os dois passos instáveis já registrados falharam: na primeira execução, a restauração com mudança externa; na segunda e na terceira, a conferência do heartbeat do painel (um a cada 20 s de conexão; a mesma falha da 0.10.0 e da 0.10.1). O código do heartbeat não mudou.

Sem validação real: qualquer envio com a 0.10.6 numa loja real.

## Envio que diz onde parou na 0.10.5, em 10/11/2026

Relato: um envio real parou na primeira criação com "O editor não confirmou a operação dentro do prazo".

- **Módulo público do editor** (`web-component-550f3324.mjs`, publicado em 01/10/2026, relido como dado e sem executar): a janela **Adicionar arquivo** só mostra erros de nome e o 409; outra recusa do servidor vai para o console, e a janela fica aberta. O botão de confirmar tem `sending` e `.button__loader` durante o pedido. As opções de extensão continuam "SCSS", "Vue", "Twig" e "JS".
- **Painel no Chromium** (`npm run test:bare`): com a recusa silenciosa ligada no editor fictício, o envio de um texto novo para em segundos com "A Yampi não confirmou a criação de sections/home/novidade.twig: o pedido terminou e a janela…", a janela da Yampi fica fechada sem confirmar, e **Continuar de onde parou**, já sem a recusa, cria e preenche o arquivo uma vez.
- **Conjunto** (Node 24): `npm run package` passou no typecheck, nos 393 testes de 27 arquivos e no build, e gerou `releases/zirtuno-sync-yampi/` na 0.10.5. `test:bare`, `test:panel`, `test:update` e `test:e2e` (que cria um texto e envia uma imagem pelas janelas do editor fictício) passaram.

Sem validação real: o motivo da recusa na loja real e qualquer criação nela com a 0.10.5.

## Avisos e revisão agrupada na 0.10.4, em 10/11/2026

- **Causa do bloqueio relatado, sem escrita** (simulação descartável, fora do repositório): o planejador da extensão sobre a pasta real, com a primeira versão do tema no Git como original e loja. Resultado: 41 textos novos impossíveis de criar (32 em 6 pastas novas, 9 `.js`), 9 bloqueios de `assets_url`, 2 de caminhos de imagem montados e as dependências deles.
- **Painel no Chromium** (`npm run test:bare`): o aviso de atenção tem tom e título, continua visível com o ponteiro sobre ele e fecha com um clique; o modelo 3D deixado de fora aparece em **Precisa da sua atenção**. Com 3 arquivos em 2 pastas novas e 2 `.js`, a revisão mostra uma linha por motivo ("3 arquivos novos estão em 2 pastas que não existem na loja…: components/catalogo (2) e components/manual (1)", "2 arquivos: A Yampi só cria…"), cada uma com **Ver N arquivos**, o título diz "5 arquivos novos não podem ser criados" e **Enviar** fica desligado. Capturas nos temas claro e escuro em `.cache/bare-validation/`, sem rolagem lateral.
- **Conjunto** (Node 24): `npm run package` passou no typecheck, nos 393 testes de 27 arquivos e no build, e gerou `releases/zirtuno-sync-yampi/` na 0.10.4. `test:bare`, `test:panel`, `test:update` e `test:e2e` passaram.

Sem validação real: o painel do Chrome com os avisos novos e qualquer envio para uma loja real.

## Tema solto sem download prévio na 0.10.3, em 10/11/2026

Relato: com a 0.10.2, a pasta de um projeto real com o tema em `theme/` foi reconhecida, mas o painel pedia **Baixar arquivos** antes de comparar.

- **Painel no Chromium** (`npm run test:bare`, novo): editor fictício sem nenhum original guardado e uma pasta fictícia no armazenamento privado do navegador com `theme/`, `package.json`, `node_modules`, documentação e um modelo 3D. Escolher a pasta compara sem erro: a loja fictícia inteira é lida, o aviso de original aparece, o resumo mostra 1 arquivo alterado e nenhum conflito, e **Atualizar da loja** e **Versões** ficam desligados com a explicação. O envio grava só esse arquivo, conferido na loja fictícia, sem acionar controles proibidos. A pasta termina idêntica, sem `.yampi-sync/`. Escolhida de novo, nada fica para enviar, e o download mostra "Loja lida na comparação".
- **Execução** (`tests/jobs.test.ts`): a comparação com `adopt` lê a loja inteira, textos e imagens, guarda o original sem `inventory` nem `partial`, com `lineage.adopted`, sem ZIP nem gravação; o plano vê a mudança da pasta sem conflito. Um original guardado antes vale mais que a leitura.
- **Worker** (`tests/background.test.ts`): `adopt` chega à execução numa comparação de projeto; é recusado num envio, numa atualização, numa restauração, sem escopo ou com valor que não é `true`.
- **Conjunto** (Node 24): `npm run package` passou no typecheck, nos 393 testes de 27 arquivos e no build, e gerou `releases/zirtuno-sync-yampi/` na 0.10.3. `test:bare`, `test:panel` e `test:update` passaram. `test:update` falhava também no código anterior (`7a69fb4`), na linha que esperava **Reler** depois de **Concluir**, que desde a reorganização da revisão volta sem projeto carregado; o script agora escolhe a pasta de novo.

Sem validação real: a importação no painel do Chrome e qualquer envio para uma loja real.

## Pasta com o tema em theme/ na 0.10.2, em 10/11/2026

Relato: o painel recusava a pasta de um projeto real com o tema em `theme/` e sem `.yampi-sync/`.

- **Reprodução, sem escrita** (simulação descartável, fora do repositório): `folderEntries` e `readProjectEntries`, com handles de pasta sobre o disco. Antes: na raiz, a mensagem relatada; em `theme/`, erro de UTF-8 num modelo 3D. Depois: nas duas, o tema inteiro lido como tema solto, com o modelo 3D de fora e nomeado no aviso.
- **Pasta** (`tests/folder.test.ts`): `theme/` lido como tema solto sem ler `node_modules`, `package.json` ou documentação; `tema/` e `theme/` juntos recusados; pasta sem tema e `theme/` sem pastas de tema recusados com a explicação; **Usar no projeto** grava só no arquivo existente de `theme/`.
- **Leitura** (`tests/project.test.ts`): binário que não é imagem fica de fora com aviso, inclusive num projeto exportado; arquivos do sistema, sem aviso; binário acima de 2 MiB nunca é lido; Twig que não é UTF-8 ou tem NUL para a leitura com o nome do arquivo.
- **Conjunto** (Node 24): `npm run package` passou no typecheck, nos 390 testes de 27 arquivos e no build, e gerou `releases/zirtuno-sync-yampi/` na 0.10.2. `npm run test:panel` passou no Chromium com o editor fictício.

Sem validação real: a leitura no painel do Chrome, a comparação com a loja e qualquer envio.

## Integração das alterações locais e remotas, em 02/11/2026

Com Node 24, `npm ci` e `npm run check` passaram; o código integrado passou nos 382 testes de 27 arquivos, no typecheck e no build. Os scripts `panel-e2e.mjs`, `e2e.mjs` e `background-e2e.mjs` também passaram no Chromium: revisão e envio sem ZIP, envio com backup, proteção de conflito na restauração, heartbeat e download com a vitrine fictícia. O download com o editor em segundo plano terminou em 43,9 s, com 55 leituras públicas e 39 conferências da loja. Os testes usam exclusivamente exemplos, editor e vitrine fictícios; nenhuma requisição alcançou uma loja real. Os registros anteriores abaixo descrevem as validações de cada conjunto antes desta integração.

## Barra, ritmo e aba em segundo plano na 0.10.1, em 02/11/2026

Relato: num download real com a vitrine, a barra mostrava 99% com **Páginas dos produtos: 47 de 271**, e o download era lento. Tudo abaixo usa só o editor e a vitrine fictícios. `npm run check` passou com 358 testes em 26 arquivos.

- **Reprodução e correção da barra** (`tests/jobs.test.ts`, `tests/progress.test.ts`): um download simulado com 264 arquivos lidos direto do servidor, 120 recursos, 30 páginas da loja e 271 de produto. Com 47 de 271 produtos, a barra mostra cerca de 59%; com 0, 51%; com 270, 97%. Ela anda a cada página, nunca volta e só chega a 100% no fim. A etapa que termina sem saber o tamanho libera o espaço que guardava, e trocar o peso da leitura (servidor ou editor) não faz a barra voltar.
- **Conferências divididas** (`tests/background.test.ts`): 12 leituras públicas ao mesmo tempo, com o editor demorando a responder, pedem no máximo 4 conferências da loja (antes, 24). Uma loja diferente no editor durante os GETs ainda faz as leituras falharem.
- **Pedido inteiro** (`tests/background.test.ts`): `previewOnly` e `links` chegam à execução; prévia avulsa sem a vitrine, `links` fora de uma comparação e endereço que não é `http(s)` são recusados.
- **Trava da aba** (`tests/background.test.ts`): o início da operação pede a trava na aba do editor, no mundo isolado; o fim a solta.
- **Leituras simultâneas** (`tests/performance.test.ts`): no máximo 6 GETs de recursos ao mesmo tempo, na ordem pedida; o cancelamento espera os 6 emitidos e não começa outra leva.
- **Aba do editor em segundo plano, extensão real** (`npm run test:background`): Chromium sem as opções do Playwright que mantêm as abas acordadas. Depois do clique em **Baixar ZIP** com a vitrine, o Playwright se desconecta e outra aba vem para a frente. A aba do editor ficou oculta o tempo todo, com os temporizadores desacelerados (4 de 10 ms levaram 2,7 s). Sem a leitura direta, os 11 arquivos foram lidos pelo editor nessa aba, e o download terminou sozinho em 44 s, com 8 páginas no recorte, 9 da loja e 11 de produto. A trava ficou na página durante a operação e foi solta no fim. Foram 39 conferências da loja para 55 leituras públicas (antes, 110). A barra só avançou e ficou abaixo de 99% enquanto faltavam páginas.
- **Extensão real** (`npm run test:direct`, `test:panel`, `test:update`, `test:preview`, `test:compression`): passaram. A leitura direta de 121 arquivos fictícios levou 10,2 s, e pelo editor, 96,6 s, com ZIPs iguais. `test:e2e` passou do download à restauração com mudança externa e parou na conferência do heartbeat do painel (um a cada 20 s), como o código da 0.10.0 (`6919dac`), sem as mudanças desta versão, no mesmo ambiente. Por isso, a parte final dele (download com a vitrine fictícia no painel) não rodou aqui; `test:background` cobre esse caminho.

Sem validação real: o tempo de um download numa loja real, o efeito da trava no congelamento de abas em cada configuração do Chrome e a conferência dos links numa loja real.

## Saída da revisão e backup opcional, em 31/10/2026

- **Painel em Chromium** (`npm run test:panel`): sem seleção e sem alterações, **Concluir** é a ação principal; com seleção, **Enviar** mantém o destaque e **Cancelar** fica secundário. Ambos encerram a revisão e voltam à tela inicial de **Importar projeto**, sem pasta ou ZIP carregado, inclusive após reabrir o painel. A referência, o histórico e os backups são preservados. Comparar e trocar pasta usam botões secundários. Revisão conferida nos temas claro e escuro, sem rolagem lateral em 300, 360 e 560 px.
- **Backup por envio** (`tests/jobs.test.ts`): desligar o ZIP elimina sua geração e download, mas o registro com os textos anteriores é persistido antes de escrever. A restauração continua funcionando; a retomada preserva a escolha, inclusive quando parou antes de escrever o primeiro arquivo. Conflitos posteriores e outra loja continuam bloqueados.
- **Integridade** (`tests/core.test.ts`): falha ao persistir o registro impede gravações com ou sem ZIP. Envios antigos e novos sem escolha explícita continuam exigindo o ZIP.
- **Fluxo completo fictício**: confirmação mostra a opção desligada, um texto é salvo e conferido, nenhum ZIP é baixado e o histórico informa que ele foi dispensado. Nova importação, nova comparação e volta à aba reativam o backup. Tanto concluir o resultado do envio quanto encerrar a revisão sem alterações volta diretamente à escolha de pasta ou ZIP na importação.

Validação exclusivamente fictícia. Nenhuma gravação ou teste destas alterações foi feito em loja real.

## Compatibilidade do tema na 0.10.1, em 30/10/2026

Uma prévia real foi inspecionada somente para leitura. O filtro `assets_url` concatenava `images/arquivo.png` diretamente ao nome do template; a URL respondia 404. O caminho completo `/assets/images/arquivo.png` encontrou a imagem enviada (HTTP 200, PNG). O módulo público `dist/vendor/icons.js` registra ícones como `IconHeader`, `IconFooter`, `IconPlus` e `IconVideo` depois dos plugins do tema. Na página, componentes homônimos foram substituídos pelos ícones internos. Isso explica conteúdo que existia na pasta e no recibo, mas não aparecia na prévia.

Os testes novos usam exclusivamente exemplos fictícios: bloqueio de caminhos literais e montados incompatíveis; colisões com ícones e propagação para consumidores; compilação local; recusa de plano antigo antes do backup ou de qualquer gravação; dependências em CSS, Vue e tabelas literais Twig; seleção conjunta com imagens novas; imagem existente alterada sem suporte de substituição; recusa do ZIP de retorno incompatível. A configuração de testes restringe a execução a `tests/`, excluindo cópias antigas em `.cache/`, e o teste de Git desliga assinatura somente no repositório temporário fictício.

`npm ci`, `npm run check` e `npm run package` passaram com Node 24: 369 testes em 27 arquivos, typecheck, build e pacote local. `npm run test:e2e` passou no editor fictício, incluindo criação de texto, imagem com caminho completo, backup, conferência no servidor, execução em segundo plano e proteção na restauração. Nenhuma requisição desse E2E alcançou a Yampi. As cópias de testes em `.cache/` não entram nessa contagem.

Com autorização específica do proprietário, um projeto real foi corrigido somente no disco: versão dos textos guardada e conferida antes das mudanças; prefixos de imagens corrigidos; quatro componentes criados com nomes próprios, preservando os antigos; fundo da vitrine protegido do CSS legado; serviço antigo de chat omitido nas páginas que já usam o novo. As 385 páginas da captura própria desse projeto compilaram com suas ferramentas existentes. Na home local, cabeçalho e rodapé renderizaram, os três planos PS Plus responderam à troca de console, e as imagens de `tema/assets/images` já carregadas não apresentaram falha. A comparação offline com a referência prevê 21 edições e quatro criações, sem imagens novas ou bloqueios. Isso não substitui a comparação com a loja atual nem a conferência real depois do reenvio. Nenhum conteúdo desse projeto foi copiado para este repositório.

Não houve gravação, publicação, exclusão ou renomeação na loja real. As correções não garantem paridade visual nem cobrem todo código dinâmico, configurações do painel ou scripts de terceiros. Atualizar a extensão não atualiza as ferramentas de projetos já exportados.

## Páginas da loja e dos produtos na 0.10.0, em 29/10/2026

Pedido: a prévia de uma loja real tinha 7 páginas, e menu, rodapé, "Ver tudo", quase todos os produtos e o voltar da página de produto davam "Rota não capturada". Tudo abaixo usa só a loja e o editor fictícios. `npm run check` passou com 609 testes em 43 arquivos.

- **Loja fictícia no formato real** (`tests/rocket-like.test.ts`, `tests/fixtures/rocket-like.ts`): 4 categorias, 2 subcategorias, uma vitrine `/l` (só no "Ver tudo" da coleção), 4 páginas de rodapé, uma promoção, uma busca escrita no tema, uma categoria que só um breadcrumb de produto linka, 14 produtos e uma cadeia de produtos semelhantes. Também tem uma categoria e um produto removidos (404, linkados pelo rodapé do tema), uma página do rodapé que redireciona para outro site e uma categoria que responde 429 duas vezes.
  - Resultado: 29 páginas, 8 delas no recorte representativo. A etapa da loja leu 10 páginas (6 categorias ou vitrines, 2 institucionais, 1 promoção, 1 busca) e a dos produtos, 11. 13 produtos têm a própria página. O 14º, que só a página do 13º mostra (lida na segunda e última rodada de produtos), fica de fora com esse motivo, e não como limite.
  - Os dois 404 viraram **link quebrado**, com `sections/global/footer.twig` como lugar do link. O redirecionamento não foi seguido nem pedido ao outro site. A categoria com 429 esperou o `Retry-After` duas vezes e entrou.
  - Uma página com 429 sem fim fica de fora com "HTTP 429" depois de esperar a cada tentativa. Com o limite de 4 páginas da loja, o aviso diz o limite e quantos caminhos ficaram de fora, e o recorte representativo não muda.
  - `customer`, `session_token` e `api_key` dentro de `window.data` de uma categoria e de um produto não aparecem em nenhum JSON do ZIP.
- **Formato 3 e runtime local** (`tests/preview-pages.test.ts`, `tests/local-runtime.test.mjs`):
  - `themeConfig` e `merchant` repetidos vão uma vez para `raw/shared/`, e a página de produto guarda só `data` e `bodyClasses`. Um compartilhado alterado, ou uma página editada à mão depois de lida, é recusado.
  - Rotas: categoria com qualquer ordenação ou página; busca só pela pergunta exata; `/__local/` com a contagem por tipo.
  - `npm run previa:trocar` troca `preview/`, guarda a anterior e recusa outra loja, captura alterada ou caminho inseguro, sem tocar `tema/`.
- **Operação e painel** (`tests/jobs.test.ts`): o progresso mostra **Páginas da loja: N de M** e **Páginas dos produtos: N de M**, e a barra só avança. O resultado lista os links quebrados. A prévia avulsa baixa só `preview/`, a partir da referência guardada, sem ler o editor nem mudar a referência.
  - Na comparação, os links do rodapé alterado da loja fictícia foram lidos pelo `fetchPublicResource` real: os dois 404 apontam o arquivo, a busca existe. Um 429 espera e repete; sem a permissão da vitrine, os links ficam sem conferência, com o motivo, e a comparação termina.
- **Chromium** (`npm run test:preview`): a exportação da loja fictícia foi movida, instalada com `npm ci`, e `npm run check` compilou todas as páginas, com todas as seções visíveis. Na prévia local, 14 cliques abriram a própria página: duas categorias do menu, duas subcategorias, duas páginas do rodapé, "Ver tudo", a busca do rodapé, três cards de produto e o voltar de cada um. O link para a categoria removida mostrou "Rota não capturada".
- **Extensão real** (`npm run test:e2e`, `test:panel`, `test:update`, `test:direct`, `test:compression`): todas passaram. Em execuções seguidas, `test:e2e` falhou duas vezes na restauração com mudança externa e uma vez no heartbeat do painel. A primeira falha também aconteceu no código da 0.9.1 (`2bcd120`), sem as mudanças desta versão. A execução final passou inteira, sem alteração, inclusive o download com a vitrine fictícia no formato 3 dentro do documento de segundo plano. `test:direct` falhou uma vez ao abrir o editor fictício e passou ao repetir.

Sem validação real: nenhuma exportação de loja real com a 0.10.0 foi feita nem conferida pelo proprietário.

## Download com a vitrine na 0.9.1, em 19/10/2026

Relato do proprietário num download real: depois de ler os 264 arquivos, a captura da vitrine pediu autorização, recomeçou a contagem e pediu de novo. Os números iam e voltavam, e o topo mostrava 100% com "Preparar o ZIP" e "Baixar o ZIP" pendentes.

- **Reprodução** (`tests/progress.test.ts`): três rodadas recomeçando a contagem levavam a barra a 100% antes de preparar o ZIP. Agora ela não passa de 99% até concluir.
- **Rodadas de autorização** (`tests/jobs.test.ts`): endereços já permitidos no Chrome entram sem pergunta; só o endereço novo é perguntado, uma vez; a contagem da etapa nunca volta; a barra só chega a 1 no fim; com tudo permitido, não há pergunta.
- **Chromium, extensão real** (`npm run test:e2e`): com o endereço das imagens já permitido, o download foi direto ao ZIP, sem pausa. As demais suítes também passaram.

Sem validação real: o download de uma loja real com a 0.9.1.

## Versões conhecidas, recibo, trechos e junção na 0.9.0, em 19/10/2026

Pedido: um uso real da 0.8.0 com a referência do download de D0, um envio por ZIP em D7 feito em outra instalação, edições depois dele e possíveis mudanças do dono da loja. A atualização mostrava 9 arquivos "mudados dos dois lados". `npm run check` passou com 591 testes em 42 arquivos, só com dados fictícios.

- **Critérios de aceite** (`tests/known.test.ts`):
  1. envio de outra instalação, listado pelo Git: `mine`;
  2. terceiro em outro trecho: `merged`, e só a mudança dele entra na pasta;
  3. terceiro nas mesmas linhas: conflito com a origem "depois do último envio conhecido";
  4. arquivo criado pelo projeto: `mine` na atualização e `update` na revisão do envio, nunca conflito do arquivo inteiro;
  5. junção de um arquivo: a pasta recebe a junção, a referência avança só dele, e só ele é gravado na loja;
  6. manifesto versão 2 continua versão 2, sem campos que as ferramentas antigas não conhecem;
  7. a escolha de um trecho sobrevive a uma nova leitura e cai quando o trecho muda;
  8. junção com trecho marcado fica bloqueada para envio;
  9. diferença só nos caminhos de imagem: "Já está na loja" no envio e `same` na atualização.
- **Recibo e lista:** o recibo traz só itens conferidos e recusa texto alterado; recibo de outra loja e lista ilegível ficam de fora, com aviso. `npm run versoes:conhecidas` listou num repositório Git temporário cada versão de cada texto, com `\r\n` normalizado.
- **SHA-256 síncrono** (`tests/sha256.test.ts`): igual ao do Node nos tamanhos de borda.
- **Comparação sem recarregar** (`tests/server-confirm.test.ts`): lê o servidor mesmo para um arquivo e para se o servidor falhar. No `npm run test:e2e`, a restauração voltou a mostrar o conflito de uma mudança feita depois do envio. A 0.8.1 lia esse arquivo pela aba sem recarregar e não o via.
- **Painel de demonstração** (`npm run test:update`):
  - escolha por trecho "Da loja" e volta para "Marcar para editar";
  - aviso com a lista de arquivos que vão receber marcações;
  - recibo gravado na pasta e baixado depois do envio;
  - "Juntar com a loja" num arquivo mudado dos dois lados em trechos diferentes: a pasta recebeu as duas mudanças, e a revisão ficou com 1 item pronto.

Sem validação real: a lista do Git num projeto real, os recibos entre computadores e a junção de um arquivo numa loja real.

## Conferência pelo servidor e falsos conflitos na 0.8.1, em 19/10/2026

- `tests/server-confirm.test.ts` (5 testes): com o servidor, envio com texto, criação e imagem sem nenhuma recarga; salvamento que o servidor não guardou para no arquivo, com o registro; mudança feita por outra pessoa só no servidor para antes de gravar; sem servidor, recarrega como antes; servidor de outra loja interrompe sem gravar.
- `tests/update.test.ts`: texto da loja igual ao que a extensão enviou fica `mine`; texto que ela nunca enviou continua conflito.
- `npm run test:e2e`: o envio completo (texto alterado, texto criado, imagem, conferência final) terminou sem recarregar a página do editor fictício e com leituras no servidor fictício.
- Na Yampi real, observado pelo proprietário: recarregar o editor mostrou "Acesso restrito"; a leitura direta funcionou. A gravação conferida pelo servidor ainda não rodou numa loja real.

## Atualização da pasta, versões e imagens opcionais na 0.8.0, em 19/10/2026

Node 24.15.0, depois de `npm ci`. `npm run check` passou com 571 testes em 39 arquivos. Tudo usa o editor fictício e projetos fictícios; nenhuma requisição alcançou a Yampi.

- **Junção** (`tests/merge.test.ts`, 13 testes):
  - bloco removido na loja e trecho mudado na pasta ficam os dois;
  - a mesma mudança dos dois lados não é conflito;
  - mudanças nas mesmas linhas, ou em linhas vizinhas, viram marcações com as duas versões, e linhas iguais nas bordas ficam fora delas;
  - começo e fim mudados em lados diferentes juntam;
  - a quebra final de linha segue quem mexeu nela, e `\r\n` vindo da loja não atrapalha;
  - arquivo criado nos dois lados é conflito do arquivo inteiro;
  - arquivo grande demais para a comparação detalhada vira conflito, nunca junção errada;
  - marcações são reconhecidas só na forma completa.
- **Atualização** (`tests/update.test.ts`, 9 testes), sobre um projeto exportado pela extensão, com mudanças fictícias na pasta e na loja:
  - cada arquivo recebeu o estado esperado: juntado, conflito marcado, da loja, só da pasta, removido, novo, imagem da loja para a prévia;
  - a referência passou a ser a loja lida, e as ferramentas locais (`readProject`) a leram;
  - a comparação seguinte bloqueou o arquivo marcado e deixou pronto o trabalho da pasta;
  - três versões foram guardadas antes de mudar a pasta, cada texto uma vez, nenhuma imagem;
  - arquivo mudado depois da leitura parou tudo sem gravar nada;
  - as escolhas "manter a da pasta" e "usar a da loja" funcionaram, e um arquivo apagado na pasta e mudado na loja voltou;
  - arquivo ainda marcado não foi juntado de novo, e sua referência não avançou;
  - gravação interrompida no segundo original deixou a pasta legível, com o aviso, e a atualização seguinte terminou;
  - leitura parcial da loja é recusada, e original adulterado sem marcação continua recusado.
- **Versões** (`tests/versions.test.ts`, 7 testes):
  - versão nomeada é listada e conferida, e só os textos que mudam ocupam espaço;
  - automática igual à anterior não se repete;
  - texto alterado, versão de outra loja e registro estragado ficam de fora;
  - trazer guarda a pasta antes, recria o arquivo apagado e mantém `\r\n`;
  - arquivo mudado depois da leitura não é sobrescrito;
  - a extensão grava só em `tema/` e nos seus registros de `.yampi-sync/`, e pasta de tema solta não recebe versões.
- **Imagens e marcações** (`tests/images-off.test.ts`, 4 testes):
  - com a opção desligada, a imagem nova fica no projeto com o motivo, e o texto que a usa espera, explicado;
  - ligada, a imagem vai junto do texto, como antes, e texto independente segue pronto;
  - texto com marcações fica bloqueado até ser resolvido.
- **Operações** (`tests/jobs.test.ts`, `tests/background.test.ts`):
  - a leitura para atualizar lê a loja inteira mesmo com caminhos pedidos, guarda à parte sem tocar a revisão do envio e não grava nada;
  - o worker recusa um envio com escopo de atualização e trata a leitura como só leitura.
- **Chromium, extensão real** (`npm run test:e2e`): a imagem nova ficou fora do envio, com o texto que a usa esperando. Ligar **Enviar imagens novas** mostrou o aviso no painel lateral; aceito, o envio de 3 itens seguiu igual ao da 0.7.0, com backup, conferência após recarregar e restauração.
- **Chromium, painel de demonstração** (`npm run test:update`): uma pasta fictícia no armazenamento privado do navegador foi entregue ao painel no lugar do seletor de pastas.
  - Mudanças fictícias da pasta: linha 10 de um template longo e o head. Da loja: linha 1991 do mesmo template, o head, os estilos, um arquivo removido e um novo.
  - A revisão mostrou 3 da loja, 1 juntado e 1 para decidir. Comparar e trocar a escolha não gravou nada.
  - Aplicar gravou a junção, as marcações, os estilos e o arquivo novo, removeu o arquivo apagado, reescreveu a referência sem deixar marcação e guardou 3 versões sem imagens. A comparação seguinte bloqueou o arquivo marcado.
  - Em **Versões**, trazer o head da versão "Pasta antes de atualizar" recuperou a versão da pasta e guardou uma quarta; uma versão nomeada ficou como quinta.
  - Até aqui, zero gravações na loja fictícia.
  - Um envio em seguida (o template juntado e o head trazido da versão) foi registrado na pasta: a referência passou a ter o conteúdo conferido, com o motivo `send`, e uma sexta versão (`envio`) guardou a loja. Capturas em `.cache/update-validation/`.
- Também aprovados depois da mudança: `npm run test:panel`, `npm run test:preview`, `npm run test:direct` e `scripts/compression-e2e.mjs`.

Sem validação real: a gravação numa pasta real pelo painel lateral do Chrome (permissão de edição, gravação e releitura) não foi conferida; o teste usa o armazenamento privado do navegador numa página comum. A leitura completa da loja para atualizar é a mesma da cópia (0.7.0), também sem validação real.

## Leitura direta e barra de progresso na 0.7.0, em 18/10/2026

Node 24.15.0. `npm run check` passou com 278 testes em 18 arquivos. Tudo usa o editor fictício e um servidor fictício que responde nas rotas que o módulo público do editor lê; nenhuma requisição alcançou a Yampi.

- **Servidor** (`tests/direct.test.ts`): somente `GET` com cookies do navegador, sem cache e com `preview=true`; loja identificada por nome e link de prévia; outra loja na sessão para tudo, antes, durante ou no fim; resposta sem os campos só desativa a leitura direta; `\r\n` e `\r` viram `\n`; imagem só por `https:` ou `data:`, sem credenciais no endereço e com o tipo conferido; servidor ocupado repetido, sessão expirada e arquivo ausente com o motivo; no máximo 6 pedidos simultâneos; resposta grande dividida entre chamadas.
- **Cópia** (`tests/direct.test.ts`): um arquivo de cada tipo pelos dois caminhos e o restante em lotes de até 24; JSON pelo editor; diferença na amostra, servidor indisponível ou falha no meio levam à leitura pelo editor e a cópia sai completa; poucos arquivos e comparação parcial não usam o servidor; cancelamento não entrega nada.
- **Barra** (`tests/progress.test.ts`, `tests/jobs.test.ts`): a barra nunca volta quando uma etapa descobre o tamanho depois (lista de arquivos, imagens da vitrine); depois de listar 40 arquivos ela fica abaixo de 5%, não em 18%; **Listar os arquivos** aparece em andamento; a etapa de leitura troca de rótulo conforme o caminho.
- **Chromium** (`npm run test:e2e`): o servidor fictício devolve os textos com `\r\n`. O download leu 5 arquivos pelo editor e 10 pelo servidor, no máximo 5 simultâneos, sem pedido recusado; o ZIP saiu igual, sem `\r`, e as etapas mostraram "Leitura direta conferida com o editor". Envio, restauração e isolamento de loja continuaram aprovados.
- **Tempo** (`npm run test:direct`): 121 arquivos fictícios, 450 ms para abrir cada um no editor e 120 ms por pedido ao servidor. Pelo editor, 95,7 s; com a leitura direta, 9,8 s (4 arquivos pelo editor, 121 pedidos, até 6 simultâneos). Os arquivos do tema no ZIP foram idênticos byte a byte. Relatório local em `.cache/direct-benchmark.json`.

Sem validação real: o endereço, as respostas e a identificação foram lidos no módulo público do editor (`web-component-550f3324.mjs`) em 18/10/2026, sem executá-lo; o módulo não integra o repositório.

## Revisão da interface, em 18/10/2026

Node 24.15.0. `npm run check` passou com 258 testes em 17 arquivos. A revisão recupera as abas no topo, o estado de conexão por escrito, as ações junto do conteúdo e as orientações de download e envio, mantendo o motor da 0.6.0. Histórico, backups e recuperação ficam somente no menu **⋯**.

`npm run test:panel` usa somente a demonstração e arquivos fictícios: navegação por mouse e teclado (setas e Home), abertura direta no download, escolha de ZIP com nome visível, importação e comparação reais do ZIP fictício, comparação preservada ao trocar de aba, recuperação vazia sem ações habilitadas e etapas abertas durante a leitura. Tema claro e escuro conferidos em 320, 360, 560 e 800 px, sem rolagem lateral. A exportação, a navegação e a comparação registraram zero gravações no editor; requisições fora da demonstração são bloqueadas. Evidências locais em `.cache/panel-validation/`.

O E2E nativo de Chromium também passou: exportação com leitura integral e sem mutações, importação de pasta/ZIP, criação e imagem fictícias, backup, painel fechado durante o envio, conferência após reload, restauração protegida e recuperação da conexão. Nenhuma requisição alcançou a Yampi. Esta revisão de interface não acrescenta validação de gravação numa loja real.

O teste do painel foi ampliado para a assinatura e a recuperação restritas ao menu, sem repetição nas duas abas, e o seletor estilizado do histórico: estado vazio desabilitado, dois envios fictícios com datas e estados diferentes, um registro de outra loja que não aparece, navegação por setas/Home/End/Enter, Escape, Tab e clique fora, retorno de foco e seleção preservada ao fechar e reabrir o menu. O backup baixado depois de escolher o envio anterior foi comparado byte a byte com o ZIP fictício daquele registro. O histórico aberto foi conferido também no tema claro e em 320–800 px. O E2E nativo passou com o acesso ao backup e à restauração pelo menu.

O cabeçalho foi conferido em 300, 320, 360, 560 e 800 px, nos temas claro e escuro: nomes longos com espaços e sem espaços, altura constante, distância do ícone e do menu, degradê até transparente, reticências e tooltip com o texto inteiro. O teste estreita e alarga o painel para conferir que o corte aparece e desaparece, e cobre textos de conexão, operação em andamento e desconexão. O ZIP fica sempre visível e o mesmo teste importa e compara o arquivo fictício pelo controle reformulado.

## Bloqueio explicado, em 17/10/2026

`npm run check` passou com 258 testes em 17 arquivos; `tests/explain.test.ts` cobre a frase para um arquivo usado que mudou só na loja, em conflito, os dois juntos e a ausência de bloqueio; `tests/folder.test.ts` cobre a gravação na pasta do projeto (quebras de linha e marca de ordem de bytes mantidas, recusa quando o arquivo mudou depois da comparação, arquivo ausente não criado, caminho com `..` recusado, projeto dentro de uma pasta acima) e a leitura da pasta. `npm run test:e2e` passou.

Na demonstração, com uma pasta em memória montada a partir do ZIP exportado pela própria demonstração: **Usar no projeto** pediu a permissão `readwrite`, gravou uma vez o arquivo com a versão da loja, releu a pasta e comparou de novo; o arquivo que estava bloqueado passou a ser enviável e o aviso sumiu. A pasta real do Chrome não foi usada: o seletor de pastas exige um gesto do usuário. Na demonstração, em Chromium, a linha "templates/home.twig usa components/Example.vue, que mudou na loja depois da sua cópia." apareceu com **Ver a mudança**, que abriu a comparação Original → Loja com **Copiar a versão da loja**; o texto copiado era a versão da loja, e nenhum erro de página ocorreu. A releitura da pasta lembrada em **Comparar de novo** não tem teste automático: o seletor de pastas exige um gesto do usuário.

## Operações em segundo plano na 0.6.0, em 16/10/2026

Windows, Node.js 26.2.0; o alvo do projeto continua Node 24. `npm run package` passou: TypeScript, **246 testes em 15 arquivos**, build e pacote com 23 arquivos permitidos (21 da extensão, `INSTRUCOES.md` e `TERCEIROS.md`). A pasta `releases/zirtuno-sync-yampi/` e os dois ZIPs têm o mesmo conteúdo, conferido byte a byte, e os dois ZIPs o mesmo SHA-256. O ZIP tem 414.545 bytes; as quatro fontes incluídas (SIL OFL 1.1) são a maior parte do aumento.

`npm run test:e2e` passou no painel lateral nativo de Chromium. No envio, o painel foi fechado logo depois do backup: a execução em segundo plano terminou sozinha, todas as etapas ficaram concluídas ou puladas, o ícone mostrou o fim e o editor foi liberado. Reaberto, o painel mostrou **Envio concluído**, com o resultado. O registro tinha os 3 itens conferidos (texto alterado, texto novo criado pelo **Adicionar arquivo** e imagem enviada para `assets/images`), e a restauração pelo menu continuou protegendo uma alteração posterior. Exportação, captura da vitrine com autorização por origem, ZIP de retorno corrompido, desconexão e nova tentativa também passaram, com zero edições, saves ou acionamentos de publicar, excluir ou renomear na exportação. `npm run test:compression` passou: o ZIP do worker é igual ao síncrono, a interface continuou respondendo e o cancelamento funcionou.

Casos novos de unidade:

- **Envio** (`tests/resume.test.ts`): uma recarga por grupo de criações e de imagens e uma por texto salvo, nenhuma antes de salvar; criações conferidas antes das imagens; continuação sem repetir o que foi conferido e sem novo backup; salvamento que chegou à loja antes da interrupção conferido, não repetido; alteração feita na loja durante a interrupção para o envio sem gravar; arquivo criado antes da interrupção conferido e preenchido; backup que falhou refeito antes da primeira alteração; seleção diferente recusada.
- **Comparação parcial** (`tests/resume.test.ts`): o mesmo envio da comparação completa lendo só o que mudou; texto incluído que só a loja mudou lido e ainda bloqueando quem o usa; arquivo removido da loja; nomes possíveis de imagem em subpasta.
- **Operações** (`tests/jobs.test.ts`): progresso por etapa, backup baixado, registro e referência atualizada; interrupção e continuação; backup que não chegou ao computador refeito ao continuar; interromper a pedido; loja diferente antes de qualquer leitura; migração da referência anterior à 0.6.0; restauração.
- **Worker** (`tests/background.test.ts`): o painel fechado não libera o editor, e outro painel só acompanha; a execução age só na aba e na operação que recebeu; comparação não grava; download só de endereços da extensão; ícone e aviso de fim; operação sem execução viva marcada como interrompida; aba fechada cancela.
- **Progresso, diferenças e novas tentativas** (`tests/progress.test.ts`): barra pelo trabalho de cada etapa, tempo restante só com histórico suficiente, diferença por linhas que reconstrói os dois lados, novas tentativas só em leituras que falham por tempo, nunca em salvar, criar ou enviar imagem.

Dois problemas foram encontrados nesta revisão, antes de qualquer uso real, e os testes acima falham sem as correções: **Continuar de onde parou** pularia o backup de um envio cujo backup falhou, e a comparação parcial deixava de bloquear um arquivo que inclui um texto alterado só na loja.

Sem validação real: a execução em segundo plano, o painel fechado no meio do envio, a continuação, a conferência em grupo de criações e imagens e a comparação parcial numa loja real.

## Correção 0.5.1, em 16/10/2026

Windows, Node.js 26.2.0. `npm run package` passou: TypeScript, 200 testes em 12 arquivos (3 novos para a decodificação de endereços `data:`), build e pacote. O editor fictício passou a declarar `connect-src 'self'`, como a página real. Sem a correção, `npm run test:e2e` falhou na leitura da imagem com **Failed to fetch**, a mesma mensagem do envio real. Com a correção, o teste de ponta a ponta passou inteiro: exportação com PNG, criação de arquivo e de imagem pelos controles do editor, envio com backup e conferência após recarregar, e restauração protegida.

Validado numa loja real, com a 0.5.0: criação de 18 textos novos por **Adicionar arquivo**, conferidos após recarregar; envio de uma imagem para `assets/images`, exibida pelo editor com os mesmos bytes do projeto; backup antes da primeira gravação; parada no primeiro erro com registro parcial. Ainda sem validação real: gravação dos textos alterados, demais imagens, URL de `assets_url` e restauração.

## Envio automático na 0.5.0, em 15/10/2026

Windows, Node.js 26.2.0; o alvo do projeto continua Node 24 e `engines` aceita a partir dele. `npm ci`, `npm run check` e `npm run package` passaram: TypeScript, 197 testes em 12 arquivos, build e pacote com 17 arquivos permitidos, sem código do editor fictício.

O editor fictício passou a reproduzir a marcação lida no módulo público do editor real: botão **Adicionar arquivo** em cada pasta, janela com seletor de extensão e nome, envio de imagens com as mesmas regras de nome, tipo e tamanho, e componente Vue padrão. `npm run test:e2e` passou no painel lateral nativo de Chromium. Um projeto com um texto alterado, um texto novo numa pasta existente e uma imagem nova numa subpasta mostrou "3 para enviar" sem nada pendente. Com dois cliques e o backup baixado antes, a extensão criou o texto pelo editor, enviou a imagem para `assets/images/nova.png` com os mesmos bytes, ajustou a referência e conferiu cada item após recarregar. A restauração continuou protegendo uma alteração posterior. Na exportação, os contadores registraram zero edições, saves, aberturas de **Adicionar arquivo** e acionamentos de publicar, excluir ou renomear. `npm run test:preview` passou com as ferramentas de projeto atualizadas.

Casos novos de unidade cobrem os estados `create` e `upload`, os motivos de bloqueio (pasta inexistente, nome ou tipo recusado), a mudança de caminho das imagens com colisões, referências montadas em tempo de execução, a escolha explícita em conflito, `components.twig` nunca enviado sem bloquear quem o inclui, e a ordem criar → enviar imagens → preencher. Também cobrem a parada no primeiro erro de cada etapa e a restauração de um arquivo criado ao conteúdo inicial da Yampi.

Uma exportação real de redesign, privada e fora deste repositório, foi usada somente para leitura, com uma loja simulada em memória igual à exportação. O plano trouxe 18 textos para criar, 40 imagens de subpastas para `assets/images`, 69 alterações e nenhum bloqueio. O envio terminou com o conteúdo final igual ao plano, imagens idênticas byte a byte e nenhuma referência apontando para as subpastas. Nenhuma requisição alcançou a Yampi e não houve gravação real.

Sem validação real: acionamento de **Adicionar arquivo** e do envio de imagens numa loja real, URL gerada por `assets_url` em `assets/images`, leitura das imagens enviadas, gravação e restauração reais.

## Distribuição simplificada em 15/10/2026

Com Node.js 24.15.0, `npm ci` e `npm run package` passaram, incluindo TypeScript, 182 testes em 12 arquivos e build. O empacotamento prepara a pasta fixa `releases/zirtuno-sync-yampi/`, o ZIP com versão e o ZIP de nome estável `zirtuno-sync-yampi.zip`, com seus hashes. A pasta e os ZIPs têm os mesmos 17 arquivos permitidos, conferidos byte a byte; os dois ZIPs têm o mesmo SHA-256. O README e o guia destacam o download direto em Releases. A instalação na janela do Chrome do usuário exige concluir o carregamento ou a recarga manualmente; esta validação não confirma essa instalação nem altera o estado de validação real da Yampi.

## Integração do repositório ZIRTUNO em 15/10/2026

Windows, Node.js 24.15.0. Os quatro commits até `9654001` foram combinados com o trabalho local da 0.4.0. `npm ci`, `npm run check` e `npm run package` passaram: TypeScript, **182 testes em 12 arquivos**, build e ZIP local `zirtuno-sync-yampi-0.4.0.zip` com 17 arquivos permitidos e SHA-256. O repositório principal e os links de instalação continuam apontando para `JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer`.

`npm run test:e2e` passou no Chromium temporário com painel lateral nativo: exportação sem mutações, importação de pasta/ZIP, bloqueio global de texto novo ausente, criação manual simulada, preenchimento antes dos arquivos existentes, backup, conferência após reload de cada arquivo, recuperação de conexão e proteção de alterações posteriores na restauração. O fluxo de captura pública e ZIP também passou. Nenhuma requisição alcançou a Yampi.

Os testes que combinam os dois trabalhos conferem que um arquivo novo vazio precisa ser selecionado junto com quem o inclui, que a restauração devolve o conteúdo vazio anterior, que conteúdo remoto conflitante bloqueia também seus dependentes e que uma troca de loja na conferência interrompe antes do próximo arquivo. As prévias de três lojas fictícias passaram: duas com comparação visual e uma no formato da vitrine, com seções, fontes, ícones, imagens, erro de rota não capturada e diagnóstico de prévia incompleta.

O teste visual também encerra o compilador esbuild do terceiro projeto exportado na limpeza, como já fazia nos outros dois. Isso libera o executável temporário no Windows e permite remover a pasta de teste sem deixar processos abertos.

Nenhuma gravação ou restauração real foi executada. As limitações de validação real e os resultados históricos abaixo continuam com seus escopos originais.

## Validação anterior da 0.4.0

Execução em 14/10/2026, Windows, Node.js 24.15.0. Fixtures, imagens, fontes, temas e respostas de API usados nos testes são inteiramente fictícios. Nenhuma escrita real na Yampi foi realizada e nenhuma requisição alcançou uma loja real. [Relatório da versão](RELATORIO-0.4.0.md).

## Resultados na 0.4.0

`npm run check` passou com 171 testes em 12 arquivos, seguido do build. As suítes novas cobrem o contrato único (`tests/contract.test.ts`), o fluxo de ponta a ponta no formato real da vitrine (`tests/rocket-like.test.ts`) e o retorno seguro (`tests/core.test.ts`). Os principais casos:

- **Formato real, ponta a ponta.** Uma vitrine fictícia com `window.themeConfig` (lista de seções com `position` 0/1/2 e `order`), `window.data` (incluindo `config` da seção principal e `context`) e `window.merchant` (com `company`, `cookies_policy`, `checkout`, `meta`) é capturada pela própria extensão, exportada, extraída e verificada com `check`: cada página captura e renderiza todas as seções visíveis com `position === 1`; aliases `main_category_content` e `main_product_content` resolvem; `products_per_page` vem de `data.config`; `pageConfig.data.sections.1` aponta para o banner; o CSS compilado coincide com o publicado (`published-verified-by-css`).
- **Fixture negativo.** Sem `company`: o `check` falha citando `sections/global/footer.twig` e o relatório lista `company` como ausente na vitrine. Alias sem arquivo: relatório e `check` citam `secao_inexistente` e a página. Rota da API não gravada: erro explícito com método e caminho.
- **Captura.** Nenhuma requisição derivada de Sass; somente a face `latin` da fonte é baixada; ícones de `$assets` com base descoberta no CSS servido; uma variante por imagem subjacente, com aliases; leituras públicas só das seções visíveis; ZIP abaixo de 3 MB.
- **Privacidade.** Lista de bloqueio remove chaves de token, sessão, chave de API e rastreamento; `company` mantém a forma com `"redacted"`; e-mail e CPF não aparecem em nenhum arquivo de `preview/`; a leitura usa `credentials: 'omit'`.
- **Simulador.** Equivalência Twig PHP × Twing (`raw` em ausente, filtros de texto, `format`, `abs`, `date`, `merge`, `filter`, `json_encode`, `sections.1`, funções de seta, concatenação de booleanos, soma com texto numérico); tag não fechada vira aviso com o arquivo; ordem das folhas e `media` iguais aos de `head.twig`; `body` preservado; só componentes de `components.twig`.
- **Sobreposições.** Editar um parâmetro de seção da home não altera categoria nem produto; escopos global, por tipo e por captura; seções por `alias@ordem`.
- **Retorno.** Arquivo modificado que inclui arquivo novo é bloqueado com o nome dos dois; arquivos alterados que se usam só vão juntos e o envio parcial é recusado antes de qualquer gravação; dependência em conflito bloqueia quem a usa; diferenças só de espaço ficam separadas; `.vue` novo fora de `components.twig` gera aviso; o ZIP de retorno é conferido entrada a entrada.
- **Projeto e atualização.** Manifesto v3 legível junto com v1/v2; `local.data.json` só com sobreposições; `.gitignore` comentado; atualizador com `--preview`, plano antes de aplicar e `--rollback` que recusa arquivos alterados depois.

`npm run test:preview` passou em Chromium com três lojas fictícias, cada uma movida para outra pasta e executada só com as ferramentas do próprio ZIP após `npm ci`:

- Duas lojas, escura e clara, no formato real: seis páginas e seis recursos cada; identidade, CSS, fontes, imagens e cache, filtros, rotas distintas por link e comparação visual com referência independente. Diferença de pixels **0%** nas quatro comparações (desktop 1200×900 e mobile 390×844).
- Loja no formato real: `check` com `published-verified-by-css`; home 3/3, categoria 1/1, produto 2/2, institucional 1/1 e promoção 1/1 seções; `__yampiLocalReady` verdadeiro; família `Fictional Sans` `loaded` e nenhum aviso OTS; ícone de `$assets` servido com status 200; todas as imagens vindas de `preview/assets/`, sem placeholder; `GET catalog/products/1/flags` listado como rota não capturada. Com um template que deixa de renderizar as seções, a barra mostra "Prévia incompleta: 0 de 1 seções" e `__yampiLocalReady` fica falso. Caminho não capturado responde 404 explícito. Nenhuma requisição saiu de `127.0.0.1`.

`npm run test:e2e` passou no painel lateral nativo de Chromium: exportação sem mutações no editor fictício (CodeMirror antigo e atual), projeto portátil com `npm ci` e `check` na prévia demonstrativa, importação de pasta e ZIP, envio fictício com backup e reload, restauração protegida, reconexão e captura visual pelo worker real (seis páginas e seis recursos no formato v2). `npm run test:compression` e `npm run package` também passaram; o instalador tem os mesmos 17 arquivos permitidos e 176.811 bytes.

Evidências locais, ignoradas pelo Git: `.cache/visual-validation/report.json` e capturas da comparação visual; `.cache/yampi-check.json` em cada projeto testado.

## Limitações e validação real na 0.4.0

Os resultados acima vêm de fixtures fictícios que reproduzem o formato descrito na análise da exportação 0.3.4. A captura 0.4.0 ainda não foi executada numa vitrine real. Rotas da API pública além de coleções, banners e produtos por slug, a equivalência exata com o minificador da plataforma, a URL de produção de `assets_url`, a regeneração de `components.twig`, a associação ao rascunho e gravações/restaurações reais continuam sem validação. Não se deve classificar uma exportação real como visualmente validada com base em HTTP 200, compilação ou hashes internos. [Pendências](ROADMAP.md).

## Histórico importado do repositório ZIRTUNO

## Envio conferido arquivo a arquivo na 0.3.7

Execução em 15/10/2026, Windows, Node.js 26.2.0; o alvo do projeto continua Node 24 e `engines` aceita a partir dele. `npm ci` e `npm run check` passaram: TypeScript, 154 testes em dez arquivos e build. `npm run test:e2e` passou no painel lateral nativo com o editor fictício.

Casos novos: uma gravação que o editor mostra mas o servidor não persistiu interrompe o envio antes do arquivo seguinte; o mesmo teste falha no código da 0.3.6, que gravava o segundo arquivo. Um texto novo ausente na loja bloqueia o envio antes de qualquer registro, recarregamento ou gravação. Um arquivo novo criado vazio à mão é preenchido antes dos arquivos que dependem dele, e o backup guarda o conteúdo vazio. Criado com conteúdo igual, fica "Já está na loja"; com outro conteúdo, fica em conflito. Uma imagem nova enviada à mão é conferida pelos bytes e não bloqueia os textos.

O e2e simula a criação manual. Com um texto novo local, o envio fica bloqueado mesmo com a loja confirmada. Depois que o arquivo vazio é criado no editor fictício, a nova comparação mostra dois arquivos prontos; o envio preenche o novo, altera o existente e confere ambos após recarregar, e a restauração prepara os dois. Publicações e acionamentos de criar, excluir ou renomear continuam em zero.

Uma exportação real de redesign, privada e fora deste repositório, foi usada somente para leitura, com uma loja simulada em memória. O pacote de retorno gerado pelas ferramentas 0.2.4 do projeto foi aceito pelo importador. Com a loja igual à exportação, o envio foi recusado sem gravar. Com os textos novos vazios na loja, o envio terminou com os arquivos novos primeiro e o conteúdo final idêntico ao projeto local. Nenhuma requisição alcançou a Yampi e não houve gravação real.

`npm run test:preview`, `npm run test:compression` e `npm run audit:performance` não foram repetidos: prévia, compactação e captura não mudaram, exceto a versão registrada nos pacotes de prévia.

## Nome aprovado e distribuição na 0.3.6

Execução em 15/10/2026, Windows, Node.js 24.19.0. O nome aprovado é **Zirtuno Sync Yampi**, e o repositório/pacote usa **zirtuno-sync-yampi**. `npm run package` passou, incluindo TypeScript, 145 testes em dez arquivos e build. O ZIP `zirtuno-sync-yampi-0.3.6.zip` contém 17 arquivos permitidos e teve seu SHA-256 conferido.

O pacote foi carregado em Chromium temporário e informou o nome aprovado, versão **0.3.6** e a página `https://github.com/ZIRTUNO/zirtuno-sync-yampi`. O painel fictício e a orientação foram conferidos em 280, 360 e 800 pixels, sem transbordamento, sobreposição entre nome e versão ou erros JavaScript; as capturas foram inspecionadas visualmente. Permissões, CSP, formatos de exportação e identificadores de armazenamento permanecem iguais. Nenhuma loja real foi acessada ou alterada.

## Identidade e distribuição na 0.3.5

Execução em 15/10/2026, Windows, Node.js 24.19.0. `npm ci` e `npm run package` passaram; este último executou `npm run check`, com TypeScript, 145 testes em dez arquivos e build da extensão. O ZIP `zirtuno-sync-0.3.5.zip` contém 17 arquivos permitidos, e seu SHA-256 foi conferido.

O pacote foi carregado em um perfil Chromium temporário: o manifesto instalado informa **Zirtuno Sync**, versão **0.3.5** e a página `https://github.com/ZIRTUNO/zirtuno-sync`. Permissões, CSP e demais capacidades do manifesto permanecem iguais às da versão anterior. O painel de demonstração fictícia e a orientação da extensão foram conferidos em 280, 360 e 800 pixels, sem transbordamento horizontal, sobreposição entre nome e versão ou erros JavaScript. As capturas foram inspecionadas visualmente. Formatos de exportação, identificadores internos e chaves de armazenamento não foram renomeados. Nenhuma loja real foi acessada ou alterada; os resultados históricos abaixo mantêm seu escopo original.

## Histórico da versão 0.3.4

Execução em 09/10/2026, Windows, Node.js 24.15.0. Fixtures, imagens e fonte usadas nos testes são inteiramente fictícias. Nenhuma escrita real na Yampi foi realizada.

## Desempenho e integridade na 0.3.4

`npm run check` passou com 145 testes em dez arquivos. Os seis casos novos verificam concorrência limitada a quatro recursos públicos, ordem e orçamento determinísticos, reaproveitamento somente na mesma exportação e com autorização, nova tentativa após falha, cancelamento sem requisições pendentes e ZIP com imagens intactas. A integração do adaptador verifica uma chamada por comando já conectado e reinjeção após reload.

`npm run test:e2e` e `npm run test:preview` foram repetidos nesta versão e passaram nos cenários fictícios descritos abaixo. A exportação pelo painel lateral nativo executou o worker de compactação distribuído. Importação, baseline, backup, envio fictício, reload, restauração protegida e prévia portátil continuaram funcionando. Durante a cópia, os contadores registraram zero edições, salvamentos, exclusões, criações, renomeações ou publicações. Nenhuma requisição alcançou uma loja real.

`npm run test:compression` passou com worker real em Chromium temporário: 5.575.444 bytes de entrada, conteúdo do ZIP igual às entradas originais, buffers preservados, cancelamento sem erro não tratado e workers encerrados. O timer do painel avançou 11 vezes durante a compactação, confirmando que ela saiu da thread da interface. O worker tem custo de inicialização; o teste não presume menor tempo total para qualquer tamanho de pacote.

A auditoria comparou o código da 0.3.3 e a 0.3.4 com as mesmas fixtures e três amostras por etapa. A mediana da preparação do ZIP caiu de 277,78 para 128,73 ms; a captura de 24 recursos com latência simulada de 25 ms caiu de 611,29 para 156,14 ms. Os 250 textos e quatro PNGs foram conferidos byte a byte após reimportação. São medições sintéticas de etapas, sem estimativa da duração total em uma loja real. [Método e comandos](AUDITORIA.md).

O pacote agora permite 17 arquivos, incluindo `zip-worker.js`. O instalador passa de 1.056.798 para 145.130 bytes (86% menor). A assinatura passa de 1.158.905 para 2.174 bytes, com o original preservado no código de desenvolvimento. Permissões e CSP permanecem iguais. Evidências locais atuais: `.cache/performance/baseline/report.json`, `.cache/performance/optimized/report.json`, `.cache/performance/worker/report.json` e `.cache/visual-validation/report.json`.

## Identidade e distribuição na 0.3.3

`npm ci`, `npm run check` e `npm run test:e2e` passaram: 139 testes em nove arquivos, seguidos do fluxo completo no painel lateral nativo de Chromium com editor fictício. A exportação continua exigindo confirmação e realizou zero edições, salvamentos ou acionamentos destrutivos. Importação, backup, envio fictício, reload, restauração protegida e captura visual fictícia também passaram. Nenhuma requisição alcançou uma loja real.

O cartão nativo de `chrome://extensions` foi conferido em perfil Chromium temporário: nome **Yampi Code Sync**, versão 0.3.3, autoria **Zirtuno**, descrição curta e nova logo. O Chrome reserva a área da descrição e controla o espaço até o ID; a extensão não injeta estilos nessa página. Painéis de 280 e 360 pixels preservaram os textos e o link Zirtuno, sem transbordamento horizontal ou erros JavaScript. O relatório histórico permanece em `.cache/brand-033/report.json`; suas três capturas antigas foram removidas na limpeza da 0.3.4.

O pacote tem os mesmos 16 arquivos permitidos. As cinco dimensões de ícones são geradas a partir dos bytes da logo autorizada, com proporções e transparência preservadas; a imagem original e Sharp ficam somente no código de desenvolvimento. A geração usa `.cache/package/`, sem acumular ZIPs no diretório de instalações. O campo de autoria do manifesto não configura nem publica a conta da Chrome Web Store.

## Interface na 0.3.2

`npm ci`, `npm run check` e `npm run package` passaram com Node 24.15.0 e 139 testes em nove arquivos. O fluxo foi repetido no painel lateral nativo de Chromium, com orientação fora do editor, navegação explícita na mesma aba, confirmação antes da cópia, exportação sem mutações, importação de pasta/ZIP, envio fictício com backup/reload, bloqueio de conflito na restauração e reconexão. Novos casos verificam que a orientação não autoriza comandos do editor e que um fechamento atrasado não desativa o painel seguinte.

A interface foi exercitada em 280, 320, 360, 480 e 800 pixels, incluindo orientação, download, importação, comparação, confirmação de envio, recuperação e erro de leitura. Não houve transbordamento horizontal da página. A logo local e o destino/atributos do link Zirtuno foram conferidos. A tabela tem rolagem própria e pode ser percorrida por teclado, com foco visível. Entrada de seção por ponteiro usa 180 ms; ativação por teclado e movimento reduzido não usam a animação. Nenhuma operação de escrita foi executada nessa conferência visual.

O relatório histórico ignorado pelo Git permanece em `.cache/panel-design/report.json`, junto do teste de conferência `.cache/panel-design-check.mjs`. As 30 capturas antigas dessa matriz foram removidas na limpeza da 0.3.4; as evidências atuais do fluxo e da prévia foram preservadas. As verificações da prévia local descritas abaixo foram realizadas na 0.3.0 e repetidas na 0.3.4; seu runtime não foi alterado nas versões 0.3.1/0.3.2/0.3.3. Esses resultados são fictícios e não ampliam a validação real.

## Diagnóstico do incidente

Os ZIPs anteriores tinham código e baseline internamente consistentes. A comparação por SHA-256 não comprovava completude do inventário remoto ou reprodução visual. O gerador antigo não capturava configurações/seções/catálogo visual, usava dados fictícios, eliminava referências remotas e inseria CSS compilado depois das regras personalizadas. Helpers ignoravam argumentos e a leitura de imagens já em cache podia manter o estado de carregamento. Produtos e categorias de demonstração tinham destinos genéricos.

A correção fica no exportador e no runtime gerado; os arquivos exportados não são alterados para ocultar falhas do simulador. Projetos privados de lojas não foram sobrescritos nesta tarefa. Não foi copiado conteúdo de lojas para este repositório.

## Resultados da 0.3.4

- 145 testes unitários passaram, em dez arquivos. Incluem parser estático sem eval/getters, Unicode e JSON/base64, allowlist e segredos, URLs privadas, redirecionamento/streaming/limites, SVG ativo, CSS/imports/fonts, hashes, originais byte a byte, exclusão de preview, helpers, configuração local, updater, navegação da orientação, concorrência/cache/compactação e permissões/isolamento do worker. Os casos anteriores de preflight, backup, conflito, cancelamento, gravação parcial e restauração permanecem ativos.
- `npm run test:e2e` passou no painel lateral nativo, com CodeMirror antigo/atual, captura textual/PNG sem mutações, projeto portátil, importação, envio fictício/backup/reload, conflito na restauração e reconexão. A etapa visual também passa pelo painel real, autorização por origem, worker autenticado e captura estática até gerar ZIP com cinco páginas e seis registros de recursos. Respostas públicas são fornecidas exclusivamente pela fixture dentro do perfil temporário.
- `npm run test:preview` passou para duas lojas fictícias distintas, escura/clara: cinco páginas e seis registros de recursos por loja (quatro SVGs originais, folha de fontes e WOFF2 original). O alias, cores, tipografia, nomes, produtos, categorias e rotas são diferentes.
- Cada ZIP foi extraído, movido a uma segunda pasta, teve a extração original removida e executou as ferramentas do próprio ZIP com `npm ci`, `check:integrity`, `check` e `pack`. Não usa ferramentas/caches do exportador para executar a prévia. O acesso à vitrine/CDN é bloqueado no navegador local após a instalação.
- Valores computados de fundo, texto, contorno/preenchimento, peso 700, CSS personalizado e espaçamento de letras foram conferidos. Imagens têm dimensões naturais válidas, classes `-loading` somem, callbacks de imagem em cache completam, fontes e ícone estão carregados, filtros usam preços da amostra e mudança de SKU usa o preço selecionado.
- Dois destinos de produto e dois de categoria foram abertos por seus links distintos em cada loja e exibiram os títulos/dados correspondentes. Home e os demais templates configurados passaram na compilação; páginas exercitadas não tiveram erros/avisos Vue não tratados ou requisições externas.
- Quatro comparações visuais: home escura/clara, desktop 1200×900 e mobile 390×844, após fontes/imagens carregarem. Referência independente de Twig/Vue/helpers locais. Mesmo estado, página e viewport. Dimensões iguais e diferença de pixels **0%** nas quatro comparações, com tolerância de canal 8 e limite de aceitação 1%.
- O retorno contém somente `tema/`, `.yampi-sync/baseline/` e `.yampi-sync/manifest.json`; originais e textos foram comparados byte a byte. Preview, catálogo auxiliar, fontes, ferramentas, relatórios e dependências não entram no retorno.

Evidências reproduzíveis, geradas e ignoradas pelo Git: `.cache/visual-validation/report.json`, `dark-desktop-reference.png`, `dark-desktop-local.png`, equivalentes mobile e light, HTML/CSS/medidas das fixtures e capturas do painel em `.cache/panel-*-e2e.png`. O relatório registra o alcance fictício e `realStoreVisualValidation: false`.

## Arquivos envolvidos

| Área | Arquivos principais |
|---|---|
| Formato/captura visual | `src/core/preview.ts`, `src/browser/preview-capture.ts`, `src/browser/public-fetch.ts` |
| Integração/permissões | `src/browser/background.ts`, `adapter.ts`, `bridge.ts`, `src/panel.ts`, manifesto e HTML do painel |
| ZIP/gerador | `src/core/archive.ts`, `compression.ts`, `local-kit.ts`, `src/browser/zip-client.ts`, `zip-worker.ts` |
| Prévia portátil | `local-runtime/dev.mjs`, `preview.mjs`, `integrity.mjs`, `engine.mjs`, `platform.mjs`, `platform-browser.mjs`, package/lock |
| Atualização | `scripts/update-project.mjs`, `runtime-versions.json` |
| Regressões | `tests/preview.test.ts`, `performance.test.ts`, fixtures visuais, testes de worker/runtime, `scripts/preview-e2e.mjs`, `e2e.mjs`, `compression-e2e.mjs`, driver do painel |
| Distribuição/documentação | build, package/lock raiz, README, instalação, validação, roadmap e licenças |

## Reproduzir

```powershell
npm ci
npm run check
npm run test:e2e
npm run test:preview
npm run test:compression
npm run audit:performance
npm run package
```

Os testes de navegador usam Chromium instalado pelo Playwright. Portas de teste são efêmeras, sem interromper um servidor de projeto já aberto. O pacote distribuído usa allowlist e não contém a fixture, driver, mock do worker ou exports. Acorn e fflate têm licença incluída.

## Nova exportação e projetos existentes na 0.3.4

Recarregue a extensão 0.3.7 na mesma pasta instalada, feche o painel antigo e recarregue o editor sem rascunhos pendentes. Confira a loja e confirme a cópia com captura visual habilitada. Autorize somente as origens apresentadas; se negar, a extensão indica a prévia parcial/demonstrativa. Extraia em uma pasta nova e execute os quatro comandos de integridade, compilação, prévia e retorno descritos no README.

Para trocar apenas ferramentas antigas, use `node scripts/update-project.mjs "C:/projeto"` e depois `--apply`. Dry-run não escreve. Ferramentas modificadas pelo usuário e dependências diferentes são recusadas antes da gravação; scripts personalizados, dados, configuração, tema, baseline e manifesto são preservados. Backup/journal precedem a atualização, com rechecagem contra edições concorrentes. Uma atualização não inventa contexto ausente: uma nova captura separada é necessária para isso.

## Limitações e validação real na 0.3.4

Configuração declarativa do editor é priorizada quando disponível. Complementos publicados podem diferir do rascunho; o vínculo independente ao tema exato não foi comprovado. A captura visual é uma amostra limitada, não um backup de catálogo/configurações operacionais. JSON dinâmico, recursos recusados, limites e falhas constam no diagnóstico. CSS importado em ciclo é recusado explicitamente, preservando as outras regras. Unknown modules e capacidades sem backend têm erro/limitação visível.

Os testes sintéticos acima validam a implementação nos cenários descritos. Não certificam fidelidade de uma loja real, todo componente, plugin ou regra de negócio. Inventário remoto independente, redes lentas reais, imagens/formatos reais, nova exportação visual real e gravação/restauração real ainda precisam de validação específica. Não se deve classificar uma exportação real como visualmente validada com base em HTTP 200, compilação ou hashes internos.

## Histórico da versão 0.2.4

Execução local em 08/10/2026, Node.js 24.15.0, Windows. Os testes usam somente dados fictícios.

## Verificações reproduzíveis

```powershell
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
npm run package
```

Os 118 testes de unidade cobrem comparação entre original/local/remoto, hashes, limites de extração, caminhos Windows, imagens, exportação antiga, importação da pasta inteira, ZIP com pasta externa, integridade da origem, preflight, backup, cancelamento, envio parcial, isolamento de sessões e histórico por loja. Incluem reconhecimento das duas associações DOM do CodeMirror pela API da instância, documento vazio, BOM, acentos, linhas finais, documento longo, leitura inconsistente e documento alterado durante a cópia. A captura não acessa operações de gravação; falha e cancelamento não produzem uma exportação parcial como completa. Locks de leitura recusam gravações antes da injeção, e a autorização de envio expira ao terminar. A conexão inclui heartbeat autenticado, parada ao fechar, erro sem repetição de escrita, recriação do port após desconexão e proteção do lock quando um port antigo encerra. O runtime local também é verificado contra leitura de arquivos fora do tema, links, escrita HTTP e hosts externos.

Na 0.2.4 foram acrescentados casos fictícios para painel global desativado, navegação, fechamento sem liberar uma gravação em andamento, nome do editor e nomes reservados Windows, workspace portátil, entradas Sass e variável de assets, dados por página, `filter`/`map` Twig com funções de seta, escaping, aliases Vue, templates funcionais e rejeição de módulos desconhecidos e HTML com bindings inválidos.

O teste de navegador instala uma cópia temporária da extensão Manifest V3 em um perfil Chromium próprio. Toda requisição à origem do painel Yampi é interceptada e substituída pelo editor fictício; requisições externas não previstas são abortadas. A cópia temporária recebe uma permissão de host exclusiva do teste. A extensão distribuída continua usando `activeTab`, sem essa permissão adicional.

O fluxo verificado inclui documento com 2.000 linhas, nomes iguais em diretórios diferentes, PNG, projeto exportado instalado com `npm ci`, compilação Twig/Sass/Vue 2 e CSS scoped, interação Vue no navegador, slots funcionais com getter Vuex, carregamento de imagem e clique na galeria, imagem servida localmente, seleção real da pasta com dependências ignoradas, ZIP de retorno, arquivo novo bloqueado, backup persistido/baixado, gravação e conferência após reload, histórico após reabrir o painel, proteção de uma alteração posterior durante restauração, rejeição de origem adulterada e zero acionamentos de publicação.

O teste usa o painel lateral nativo (`SIDE_PANEL` real), acionado pelo mesmo handler de produção a partir de um clique em uma página auxiliar exclusiva da cópia temporária. Abrir e reabrir pelo ícone deixa zero arquivos abertos e zero downloads até clicar em **Confirmar e baixar ZIP**. A exportação usa somente comandos de contexto, inventário e leitura, sob lock de leitura. Contadores e a comparação do conteúdo persistido confirmam zero edições, salvamentos e acionamentos de exclusão, renomeação, criação e publicação durante a cópia. A leitura integral passa com CodeMirror 6.36.2 (`cmView/rootView`) e com a versão atual fixada no lockfile (`cmTile/root`). Essas bibliotecas executam somente no editor fictício; não são incluídas no pacote da extensão.

Também verifica comparação automática ao importar, confirmação do destino após revisão, persistência através do reload e ausência de nova exportação ao recarregar o painel. O editor fictício fica em um Shadow DOM aberto. Títulos diferentes e controles semelhantes fora do componente não interferem na exportação. Múltiplos componentes, Shadow DOM fechado, rascunho em aba inativa, troca de loja e substituição do componente durante a leitura são recusados. Identidade ambígua mantém o erro original visível mesmo após desconexão forçada; retry recria o port e reconecta. Uma mensagem periódica real alcança o worker durante o teste. A página auxiliar, sua permissão, controles de desconexão e o driver CDP não fazem parte do pacote distribuído.

## Estado do painel real

A análise do [módulo público do editor Yampi](https://lisa.yampi.com.br/web-component-550f3324.mjs), em 08/10/2026, confirmou o componente `yampi-code-editor`, Shadow DOM aberto, cabeçalho, árvore, CodeMirror e indicadores de carregamento/rascunho. Confirmou também a associação `cmView/rootView`, incompatível com a descoberta de instância da biblioteca mais recente antes usada pela extensão. A versão 0.2.3 encontra a instância pela associação correspondente e valida com `findFromDOM` da própria página. Somente os seletores e o comportamento observado orientaram o adaptador; o módulo da Yampi e o HTML de uma sessão real não integram o repositório nem o pacote.

O proprietário relatou que a versão 0.2.2 reconheceu o editor e abriu arquivos, mas falhou na leitura completa do CodeMirror. Em 08/10/2026, relatou a conclusão de uma exportação textual real com a versão 0.2.3 e forneceu seu ZIP. Fora deste repositório público, a análise do pacote confirmou os tamanhos e hashes entre manifesto, original e tema local. O ZIP de retorno foi aceito pelo importador da extensão com conteúdo e origem preservados. O tema e os relatórios dessa loja permanecem no projeto privado expressamente solicitado pelo proprietário.

Essa conferência não compara independentemente cada arquivo com o editor remoto nem certifica que todo inventário dinâmico foi capturado em qualquer condição de rede. O pacote recebido não permitiu validar imagens reais. Gravações, reload e restauração reais continuam sem teste; os testes de escrita acima são fictícios. A análise de JavaScript público não substitui esses testes.

Na 0.2.3 o teste de compilação da prévia com o projeto real falhou. A 0.2.4 corrige as dependências identificadas com implementações genéricas e testes fictícios. No projeto privado, as cinco páginas passaram na compilação e em Chromium: HTML 200, componentes Vue ativos, sem erros ou avisos Vue e sem requisições externas. A home e a página de produto também passaram em viewport móvel de 390×844; a galeria concluiu o carregamento e a imagem abriu e fechou sem erros. Os hashes do tema e dos originais permaneceram iguais. Esse resultado cobre as páginas configuradas e seus dados fictícios; não certifica o backend, configurações reais, recursos não presentes no ZIP ou toda interação possível da loja. Nenhum código ou dado do projeto real foi incorporado aos testes públicos.

Uma próxima validação real deve começar pela exportação e conferência do inventário. Qualquer teste real de gravação depende de instruções específicas do proprietário sobre a loja de teste e o arquivo escolhido. Nunca publique automaticamente. A prévia local é parcial e utiliza dados fictícios; não substitui a prévia final da Yampi.
