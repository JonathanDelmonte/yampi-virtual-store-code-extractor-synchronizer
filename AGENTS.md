# Instruções do projeto

- O proprietário autorizou tornar público este repositório em 07/10/2026. Compartilhe somente o código da ferramenta e exemplos fictícios. Não publique pacotes em uma loja de extensões sem novo pedido do usuário.
- Não copie temas, catálogo, exportações, backups, cookies, credenciais ou dados de clientes para o repositório. Testes usam apenas exemplos fictícios. Revise o conteúdo completo do índice antes de cada push.
- O projeto da extensão é separado dos projetos de redesign das lojas. Não altere arquivos desses outros projetos.
- Testes automatizados de escrita usam o editor fictício. Não use uma loja real de cliente como ambiente de teste de gravação. Para um teste real, obtenha instruções específicas do usuário sobre o ambiente e o arquivo de teste.
- Nunca acione Publicar loja, excluir ou renomear, nem tente criar pastas (a Yampi não permite). Desde a 0.5.0, a pedido do proprietário (15/10/2026), a extensão cria textos novos (Twig, Vue, SCSS) em pastas existentes e envia imagens novas para `assets/images` pelos próprios controles do editor, só depois da comparação, do backup e da confirmação do envio, conferindo cada item após recarregar.
- Mantenha comparação entre original/local/remoto, preflight, backup persistido antes da gravação, conferência após reload e proteção para alterações posteriores na restauração.
- Pare no primeiro erro e preserve o registro do envio parcial. Não sobrescreva uma alteração feita na loja sem a escolha explícita do usuário para aquele arquivo, com as versões visíveis e a da loja no backup. Não use comparação apenas por nome de arquivo.
- Use Node 24, `npm ci`, `npm run check` e `npm run package`. Amplie os testes quando a mudança afetar integridade, gravação ou isolamento de lojas.
- Limitações e estado de validação real devem continuar explícitos no README. Não anuncie suporte de exportação para produtos, configurações ou imagens antes de implementá-lo e verificá-lo.
