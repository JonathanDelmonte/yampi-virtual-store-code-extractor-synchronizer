# Zirtuno Sync Yampi

Extensão independente para copiar o código do editor Yampi, trabalhar no computador e devolver os textos escolhidos com comparação e backup. O repositório público contém somente a ferramenta e exemplos fictícios; projetos e dados de lojas ficam fora dele.

**[Baixar extensão para Chrome — versão atual](https://github.com/JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer/releases/latest/download/zirtuno-sync-yampi.zip)** · [Ver release e SHA-256](https://github.com/JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer/releases/latest) · [Como instalar](docs/INSTALACAO.md)

Extraia o ZIP em uma pasta fixa. Abra `chrome://extensions`, ative **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione a pasta que contém `manifest.json`. O download **Source code** do GitHub não é a extensão pronta. Se ela já estiver instalada, atualize os arquivos na mesma pasta e clique em **Recarregar** no cartão.

## Versão 0.10.0

A prévia local passa a abrir as páginas que a vitrine linka. Até a 0.9.1, o download guardava 8 páginas representativas, e o menu, o rodapé, o "Ver tudo" das vitrines, quase todos os produtos e o voltar da página de produto davam "Rota não capturada nesta prévia".

- **Páginas da loja.** Depois do recorte de 8 páginas, o download segue os links das páginas capturadas (menu, subcategorias, rodapé, breadcrumbs, banners), das leituras públicas gravadas (o "Ver tudo" das coleções) e os links escritos no próprio tema (`href`, `link` e `cta-url` com caminho literal em `.twig` e `.vue`). Entram categorias e subcategorias, vitrines `/l`, buscas, páginas institucionais e promoções, em até 4 rodadas: as páginas novas trazem os links da rodada seguinte.
  - Uma página por caminho: `/categoria?sort_by=…` e `/categoria?page=2` são a mesma captura. Cada busca (`?q=`) é uma captura.
- **Páginas dos produtos.** Em seguida, a página de cada produto (`/<slug>/p`) que as páginas capturadas, as leituras públicas e o tema mostram, e numa segunda rodada os que só outras páginas de produto mostram (semelhantes). Uma última rodada lê as categorias que só um produto linka: o voltar da página do produto.
- **Orçamento próprio.** Até 200 páginas da loja (24 MiB) e 400 de produto (16 MiB), à parte das 8 representativas e do orçamento de CSS, fontes e banners. O que passa do limite vira aviso, com a contagem e exemplos.
- **Fotos.** Nenhuma foto nova é baixada para essas páginas: uma foto sem cópia na exportação mostra o placeholder, como antes.
- **Loja que pede calma.** Com HTTP 429 ou 503, todas as leituras esperam juntas (o `Retry-After`, até 60 s) e passam a sair mais espaçadas; queda de conexão tenta de novo. Só depois das tentativas a página vira aviso. Uma página que responde 404, redireciona (o redirecionamento não é seguido) ou não é do tipo esperado também vira aviso, e o download termina.
- **Links quebrados.** Um caminho que a loja responde com 404 vira o aviso **link quebrado**, com o lugar do link: o arquivo do tema ou a chave dos dados (por exemplo, `merchant.categories`). Ele aparece no fim do download e em `preview/report.json`.
- **Progresso e relatório.** O download mostra **Páginas da loja: N de M** e **Páginas dos produtos: N de M**. O resultado diz quantas entraram por tipo, quais ficaram de fora e por quê.
- **Mesma limpeza.** As páginas novas passam pela mesma lista de bloqueio das demais: segredos, rastreamento e dados de cliente não entram no ZIP.
- **Formato 3 da prévia.** `themeConfig` e `merchant`, que se repetem iguais em cada página, ficam uma vez em `preview/raw/shared/`, conferidos pelo SHA-256 como o resto ([motivo](docs/SPEC.md)). A prévia local (`npm run dev`, `npm run check`) aceita até 640 páginas. Ela abre qualquer ordenação ou página de uma categoria capturada pelo caminho dela, e a busca só pela pergunta exata. O índice `/__local/` mostra a contagem por tipo, com alguns exemplos.
- **Envio: aviso de rota que não existe.** Categorias, vitrines e páginas são dados do painel da Yampi: o envio não cria rota.
  - Na comparação, cada link interno literal dos textos que o projeto mudou é conferido na vitrine.
  - Uma rota que responde 404 vira aviso: "Link para uma rota que não existe na loja: /x em elements/y.twig; crie a categoria ou a página no painel da Yampi, ou troque o link". É aviso, não bloqueio: a categoria pode estar sendo criada no painel.
  - Sem a leitura da vitrine liberada no Chrome, os links ficam sem conferência, com o botão **Conferir os links**.
- **Prévia nova depois de atualizar.** Ao terminar **Atualizar a pasta**, o painel oferece **Baixar a prévia nova**: um ZIP só com `preview/`, capturado a partir da referência que a atualização acabou de gravar, sem ler o tema de novo.
  - Na pasta do projeto, `npm run previa:trocar -- previa-<loja>-<data>.zip` confere a captura (loja, hashes e formato), guarda a prévia anterior em `.yampi-sync/updates/` e põe a nova no lugar.
  - A extensão continua sem gravar em `preview/`, e nada disso vai para a Yampi.
- **Projetos antigos.** `node scripts/update-project.mjs <projeto> --preview <nova-exportação.zip>` leva as ferramentas novas e o formato 3. As ferramentas da 0.9.1 e anteriores não leem uma prévia com mais de 12 páginas.

**Validado só com a loja fictícia.** Os testes exportam a loja fictícia no formato real, com mais categorias, subcategorias, vitrines, páginas de rodapé e produtos do que o recorte, uma rota 404, um redirecionamento para fora e uma categoria que responde 429 duas vezes. Em `npm run test:preview`, um navegador clica em menu, subcategorias, rodapé, "Ver tudo", busca, produtos e voltar na prévia local. Ainda não houve uma exportação real conferida pelo proprietário com a 0.10.0. [Validação](docs/VALIDACAO.md).

## Versão 0.9.1

Corrige o download com a vitrine publicada, que pedia autorização várias vezes, recomeçava a captura e mostrava 100% antes do fim.

- **Uma pergunta, no clique.** **Baixar ZIP** pede de uma vez a vitrine e os endereços onde a Yampi guarda imagens e fontes (`cdn.yampi.io`, `fonts.googleapis.com`, `fonts.gstatic.com`). O Chrome lembra essa permissão, então os próximos downloads não perguntam de novo.
- **Sem perguntar o que já está liberado.** Durante a captura, um endereço que o Chrome já permite entra sem pergunta. Só um endereço realmente novo pausa o download, uma vez. As fontes de `fonts.googleapis.com` e `fonts.gstatic.com` são pedidas juntas.
- **Sem recomeçar.** Depois de autorizar, a etapa continua de onde estava: **Completar a vitrine com os recursos autorizados**. O que já foi capturado vem do cache, e a contagem da etapa nunca volta.
- **100% só no fim.** Enquanto alguma etapa tiver trabalho pela frente, a barra para em 99%.

**Validado só com a vitrine fictícia.** Os testes cobrem as rodadas de autorização e a barra; o download real de uma loja com a 0.9.1 ainda não foi feito.

## Versão 0.9.0

A 0.9.0 resolve o que um projeto real mostrou: a pasta com a referência do download antigo, um envio feito por ZIP em outro computador e edições depois dele. "Atualizar da loja" pedia decisão em 9 arquivos, sem dizer de quem era cada lado.

- **Versões conhecidas do projeto.** A extensão reconhece na loja um texto que o próprio projeto já teve, venha ele do Git, de um recibo de envio ou do histórico desta instalação. Para esse arquivo, a mudança é nossa: a referência passa a ser o texto da loja, e não há conflito, nem num arquivo criado pelo projeto. Quando a loja tem algo diferente de todas as versões conhecidas, a junção usa como base a versão mais próxima, e o conflito mostra só a mudança da outra pessoa.
  - `npm run versoes:conhecidas`, no projeto, grava `.yampi-sync/versoes-conhecidas.json` com cada versão que o Git teve de cada texto de `tema/`. A extensão não lê o Git: lê esse arquivo.
  - Projetos exportados antes ganham o comando com o atualizador de ferramentas, ou podem usar `node <extensão>/local-runtime/known.mjs "<pasta>"`.
- **Recibo de envio.** Depois de um envio conferido, inclusive a partir de ZIP, **Baixar recibo do envio** guarda o que cada item deixou na loja. Coloque-o em `.yampi-sync/recibos/` e faça commit: qualquer computador com o projeto reconhece esses textos como nossos. Com a escrita na pasta liberada, a extensão grava o recibo lá sozinha.
- **De quem é cada lado.** A atualização e a revisão do envio dizem, quando dá para saber:
  - "A loja tem a versão enviada em DD/MM (sem mudança de outra pessoa)";
  - "A loja mudou depois do último envio conhecido: provável mudança de outra pessoa".

  Os lados se chamam sempre **Nossa (pasta do projeto)** e **Da loja (Yampi agora)**.
- **Decisão por trecho.** Em **Comparar**, cada trecho em conflito tem **Nossa**, **Da loja**, **As duas** ou **Marcar para editar**. A escolha vale para aquele trecho mesmo depois de ler a loja de novo, se ele não mudou.
- **Juntar só um arquivo e enviar.** Na revisão do envio, um arquivo mudado dos dois lados tem **Juntar com a loja**. A extensão junta só esse arquivo na pasta (guardando antes a versão da pasta), avança a referência só dele e compara de novo. Ele fica pronto para enviar, e os outros não são lidos para decisão nem alterados.
- **Projetos antigos continuam funcionando.** Atualizar a pasta mantém a versão do manifesto que ela tinha. As ferramentas exportadas antes da versão 3 do manifesto aceitam só 1 e 2, e a 0.8 as deixava sem `npm run dev`, `check` e `pack`.
- **Caminhos de imagem.** O envio move imagens de subpastas para `assets/images` e reescreve as referências. A atualização agora compara a pasta como o envio a deixaria na loja: uma diferença só nesses caminhos não é mudança de ninguém. O que vem da loja entra na pasta com os caminhos do projeto.
- **Aviso antes de marcar.** A revisão da atualização lista os arquivos que vão receber marcações de conflito e lembra de fazer commit antes, se o projeto usa Git.
- **Comparar sem recarregar lê tudo pelo servidor.** Na 0.8.1, uma comparação de poucos arquivos ainda lia pela aba do editor, que pode guardar um texto antigo. Agora, quando a comparação não recarrega, todos os textos vêm do servidor da Yampi, a mesma fonte que o envio confere.

**Validado só com o editor e o servidor fictícios.** Os 9 critérios de aceite do pedido foram testados com projetos fictícios ([Validação](docs/VALIDACAO.md)), além do fluxo completo no painel de demonstração. A leitura do Git foi testada num repositório temporário. Ainda não rodou numa loja real.

## Versão 0.8.1

Corrige o que o primeiro uso real da 0.8.0 mostrou.

- **Sem "Acesso restrito".** Escolher a pasta, atualizar ou enviar recarregava a aba do editor, e a Yampi agora responde a essa recarga com a página "Acesso restrito", embora o editor abra normalmente pelo menu. A comparação, a atualização e o envio passaram a conferir tudo no servidor da Yampi (o mesmo pedido que o editor faz para abrir um arquivo), sem recarregar a aba. A gravação continua pelo próprio editor. Se o servidor não responder, a extensão recarrega como antes e, se aparecer "Acesso restrito", para na hora e explica o que fazer.
- **Menos falsos conflitos ao atualizar.** Um arquivo que você enviou pela extensão e depois continuou editando aparecia como "mudou dos dois lados", porque a referência da pasta era anterior ao envio. Agora a atualização usa o registro dos envios: se a loja tem exatamente o que a extensão enviou, a mudança é sua, e o arquivo fica como está na pasta.

**Validado só com o editor e o servidor fictícios:** o envio inteiro, com criação, imagem e conferência final, sem nenhuma recarga da página do editor. Na Yampi real, a leitura pelo servidor já funcionou na cópia e na atualização; a gravação conferida pelo servidor ainda não foi usada numa loja real.

## Versão 0.8.0

A 0.8.0 faz a pasta do projeto acompanhar a loja e guarda versões do trabalho. Assim, um envio não desfaz o que o cliente mudou na Yampi, e dá para voltar atrás.

- **Atualizar da loja.** Com a pasta do projeto escolhida, **Atualizar da loja** lê a loja inteira e mostra o que vem para a pasta antes de gravar qualquer coisa:
  - o que só a loja mudou entra, e o que só você mudou fica;
  - mudanças dos dois lados em trechos diferentes do mesmo arquivo são juntadas linha a linha;
  - quando os dois mudaram as mesmas linhas, você decide. Por padrão, o arquivo recebe as duas versões entre marcações (`<<<<<<<`, `=======`, `>>>>>>>`) para resolver no VS Code, e nada com marcações é enviado;
  - arquivo removido na loja sai da pasta, e arquivo novo na loja entra;
  - imagens da loja entram na pasta só para a prévia local.
- **A referência fica na pasta.** Depois de uma atualização, `.yampi-sync/manifest.json` e `.yampi-sync/baseline/` passam a ser a loja como foi lida. Depois de um envio também, se a escrita na pasta já estiver liberada.
  - Antes, a referência só avançava neste navegador: limpar os dados da extensão ou abrir a pasta em outro computador fazia voltar à exportação antiga.
  - Se a gravação parar no meio, a pasta continua legível e a próxima atualização termina o trabalho.
- **Versões na pasta do projeto.** Antes de mudar a pasta, a extensão guarda em `.yampi-sync/versoes/` a referência anterior, a pasta como estava e a loja como foi lida.
  - Só textos: imagens não entram, para economizar espaço. Cada texto é guardado uma vez, pelo SHA-256, então uma versão nova só ocupa o que mudou.
  - Em **Versões**, salve a pasta com um nome (por exemplo, "Banner de Natal aprovado"), abra uma versão, veja o que mudou desde então e traga um arquivo, ou todos, de volta para `tema/`. A pasta de antes também fica guardada.
- **Imagens fora do envio por padrão.** Imagens novas ficam no projeto.
  - **Enviar imagens novas**, na revisão, as inclui depois de um aviso: uma imagem enviada fica na loja, e a extensão não a substitui nem apaga.
  - A opção volta a desligar a cada comparação. Um texto que usa uma imagem nova espera, com o motivo.
- **Permissão do Chrome.** Atualizar, salvar ou trazer uma versão pedem, no clique, permissão para editar a pasta.
  - A extensão grava só em `tema/` e nos seus registros de `.yampi-sync/` (referência e versões). Ferramentas, `package.json`, `preview/` e `node_modules` nunca são tocados.
  - Cada arquivo precisa estar como foi lido; se mudou depois, nada é gravado.

**Validado só com o editor fictício.** Foram testados com projetos e lojas fictícios ([Validação](docs/VALIDACAO.md)):
- junção linha a linha e conflito marcado;
- arquivos removidos e novos;
- referência reescrita, inclusive com parada no meio;
- versões e recuperação;
- envio de imagens desligado.

Ainda não foi conferida a gravação numa pasta real pelo painel lateral do Chrome: o teste automatizado usa o armazenamento privado do navegador no lugar do seletor de pastas. Configurações do editor visual da Yampi (seções e banners definidos no painel, não no código) não estão nos arquivos lidos e não entram nas versões. As telas novas têm layout funcional; o acabamento visual vem depois. [Regras](docs/SPEC.md).

## Versão 0.7.0

A 0.7.0 acelera o download do tema e corrige a barra de progresso.

- **Download direto do servidor da Yampi.** Até a 0.6, a extensão abria cada arquivo no editor e esperava a tela estabilizar: cerca de 0,8 s por arquivo, uns 3 minutos e meio para 264 arquivos. Agora a página do editor pede os arquivos ao servidor da Yampi pelo mesmo endereço que ela usa para abrir um arquivo (somente `GET`, no rascunho), seis de cada vez, com os cookies que o navegador já envia: a extensão não lê, guarda nem envia senha, cookie ou token.
- **Conferido com o editor.** Antes do restante, o primeiro arquivo de cada tipo (Twig, SCSS, Vue, imagem…) é lido pelos dois caminhos e precisa sair idêntico ao que o editor mostra. Só esses tipos seguem pelo servidor. JSON, que o editor reformata ao mostrar, e qualquer diferença ficam com a leitura pelo editor, arquivo por arquivo. Servidor indisponível ou resposta inesperada também levam de volta à leitura pelo editor, sem interromper o download. As etapas dizem qual caminho foi usado e por quê.
- **A loja certa.** Nome e link **Ver prévia** do cabeçalho são conferidos com o servidor, e a loja da sessão do navegador é conferida antes e depois de cada lote e no fim, como o próprio editor faz ao voltar para a aba. Se ela mudar (outra aba trocou de loja), o download para e nada é entregue.
- **Barra que só avança.** Ao terminar de listar, a barra mostrava 18% e voltava para perto de zero quando o número de arquivos chegava. Agora esse número entra junto com a lista, e nenhuma etapa que descobre o próprio tamanho depois faz a barra voltar. **Listar os arquivos** aparece em andamento desde o início.
- **Medido no editor fictício.** 121 arquivos, com 450 ms para abrir cada um no editor e 120 ms por pedido ao servidor fictício: 95,7 s pelo editor e 9,8 s com a leitura direta, com os mesmos arquivos no ZIP, byte a byte. [Validação](docs/VALIDACAO.md).

**Ainda não validado numa loja real.** O endereço, o formato das respostas e a identificação da loja foram lidos no módulo público do editor em 18/10/2026 e reproduzidos no servidor fictício. Se a Yampi mudar algo, a amostra ou a identificação falham e o download volta sozinho para a leitura pelo editor, com o motivo nas etapas. O tempo numa loja real depende da rede e do servidor da Yampi. Envio, preflight e conferência após recarregar continuam lendo pelo editor. [Regras da leitura direta](docs/SPEC.md).

## Versão 0.6.0

A 0.6.0 resolve o que o primeiro envio real mostrou: o envio parava quando o painel fechava, demorava e não dizia quanto faltava.

- **Continua com o painel fechado.** Baixar, comparar e enviar rodam num documento da própria extensão, fora do painel. Trocar de aba ou fechar o painel não interrompe nada; o ícone mostra a porcentagem e, no fim, um aviso do sistema diz se terminou ou parou. Reabrir o painel mostra o andamento ou o resultado.
- **Progresso claro.** Porcentagem ponderada pelo trabalho real de cada etapa, tempo restante estimado pelo ritmo recente, a etapa e o arquivo em andamento e um registro do que já foi conferido.
- **Mais rápido, com a mesma conferência.** O editor deixa de ser recarregado duas vezes por arquivo. Os arquivos criados e as imagens enviadas são conferidos em grupo, depois de uma única recarga; cada texto continua salvo e conferido após recarregar, antes do próximo. A comparação relê na loja só o que o projeto mudou, não o tema inteiro.
- **Continuar de onde parou.** Um envio interrompido (aba fechada, extensão reiniciada, erro) continua do item em que parou. O que já foi conferido não é refeito, e o item em andamento é conferido na loja antes: se alguém o alterou, o envio para.
- **Sem recomeçar do zero.** A pasta do projeto fica lembrada (**Reler “pasta”**, com um clique), pode ser solta no painel e só `tema/` e `.yampi-sync/` são lidos, sem `node_modules`. Projeto, comparação e escolhas ficam guardados por loja. Depois de cada envio, a referência avança: o que já foi enviado não volta como conflito.
- **Abas e orientações visíveis.** **Baixar arquivos** e **Importar projeto** ficam no topo, junto do nome da loja e do estado de conexão. Nomes compridos ficam em uma linha, com degradê e reticências; o texto completo aparece ao passar o mouse. O painel abre no download; as ações ficam na própria etapa. **Importar por ZIP** tem um bloco próprio, botão direto e nome do arquivo, e as orientações explicam a pasta, o conteúdo da cópia e o envio. Histórico, backups e recuperação ficam somente no menu **⋯**; etapas e registro do progresso começam abertos. A comparação é preservada ao trocar de aba.

A 0.5.1 corrigiu a conferência das imagens enviadas: o editor da Yampi mostra cada imagem guardada como endereço `data:`, e a política de segurança da página bloqueia `fetch()` nesse endereço. A extensão decodifica a imagem diretamente.

**Edição local e sincronização do código da sua loja Yampi.** A 0.5.0 faz o envio inteiro sozinha. Você escolhe a pasta do projeto, confere um resumo e confirma. A extensão cria os textos novos pelo **Adicionar arquivo** do próprio editor, envia as imagens novas pelo envio de imagens da Yampi e salva os arquivos alterados. Cada item é conferido na Yampi depois de recarregar o editor, antes do próximo. Imagens em subpastas vão direto para `assets/images`, porque a Yampi não aceita subpastas, e as referências nos arquivos enviados são ajustadas. O painel mostra só o que precisa da sua decisão, como um arquivo alterado na loja depois da sua cópia. [Contrato do envio](docs/SPEC.md).

A 0.4.0 corrige o fluxo de ponta a ponta medido na análise da exportação 0.3.4: uma exportação nova passa em `npm run check` e abre home, categoria e produto com seções, fontes, ícones e imagens capturados. Quando algo falta, a prévia diz exatamente o quê. [Relatório da versão](docs/RELATORIO-0.4.0.md).

- **Contrato único.** `local-runtime/contract.mjs` transforma a captura bruta (`window.themeConfig`, `window.data`, `window.merchant`) nas variáveis do tema: `header`, `footer`, `mainSections` (seções `position` 1, na ordem de `order`), `pageConfig.data`, `customData` e `context`. A mesma função é usada pela captura, por `npm run check`, por `npm run dev` e pelos testes. Em categoria, busca e produto, `window.data.config` é a seção principal.
- **Aliases por regra.** `get_section_file` procura `sections/<página>/<alias>.twig`, depois sem o prefixo `main_`, depois `sections/global/`. Páginas institucionais usam `sections/content/`. Um alias sem arquivo é erro explícito, com alias e página.
- **Captura completa e anônima.** Os três objetos públicos são lidos sem cookies e sem executar a página, e gravados sem alteração em `preview/raw/`. Uma lista de bloqueio remove segredos (`token`, `session`, `password`, chaves de API…) e IDs de rastreamento. `merchant.company` mantém as chaves, com nome, documento, contatos e endereço trocados por `"redacted"`; e-mails, CPF e CNPJ também viram `"redacted"` em qualquer texto. O relatório lista as chaves que o código usa e a captura não trouxe, com o motivo.
- **Páginas por tipo.** Primeiro uma página de cada tipo (home, categoria, produto, institucional, promoção, busca), depois o restante do orçamento. Tipos ausentes aparecem no relatório.
- **Leituras públicas gravadas.** As coleções, banners e produtos pedidos pelas seções visíveis são lidos uma vez na API pública, sem credenciais, e reproduzidos na prévia com filtro por `id[]`, `slug` e `limit`. Uma rota não gravada gera erro explícito com o caminho.
- **Assets por prioridade.** CSS servido e fontes primeiro (somente `latin` e `latin-ext`, WOFF2), depois logotipo e ícones de `$assets`, banners, produtos e o restante. Imagens são deduplicadas pela imagem subjacente: a variante exibida (por exemplo, `fit-in/600x600`) é baixada e as demais URLs viram aliases. Nenhuma URL é derivada de `@import` Sass. Fonte não capturada perde a `@font-face`; nunca aponta para uma imagem.
- **Associação pelo CSS.** `npm run check` compila cada entrada Sass e compara com o CSS publicado capturado, normalizando a minificação. Iguais: `published-verified-by-css`; diferentes: lista das folhas divergentes.
- **Simulador mais fiel.** Twing com a semântica de nulos do Twig PHP (`raw`, `upper`, `format`, `date`, concatenação e soma). HTML normalizado como o navegador faz antes do Vue: uma tag não fechada vira aviso com o arquivo provável. Ordem do CSS igual à de `head.twig`, com cada folha no seu `<link>` e `media`. `<body>` preservado. Somente componentes de `components.twig` são registrados. Prontidão estrutural: `__yampiLocalReady` fica falso quando falta seção, e a barra da prévia mostra seções, imagens em placeholder, fontes com erro e rotas não capturadas.
- **Retorno seguro.** Arquivo enviado que depende de caminho que não existirá na loja (Sass, Twig, componente, imagem) fica bloqueado com o nome dos dois. Desde a 0.5.0, textos e imagens novos são criados pela extensão. Arquivos alterados que usam uns aos outros só vão juntos. Alterações só de espaço em branco aparecem separadas e podem ser descartadas. `.editorconfig` e `.vscode/settings.json` evitam que abrir e salvar gere diferença.
- **Projeto organizado.** `local.data.json` contém só sobreposições, com escopo global, por página ou por captura. Manifesto versão 3 com ferramenta, tema, quebras de linha e `logs/` ignorado; versões 1 e 2 continuam legíveis. `.gitignore` comentado.

O repositório de origem continua **JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer**. O pacote e o nome exibido no Chrome e no painel são **Zirtuno Sync Yampi** (`zirtuno-sync-yampi`), desenvolvido por **Zirtuno**. O ícone usa a logo fornecida pelo proprietário; sua versão original está em `assets/zirtuno-sync-yampi-logo.png`. [Proposta visual e nome técnico](docs/INTERFACE.md).

O ícone de código informa no hover que a extensão precisa do **Editor de código da Yampi**. Fora dessa tela, o clique abre uma orientação com botão para acessar o editor na mesma aba. Dentro do editor, abre diretamente o painel de cópia e envio. Nenhuma cópia começa ao abrir o painel.

| Pasta/arquivo | Uso |
|---|---|
| `tema/` | Código editável, copiado do editor |
| `.yampi-sync/baseline/` e `manifest.json` | Referência: a loja como a extensão a conhece por último (download, atualização ou envio), com tamanhos e SHA-256, para comparar e devolver código |
| `.yampi-sync/versoes/` | Versões do projeto: só textos, cada um guardado uma vez pelo SHA-256 |
| `preview/` | Captura bruta (`raw/`, com `raw/shared/` para o que se repete), leituras públicas, recursos, manifesto e relatório |
| `local.data.json` | Somente sobreposições da prévia (começa vazio) |
| `local.config.json` | Templates, estilos, mapa de seções e opções de componentes |
| `.yampi-sync/tools/` | Ferramentas portáteis para Twig/Sass/Vue 2, contrato, integridade e retorno |

A leitura confere identidade, inventário antes/depois e documento completo do CodeMirror, sob lock de leitura. Os hashes comprovam integridade. O inventário estável observado no DOM **não é uma auditoria independente da completude remota**. Logs do editor ficam fora do tema e são registrados como ignorados no manifesto.

## Instalar e exportar

Use o [download direto da extensão](https://github.com/JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer/releases/latest/download/zirtuno-sync-yampi.zip), extraia o ZIP e carregue a pasta em `chrome://extensions`, com modo de desenvolvedor e **Carregar sem compactação**. Para atualizar, substitua os arquivos na mesma pasta instalada e recarregue o cartão. [Instruções completas](docs/INSTALACAO.md).

1. Abra `https://app.yampi.com.br/store/code-editor/` e clique no ícone. O painel abre em **Baixar arquivos**, na própria aba, sem copiar nada sozinho.
2. Confira a loja no alto do painel. Deixe **Incluir a vitrine publicada** ligado e clique em **Baixar ZIP**. O Chrome pede leitura da origem da vitrine. Negar permite copiar o código com prévia demonstrativa.
3. Imagens, fontes e a API pública de catálogo ficam em outras origens. O painel lista os destinos e aguarda **Autorizar e terminar o ZIP**. **Baixar sem esses recursos** mantém as falhas no relatório. Nenhum arquivo da Yampi é editado, salvo, excluído, criado, renomeado ou publicado durante a cópia. O download continua mesmo com o painel fechado.
4. Extraia a exportação fora deste repositório e abra a pasta ou seu `.code-workspace` no VS Code.

Com Node.js 24, no terminal da pasta exportada:

```powershell
npm ci
npm run check:integrity
npm run check
npm run dev
```

Abra `http://127.0.0.1:5182`. As páginas capturadas abrem pelos mesmos caminhos da loja, uma categoria com qualquer ordenação ou página e a busca pela pergunta exata; o índice em `/__local/` mostra a contagem de capturas por tipo, com exemplos, e os templates sem captura. A instalação inicial de dependências usa o registro npm.

## Captura e diagnóstico

A leitura é estática: literais, objetos, arrays e JSON/base64 declarativos. Expressões dinâmicas, getters e chamadas não são executados. HTML bruto, scripts, autenticação, checkout, cookies, pedidos e dados de clientes ficam fora do pacote. Trata-se de uma amostra visual datada, sem exportação completa do catálogo ou das configurações.

PNG/JPEG/WebP/SVG, CSS e WOFF/WOFF2/TTF/OTF são validados, identificados por SHA-256 e deduplicados. URLs privadas, credenciais em URL, redirecionamentos, tipos desconhecidos e SVG ativo são recusados.

Máximos: 8 páginas representativas, 200 recursos, 12 MiB de recursos, 2 MiB por recurso e por página, 40 leituras públicas (4 MiB) e 15 segundos por leitura HTTP. O orçamento segue a prioridade descrita acima e o relatório mostra contagem e bytes por categoria. Desde a 0.10.0, à parte: até 200 páginas da loja (24 MiB, 4 rodadas) e 400 páginas de produto (16 MiB), sem recursos novos; o relatório lista por etapa o que entrou, por tipo, e o que ficou de fora, com o motivo.

`preview/report.json` separa código, configuração, contrato (aliases, seções visíveis, chaves ausentes, cobertura de templates), assets, compilação, inicialização e visual. `npm run check` grava `.cache/yampi-check.json` com seções renderizadas por página, avisos de markup e componentes e a paridade de CSS. O servidor oferece `/__local/diagnostic.json`; o navegador expõe `__yampiLocalReady` e `__yampiLocalState`. HTTP 200 não certifica inicialização ou aparência.

Preços refletem a data da captura. Carrinho, checkout, pagamentos, formulários e gravações permanecem bloqueados.

## Devolver e recuperar

1. No editor de código da Yampi, clique no ícone e escolha **Importar projeto**.
2. Escolha a pasta do projeto, ou solte-a no painel. Da segunda vez em diante, **Reler “pasta”** faz isso com um clique. Em **Usar um ZIP de retorno** vale o ZIP de `npm run pack`. A comparação começa sozinha.
3. Confira o resumo: alterados, novos e imagens. O que precisa de você aparece em **Precisa da sua atenção**, com a ação ao lado; **Comparar e escolher** mostra as linhas que mudaram. Se um arquivo usa outro que mudou só na loja, **Ver a mudança** mostra o que mudou; **Usar no projeto** grava a versão da loja nesse arquivo da sua pasta e compara de novo (ou **Copiar**, para colar à mão). **Comparar de novo** relê a pasta.
4. Clique em **Enviar N itens** e confirme. O backup é baixado antes da primeira mudança. Pode fechar o painel ou trocar de aba: o envio continua, e o ícone mostra o progresso.
5. No fim, **Abrir a prévia** abre o rascunho da Yampi. Se estiver tudo certo, publique na Yampi. Se não, **Desfazer este envio**.

| Situação | Resultado |
|---|---|
| Local mudou; loja igual ao original | Enviado |
| Local e loja iguais | Não grava novamente |
| Mudou só na loja | Preserva a loja |
| Ambos mudaram de formas diferentes | Conflito: fica a versão da loja, a menos que você escolha **Usar a versão do projeto** |
| Arquivo ausente localmente | Não exclui |
| Texto novo (.twig, .vue, .scss) em pasta que existe na loja | Criado pela extensão e preenchido |
| Texto novo em pasta nova, ou com nome/tipo que a Yampi recusa | Bloqueia todo o envio, com o motivo |
| Imagem nova | Fica no projeto. Com **Enviar imagens novas** ligado (depois do aviso), vai para `assets/images`; de subpasta, com as referências ajustadas |
| Texto com marcações de conflito | Nunca enviado: resolva no editor de código |
| Imagem existente alterada | Não enviada: a Yampi não substitui imagens |
| `elements/scripts/components.twig` | Nunca enviado: a Yampi gera esse arquivo |
| Depende de arquivo que não existirá na loja | Bloqueia, com o nome da dependência |
| Arquivos alterados que usam uns aos outros | Enviados juntos |
| Só espaço em branco | Separado, sem seleção inicial; pode ser descartado |

Cada texto existente é relido antes de salvar. Os arquivos criados e as imagens enviadas são conferidos em grupo, depois de recarregar o editor, antes da etapa seguinte; cada texto é salvo e conferido após recarregar, antes do próximo. A operação para no primeiro erro e mantém o registro parcial; **Continuar de onde parou** retoma do item em que parou, sem refazer o que já foi conferido e sem sobrescrever o que outra pessoa alterou na loja. **Desfazer este envio** e **Comparar para restaurar** (no menu **⋯ → Histórico e backups**) protegem alterações posteriores: arquivos criados voltam ao conteúdo inicial da Yampi, e nada é excluído. A extensão nunca publica, exclui ou renomeia. Regras completas: [SPEC.md](docs/SPEC.md).

### Atualizar da loja e versões

Antes de um trabalho novo numa pasta que já tem tempo, use **Atualizar da loja** (abaixo da pasta, em **Importar projeto**). Assim você mexe sobre o que está na loja hoje, e o próximo envio não volta atrás no que o cliente fez. Nada vai para a loja. A pasta só muda quando você confirma **Atualizar a pasta**, depois de revisar:

| Situação | Na pasta |
|---|---|
| Só a loja mudou | Recebe a versão da loja |
| Só a pasta mudou | Fica como está |
| Os dois mudaram, em trechos diferentes | Recebe as duas mudanças juntas |
| Os dois mudaram as mesmas linhas | Você decide: as duas versões marcadas no arquivo (padrão), **Manter a da pasta** (vai no próximo envio, com a da loja no backup) ou **Usar a da loja** |
| Removido na loja | Sai da pasta. Se você o tinha editado, decide (padrão: seguir a loja) |
| Novo na loja | Entra na pasta |
| Apagado na pasta e mudado na loja | Volta com a versão da loja, a menos que você escolha deixá-lo apagado |
| Ainda com marcações de uma atualização anterior | Fica como está até você resolver; a referência dele não avança |
| Imagem | A da loja entra para a prévia local; uma imagem mudada na pasta fica |

Antes de gravar, a extensão guarda três versões em `.yampi-sync/versoes/`: a referência, a pasta e a loja. Em **Versões**, abra uma delas para ver o que mudou desde então e trazer arquivos de volta. Também é possível salvar a pasta com um nome. Versões guardam só textos.

O projeto local não precisa mudar por causa das imagens: a prévia continua usando as subpastas, e só a loja recebe os caminhos em `assets/images`. Uma referência montada em tempo de execução (por exemplo, `'images/hero/' ~ nome`) não pode ser ajustada e bloqueia o arquivo, com o motivo.

**Validação real parcial (16/10/2026).** Numa loja real, **Adicionar arquivo** criou 18 textos novos (Twig, Vue e SCSS) em pastas existentes, cada um conferido após recarregar, e o envio de imagens gravou uma imagem em `assets/images` com os mesmos bytes do projeto. A conferência dessa imagem parou o envio na 0.5.0 e foi corrigida na 0.5.1. Ainda sem validação real: gravação dos textos alterados, envio das demais imagens, o caminho que `assets_url` gera em `assets/images` e a restauração. **A 0.6.0 foi validada só com o editor fictício:** a execução em segundo plano, o painel fechado no meio do envio, a retomada, a conferência em grupo de criações e imagens e a comparação parcial ainda não rodaram numa loja real. Numa aba em segundo plano o navegador desacelera a página; o envio continua, mais devagar. No primeiro envio real, acompanhe o painel e confira tudo em **Ver prévia** antes de publicar. Sem transação atômica do servidor, uma edição externa entre ler e salvar ainda pode ocorrer: não edite simultaneamente nem troque de loja ou tema durante o envio. Testes de gravação em loja real exigem ambiente e arquivo expressamente escolhidos pelo proprietário.

`npm run pack` também informa arquivos modificados e adicionados. `npm run check:integrity -- --return-zip retorno-yampi.zip` confere se o ZIP tem exatamente manifesto, originais e `tema/`, com os mesmos hashes; `-- --original` confirma que nada mudou.

Na prévia local, `assets_url` aponta para `tema/assets/`; o caminho de produção continua sem validação.

## Atualizar projetos antigos

Faça uma nova exportação **em outra pasta**. Depois, nesta pasta da extensão:

```powershell
node scripts/update-project.mjs "C:/caminho/do/projeto" --preview "C:/caminho/nova-exportacao.zip"
node scripts/update-project.mjs "C:/caminho/do/projeto" --preview "C:/caminho/nova-exportacao.zip" --apply
node scripts/update-project.mjs "C:/caminho/do/projeto" --rollback .yampi-sync/updates/<data> --apply
```

O primeiro comando mostra o plano: ferramentas, mudanças em `package.json` e lockfile, arquivos de `preview/` e a migração de `local.data.json`. O segundo aplica; o terceiro desfaz. Somente `.yampi-sync/tools/`, `package.json`, `package-lock.json` e `preview/` são substituídos; `tema/`, originais, manifesto e `local.config.json` são preservados. Um `local.data.json` no formato antigo (cópia completa dos dados) vai para o backup e dá lugar a sobreposições vazias. Dependências próprias do projeto continuam no lockfile; conflitos com as ferramentas são recusados. Ferramentas editadas pelo usuário e links também são recusados. Bytes anteriores e o registro ficam em `.yampi-sync/updates/`; o rollback recusa arquivos alterados depois da atualização. Não executa scripts do projeto nem chama a Yampi. Depois execute `npm ci`, `check:integrity`, `check` e `pack` no projeto atualizado.

Sem `--preview`, só ferramentas e pacote mudam; a captura existente é mantida. Para trocar só a prévia de um projeto que já tem as ferramentas da 0.10.0, use **Baixar a prévia nova** (depois de **Atualizar a pasta**) e `npm run previa:trocar -- <zip>` na pasta do projeto; o mesmo comando aceita uma exportação completa da mesma loja. Prévias capturadas pela 0.3.x são lidas em modo de compatibilidade, com parâmetros e ordem incompletos: faça uma nova exportação.

## Desenvolvimento e validação

```powershell
npm ci
npm run check
npm run test:e2e
npm run test:direct
npm run test:preview
npm run test:compression
npm run audit:performance
npm run package
```

`npm run dev` oferece a demonstração fictícia em `http://127.0.0.1:5181/demo.html?demo=1`. `npm run package` gera uma pasta fixa pronta para carregar em **`releases/zirtuno-sync-yampi/`**, com 23 arquivos permitidos; as próximas execuções atualizam essa mesma pasta. Os ZIPs e hashes ficam em `.cache/package/`: `zirtuno-sync-yampi-<versão>.zip` identifica a versão e `zirtuno-sync-yampi.zip` mantém o link direto do GitHub estável. A pasta local e os pacotes são ignorados pelo Git; no GitHub, o instalador pronto fica em Releases. Preserve a pasta carregada no navegador enquanto usar a extensão. Ícones são redimensionados localmente a partir da logo autorizada, preservando proporções e transparência. Sharp é uma dependência de desenvolvimento e não integra o pacote da extensão. A assinatura exibida em 18 px usa uma versão de 72×72 px gerada de `assets/zirtuno-logo-source.png`; a imagem original permanece somente no código de desenvolvimento. Chrome/Edge com `sidePanel` são necessários; outros navegadores não foram validados. O painel global fica desativado e cada aba exige clique no ícone. Vue 2 é usado por compatibilidade, fora de manutenção; use projetos confiáveis e mantenha o servidor em localhost.

Testes cobrem leitura integral, escrita somente fictícia, backup, conflitos, restauração, parser, privacidade e isolamento. Uma loja fictícia no formato real da vitrine (lista de seções com `position`, aliases `main_*`, `window.data.config`, `company`, fontes com subconjuntos, ícones de `$assets`, variantes de imagem e API pública) é exportada, instalada e aberta em Chromium. Duas lojas fictícias, escura/clara, continuam comparadas pixel a pixel. [Resultados e evidências](docs/VALIDACAO.md).

Isso não certifica uma loja real. Exportações textuais reais anteriores tiveram hashes internos conferidos fora deste repositório. A leitura direta da 0.7.0 ainda não foi executada numa loja real; `npm run test:direct` mede o mesmo download pelos dois caminhos no editor fictício. A captura 0.4.0 ainda não foi executada numa vitrine real; formato real da API além de coleções, banners e produtos, regras exatas do minificador da plataforma, URL de produção de `assets_url`, regeneração de `components.twig` e gravações/restaurações reais continuam sem validação.

## Privacidade e arquitetura

Sem telemetria. `activeTab`/`scripting` operam a aba escolhida; o editor é lido explicitamente em `MAIN`, dentro de seu componente. HTTPS é uma permissão **opcional**; a interface solicita somente origens concretas. O worker exige painel/sessão autenticados, lock de leitura, permissão da origem e identidade antes/depois do GET, com `credentials: omit`, `redirect: manual` (o redirecionamento nunca é seguido; desde a 0.10.0 ele é distinguido de uma falha de rede) e sem referrer. Nenhum acesso global é concedido automaticamente.

Desde a 0.6.0, `offscreen` permite o documento da extensão que executa as operações com o painel fechado; ele só conversa com o worker, que confere se o pedido vem desse documento e da operação que recebeu o editor. `notifications` mostra o aviso de fim quando o painel está fechado. A pasta do projeto só recebe escrita quando você clica em **Usar no projeto**: o Chrome pede a permissão de escrita, e só um arquivo de `tema/` que já existe é trocado, se ainda estiver como na comparação. As fontes Atkinson Hyperlegible Next e Mono (SIL OFL 1.1) vêm no pacote; nenhuma fonte é carregada da internet.

Desde a 0.7.0, a cópia pede os arquivos ao servidor do próprio editor (`bart.yampi.com.br`), a partir da página do editor e somente com `GET`: o navegador envia os cookies dessa página, como faz com os pedidos do editor, e a extensão não lê, guarda nem envia senha, cookie ou token. Da identificação da loja, usa só nome, link de prévia e apelido. Nenhuma permissão nova foi pedida ao Chrome.

Originais e histórico ficam em IndexedDB local, separados por loja, sem criptografia adicional. ZIPs podem conter conteúdo privado. A extensão não envia projetos ao GitHub. Mantenha exports/backups fora deste repositório e revise qualquer publicação. [Licenças](docs/TERCEIROS.md).

`local-runtime/contract.mjs` define o contrato da plataforma e `dependencies.mjs` as dependências do retorno; ambos são usados pela extensão e pelo projeto exportado. `src/core/preview.ts` define formato e sanitização; `src/browser/preview-capture.ts` faz a captura estática, as leituras públicas e a fila de assets; `src/browser/preview-pages.ts` lê as páginas da loja e dos produtos, com `src/core/preview-links.ts` (links da loja) e `src/core/pacer.ts` (espera compartilhada); `public-fetch.ts` limita downloads. `local-runtime/` compila e serve a prévia; `scripts/update-project.mjs` atualiza projetos. [ROADMAP.md](docs/ROADMAP.md) mantém capacidades ainda não implementadas.

O nome interno `yampi-theme-sync` permanece nos formatos de exportação e armazenamento para compatibilidade com projetos e históricos existentes. [Configuração da conta](docs/CHROME-WEB-STORE.md).

Referências: [editor Yampi](https://docs.yampi.com.br/editor-codigo/intro), [MAIN/ISOLATED](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [cascata CSS](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction), [JSON Merge Patch](https://www.rfc-editor.org/rfc/rfc7396), [painel lateral](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
