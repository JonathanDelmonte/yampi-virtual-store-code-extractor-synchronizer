# Diário

Registro datado. Novas entradas vão no fim, sem reescrever as anteriores. As evidências de cada versão ficam em [VALIDACAO.md](VALIDACAO.md); o contrato do envio, em [SPEC.md](SPEC.md).

## 15/10/2026 — Revisão do envio antes da primeira transferência real

Contexto: o proprietário vai transferir um redesign completo para a loja de um cliente. O projeto do cliente é privado e fica fora deste repositório. A revisão usou o código da extensão, o editor fictício e, somente para leitura, uma cópia do projeto exportado numa pasta temporária fora do repositório. Nenhuma loja real foi acessada.

O projeto do redesign tinha alterações em textos existentes, textos novos (Twig, Sass e componentes Vue) incluídos, importados ou montados por esses textos, e imagens novas em subpastas de `assets/images`. Antes de mudar o código, a comparação real desse projeto com a extensão 0.3.6 marcou os textos novos como `new-local` mesmo depois de criados à mão na loja, e permitia enviar os arquivos que dependem deles.

Encontrado:

- A conferência logo após salvar lia o documento do CodeMirror. A releitura da Yampi só acontecia depois do último arquivo, então uma gravação recusada pelo servidor, sem deixar a aba pendente, só seria descoberta depois de todos os envios. O README já prometia conferência após recarregar e parada no primeiro erro.
- Um arquivo novo criado à mão na Yampi continuava `new-local`, sem confirmação de conteúdo, e nada impedia enviar antes os arquivos que dependem dele.

Decisões:

- Cada arquivo é relido da Yampi, depois de recarregar o editor, antes do próximo. Custa um recarregamento a mais por arquivo.
- A extensão continua sem criar arquivos. O proprietário cria o arquivo novo vazio no editor da Yampi, e a extensão preenche o conteúdo com backup e conferência.
- Um texto novo ausente na loja bloqueia o envio inteiro. Imagem nova não bloqueia, porque não quebra a compilação e é enviada à mão.
- `AGENTS.md` continua sendo a fonte das instruções, legível por outros agentes; `CLAUDE.md` o importa e indexa as armadilhas.

Ainda sem validação real: gravação e restauração na Yampi, leitura de imagens enviadas (CORS), criação de pastas em `assets/images` e o caminho gerado por `assets_url` para essas imagens.

## 15/10/2026 — Integração do repositório ZIRTUNO no repositório original

Os quatro commits de `ZIRTUNO/zirtuno-sync-yampi`, de `9fbf728` até `9654001`, foram incorporados com o histórico original. A branch alternativa `claude/yampi-redesign-transfer-tool-43cde9` tem a mesma árvore de arquivos da principal. O trabalho local da 0.4.0 foi preservado antes da integração e combinado com o nome Zirtuno Sync Yampi, a conferência por arquivo após reload e o preenchimento de textos criados vazios à mão. O remoto principal continua sendo `JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer`; links de instalação e página da extensão apontam para ele.

As proteções da 0.4.0 continuam valendo: dependências ausentes bloqueiam quem as usa; textos dependentes precisam ser selecionados juntos, inclusive os novos criados vazios; conflitos e troca de loja interrompem o envio. Imagens ausentes não bloqueiam textos independentes, mas bloqueiam quem as referencia. Os testes de integração usam somente dados fictícios. Nenhuma loja real foi acessada.

## 15/10/2026 — Envio automático (0.5.0)

Pedido do proprietário: a transferência precisa ser simples e quase toda automática, sem o usuário criar arquivos, pastas ou imagens à mão. Na 0.4.0, o envio real de um redesign mostrava 18 textos para criar à mão, imagens para enviar à mão e 15 arquivos bloqueados por dependência.

O módulo público do editor da Yampi foi lido, como dado e sem executá-lo, para conhecer os controles reais. **Adicionar arquivo**, em cada pasta, cria SCSS, Vue, Twig ou JS numa pasta existente, com nome só de letras, números, `_` e `-`; um `.vue` nasce com o componente padrão da Yampi. Na pasta `assets/images`, o mesmo botão abre o envio de imagens, que salva sempre em `assets/images/<nome>`, em minúsculas. Não existe criação de pastas nem substituição de imagem. Tudo vai para o rascunho (`preview=true`).

Decisões:

- A extensão cria textos e envia imagens pelos mesmos controles que uma pessoa usaria. Ela nunca chama a API da Yampi diretamente, e a Yampi continua validando nomes, tipos e duplicatas.
- Imagens novas fora de `assets/images` ganham um caminho lá. Referências literais são reescritas de forma determinística no que vai para a loja, e o projeto local não muda. Caminho montado em tempo de execução bloqueia o arquivo, com o motivo.
- Conflito pode ser resolvido arquivo a arquivo com **Usar a versão do projeto**, depois de ver as versões; a da loja fica no backup.
- `components.twig` nunca é enviado: a Yampi o regenera ao criar um componente, e enviá-lo concorreria com isso.
- A confirmação deixa de pedir o nome digitado. A identidade da loja continua conferida pela extensão em cada etapa, e o envio pede um clique de confirmação com o nome à vista.
- O editor fictício passa a reproduzir a marcação real (árvore com `.add-item`, `DsModal`, `DsSelect`, `DsInput`, envio de imagens) para que os testes exercitem o mesmo caminho.

