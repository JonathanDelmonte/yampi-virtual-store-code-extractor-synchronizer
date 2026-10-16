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
