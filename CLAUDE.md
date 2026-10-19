@AGENTS.md

## Armadilhas

Uma linha por armadilha; o detalhe fica no documento indicado.

- O texto do CodeMirror não prova que a Yampi gravou: só a releitura depois de recarregar a aba confirma o servidor. → `docs/SPEC.md`, "Envio".
- A extensão cria arquivos só pelos controles do próprio editor (Adicionar arquivo, envio de imagens), cuja marcação foi lida no módulo público e reproduzida no editor fictício; mudou a marcação real, mude os dois juntos. → `docs/SPEC.md`, "O que a Yampi permite".
- A Yampi não cria pastas e guarda imagens só direto em `assets/images`: imagens de subpastas mudam de caminho na loja, e as referências literais são reescritas no envio. → `docs/SPEC.md`, "Imagens".
- `elements/scripts/components.twig` é gerado pela Yampi; enviá-lo concorreria com a regeneração feita ao criar um componente. → `docs/SPEC.md`, "Comparação".
- Um `.vue` criado pela Yampi nasce com o componente padrão dela, não vazio. → `src/core/model.ts`, `YAMPI_VUE_TEMPLATE`.
- O editor real mostra imagens guardadas como endereço `data:`, e a CSP da página bloqueia `fetch()` nelas: decodifique, não baixe. O editor fictício tem a mesma CSP. → `src/core/model.ts`, `dataUrlBytes`.
- Gravar no editor muda só a prévia da Yampi; clientes veem depois de Publicar, que a extensão nunca aciona. → `docs/SPEC.md`, "Envio".
- O painel lateral morre ao trocar de aba; operações longas rodam no documento offscreen, que só tem `chrome.runtime`: tudo passa pelo worker. → `docs/SPEC.md`, "Execução em segundo plano".
- Continuar ou recomeçar um envio depende do que o registro mostra feito, não do estado: um backup que falhou também termina `stopped`. → `src/core/workflow.ts`, `continues`.
- Aba oculta desacelera temporizadores (1 s, depois 1 min): as esperas da ponte reagem a mudanças no DOM, não a `setTimeout` encadeado. → `src/browser/bridge.ts`, `until`.
- Downloads do worker não aparecem para o CDP; o e2e os espera por `chrome.downloads.search`. → `scripts/side-panel-test.mjs`, `waitExtensionDownload`.
- A única escrita fora da loja troca um arquivo existente de `tema/` que ainda está como na comparação, por clique do usuário; não crie arquivos nem pastas no projeto. → `docs/SPEC.md`, "Escrita na pasta do projeto".
- `job:<aba>` divide o `storage.session` com as sessões: quem lista sessões ignora chaves com `:`. → `src/browser/background.ts`, `sessions`.
- A cópia lê pelo servidor do editor só os tipos cuja amostra saiu igual ao CodeMirror; o editor reformata JSON ao mostrar, então JSON fica com a leitura pelo editor. → `docs/SPEC.md`, "Leitura direta".
- Trocar de loja em outra aba pode mudar a loja da sessão sem mudar o cabeçalho do editor aberto; o próprio editor detecta isso por `merchant-identity` (lido no módulo público, não validado numa loja real). → `docs/SPEC.md`, "Leitura direta".
- Com **Efeitos de transparência** desligado no Windows, `prefers-reduced-transparency` vale `reduce` e as barras ficam foscas, sem refração: emule o valor para conferir o vidro. → `docs/INTERFACE.md`, "Material".