Ainda sem validação real: os controles de criação e envio nunca foram acionados numa loja real, a URL gerada por `assets_url` em `assets/images` não foi conferida, e a leitura das imagens enviadas depende de o editor mostrá-las por data URL, como o módulo indica.

## 16/10/2026 — Primeiro envio real e correção 0.5.1

O proprietário iniciou o envio de um redesign numa loja real com a 0.5.0. A loja tinha mudado depois da exportação: três textos alterados no editor e um quarto que o projeto não tocava. As mudanças da loja foram levadas ao projeto do cliente antes do envio; os três conflitos passaram a mostrar a versão do projeto já com elas.

O que funcionou na loja real:

- **Adicionar arquivo** criou os 18 textos novos (Twig, Vue e SCSS) em pastas existentes. Cada um foi relido depois de recarregar, com o conteúdo inicial da Yampi (vazio ou o componente padrão).
- O envio de imagens gravou a primeira imagem em `assets/images`. O editor a mostra como `data:image/jpeg;base64,…`, com os mesmos bytes do arquivo do projeto.
- O backup foi baixado antes da primeira gravação, e o registro do envio parcial ficou no histórico com `pending` e `error`.

O que falhou: a conferência da imagem. `readImage` passava o endereço `data:` por `fetch()`, e a política de segurança (CSP) da página do editor bloqueia essa chamada. O envio parou com **Failed to fetch**, como previsto pela regra de parar no primeiro erro, antes de gravar qualquer texto alterado.

Correção na 0.5.1: endereços `data:` são decodificados diretamente (`dataUrlBytes`), sem rede. Endereços `https:` continuam baixados como antes. O editor fictício ganhou `connect-src 'self'`; sem a correção, o teste de ponta a ponta falha com a mesma mensagem da loja real.

Retomada: uma nova comparação reconhece a imagem já enviada como igual e os 18 textos criados como arquivos a preencher.

Pendente para uma próxima versão: quando um texto depende de um arquivo que só a loja mudou, o painel o mostra como bloqueado, mas não explica que esse arquivo mudou na loja nem como trazê-lo para o projeto.

## 16/10/2026 — Operações em segundo plano e painel por etapas (0.6.0)

Pedido do proprietário depois do primeiro envio real: progresso claro de cada operação, mais velocidade e confiabilidade, continuar com o painel fechado ou em outra aba sem recomeçar, mais automação e uma identidade visual própria, sem aparência genérica.

O que o envio real mostrou: o painel lateral pertence à aba e é destruído quando o usuário troca de aba, levando a operação junto; o editor era recarregado duas vezes por arquivo; e o painel não dizia quanto faltava.

Decisões:

- Baixar, comparar e enviar rodam num documento offscreen da extensão. O worker mantém o bloqueio da aba e guarda o estado em `storage.session`; o painel só mostra esse estado, e reabrir o painel não reinicia nada. O documento só fala com o worker, que confere a operação, a aba e o endereço do editor em cada comando.
- Menos recargas com a mesma conferência: nenhuma recarga antes de salvar quando o editor acabou de mostrar a versão do servidor; criações e imagens conferidas em grupo depois de uma recarga; cada texto continua salvo, recarregado e relido antes do próximo.
- Um envio interrompido continua do item em que parou. O registro ganhou `issued` (feito, ainda não conferido), `resumedAt` e `scope`, e o plano confirmado fica guardado com o registro.
- A comparação lê na loja só o que o projeto mudou e os textos que esses arquivos usam. O resto é listado e tratado como igual à exportação, porque nunca é enviado.
- Projeto, comparação e escolhas ficam guardados por loja. A referência avança depois de cada envio, para que o que foi enviado não volte como conflito.
- Painel: a primeira proposta visual (vidro em todo o painel, gradientes e brilhos) foi recusada por parecer genérica; a segunda, por excesso de texto e falta de hierarquia. A versão final mostra um passo por tela, com título de estado, uma ação principal na barra de baixo, vidro só nas barras e um único destaque de cor ([INTERFACE.md](INTERFACE.md)).

Encontrado na revisão final, antes de qualquer uso real, e corrigido com testes:

- Um backup que falhava também deixava o registro como `stopped`, e **Continuar de onde parou** pularia o backup. Agora a decisão de continuar ou recomeçar vem do que o registro mostra feito: sem nenhuma alteração, o envio recomeça com nova conferência e novo backup.
- A comparação parcial não lia um texto incluído que só a loja mudou, e o arquivo que o usa deixava de ser bloqueado como na comparação completa. Agora os textos usados pelos arquivos alterados também são lidos.

