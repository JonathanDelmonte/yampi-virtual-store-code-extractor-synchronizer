# Zirtuno Sync Yampi

Extensão independente para copiar o código do editor Yampi, trabalhar no computador e devolver os textos escolhidos com comparação e backup. O repositório público contém somente a ferramenta e exemplos fictícios; projetos e dados de lojas ficam fora dele.

**[Baixar extensão para Chrome — versão atual](https://github.com/JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer/releases/latest/download/zirtuno-sync-yampi.zip)** · [Ver release e SHA-256](https://github.com/JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer/releases/latest) · [Como instalar](docs/INSTALACAO.md)

Extraia o ZIP em uma pasta fixa. Abra `chrome://extensions`, ative **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione a pasta que contém `manifest.json`. O download **Source code** do GitHub não é a extensão pronta. Se ela já estiver instalada, atualize os arquivos na mesma pasta e clique em **Recarregar** no cartão.

## Versão 0.5.0

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
| `.yampi-sync/baseline/` e `manifest.json` | Originais, tamanhos e SHA-256 para comparar e devolver código |
| `preview/` | Captura bruta (`raw/`), leituras públicas, recursos, manifesto e relatório |
| `local.data.json` | Somente sobreposições da prévia (começa vazio) |
| `local.config.json` | Templates, estilos, mapa de seções e opções de componentes |
| `.yampi-sync/tools/` | Ferramentas portáteis para Twig/Sass/Vue 2, contrato, integridade e retorno |

A leitura confere identidade, inventário antes/depois e documento completo do CodeMirror, sob lock de leitura. Os hashes comprovam integridade. O inventário estável observado no DOM **não é uma auditoria independente da completude remota**. Logs do editor ficam fora do tema e são registrados como ignorados no manifesto.

## Instalar e exportar

Use o [download direto da extensão](https://github.com/JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer/releases/latest/download/zirtuno-sync-yampi.zip), extraia o ZIP e carregue a pasta em `chrome://extensions`, com modo de desenvolvedor e **Carregar sem compactação**. Para atualizar, substitua os arquivos na mesma pasta instalada e recarregue o cartão. [Instruções completas](docs/INSTALACAO.md).

1. Abra `https://app.yampi.com.br/store/code-editor/` e clique no ícone. O painel abre na própria aba, sem copiar automaticamente.
2. Confira a loja. Deixe **Incluir contexto visual da vitrine publicada** marcado e clique em **Confirmar e baixar ZIP**. O Chrome pede leitura da origem da vitrine. Negar permite copiar o código com prévia demonstrativa.
3. Imagens, fontes e a API pública de catálogo ficam em outras origens. O painel lista os destinos e aguarda **Autorizar recursos e finalizar ZIP**. **Baixar com prévia parcial** mantém as falhas no relatório. Nenhum arquivo da Yampi é editado, salvo, excluído, criado, renomeado ou publicado durante a cópia.
4. Extraia a exportação fora deste repositório e abra a pasta ou seu `.code-workspace` no VS Code.

Com Node.js 24, no terminal da pasta exportada:

```powershell
npm ci
npm run check:integrity
npm run check
npm run dev
```

Abra `http://127.0.0.1:5182`. As páginas capturadas abrem pelos mesmos caminhos da loja; o índice em `/__local/` lista capturas e templates sem captura. A instalação inicial de dependências usa o registro npm.

## Captura e diagnóstico

A leitura é estática: literais, objetos, arrays e JSON/base64 declarativos. Expressões dinâmicas, getters e chamadas não são executados. HTML bruto, scripts, autenticação, checkout, cookies, pedidos e dados de clientes ficam fora do pacote. Trata-se de uma amostra visual datada, sem exportação completa do catálogo ou das configurações.

PNG/JPEG/WebP/SVG, CSS e WOFF/WOFF2/TTF/OTF são validados, identificados por SHA-256 e deduplicados. URLs privadas, credenciais em URL, redirecionamentos, tipos desconhecidos e SVG ativo são recusados.

Máximos: 8 páginas, 200 recursos, 12 MiB de recursos, 2 MiB por recurso e por página, 40 leituras públicas (4 MiB) e 15 segundos por leitura HTTP. O orçamento segue a prioridade descrita acima e o relatório mostra contagem e bytes por categoria.

`preview/report.json` separa código, configuração, contrato (aliases, seções visíveis, chaves ausentes, cobertura de templates), assets, compilação, inicialização e visual. `npm run check` grava `.cache/yampi-check.json` com seções renderizadas por página, avisos de markup e componentes e a paridade de CSS. O servidor oferece `/__local/diagnostic.json`; o navegador expõe `__yampiLocalReady` e `__yampiLocalState`. HTTP 200 não certifica inicialização ou aparência.

Preços refletem a data da captura. Carrinho, checkout, pagamentos, formulários e gravações permanecem bloqueados.

## Devolver e recuperar

1. No editor de código da Yampi, clique no ícone e abra **Enviar projeto**.
2. Escolha a pasta do projeto (ou, em **Usar um ZIP de retorno**, o ZIP de `npm run pack`). A comparação começa sozinha.
3. Confira o resumo: alterados, novos, imagens e iguais. Se algo precisar de você, aparece em **Precisa da sua atenção**, com o motivo e a ação.
4. Clique em **Enviar** e confirme. O backup é baixado antes da primeira mudança; o progresso mostra cada etapa.
5. No fim, clique em **Ver prévia** na Yampi e confira a loja. Se estiver tudo certo, publique na Yampi. Se não, **Desfazer este envio**.

| Situação | Resultado |
|---|---|
| Local mudou; loja igual ao original | Enviado |
| Local e loja iguais | Não grava novamente |
| Mudou só na loja | Preserva a loja |
| Ambos mudaram de formas diferentes | Conflito: fica a versão da loja, a menos que você escolha **Usar a versão do projeto** |
| Arquivo ausente localmente | Não exclui |
| Texto novo (.twig, .vue, .scss) em pasta que existe na loja | Criado pela extensão e preenchido |
| Texto novo em pasta nova, ou com nome/tipo que a Yampi recusa | Bloqueia todo o envio, com o motivo |
| Imagem nova | Enviada para `assets/images`; de subpasta, com as referências ajustadas |
| Imagem existente alterada | Não enviada: a Yampi não substitui imagens |
| `elements/scripts/components.twig` | Nunca enviado: a Yampi gera esse arquivo |
| Depende de arquivo que não existirá na loja | Bloqueia, com o nome da dependência |
| Arquivos alterados que usam uns aos outros | Enviados juntos |
| Só espaço em branco | Separado, sem seleção inicial; pode ser descartado |

Cada texto existente é relido antes de salvar. Depois de criado, enviado ou salvo, cada item é conferido na Yampi após recarregar o editor, antes do próximo. A operação para no primeiro erro e mantém o registro parcial. **Desfazer este envio** e **Comparar para restaurar** protegem alterações posteriores: arquivos criados voltam ao conteúdo inicial da Yampi, e nada é excluído. A extensão nunca publica, exclui ou renomeia. Regras completas: [SPEC.md](docs/SPEC.md).

O projeto local não precisa mudar por causa das imagens: a prévia continua usando as subpastas, e só a loja recebe os caminhos em `assets/images`. Uma referência montada em tempo de execução (por exemplo, `'images/hero/' ~ nome`) não pode ser ajustada e bloqueia o arquivo, com o motivo.

**Validação real pendente.** Os controles do editor (**Adicionar arquivo**, envio de imagens) foram lidos no módulo público do editor e reproduzidos no editor fictício, mas ainda não foram acionados numa loja real. O caminho que `assets_url` gera para imagens em `assets/images` também não foi conferido. No primeiro envio real, acompanhe o painel e confira tudo em **Ver prévia** antes de publicar. Sem transação atômica do servidor, uma edição externa entre ler e salvar ainda pode ocorrer: não edite simultaneamente nem troque de loja ou tema durante o envio. Testes de gravação em loja real exigem ambiente e arquivo expressamente escolhidos pelo proprietário.

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

Sem `--preview`, só ferramentas e pacote mudam; a captura existente é mantida. Prévias capturadas pela 0.3.x são lidas em modo de compatibilidade, com parâmetros e ordem incompletos: faça uma nova exportação.

## Desenvolvimento e validação

```powershell
npm ci
npm run check
npm run test:e2e
npm run test:preview
npm run test:compression
npm run audit:performance
npm run package
```

`npm run dev` oferece a demonstração fictícia em `http://127.0.0.1:5181/demo.html?demo=1`. `npm run package` gera uma pasta fixa pronta para carregar em **`releases/zirtuno-sync-yampi/`**, com 17 arquivos permitidos; as próximas execuções atualizam essa mesma pasta. Os ZIPs e hashes ficam em `.cache/package/`: `zirtuno-sync-yampi-0.4.0.zip` identifica a versão e `zirtuno-sync-yampi.zip` mantém o link direto do GitHub estável. A pasta local e os pacotes são ignorados pelo Git; no GitHub, o instalador pronto fica em Releases. Preserve a pasta carregada no navegador enquanto usar a extensão. Ícones são redimensionados localmente a partir da logo autorizada, preservando proporções e transparência. Sharp é uma dependência de desenvolvimento e não integra o pacote da extensão. A assinatura exibida em 18 px usa uma versão de 72×72 px gerada de `assets/zirtuno-logo-source.png`; a imagem original permanece somente no código de desenvolvimento. Chrome/Edge com `sidePanel` são necessários; outros navegadores não foram validados. O painel global fica desativado e cada aba exige clique no ícone. Vue 2 é usado por compatibilidade, fora de manutenção; use projetos confiáveis e mantenha o servidor em localhost.

Testes cobrem leitura integral, escrita somente fictícia, backup, conflitos, restauração, parser, privacidade e isolamento. Uma loja fictícia no formato real da vitrine (lista de seções com `position`, aliases `main_*`, `window.data.config`, `company`, fontes com subconjuntos, ícones de `$assets`, variantes de imagem e API pública) é exportada, instalada e aberta em Chromium. Duas lojas fictícias, escura/clara, continuam comparadas pixel a pixel. [Resultados e evidências](docs/VALIDACAO.md).

Isso não certifica uma loja real. Exportações textuais reais anteriores tiveram hashes internos conferidos fora deste repositório. A captura 0.4.0 ainda não foi executada numa vitrine real; formato real da API além de coleções, banners e produtos, regras exatas do minificador da plataforma, URL de produção de `assets_url`, regeneração de `components.twig` e gravações/restaurações reais continuam sem validação.

## Privacidade e arquitetura

Sem telemetria. `activeTab`/`scripting` operam a aba escolhida; o editor é lido explicitamente em `MAIN`, dentro de seu componente. HTTPS é uma permissão **opcional**; a interface solicita somente origens concretas. O worker exige painel/sessão autenticados, lock de leitura, permissão da origem e identidade antes/depois do GET, com `credentials: omit`, `redirect: error` e sem referrer. Nenhum acesso global é concedido automaticamente.

Originais e histórico ficam em IndexedDB local, separados por loja, sem criptografia adicional. ZIPs podem conter conteúdo privado. A extensão não envia projetos ao GitHub. Mantenha exports/backups fora deste repositório e revise qualquer publicação. [Licenças](docs/TERCEIROS.md).

`local-runtime/contract.mjs` define o contrato da plataforma e `dependencies.mjs` as dependências do retorno; ambos são usados pela extensão e pelo projeto exportado. `src/core/preview.ts` define formato e sanitização; `src/browser/preview-capture.ts` faz a captura estática, as leituras públicas e a fila de assets; `public-fetch.ts` limita downloads. `local-runtime/` compila e serve a prévia; `scripts/update-project.mjs` atualiza projetos. [ROADMAP.md](docs/ROADMAP.md) mantém capacidades ainda não implementadas.

O nome interno `yampi-theme-sync` permanece nos formatos de exportação e armazenamento para compatibilidade com projetos e históricos existentes. [Configuração da conta](docs/CHROME-WEB-STORE.md).

Referências: [editor Yampi](https://docs.yampi.com.br/editor-codigo/intro), [MAIN/ISOLATED](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [cascata CSS](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction), [JSON Merge Patch](https://www.rfc-editor.org/rfc/rfc7396), [painel lateral](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
