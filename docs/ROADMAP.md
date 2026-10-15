# Próximas etapas

**Estado em 15/10/2026:** versão 0.3.7, validada somente com o editor fictício; nenhuma gravação real foi feita. Próxima etapa: validação controlada do envio real, com loja e arquivo de teste escolhidos pelo proprietário. Histórico em [JOURNAL.md](JOURNAL.md).

## Validação controlada do adaptador real

1. Instalar a versão local e validar `activeTab`, isolamento de painel/worker e permissões no navegador utilizado.
2. Exportar uma loja autorizada, conferir o inventário, os hashes e arquivos de mesmo nome em pastas distintas. Verificar tempos de carregamento em rede lenta.
3. Usar uma loja de teste ou um tema em rascunho expressamente escolhido pelo usuário para validar salvar, histórico de versões, recarregamento e restauração. Nunca publicar automaticamente.
4. Testar falha de conexão, interrupção durante save e troca de tema; fortalecer a identificação oficial de loja/tema se a interface fornecer esse dado.

## Arquivos novos e imagens do tema

Exportação de imagens PNG/JPG/JPEG/WebP/SVG implementada, com ciclo completo de PNG testado no editor fictício; conferir os demais formatos, preview/CORS e a equivalência dos bytes na Yampi real. Investigar controles reais de criação e substituição de imagens. Desde a 0.3.7, um texto novo criado vazio à mão no editor da Yampi é preenchido pela extensão, e texto novo ausente na loja bloqueia o envio ([SPEC.md](SPEC.md)); a criação continua manual. Confirmar na Yampi real se `assets/images` aceita subpastas e qual URL `assets_url` gera para elas. A Yampi não permite criar pastas livremente. Upload binário exige backup/restauração de bytes e conferência após reload; permanece bloqueado. Renomear e excluir exigem um desenho separado de recuperação; continuam desativados.

## Configurações e catálogo

São dados distintos dos arquivos do tema. A 0.3.0 captura uma amostra visual estática, recursos locais e configurações permitidas, com origem/limites explícitos. Validar essa captura em lojas reais e ampliar formatos declarativos suportados. Exportação completa de catálogo/configurações operacionais e sua importação continuam fora do escopo. A importação desses dados deve considerar IDs, estoque, campos obrigatórios e alterações que afetam a operação da loja. Não tratá-los como simples arquivos de código.

## Manutenção

Histórico de envios isolado por loja, originais independentes, projeto local portátil, check de compilação e importação da pasta inteira/ZIP estão implementados na 0.2. Ampliar a compatibilidade Twig/Sass/Vue 2 e simular plugins próprios exige exemplos fictícios das estruturas suportadas. Recuperação de uma exportação interrompida, comparação por linhas e identificação oficial de tema ainda podem ser adicionadas. O proprietário autorizou o código público; projetos e dados das lojas continuam excluídos deste repositório público.

## Nome do projeto exportado — implementado na 0.2.4

O nome exato lido do editor é preservado no manifesto, no README e nos dados de prévia. O pacote npm e o workspace do VS Code recebem uma versão normalizada desse nome, respeitando nomes reservados do Windows. O nome local pode ser alterado sem modificar a identidade da sincronização. O ZIP mantém sua estrutura portátil, com `tema/` como pasta editável. Projetos de lojas podem ser enviados a repositórios privados somente quando seu proprietário solicitar; continuam separados deste repositório público.