Ainda sem validação real: tudo o que a 0.6.0 acrescentou. Continua pendente o item de 16/10: explicar no painel que a dependência bloqueada mudou na loja e como trazê-la para o projeto.

## 17/10/2026 — Bloqueio por arquivo que mudou só na loja

Resolve o pendente de 16/10. Um arquivo alterado no projeto que usa outro alterado só na loja continua bloqueado: enviá-lo sozinho combinaria a versão nova com uma versão da loja que o projeto nunca testou. O que faltava era explicar.

- O painel diz, numa linha, qual arquivo usado mudou e onde: só na loja ("mudou na loja depois da sua cópia") ou nos dois ("mudou na loja e no projeto"). **Ver a mudança** abre a comparação Original → Loja; num conflito, **Comparar e escolher**.
- Na comparação de um arquivo que mudou só na loja, **Copiar a versão da loja** põe o texto na área de transferência e diz onde colar no projeto. Escrever direto na pasta do projeto seria a primeira gravação da extensão fora da loja e exigiria permissão de escrita na pasta; ficou para uma decisão do proprietário.
- **Comparar de novo** relê a pasta lembrada antes de comparar, para que o arquivo colado conte. Sem acesso à pasta, compara a leitura anterior e avisa.
- A demonstração fictícia passou a alterar também `templates/home.twig`, que usa `components/Example.vue`: alterar esse componente na loja fictícia mostra o caso.

Conferido no Chromium com a demonstração: a linha, a comparação aberta em Original → Loja, o botão de cópia e o texto copiado. A releitura da pasta lembrada depende do seletor de pastas do Chrome e não roda nos testes automáticos.

## 17/10/2026 — Versão da loja gravada na pasta do projeto

Decisão do proprietário: além de copiar, o painel pode gravar a versão da loja direto no arquivo do projeto, pedindo ao Chrome a permissão de escrita na pasta, e comparar de novo. A cópia continua como alternativa.

Proteções: só por clique, num arquivo que mudou só na loja; só troca um arquivo de `tema/` que já existe e que continua como na comparação; nada é criado; quebras de linha e marca de ordem de bytes do arquivo ficam como estavam. A localização do projeto dentro da pasta escolhida passou a ser a mesma na leitura e na escrita.

A demonstração passou a guardar em memória a pasta escolhida, como a extensão faz no IndexedDB; antes, ela a esquecia a cada comparação.

## 18/10/2026 — Abas, orientações e ações junto do conteúdo

Pedido do proprietário depois de instalar a 0.6.0: manter suas cores e botões, recuperar as abas e o estado de conexão explícito da interface anterior, tirar a ação fixa do rodapé, melhorar a escolha do ZIP e tornar as orientações e os backups visíveis de novo.

O painel abre em **Baixar tema** e mantém **Enviar alterações** ao lado. As abas preservam o projeto e a comparação, com navegação por teclado. Cada etapa recebe seus próprios botões no fluxo da página. A escolha do ZIP informa o arquivo lido e explica `npm run pack`. A ajuda explica o download, a edição, o conteúdo da pasta e a confirmação do envio. **Backups e recuperação** reúne o histórico e as ações na página; o menu do topo leva até ela. Etapas e registro do progresso começam abertos.

A cópia do tema continua em ZIP: exportar diretamente para uma pasta não foi implementado. A execução em segundo plano, a retomada e as proteções do envio da 0.6.0 foram preservadas. Testes e capturas usam somente a demonstração e o editor fictício; nenhuma loja real foi acessada. O trabalho local anterior à integração foi mantido separado, e esta revisão parte do merge `0806888`.

## 18/10/2026 — Menu e seletor do histórico

A pedido do proprietário, a assinatura e as informações da ferramenta saíram do rodapé e ficam apenas no menu **⋯**. Os controles de recuperação são compartilhados entre esse menu e a seção da página; fechar o menu mantém o envio escolhido. O seletor nativo foi substituído por uma lista estilizada com datas, estados e teclado, sem abrir uma lista vazia quando ainda não há envios. O teste conferiu o backup do registro escolhido e o isolamento entre históricos de lojas fictícias, além do fluxo de restauração no editor fictício.

## 18/10/2026 — Recuperação somente no menu

A pedido do proprietário, o bloco **Backups e recuperação** saiu das duas abas. Histórico, download de backups e restauração continuam disponíveis somente no menu **⋯**, sem mover os controles ao abrir ou fechar. A seleção do envio é preservada ao reabrir o menu. As orientações e os testes foram ajustados para esse acesso.

## 18/10/2026 — ZIP como ação e cabeçalho da loja

O proprietário aprovou a proposta **Importar por ZIP**, com bloco próprio e botão direto, e pediu a atualização da pasta instalada. O ZIP deixa de ser um acordeão igual aos tutoriais. No cabeçalho, um ícone de conexão substitui o ponto e fica separado do texto por 12 px. Nome e estado ocupam uma linha; quando não cabem, o fim do texto fica transparente antes das reticências, e o tooltip mantém o conteúdo completo. A medição acompanha texto, carregamento das fontes e largura do painel. Os testes visuais usam nomes e estados fictícios, incluindo nomes sem espaços e redimensionamento.

