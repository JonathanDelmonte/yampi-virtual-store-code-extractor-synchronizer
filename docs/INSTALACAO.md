# Instalação local

**[Baixar extensão pronta para Chrome](https://github.com/JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer/releases/latest/download/zirtuno-sync-yampi.zip)** · [SHA-256](https://github.com/JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer/releases/latest/download/zirtuno-sync-yampi.zip.sha256)

O link sempre oferece a versão marcada como mais recente. A versão deste código é **0.5.0**. Use o arquivo **zirtuno-sync-yampi.zip** em Releases; os downloads **Source code** contêm o projeto para desenvolvimento, sem a extensão compilada.

1. Extraia `zirtuno-sync-yampi.zip` em uma pasta fixa chamada `zirtuno-sync-yampi`. Não carregue o ZIP diretamente. Depois de extrair, pode apagar o ZIP e seu arquivo SHA-256; mantenha a pasta carregada no Chrome.
2. Abra a página de extensões do Chrome (`chrome://extensions`) ou Edge (`edge://extensions`). O painel lateral depende da API `sidePanel`, disponível no Chrome 120 ou posterior. Outros navegadores não foram validados.
3. Ative o modo de desenvolvedor e escolha **Carregar sem compactação** / **Load unpacked**.
4. Selecione a pasta que contém `manifest.json`. Mantenha os demais arquivos e as pastas `icons/` e `brand/` juntos.
5. Fixe o ícone de código da extensão. O texto ao passar o mouse orienta a abrir o **Editor de código da Yampi**. Abra o editor da loja e clique no ícone.

Se clicar fora do editor, a extensão abre uma orientação no painel lateral. Clique em **Abrir editor de código da Yampi** para acessar o editor na mesma aba; se necessário, faça login. Depois que o editor carregar, clique novamente no ícone para conectar. Esse caminho não inicia uma exportação e não cria uma nova aba.

Para atualizar uma instalação anterior da versão 0.2/0.3, extraia o novo ZIP sobre os arquivos da mesma pasta que você carregou no Chrome. Abra `chrome://extensions` e clique em **Recarregar** no cartão da extensão, que passa a se chamar **Zirtuno Sync Yampi**. Feche o painel antigo da extensão, recarregue a aba do editor sem rascunhos pendentes e clique no ícone. Usar uma pasta diferente pode criar uma nova identidade da extensão e separar os backups existentes; preserve a pasta instalada para atualizar.

Neste repositório, `npm ci` e `npm run package`, com Node 24, preparam **`releases/zirtuno-sync-yampi/`**. Essa é a pasta pronta para selecionar em **Carregar sem compactação**. As próximas execuções de `npm run package` atualizam a mesma pasta; depois, clique em **Recarregar** no cartão da extensão. O nome da pasta permanece fixo entre versões. O diretório `releases/` é local e ignorado pelo Git; os downloads públicos ficam na seção Releases do GitHub.

Durante desenvolvimento, `npm run build` também atualiza a pasta `dist`, usada na demonstração e nos testes. Em seguida, recarregue a aba Yampi, sem rascunhos pendentes, para substituir o adaptador anterior.

O pacote é uma versão local de desenvolvimento, sem instalação automática ou aprovação de uma loja oficial de extensões. A versão 0.5 deve ser acompanhada no primeiro envio real, conferindo tudo em Ver prévia antes de publicar. A gravação foi testada somente no editor fictício, inclusive em Chromium com extensão Manifest V3. O teste usa permissão adicional somente na cópia temporária; o proprietário concluiu uma exportação textual real na 0.2.3, mas a captura da 0.4.0 ainda precisa de nova conferência no painel e numa vitrine reais. Qualquer teste real de gravação depende de instruções específicas sobre ambiente e arquivo.

Ao clicar no ícone dentro do editor, abre-se um painel lateral na mesma aba. Confira a loja no topo e clique em **Confirmar e baixar ZIP**. Nenhum arquivo é aberto ou copiado antes desse botão, e nenhum arquivo precisa ser importado para exportar. A extensão abre os arquivos para leitura, sem editar, salvar, excluir ou publicar conteúdo na Yampi. O worker bloqueia comandos de gravação durante a cópia. Acompanhe o progresso; o ZIP é baixado ao concluir. Um erro interrompe a cópia e mostra o motivo.

Extraia a exportação fora do repositório da extensão e abra essa pasta no VS Code. Execute `npm ci` e `npm run dev` com Node 24 e edite `tema/`. Para devolver, abra **Enviar projeto** e escolha a pasta inteira do projeto (ou o ZIP de `npm run pack`). A comparação com a loja começa automaticamente e mostra um resumo. Clique em **Enviar** e confirme: a extensão cria os arquivos novos, envia as imagens novas e salva os alterados pelo próprio editor da Yampi, conferindo cada item. A loja de destino aparece na confirmação e é conferida a cada etapa; um projeto de outra loja é recusado.

Mantenha a aba da Yampi aberta, sem edições manuais enquanto a extensão trabalha. Não troque a loja ou o tema na mesma sessão. Salve ou descarte rascunhos pendentes manualmente antes de iniciar. Imagens novas são enviadas para `assets/images`, a única pasta de imagens que a Yampi aceita; imagens existentes não são substituídas. A extensão nunca aciona **Publicar loja**, nem exclui ou renomeia.

Dados das lojas nunca devem ser copiados para o repositório da extensão. A cópia original e os backups são guardados localmente; a extensão não os envia ao GitHub.

## Contexto visual na 0.4.0

Deixe a captura visual marcada e autorize a origem da vitrine quando o Chrome solicitar. Imagens, fontes e a API pública de catálogo (`api.dooki.com.br`, somente leituras anônimas) ficam em outras origens; o painel lista esses destinos: clique em **Autorizar recursos e finalizar ZIP**. Uma dependência de CSS pode exigir outra autorização. **Baixar com prévia parcial** registra recursos ausentes; negar/desmarcar a captura visual mantém a cópia do código com prévia demonstrativa. Nenhuma permissão global é concedida automaticamente.

A configuração publicada pode diferir do rascunho. Extraia a nova exportação em outra pasta; não substitua um projeto que já editou. Confira `preview/report.json`, execute `npm run check:integrity`, `npm run check` e depois `npm run dev`. O `check` grava `.cache/yampi-check.json` com seções por página e a comparação do CSS publicado. O ZIP inclui os recursos visuais capturados para uso local. Eles não entram no retorno à Yampi. Para levar um projeto antigo à 0.4.0, use o atualizador descrito no README com `--preview` e a nova exportação: ele troca ferramentas, pacote e `preview/`, preserva `tema/` e permite desfazer.

Imagens, fontes e estilos públicos são baixados em até quatro requisições simultâneas. Ao autorizar uma origem adicional, a mesma exportação reaproveita recursos válidos já lidos. Cada nova exportação começa sem esse cache. A etapa **Preparando ZIP** usa um worker local e permite cancelamento; o código e as imagens da loja são preservados integralmente.
