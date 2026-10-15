# Yampi Code Sync

Extensão independente para copiar o código do editor Yampi, trabalhar no computador e devolver os textos escolhidos com comparação e backup. O repositório público contém somente a ferramenta e exemplos fictícios; projetos e dados de lojas ficam fora dele.

## Versão 0.3.4

A cópia usa uma única chamada ao adaptador por comando após a conexão. Imagens, fontes e estilos públicos são baixados em até quatro requisições simultâneas, com reaproveitamento das respostas válidas dentro da mesma exportação quando outra origem exige autorização. A compactação ocorre em um worker local, mantendo o painel responsivo. PNG/JPEG/WebP/WOFF2 preservam seus bytes no ZIP, sem uma segunda compressão desnecessária. A navegação pelos arquivos do editor permanece sequencial, com as mesmas verificações de estabilidade e integridade. [Auditoria e medições reproduzíveis](docs/AUDITORIA.md).

Nome do repositório, pacote e pasta de desenvolvimento: **yampi-virtual-store-code-extractor-synchronizer**. No Chrome e no painel, o nome curto é **Yampi Code Sync**, desenvolvido por **Zirtuno**. O ícone usa a logo fornecida pelo proprietário; sua versão original está em `assets/yampi-code-sync-logo.png`. A descrição curta deixa a finalidade mais clara no cartão de extensões. O espaçamento desse cartão é controlado pelo Chrome.

O painel preserva os tutoriais e as seções abertas, com bordas arredondadas, ações em azul petróleo e tons suaves derivados da marca Zirtuno. A assinatura discreta no cabeçalho abre seu Instagram somente ao clicar. Abas com sublinhado, confirmações visíveis e transições curtas orientam cada etapa; movimento reduzido e navegação por teclado continuam respeitados. [Proposta visual e nome técnico](docs/INTERFACE.md).

O novo ícone de código informa no hover que a extensão precisa do **Editor de código da Yampi**. Fora dessa tela, o clique abre uma orientação com botão para acessar o editor na mesma aba. Dentro do editor, abre diretamente o painel de cópia e envio. Nenhuma cópia começa ao abrir o painel.

A exportação separa a cópia do código da captura visual e informa origem, recursos ausentes e alcance da validação. Compilar sem erros não comprova a aparência de uma loja real. A mudança de interface não amplia a validação real descrita abaixo.

| Pasta/arquivo | Uso |
|---|---|
| `tema/` | Código editável, copiado do editor |
| `.yampi-sync/baseline/` e `manifest.json` | Originais, tamanhos e SHA-256 para comparar e devolver código |
| `preview/` | Contexto visual, páginas de amostra, recursos, manifesto e relatório separados |
| `local.data.json` | Contexto editável; alterações do usuário prevalecem sem trocar o item da rota |
| `local.config.json` | Templates, estilos globais/mobile/por página e aliases |
| `.yampi-sync/tools/` | Ferramentas portáteis para Twig/Sass/Vue 2, integridade e retorno |

A leitura confere identidade, inventário antes/depois e documento completo do CodeMirror, sob lock de leitura. Os hashes comprovam integridade. O inventário estável observado no DOM **não é uma auditoria independente da completude remota**. Logs do editor ficam fora do tema.

Quando há configuração declarativa compatível no editor, ela tem prioridade. O contexto complementar vem da vitrine pública, sem cookies, credenciais ou execução dos scripts dessa vitrine. `published-unverified` significa que a publicação pode diferir do rascunho. Configuração do editor com recursos publicados também permanece uma **prévia parcial**. Contexto inacessível gera uma prévia demonstrativa identificada.

## Instalar e exportar