## 18/10/2026 — Download direto do servidor e barra que só avança (0.7.0)

Pedido do proprietário ao baixar um tema real de 264 arquivos: a barra saltou para 18% e voltou a zero, e a leitura levava cerca de 0,8 s por arquivo (uns 3 minutos e meio). Perguntou se havia um método mais rápido e profissional.

O salto vinha dos pesos: listar valia 2 de 11 unidades enquanto o número de arquivos era desconhecido, e a leitura somava 264 logo depois. A lentidão vinha de abrir cada arquivo na tela e esperar 320 ms de estabilidade. A Yampi não tem API pública de temas, mas o módulo público do editor mostra que ele abre um arquivo com um `GET` ao próprio servidor, autenticado só pelos cookies, e indexa o tema inteiro em lotes de 10. A 0.7.0 usa o mesmo pedido a partir da página do editor, confere uma amostra de cada tipo com o CodeMirror e a loja da sessão a cada lote, e recua para a leitura pelo editor em qualquer dúvida.

Ainda sem validação real. No primeiro download, conferir nas etapas a mensagem da leitura direta e comparar os hashes do manifesto com uma cópia lida pelo editor.

## 19/10/2026 — Atualizar da loja, versões na pasta e imagens opcionais (0.8.0)

Pedido do proprietário: o cliente muda a loja na Yampi (remove um bloco, troca imagens), e importar de novo a pasta antiga desfaria esse trabalho. Ele quer atualizar a pasta com o que está na loja antes de mexer, guardar versões antigas no computador para voltar atrás ("traga aquele banner de volta") e não enviar imagens por padrão, com uma opção avisada para enviar. Versões não precisam guardar imagens.

Encontrado:

- A 0.6.0 já avançava a referência depois de cada envio, mas só no IndexedDB deste navegador. A pasta continuava com a exportação: limpar os dados da extensão, ou usar a pasta em outro computador, voltava à referência antiga, e uma reversão feita pelo cliente depois de um envio parecia mudança do projeto.
- A comparação era por arquivo inteiro: cliente e desenvolvedor mexendo em trechos diferentes do mesmo arquivo davam conflito, e trazer a loja para a pasta era um arquivo por vez (**Usar no projeto**).
- Desde a 0.5.0, imagens novas iam por padrão.

Decisões:

- **Atualizar da loja**: leitura completa em segundo plano, junção linha a linha como no Git, revisão antes de gravar e versões antes de mudar a pasta. Conflito vira marcações no arquivo (o VS Code oferece aceitar uma ou outra versão), e nada com marcações é enviado. Nenhum padrão desfaz uma mudança da loja.
- A referência é reescrita na própria pasta, com uma marcação gravada antes, para que uma gravação interrompida deixe a pasta legível.
- Versões em `.yampi-sync/versoes/`, só textos, cada um guardado uma vez pelo hash. Integração com o GitHub ficou de fora: o histórico local cobre o pedido, e o README do projeto já explica como versioná-lo num repositório privado.
- Imagens novas só vão com **Enviar imagens novas**, ligado depois de um aviso; a opção volta a desligar a cada comparação.
- A extensão passa a gravar na pasta do projeto além do arquivo de **Usar no projeto** (atualização, versões, referência), sempre com a permissão do Chrome dada num clique e só em `tema/` e nos seus registros de `.yampi-sync/`.
- Telas com layout funcional; o acabamento visual fica para uma próxima etapa, a pedido do proprietário.

Ainda sem validação real: a escrita numa pasta real pelo painel lateral e a atualização numa loja real.

## 19/10/2026 — "Acesso restrito" ao recarregar o editor e falsos conflitos (0.8.1)

No primeiro uso real da 0.8.0, na loja Kabban, escolher a pasta e **Atualizar da loja** levaram a aba à página "Acesso restrito" da Yampi; abrindo o editor pelo menu, ele funcionava, e a operação seguia. A extensão recarregava a aba (`chrome.tabs.reload` do endereço do editor) antes de comparar e a cada arquivo enviado. A leitura direta pelo servidor da Yampi funcionou na mesma loja ("conferida com o editor em 5 tipos de arquivo").

Decisão: com o servidor respondendo pela mesma loja, comparação, preflight e todas as conferências do envio leem pelo servidor, sem recarregar; a gravação continua pelo editor, que confere o conteúdo esperado antes de salvar. Sem o servidor, recarrega como antes, mas uma página "Acesso restrito" interrompe na hora, com o motivo.

A mesma atualização mostrou 9 arquivos "mudados dos dois lados". A referência da pasta era o download de 08/10, anterior aos envios feitos pela extensão; um arquivo enviado e depois editado parecia conflito. A atualização passa a usar os registros de envio desta instalação: um texto da loja igual ao que a extensão enviou é mudança do próprio projeto.

Ainda sem validação real: a gravação conferida pelo servidor.

