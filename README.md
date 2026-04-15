# robo-atendente
readme = '''# 🤖 Robô de Atendimento - RC Reforma e Construção

Sistema de atendimento automatizado humanizado para WhatsApp Business API, com painel de intervenção humana e treinamento via web.

## ✨ Funcionalidades

- **Respostas Fluidas**: Sem botões, sem emojis, conversa natural
- **Painel de Intervenção**: Interface tipo WhatsApp Web para atendimento humano
- **Painel de Treinamento**: Configure respostas do robô sem tocar no código
- **Persistência**: Tudo salvo no Supabase (PostgreSQL)
- **Mobile First**: Funciona perfeitamente em qualquer celular
- **Realtime**: Atualizações em tempo real via WebSocket

## 🚀 Deploy na Vercel

1. **Fork/Clone este repositório**

2. **Criar projeto no Supabase:**
   - Acesse [supabase.com](https://supabase.com)
   - Crie novo projeto
   - No SQL Editor, execute o conteúdo de `schema.sql`
   - Copie URL e anon key (Settings > API)

3. **Configurar Vercel:**
   ```bash
   npm i -g vercel
   vercel
   ```

4. **Variáveis de Ambiente (Vercel Dashboard):**
   ```
   SUPABASE_URL=https://seu-projeto.supabase.co
   SUPABASE_KEY=sua-anon-key
   WHATSAPP_TOKEN=seu-token-whatsapp
   WHATSAPP_PHONE_ID=seu-phone-id
   TELEGRAM_BOT_TOKEN=seu-token-telegram (opcional)
   TELEGRAM_CHAT_ID=seu-chat-id (opcional)
   NUMERO_RC=seu-numero-whatsapp
   ```

5. **Configurar WhatsApp Webhook:**
   - No Meta Developers, configure webhook: `https://seu-projeto.vercel.app/api/webhook`
   - Verify token: `roboatendente`
   - Subscreva em: `messages`

## 📱 Acessos

- **Painel de Atendimento**: `https://seu-projeto.vercel.app/painel`
- **Painel de Treinamento**: `https://seu-projeto.vercel.app/treinamento`

## 🗄️ Estrutura do Supabase

### Tabelas:
- `configs`: Configurações do robô (respostas, preços)
- `mensagens`: Histórico de conversas
- `clientes`: Estado atual de cada cliente
- `intervencoes`: Controle de intervenção humana
- `agendamentos`: Visitas agendadas
- `respostas_personalizadas`: Respostas customizadas
- `fluxo_conversa`: Etapas do fluxo

## 🔧 Personalização

No painel de treinamento você pode editar:
- Saudações e mensagens iniciais
- Respostas sobre preços
- Objecções (quando cliente acha caro)
- Bairros atendidos
- Serviços oferecidos
- Palavras que ativam intervenção humana
- Fluxo completo da conversa

## 📞 Suporte

RC Reforma e Construção - Botafogo, Rio de Janeiro
'''

print("Arquivos de configuração criados:")
print(f"- package.json ({len(package_json)} chars)")
print(f"- vercel.json ({len(vercel_json)} chars)")
print(f"- README.md ({len(readme)} chars)")
print(f"- schema.sql ({len(schema_sql)} chars)")
