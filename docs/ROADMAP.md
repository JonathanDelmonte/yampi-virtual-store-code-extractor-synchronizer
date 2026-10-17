# Próximas etapas

**Estado em 16/10/2026:** versão 0.6.0, com as operações em segundo plano, progresso, retomada de envios interrompidos, comparação parcial e o painel por etapas, validada somente com o editor fictício. Numa loja real, a 0.5.0 criou 18 textos e enviou uma imagem, conferidos após recarregar. Próxima etapa: envio real controlado com a 0.6.0, acompanhado pelo proprietário, conferindo textos alterados, as demais imagens, o painel fechado no meio do envio, a retomada, o caminho de `assets_url` e a restauração. Histórico em [JOURNAL.md](JOURNAL.md).

## Validação controlada do adaptador real

1. Instalar a versão local e validar `activeTab`, isolamento de painel/worker e permissões no navegador utilizado.
2. Exportar uma loja autorizada com a 0.4.0, conferir inventário, hashes, `preview/report.json > contract` e `.cache/yampi-check.json`. Confirmar em Chromium as seções, fontes, ícones e imagens das páginas capturadas.
3. Usar uma loja de teste ou um tema em rascunho expressamente escolhido pelo usuário para validar salvar, histórico de versões, recarregamento e restauração. Nunca publicar automaticamente.
4. Testar falha de conexão, interrupção durante save e troca de tema; fortalecer a identificação oficial de loja/tema se a interface fornecer esse dado.

## Pendências da análise da 0.3.4

- **Plataforma a confirmar:** precedência entre `window.data.config` e `themeConfig.sections`; formato das URLs do thumbor; demais rotas da API pública (`flags`, `placeholders/*`, `count`, recomendações) e seus formatos; regras do minificador além das normalizadas; se a plataforma carrega o CSS da biblioteca Splide; regeneração de `elements/scripts/components.twig` ao criar componentes; URL de produção gerada por `assets_url`/`asset()`.
- **Rascunho:** capturar o contexto pela prévia do editor ("Ver prévia"), para associar o rascunho exportado sem depender da vitrine publicada.
- **Editor:** ler pelo mesmo endpoint de leitura do editor, somente com GET, registrando identificador remoto e versão por arquivo; fechar as abas abertas pela extensão e restaurar as do usuário. Ambos exigem validação no editor real.
- **Logs:** exportar `logs/` como somente leitura em `.yampi-sync/logs/`, nunca enviado de volta. Hoje o manifesto registra a pasta como ignorada.

## Arquivos novos e imagens do tema

Exportação de imagens PNG/JPG/JPEG/WebP/SVG implementada, com ciclo completo de PNG testado no editor fictício; conferir os demais formatos, preview/CORS e a equivalência dos bytes na Yampi real. Investigar controles reais de criação e substituição de imagens. Desde a 0.5.0, a extensão cria textos novos e envia imagens novas pelos controles do próprio editor, e imagens de subpastas vão para `assets/images` com as referências reescritas ([SPEC.md](SPEC.md)). O módulo do editor mostra que a Yampi não cria pastas nem substitui imagens. Falta conferir na Yampi real a criação pelo editor, a URL que `assets_url` gera e a leitura das imagens enviadas. Substituir uma imagem existente exigiria excluir; renomear e excluir continuam desativados e exigem um desenho separado de recuperação.

## Configurações e catálogo

São dados distintos dos arquivos do tema. A 0.4.0 captura os objetos públicos da vitrine, leituras públicas de catálogo exigidas pelas seções visíveis e recursos locais, com origem e limites explícitos. Exportação completa de catálogo/configurações operacionais e sua importação continuam fora do escopo. A importação desses dados deve considerar IDs, estoque, campos obrigatórios e alterações que afetam a operação da loja. Não tratá-los como simples arquivos de código.

## Manutenção

Histórico de envios isolado por loja, originais independentes, projeto local portátil, check de compilação e importação da pasta inteira/ZIP estão implementados. Ampliar a compatibilidade Twig/Sass/Vue 2 e simular plugins próprios exige exemplos fictícios das estruturas suportadas. A comparação por linhas existe desde a 0.6.0. Retomar uma exportação interrompida (hoje ela recomeça) e a identificação oficial de tema ainda podem ser adicionadas. O proprietário autorizou o código público; projetos e dados das lojas continuam excluídos deste repositório público.