## 19/10/2026 — Referência atrasada: versões conhecidas, recibo, trechos e junção (0.9.0)

Pedido do proprietário, a partir de um uso real da 0.8.0 num projeto com duas pessoas e Git. A pasta tinha a referência do download de D0, num manifesto versão 2. O redesign foi enviado em D7 a partir de um ZIP, em outra instalação, e depois vieram outras edições. A atualização mostrou 9 conflitos:
- 5 em arquivos criados pelo projeto, sem referência;
- 4 em arquivos com trabalho não commitado.

A comparação de uma exportação nova com o Git mostrou 3 versões antigas do projeto, 4 diferenças só nos caminhos de imagem reescritos pelo envio, 2 mudanças reais de terceiros e o `components.twig` regenerado.

Decisões:

- A extensão não lê o Git. O projeto gera `.yampi-sync/versoes-conhecidas.json` (`npm run versoes:conhecidas`), e os envios deixam recibos para guardar no projeto. Um texto da loja igual a uma versão conhecida é mudança nossa; diferente de todas, a base da junção é a versão conhecida mais próxima, e o conflito mostra só a mudança do terceiro. Sem versão conhecida, a extensão não afirma de quem é a mudança.
- Decisão por trecho, com identidade pelo conteúdo, e junção de um arquivo só na revisão do envio, gravada na pasta antes de enviar. Assim, a comparação seguinte não reenvia a versão antiga da pasta.
- O manifesto mantém a versão que a pasta tinha.
- A comparação sem recarregar lê todos os textos pelo servidor. O e2e da restauração mostrou que a 0.8.1 lia pela aba um texto antigo quando havia poucos arquivos.

Ainda sem validação real.

## 19/10/2026 — Download com a vitrine: uma autorização, sem recomeçar (0.9.1)

Relato do proprietário: o download pedia autorização para imagens e fontes, recapturava tudo, pedia de novo, e a barra mostrava 100% antes do fim.

Causas:
- o clique só pedia a origem da vitrine;
- cada rodada perguntava até pelas origens que o Chrome já permitia;
- cada rodada reportava a contagem da etapa desde o início;
- o reancoramento da barra deixava ela chegar a 100% com etapas pendentes.

Decisões:
- o clique pede também as origens comuns de imagens e fontes da Yampi;
- as origens já permitidas entram sem pergunta;
- a contagem da etapa é monotônica;
- a barra para em 99% enquanto há trabalho.

## 29/10/2026 — Páginas da loja e dos produtos na prévia (0.10.0)

Pedido do proprietário, em dois textos de 26 e 27/10/2026 escritos a partir da prévia de uma loja real:
- a exportação deve trazer sozinha as páginas da loja que as páginas capturadas e o tema linkam (categorias, subcategorias, vitrines `/l`, buscas, páginas de atendimento, promoções) e a página de cada produto, para que menu, rodapé, "Ver tudo", produtos e voltar abram na prévia local;
- o envio deve avisar quando o tema linka uma rota que não existe na loja.

Na exportação real de referência (20/10/2026), a prévia tinha 7 páginas, e a home linkava mais de cem produtos. O proprietário já fazia isso fora da extensão, com scripts locais do projeto da loja. Eles foram lidos só como referência de comportamento; nada do projeto da loja veio para este repositório, e os testes usam a loja fictícia.

Decisões:
- Duas etapas depois do recorte, nesta ordem: páginas da loja (até 4 rodadas), páginas dos produtos e uma rodada final com as categorias que só um produto linka. Orçamento próprio (200 e 400 páginas), à parte do recorte e dos recursos.
- Da página ao vivo entram os três objetos públicos, não só `window.data` como nos scripts de referência. `themeConfig` e `merchant` repetidos são guardados uma vez pelo hash, em `raw/shared/` (formato 3 da prévia). O motivo está em [SPEC.md](SPEC.md), "Formato 3".
- Sem fotos novas: o orçamento de recursos continua com CSS, fontes e banners.
- 404 vira `link-broken`, com o lugar do link. A comparação usa o mesmo critério para os links dos textos que vão no envio; é aviso, não bloqueio.
- 429 e 503 fazem todas as leituras esperarem juntas. O download público passou a `redirect: 'manual'`, que também não segue o redirecionamento, mas o distingue de uma falha de rede.
- A extensão continua sem gravar em `preview/`. A prévia nova depois de **Atualizar a pasta** vem num ZIP, e uma ferramenta do projeto (`npm run previa:trocar`) faz a troca.
- `scripts/runtime-versions.json` não tinha os hashes das ferramentas da 0.9.1: `update-project.mjs` recusaria esses projetos ao trocar `preview.mjs`. Agora registra todas as versões das ferramentas no Git.

Não feito: os scripts de referência também gravavam, para cada produto, uma leitura `catalog/products/<slug>` montada com a página. Não foi reproduzido, porque seria uma resposta da API inventada a partir de outra fonte. As seções que pedem um produto pelo slug continuam com as leituras planejadas pela captura.

