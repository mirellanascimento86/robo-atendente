// API para o painel de intervenção - Dados em tempo real
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const { acao } = req.query;
  
  try {
    switch (acao) {
      case 'conversas':
        return await getConversas(res);
      case 'mensagens':
        return await getMensagens(req, res);
      case 'intervir':
        return await intervir(req, res);
      case 'liberar':
        return await liberar(req, res);
      case 'enviar':
        return await enviarMensagem(req, res);
      case 'agenda':
        return await getAgenda(res);
      case 'ocupar':
        return await ocuparHorario(req, res);
      default:
        return res.status(400).json({ erro: 'Ação inválida' });
    }
  } catch (e) {
    console.error('Erro painel-data:', e);
    return res.status(500).json({ erro: e.message });
  }
}

async function getConversas(res) {
  // Buscar todas as sessões
  const { data: sessoes } = await supabase
    .from('sessoes')
    .select('*')
    .order('ultima_atividade', { ascending: false });
  
  // Buscar intervenções ativas
  const { data: intervencoes } = await supabase
    .from('intervencoes')
    .select('*')
    .eq('ativa', true);
  
  const intervMap = new Map(intervencoes?.map(i => [i.telefone, i]));
  
  // Buscar última mensagem de cada conversa
  const conversas = [];
  
  for (const sessao of sessoes || []) {
    const { data: ultimaMsg } = await supabase
      .from('mensagens')
      .select('mensagem, timestamp, tipo')
      .eq('telefone', sessao.telefone)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();
    
    conversas.push({
      telefone: sessao.telefone,
      nome: sessao.nome,
      etapa: sessao.etapa,
      dados: sessao.dados,
      intervencao: !!intervMap.get(sessao.telefone),
      ultimaMensagem: ultimaMsg?.mensagem || 'Sem mensagens',
      ultimaHora: ultimaMsg?.timestamp || sessao.ultima_atividade,
      tipoUltima: ultimaMsg?.tipo || 'desconhecido'
    });
  }
  
  return res.json(conversas);
}

async function getMensagens(req, res) {
  const { telefone } = req.query;
  
  const { data: mensagens } = await supabase
    .from('mensagens')
    .select('*')
    .eq('telefone', telefone)
    .order('timestamp', { ascending: true });
  
  return res.json(mensagens || []);
}

async function intervir(req, res) {
  const { telefone } = req.body;
  
  await supabase.from('intervencoes').upsert({
    telefone,
    ativa: true,
    inicio: new Date().toISOString()
  });
  
  return res.json({ sucesso: true });
}

async function liberar(req, res) {
  const { telefone } = req.body;
  
  await supabase.from('intervencoes')
    .update({ ativa: false, fim: new Date().toISOString() })
    .eq('telefone', telefone);
  
  // Resetar sessão
  await supabase.from('sessoes')
    .update({ etapa: 'INICIO', dados: {} })
    .eq('telefone', telefone);
  
  return res.json({ sucesso: true });
}

async function enviarMensagem(req, res) {
  const { telefone, mensagem } = req.body;
  
  // Salvar no banco
  await supabase.from('mensagens').insert({
    telefone,
    mensagem,
    tipo: 'humano',
    remetente: 'Atendente',
    timestamp: new Date().toISOString()
  });
  
  // Enviar via WhatsApp Cloud API
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  
  if (token && phoneId) {
    try {
      await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: telefone,
          type: 'text',
          text: { body: mensagem }
        })
      });
    } catch (e) {
      console.error('Erro ao enviar WhatsApp:', e);
    }
  }
  
  return res.json({ sucesso: true });
}

async function getAgenda(res) {
  const hoje = new Date().toISOString().split('T')[0];
  
  const { data: agenda } = await supabase
    .from('agenda')
    .select('*')
    .gte('data', hoje)
    .order('data', { ascending: true })
    .order('horario', { ascending: true });
  
  return res.json(agenda || []);
}

async function ocuparHorario(req, res) {
  const { data, horario, tecnico } = req.body;
  
  await supabase.from('agenda').insert({
    data,
    horario,
    tecnico,
    status: 'ocupado',
    timestamp: new Date().toISOString()
  });
  
  return res.json({ sucesso: true });
}