Baixe em [Releases](https://github.com/ZIRTUNO/yampi-virtual-store-code-extractor-synchronizer/releases), extraia o ZIP da extensão e carregue a pasta em `chrome://extensions`, com modo de desenvolvedor e **Carregar sem compactação**. Para atualizar, substitua os arquivos na mesma pasta instalada e recarregue o cartão. O ZIP pode ser apagado depois da extração; mantenha a pasta instalada enquanto a extensão estiver em uso. [Instruções completas](docs/INSTALACAO.md).

1. Abra `https://app.yampi.com.br/store/code-editor/` e clique no ícone. O painel abre na própria aba, sem copiar automaticamente. Se estiver em outra tela, a extensão mostra **Abrir editor de código da Yampi**; use esse botão e clique novamente no ícone depois que o editor carregar.
2. Confira a loja. Deixe **Incluir contexto visual da vitrine publicada** marcado e clique em **Confirmar e baixar ZIP**. O Chrome pede leitura da origem da vitrine. Negar permite copiar o código com prévia demonstrativa.
3. Para imagens/fontes em outras origens, o painel lista os destinos e aguarda **Autorizar recursos e finalizar ZIP**. CSS pode revelar outras dependências e exigir outra autorização. **Baixar com prévia parcial** mantém as falhas no relatório. Nenhum arquivo da Yampi é editado, salvo, excluído, criado, renomeado ou publicado durante a cópia.
4. Extraia a exportação fora deste repositório e abra a pasta ou seu `.code-workspace` no VS Code. O nome vem do editor; somente nomes de arquivo/pacote são normalizados para Windows.

Com Node.js 24, no terminal da pasta exportada:

```powershell
npm ci
npm run check:integrity
npm run check
npm run dev
```

Abra `http://127.0.0.1:5182`, escolha uma página e edite `tema/`. Produtos/categorias capturados possuem rotas distintas. Imagens, ícones e fontes incluídos usam `preview/assets/`, sem acesso à vitrine. A instalação inicial de dependências usa o registro npm.

## Captura e diagnóstico

A captura estática aceita literais, objetos, arrays e JSON/base64 declarativos conhecidos. Expressões dinâmicas, getters e chamadas arbitrárias não são executados. A allowlist seleciona identidade visual, parâmetros, seções e campos de apresentação. HTML bruto, scripts, autenticação, checkout, cookies, pedidos e dados de clientes ficam fora do pacote. Trata-se de uma amostra visual, sem exportação completa do catálogo/banco de configurações.

PNG/JPEG/WebP/SVG, CSS e WOFF/WOFF2/TTF/OTF são validados, identificados por SHA-256 e deduplicados. Cada recurso registra URL pública, caminho, tipo, tamanho e hash. URLs privadas, credenciais em URL, redirecionamentos, tipos desconhecidos e SVG ativo são recusados. Falhas ficam explícitas; assets locais ausentes não recebem sucesso silencioso.

Máximos: 7 páginas, 24 produtos por amostra, 120 recursos, 2 MiB por recurso/página/JSON, 24 MiB de recursos e 15 segundos por leitura HTTP. O gerador aceita limites menores; a interface usa os máximos. Recortes são registrados, sem truncar JSON. Até dois produtos e duas categorias são priorizados além da home. Mais de 32 origens interrompem a preparação.

`preview/report.json` separa seis estados: código/inventário, configuração/associação, assets, compilação, inicialização e verificação visual. No ZIP novo, compilação/inicialização ainda não foram executadas e a aparência está `not-validated`. O servidor oferece `/__local/diagnostic.json`; o navegador expõe `__yampiLocalReady` e `__yampiLocalMessages`, com erros e avisos Vue visíveis. HTTP 200 não certifica inicialização ou aparência. O banner local distingue prévia parcial/demonstrativa.

A folha compilada respeita o ponto de inclusão no template e não é duplicada depois do CSS personalizado. Fontes capturadas são resolvidas localmente. Helpers consideram família/peso e estilo/cor; imagens saem de `-loading` também em cache. Busca, filtros, mixins e estado usam contratos explícitos. Módulos desconhecidos falham com diagnóstico, sem substituições vazias para esconder incompatibilidade.

Preços refletem a data da captura, sem estoque/preço em tempo real. SKUs priorizam `selected_sku_id`, depois a primeira variante capturada não bloqueada. Valores formatados e por pagamento são preservados; não há regra de seleção por nome de licença. O intervalo local derivado usa apenas preços finitos da amostra, identificado como `captured-sample`, sem representar o catálogo inteiro. Carrinho, checkout, pagamentos, formulários e gravações reais permanecem bloqueados.

## Devolver e recuperar

Execute `npm run pack` e importe `retorno-yampi.zip` em **Enviar alterações**, ou escolha a pasta inteira. Pacote/importador considera somente `tema/`, manifesto e originais; preview, relatórios, ferramentas e dependências ficam fora. Formatos antigos 1/2 e ZIP com uma raiz externa continuam aceitos.

| Situação | Resultado |
|---|---|
| Local mudou; loja igual ao original | Pode ser selecionado |
| Local e loja iguais | Não grava novamente |
| Mudou só na loja | Preserva a loja |
| Ambos mudaram de formas diferentes | Bloqueia conflito |
| Arquivo ausente localmente | Não exclui |
| Arquivo novo ou imagem alterada | Bloqueia envio |

Após revisar, digite o nome para confirmar o destino. Backup persistido/baixado precede a gravação; cada texto é relido antes de salvar e conferido após reload. A operação para no primeiro erro e mantém o registro parcial. **Comparar para restaurar** protege alterações posteriores. Não há sobrescrita forçada nem publicação automática.

Sem transação atômica do servidor, uma edição externa entre ler e salvar ainda pode ocorrer. Não edite simultaneamente nem troque loja/tema durante o envio. Imagens alteradas, criação, renomeação e exclusão permanecem bloqueadas. Confira na Yampi antes de publicar manualmente. Gravações reais exigem ambiente/arquivo de teste expressamente escolhido pelo proprietário.

## Atualizar projetos antigos

Extraia uma nova exportação **em outra pasta** para obter contexto visual. Atualizar ferramentas antigas não recupera dados que nunca vieram no ZIP.

Nesta pasta da extensão, mostre o plano e depois aplique:

```powershell
node scripts/update-project.mjs "C:/caminho/do/projeto"
node scripts/update-project.mjs "C:/caminho/do/projeto" --apply
```

O atualizador confere originais e hashes de ferramentas conhecidas, recusa ferramentas personalizadas/links e preserva `tema/`, baseline/manifesto, configuração, dados e preview. Preserva scripts personalizados; dependências incompatíveis exigem ajuste explícito, sem regenerar silenciosamente o lockfile. Guarda bytes anteriores/registro em `.yampi-sync/updates/`, reconfere arquivos contra edições concorrentes e para no primeiro erro. Não executa scripts do projeto nem chama a Yampi. Depois execute `npm ci`, `check:integrity`, `check` e `pack` no projeto atualizado.

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

`npm run dev` oferece a demonstração fictícia em `http://127.0.0.1:5181/demo.html?demo=1`. O pacote contém 17 arquivos permitidos e sai temporariamente em `.cache/package/yampi-code-sync-0.3.4.zip`, com SHA-256. Esses dois arquivos podem ser removidos depois de confirmar o upload em Releases; a geração não acumula instaladores em `releases/`. Ícones são redimensionados localmente a partir da logo autorizada, preservando proporções e transparência. Sharp é uma dependência de desenvolvimento e não integra o pacote da extensão. A assinatura exibida em 18 px usa uma versão de 72×72 px gerada de `assets/zirtuno-logo-source.png`; a imagem original permanece somente no código de desenvolvimento. Chrome/Edge com `sidePanel` são necessários; outros navegadores não foram validados. O painel global fica desativado e cada aba exige clique no ícone. Vue 2 é usado por compatibilidade, fora de manutenção; use projetos confiáveis e mantenha o servidor em localhost.

Testes cobrem leitura integral, escrita somente fictícia, backup, conflitos, restauração, parser, privacidade e isolamento. Duas lojas fictícias, escura/clara, têm identidade, fontes, cores, produtos e rotas distintas. ZIPs são movidos e executados com acesso à loja bloqueado. Capturas independentes de referência são comparadas com a mesma home/estado/viewport após fontes/imagens carregarem. [Resultados e evidências](docs/VALIDACAO.md).

Isso não certifica uma loja real ou todas as interações. Exportações textuais reais anteriores tiveram hashes internos conferidos fora deste repositório. Completude independente, associação exata ao rascunho, imagens reais, nova captura visual real e gravações/restaurações reais continuam sem validação completa.

## Privacidade e arquitetura

Sem telemetria. `activeTab`/`scripting` operam a aba escolhida; o editor é lido explicitamente em `MAIN`, dentro de seu componente. HTTPS é uma permissão **opcional**; a interface solicita somente origens concretas. O worker exige painel/sessão autenticados, lock de leitura, permissão da origem e identidade antes/depois do GET, com `credentials: omit`, `redirect: error` e sem referrer. Nenhum acesso global é concedido automaticamente.

Originais e histórico ficam em IndexedDB local, separados por loja, sem criptografia adicional. ZIPs podem conter conteúdo privado. A extensão não envia projetos ao GitHub. Mantenha exports/backups fora deste repositório e revise qualquer publicação. [Licenças](docs/TERCEIROS.md).

`src/core/preview.ts` define formato/allowlist; `src/browser/preview-capture.ts` faz captura estática; `public-fetch.ts` limita downloads. Worker/painel coordenam permissões. `local-runtime/` compila/serve a prévia; `scripts/update-project.mjs` atualiza ferramentas. [ROADMAP.md](docs/ROADMAP.md) mantém capacidades ainda não implementadas.

O nome interno `yampi-theme-sync` permanece nos formatos de exportação e armazenamento para compatibilidade com projetos e históricos existentes. A autoria do manifesto não altera o nome público do editor na Chrome Web Store; esse campo pertence à conta de desenvolvedor. [Configuração da conta](docs/CHROME-WEB-STORE.md).

Referências: [editor Yampi](https://docs.yampi.com.br/editor-codigo/intro), [MAIN/ISOLATED](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [cascata CSS](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction), [painel lateral](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