Ainda sem validação real: nenhuma loja real foi acessada. O formato das páginas de busca, promoção e vitrine `/l` segue o descrito pelo proprietário e foi reproduzido na loja fictícia.

## 02/11/2026 — Barra parada em 99%, download lento e aba em segundo plano (0.10.1)

Relato do proprietário ao baixar uma loja real com a vitrine: a barra mostrava 99% com **Páginas dos produtos: 47 de 271**, **Preparar o ZIP** e **Baixar o ZIP** ainda pela frente, e o download demorava muito. Pediu também a garantia de que a extensão continue funcionando ao trocar de aba ou de janela.

Causas:
- As etapas que só descobrem o tamanho ao começar (páginas da loja, páginas dos produtos, recursos) não tinham espaço na barra. Ela enchia com o tema, parava em 99% (regra da 0.9.1) e, quando as páginas apareciam, o reancoramento dava a elas só o espaço entre 99% e 100%.
- Os pesos eram de antes da leitura direta: 264 arquivos lidos em segundos valiam mais que 271 páginas de produto.
- Cada leitura pública pedia duas conferências da loja à aba do editor, uma antes e outra depois do GET: mais de mil execuções de script na aba num download grande, mais lentas com a aba em segundo plano.
- 4 leituras de cada vez, e cada página de produto guardava o documento HTML analisado até o fim da rodada.
- O worker descartava `previewOnly` e `links` do pedido: **Baixar a prévia nova** lia o tema inteiro de novo, e a comparação não conferia os links.

Decisões:
- Tamanho esperado por etapa (`expect`), pesos em segundos por item e troca de peso quando a leitura passa a ser direta. A barra continua sem voltar e sem 100% antes do fim.
- **Capturar a vitrine** passa a contar as páginas de amostra; as leituras públicas entram na contagem de **Baixar estilos, fontes e imagens**.
- Conferência da loja dividida entre as leituras: a de antes vale por 1 s, a de depois começa sempre depois do GET.
- 6 leituras de cada vez nas páginas e nos recursos, sem guardar o documento analisado.
- Trava (Web Lock) na página do editor durante a operação, para o Chrome não congelar a aba.
- `validRequest` passa a conferir e repassar `previewOnly` e `links`.

Não feito: a leitura pelo editor (arquivos JSON, amostras, envio) continua mais lenta com a aba oculta, porque o navegador desacelera os temporizadores da página e a espera de estabilidade depende deles. Mudar essa espera mexeria na integridade da cópia sem validação no editor real.

Ainda sem validação real: o tempo numa loja real, o efeito da trava no congelamento de abas em cada configuração do Chrome (economia de energia, memória) e a conferência dos links numa loja real.

## 10/11/2026 — Pasta com o tema em theme/ recusada (0.10.2)

Relato do proprietário: ao escolher a pasta do projeto de uma loja real em **Importar projeto**, o painel dizia "Não encontrei um projeto exportado nesta pasta".

Causas, reproduzidas com o código da extensão sobre a pasta real, só com leitura:
- O projeto tinha começado de uma cópia da loja anterior à extensão: o tema fica em `theme/`, sem `.yampi-sync/`. A extensão procurava o tema só na própria pasta e em `tema/`, e projetos exportados só um nível abaixo.
- Escolhendo `theme/` direto, a leitura parava com "The encoded data was not valid for encoding utf-8": um modelo 3D (`.glb`) do tema era lido como texto.

Decisões:
- `theme/` vale como `tema/` para o tema solto. Com os dois na mesma pasta, a extensão recusa em vez de escolher.
- Binários que não são imagens PNG, JPEG, WebP ou SVG ficam de fora com um aviso que os nomeia (a Yampi não os guarda; um acima de 2 MiB nem é lido). Arquivos do sistema, sem aviso. Um texto do tema que não é UTF-8 continua parando a leitura, agora com o nome do arquivo: deixá-lo de fora enviaria o resto sem ele.
- Sem o original da loja guardado na extensão, a mensagem diz para usar **Baixar arquivos** antes.
- `AGENTS.md` não mudou: a escrita num tema solto (só **Usar no projeto**, num arquivo que já existe) já acontecia na pasta do tema lida.

Não feito: o seletor de arquivos alternativo (sem a API de pastas) continua exigindo a pasta do tema, e o ZIP de retorno continua recusando arquivos acima de 2 MiB.

Ainda sem validação real: a leitura no painel do Chrome e a comparação dessa pasta com a loja; nada foi enviado.

## 10/11/2026 — Tema solto sem download prévio (0.10.3)

Relato do proprietário, com a 0.10.2 instalada: a pasta foi reconhecida, mas o painel parou com "a extensão ainda não guardou o original desta loja. Em Baixar arquivos…". Pediu que a extensão fosse compatível com qualquer projeto, sem exigir arquivos dela na pasta nem um passo antes de importar.

Causa: um tema solto só era comparado se já houvesse um original guardado na extensão, e só um download o guardava.

