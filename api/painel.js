// ============================================
// PAINEL DE INTERVENÇÃO - BACKEND
// ============================================

import fs from 'fs/promises';

// Banco em memória
const conversas = {};
const mensagens = {};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  
  // GET - Buscar dados
  if (req.method === 'GET') {
    const { acao, telefone } = req.query;
    
    // Listar todas as conversas ativas
    if (acao === 'listar') {
      const lista = Object.keys(conversas).map(tel => ({
        telefone: tel,
        nome: conversas[tel].nome || 'Desconhecido',
        status: conversas[tel].intervencao ? '🔴 INTERVENÇÃO' : '🟢 ROBÔ',
        ultimaMsg: mensagens[tel]?.slice(-1)[0]?.texto?.substring(0, 30) + '...' || '...',
        intervencao: conversas[tel].intervencao || false
      }));
      return res.json(lista);
    }
    
    // Buscar mensagens de uma conversa específica
    if (acao === 'mensagens' && telefone) {
      return res.json(mensagens[telefone] || []);
    }
    
    return res.json({ erro: 'Ação inválida' });
  }
  
  // POST - Ações do painel
  if (req.method === 'POST') {
    const { acao, telefone, texto } = req.body;
    
    // INTERVIR - Assumir controle
    if (acao === 'intervir' && telefone) {
      if (!conversas[telefone]) conversas[telefone] = {};
      conversas[telefone].intervencao = true;
      
      // Notificar cliente que atendente assumiu
      await enviarWhatsApp(telefone, '👤 *Atendente humano entrou no chat*\n\nComo posso ajudar?');
      
      return res.json({ ok: true, mensagem: 'Intervenção ativada' });
    }
    
    // LIBERAR - Devolver ao robô
    if (acao === 'liberar' && telefone) {
      if (conversas[telefone]) {
        conversas[telefone].intervencao = false;
      }
      
      await enviarWhatsApp(telefone, '🤖 *Robô retomou o atendimento*\n\nPosso ajudar em algo mais?');
      
      return res.json({ ok: true, mensagem: 'Robô liberado' });
    }
    
    // ENVIAR - Enviar mensagem humana
    if (acao === 'enviar' && telefone && texto) {
      await enviarWhatsApp(telefone, texto);
      
      // Salvar no histórico
      if (!mensagens[telefone]) mensagens[telefone] = [];
      mensagens[telefone].push({
        tipo: 'humano',
        nome: 'Atendente',
        texto: texto,
        data: new Date().toISOString()
      });
      
      return res.json({ ok: true });
    }
    
    return res.json({ erro: 'Ação inválida' });
  }
  
  res.status(405).json({ erro: 'Método não permitido' });
}

// Função para enviar WhatsApp
async function enviarWhatsApp(numero, mensagem) {
  const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
  const TOKEN = process.env.WHATSAPP_TOKEN;
  
  try {
    await fetch(`https://graph.facebook.com/v18.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numero,
        type: 'text',
        text: { body: mensagem }
      })
    });
  } catch (e) {
    console.error('Erro ao enviar:', e);
  }
}

// Exportar para webhook usar
export { conversas, mensagens };
