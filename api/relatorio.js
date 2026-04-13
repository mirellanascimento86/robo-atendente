import { banco } from './webhook.js';

export default async function handler(req, res) {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;
  
  const hoje = new Date().toLocaleDateString('pt-BR');
  
  // Filtrar visitas de hoje
  const visitasHoje = banco.visitas.filter(v => v.data === hoje);
  
  if (visitasHoje.length === 0) {
    await enviarTelegram(TELEGRAM_TOKEN, TELEGRAM_CHAT, `📊 *RELATÓRIO ${hoje}*\n\nNenhuma visita marcada hoje.`);
    return res.json({ mensagem: 'Sem visitas hoje' });
  }
  
  let texto = `📊 *RELATÓRIO DIÁRIO - ${hoje}*\n\n`;
  texto += `*Total de atendimentos:* ${visitasHoje.length}\n\n`;
  
  visitasHoje.forEach((v, i) => {
    texto += `*${i + 1}.* ${v.nome}\n`;
    texto += `   📱 ${v.telefone}\n`;
    texto += `   🏠 ${v.servico} - ${v.comodo || v.tipo || ''}\n`;
    texto += `   📍 ${v.bairro || 'Não informado'}\n`;
    texto += `   ⏰ ${v.hora}\n\n`;
  });
  
  await enviarTelegram(TELEGRAM_TOKEN, TELEGRAM_CHAT, texto);
  
  // Limpar visitas do dia (opcional)
  banco.visitas = banco.visitas.filter(v => v.data !== hoje);
  
  res.json({ ok: true, enviados: visitasHoje.length });
}

async function enviarTelegram(token, chat, texto) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: texto,
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    console.error('Erro:', e);
  }
}