Decisões:
- A primeira comparação de um tema solto sem original lê a loja inteira e guarda essa leitura como original (`adopt` no pedido, conferido por `validRequest`). É o mesmo original que um download guardaria, sem ZIP e sem escrever na pasta. Um original guardado no meio tempo vale mais.
- **Atualizar da loja**, **Juntar com a loja** e **Versões** ficam desligados num tema solto, com a explicação no painel, em vez de falhar no clique: eles guardam registros em `.yampi-sync/`.
- A ordem continua comparação, backup e confirmação antes de gravar. Sem o original do projeto, a revisão de cada arquivo é a única defesa contra desfazer mudanças da loja feitas depois da cópia de onde o projeto partiu; o painel avisa isso ao terminar a leitura.

Não feito: ler o original no histórico Git do projeto. A extensão não lê o Git; `npm run versoes:conhecidas` existe só nos projetos exportados.

Ainda sem validação real: a importação no painel do Chrome e qualquer envio para uma loja real.

## 10/11/2026 — Envio bloqueado num redesign e avisos (0.10.4)

Relato do proprietário, com a 0.10.3: o envio do projeto real continuava bloqueado sem que ficasse claro o motivo, o modelo 3D aparecia como deixado de fora, e os avisos flutuantes pediam um visual melhor.

Causa do bloqueio, reproduzida com o planejador da extensão sobre a pasta real e a primeira versão do tema no Git (só leitura): 41 textos novos que a Yampi não deixa criar (32 em 6 pastas novas, 9 `.js`), 9 textos com `assets_url` sem `/assets/`, 2 com caminhos de imagem montados que a extensão não ajusta, e os arquivos que dependem deles. Um texto novo impossível de criar bloqueia o envio inteiro desde 15/10, e a revisão listava uma linha por arquivo.

Decisões:
- A regra continua. A revisão passa a agrupar os bloqueios por motivo, com a contagem por pasta, e o título diz quantos arquivos novos o envio espera.
- Avisos flutuantes com tom, marca, título e **Fechar**; os de atenção ficam 12 s e esperam enquanto lidos. O que a leitura deixou de fora fica também na revisão.
- O modelo 3D continua fora: o editor guarda só textos e imagens PNG, JPEG, WebP ou SVG em `assets/images`. A orientação ao proprietário é hospedá-lo fora da Yampi, com CORS, e apontar o tema para esse endereço.

Não feito: mover sozinho os arquivos de pastas novas para pastas existentes. Exigiria reescrever includes, imports e o nome com que a Yampi registra cada componente (gerado em `elements/scripts/components.twig`), sem validação numa loja real. A correção de `assets_url` também continua sem conserto silencioso, como decidido na 0.10.1.

Ainda sem validação real: o painel do Chrome com os avisos novos e qualquer envio para uma loja real.

## 10/11/2026 — Envio real parado na primeira criação (0.10.5)

Relato do proprietário: o envio do redesign de uma loja real (185 itens: 100 textos novos, 42 imagens, 43 textos alterados) parou em 0 de 185 com "O editor não confirmou a operação dentro do prazo". A primeira etapa cria os textos novos pela janela **Adicionar arquivo**; o primeiro seria um `.scss` numa subpasta de `assets/styles`.

Encontrado, relendo como dado o módulo público do editor (o mesmo de 01/10/2026, ainda publicado): a janela cria com `POST /merchant/file/storage/create?preview=true`; ao dar certo, fecha, recarrega a árvore e abre o arquivo. Uma recusa do servidor que não seja 409 só vai para o console, e a janela fica aberta, sem mensagem. A ponte esperava a janela fechar e o arquivo aparecer por 20 s, e então dava um erro genérico. As outras esperas (janela abrir, opção de extensão, botão liberar) também davam o mesmo erro.

Decisões:
- A ponte acompanha o botão de confirmar (classe `sending` e `.button__loader`, do `DsButton`) e para logo quando o pedido termina com a janela aberta, fechando-a pelo **Cancelar**.
- Toda espera do editor tem nome na mensagem de prazo esgotado.
- O editor fictício reproduz o botão em andamento e a recusa silenciosa (`fixture-refuse-create`).

Não feito: descobrir o motivo da recusa na loja real. Só a resposta do servidor (no console ou na rede da aba do editor) mostra o status; o próximo envio com a 0.10.5 vai dizer em qual passo e arquivo parou. Criar pelo servidor, sem a janela, daria o status, mas mudaria a forma de gravação autorizada (pelos controles do editor) e precisa de decisão do proprietário.

Ainda sem validação real: qualquer criação na loja real com a 0.10.5.

## 11/11/2026 — O editor da Yampi mudou a criação de arquivos (0.10.6)

Relato do proprietário, com a 0.10.5: o envio real parou de novo no primeiro texto novo, agora com o passo nomeado: "esperava a janela "Adicionar arquivo" abrir na pasta assets/styles/elements/cart (o botão + não abriu nenhuma janela)".

