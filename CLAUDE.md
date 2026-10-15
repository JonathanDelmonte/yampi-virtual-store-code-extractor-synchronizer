@AGENTS.md

## Armadilhas

Uma linha por armadilha; o detalhe fica no documento indicado.

- O texto do CodeMirror não prova que a Yampi gravou: só a releitura depois de recarregar a aba confirma o servidor. → `docs/SPEC.md`, "Envio".
- A extensão nunca cria arquivos: um texto novo é criado vazio, à mão, no editor da Yampi, e a extensão só preenche arquivos existentes. → `docs/SPEC.md`, "Arquivos novos".
- `elements/scripts/components.twig` é gerado pela Yampi a partir dos componentes existentes; alterações locais nele são sobrescritas. → `docs/SPEC.md`, "Arquivos novos".
- Leitura de imagens enviadas à Yampi (CORS) e pastas novas em `assets/images` ainda não foram validadas numa loja real. → `README.md`, "Devolver e recuperar".
- Gravar no editor muda só a prévia da Yampi; clientes veem depois de Publicar, que a extensão nunca aciona. → `docs/SPEC.md`, "Envio".
