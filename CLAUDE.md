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