Encontrado, só com arquivos públicos lidos como dado:
- A página do editor é do painel da Yampi, publicado em 10/11/2026. Ele lê `https://lisa.yampi.com.br/manifest.json` e carrega a entrada `src/web-component.ts`: `code-editor-9121cad2.js`, que importa `web-component-030ca37f.js` (manifesto de 05/11/2026). A extensão foi feita sobre `web-component-550f3324.mjs` (01/10/2026), e a última criação real conferida foi em 16/10.
- No módulo novo, o "+" de uma pasta comum põe uma linha na árvore (`NewFileInput`/`FileNameInput`): um campo para o nome com a extensão, Enter confirma, Esc ou perder o foco cancela, `sending` durante o pedido, e qualquer recusa aparece abaixo do campo. Só `assets/images` continua abrindo a janela de envio de imagens. A aba marca alterações com `button.close-button.has-changes`. O componente padrão de um `.vue` novo não mudou.
- Durante o pedido, a linha mostra o nome num `.file-name`, a mesma classe dos arquivos da árvore: sem cuidado, a extensão o contaria como arquivo criado antes da Yampi criar.

Decisões:
- A ponte segue o que o "+" abrir: a linha (nome e Enter no mesmo instante, Esc ao parar) ou a janela de antes. A leitura da árvore ignora a linha em edição.
- O editor fictício passa a reproduzir a linha e a aba novas; a janela fica com `fixture-creation=janela`, e `test:bare` cobre os dois.
- `CLAUDE.md` registra onde ver qual módulo o editor carrega.

Ainda sem validação real: o primeiro envio com a 0.10.6 numa loja real. As gravações de textos existentes usam os mesmos controles de antes (**Salvar arquivo**, abas e CodeMirror), que o módulo novo mantém.

## 13/11/2026 — Recusa da Yampi ao salvar (0.10.7)

Relato do proprietário, com duas capturas de tela de um envio real de 19 itens: o editor mostrou, num bloco vermelho acima das abas, "Erro ao incluir o arquivo ', priority: '. O arquivo não foi encontrado.", com `elements/scripts/navigation.twig` ainda marcado como alterado; o painel, na 0.10.6, parou em 2 de 19 itens com "O editor não confirmou a operação dentro do prazo: esperava a Yampi confirmar o salvamento de elements/scripts/navigation.twig." Pediu que os dois erros fossem corrigidos.

Causas:
- O servidor da Yampi lê, num `.twig` salvo, a palavra `include` seguida de aspas como inclusão do arquivo nomeado até as próximas aspas, sem olhar se está num `<script>`. O texto tinha, pelo que a mensagem mostra, `credentials: 'include', priority: '…'` (um `fetch` com prioridade): a Yampi procurou o arquivo `, priority: ` e recusou o salvamento (HTTP 406). O texto do tema não está neste repositório; a forma exata foi deduzida da mensagem.
- O módulo público do editor carregado hoje (`code-editor-9121cad2.js`, que só importa o `web-component-030ca37f.js` do editor de 05/11/2026) e o anterior (`550f3324`), lidos como dado em 13/11/2026, sem executá-los e sem trazê-los ao repositório, mostram a mesma resposta: num 406, a mensagem do servidor vai para `main .has-error > .bg-red-pure`; em qualquer recusa, o botão volta ligado e o arquivo continua alterado. A ponte só esperava o botão desligar, até 20 s (60 s com a aba oculta); a 0.10.6 já dizia o que faltava, mas não o motivo.

Decisões:
- A ponte reconhece o bloco e para na hora, com a mensagem e a linha do trecho. Uma recusa sem mensagem para quando o envio do botão termina com ele ligado, depois de 1 s estável: no editor real, o sucesso desliga o botão na mesma atualização que encerra o envio.
- Um bloco anterior é fechado pelo próprio ícone antes de salvar. Sem isso, a mesma recusa de novo, ou uma recusa sem mensagem com o bloco antigo na tela, seriam iguais na página. O ícone só esconde o aviso; nada da loja muda.
- A comparação barra o texto antes do envio (`saveIssues`), para o envio não parar no meio. Só a mesma linha e só nomes que nenhum arquivo pode ter: é o que a recusa real mostra. Ler entre linhas barraria `credentials: 'include'` seguido de quebra de linha, comum em JavaScript, sem prova de que a Yampi recuse; se recusar, a ponte mostra a mensagem dela.
- A regra é separada de `productionIssues`, que a gravação também aplica aos arquivos incluídos pelo texto: um arquivo da loja só incluído não é salvo de novo e não pode bloquear quem o inclui.
- A alteração recusada não é desfeita na aba. Restaurar o texto antigo deixaria a aba marcada como alterada do mesmo jeito (o editor marca qualquer mudança), e fechar a aba sem salvar passa pela janela **Alterações não salvas**, com o botão de descartar, que a extensão não aciona.
- `dependencies.mjs` e `pack.mjs` mudaram: os hashes anteriores (iguais da 0.10.1 à 0.10.6) entraram em `scripts/runtime-versions.json`.

Ainda sem validação real: a ponte nova não salvou numa loja real, e a regra da Yampi entre linhas, em `.vue` e para nomes de caminho inexistentes não foi observada.
