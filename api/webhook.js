import fs from 'fs/promises';
import path from 'path';

const CONFIG = {
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID
};

// Banco em memória + arquivo
let conhecimento = {};
let agenda = {};
let conversasAtivas = {}; // Para intervenção em tempo real

// Carregar dados ao iniciar
async function carregarDados() {
  try {
    const conh = await fs.readFile('./data/conhecimento.json', 'utf8');
    conhecimento = JSON.parse(conh);
    
    const ag = await fs.readFile('./data/agenda.json', 'utf8');
    agenda = JSON.parse(ag);
  } catch (e) {
    console.log('Usando dados padrão');
  }
}

carregarDados();

export default async function handler(req, res) {
  
  // Verificação Meta (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // Receber mensagem (POST)
  if (req.method === 'POST') {
    try {
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      
      if (!message) return res.status(200).send('OK');
      
      const telefone = message.from;
      const nome = value.contacts?.[0]?.profile?.name || 'Cliente';
      const texto = message.text?.body || '';
      
      console.log(`📩 ${telefone} (${nome}): ${texto}`);
      
      // Salvar no histórico
      await salvarMensagem(telefone, nome, 'cliente', texto);
      
      // Verificar se está em intervenção humana
      if (conversasAtivas[telefone]?.intervencao) {
        console.log('👤 Intervenção humana ativa - ignorando robô');
        return res.status(200).send('OK');
      }
      
      // Processar mensagem
      const resposta = await processarMensagem(telefone, nome, texto);
      
      // Enviar resposta
      if (resposta) {
        await enviarWhatsApp(telefone, resposta);
        await salvarMensagem(telefone, 'Robô', 'bot', resposta);
      }
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('❌ Erro:', erro);
      return res.status(200).send('OK');
    }
  }
}

// ============================================
// PROCESSAMENTO INTELIGENTE (SEM IA - 100% CÓDIGO)
// ============================================

async function processarMensagem(telefone, nome, texto) {
  const t = texto.toLowerCase().trim();
  const chat = conversasAtivas[telefone] || { etapa: 'inicio', dados: {} };
  
  // 1. Verificar palavras-chave de ação imediata
  for (const [chaves, resposta] of Object.entries(conhecimento.palavras_chave || {})) {
    const lista = chaves.split('|');
    if (lista.some(p => t.includes(p))) {
      if (chaves.includes('atendente|humano')) {
        chat.intervencao = true;
        conversasAtivas[telefone] = chat;
        await notificarTelegramIntervencao(nome, telefone, texto);
        return resposta;
      }
      return resposta;
    }
  }
  
  // 2. Fluxo de conversa baseado em etapa
  if (chat.etapa === 'inicio') {
    // Detectar intenção
    if (t.includes('1') || t.includes('ar')) {
      chat.etapa = 'ar_btus';
      chat.dados.servico = 'Ar condicionado';
      conversasAtivas[telefone] = chat;
      return conhecimento.fluxos?.ar_condicionado?.pergunta || "Quantos BTUs?";
    }
    else if (t.includes('2') || t.includes('geladeira')) {
      chat.etapa = 'geladeira_marca';
      chat.dados.servico = 'Geladeira';
      conversasAtivas[telefone] = chat;
      return "Qual a marca e modelo?";
    }
    else if (t.includes('3') || t.includes('máquina')) {
      chat.etapa = 'maquina_tipo';
      chat.dados.servico = 'Máquina de lavar';
      conversasAtivas[telefone] = chat;
      return "Qual o problema? Não liga, não centrifuga, vazamento?";
    }
    else if (t.includes('4') || t.includes('reforma')) {
      chat.etapa = 'reforma_tipo';
      chat.dados.servico = 'Reforma';
      conversasAtivas[telefone] = chat;
      return "Qual tipo de reforma? Elétrica, hidráulica, pintura?";
    }
    else if (t.includes('5')) {
      chat.intervencao = true;
      conversasAtivas[telefone] = chat;
      await notificarTelegramIntervencao(nome, telefone, texto);
      return "🔄 Transferindo para atendente humano. Aguarde...";
    }
    
    // Resposta padrão
    return conhecimento.saudacao;
  }
  
  // 3. Fluxo Ar Condicionado
  if (chat.etapa === 'ar_btus') {
    const btus = t.match(/(\d+)/);
    if (btus) {
      chat.dados.btus = btus[1];
      chat.etapa = 'ar_bairro';
      conversasAtivas[telefone] = chat;
      return "Qual bairro?";
    }
    return "Por favor, informe quantos BTUs (ex: 9000, 12000)";
  }
  
  if (chat.etapa === 'ar_bairro') {
    chat.dados.bairro = texto;
    chat.etapa = 'ar_problema';
    conversasAtivas[telefone] = chat;
    return "Qual o problema? Não gela, vazamento, barulho?";
  }
  
  if (chat.etapa === 'ar_problema') {
    chat.dados.problema = texto;
    chat.etapa = 'confirmar_visita';
    conversasAtivas[telefone] = chat;
    
    // Buscar disponibilidade
    const horarios = await buscarHorariosDisponiveis('ar');
    
    return `✅ *Resumo do atendimento:*
    
📋 Serviço: ${chat.dados.servico}
🔧 BTUs: ${chat.dados.btus}
📍 Bairro: ${chat.dados.bairro}
⚠️ Problema: ${chat.dados.problema}

💰 Visita técnica: R$140
📅 Horários disponíveis: ${horarios}

Deseja agendar? (sim/não)`;
  }
  
  // 4. Confirmação de agendamento
  if (chat.etapa === 'confirmar_visita') {
    if (t.includes('sim') || t.includes('ok') || t.includes('pode')) {
      // Realizar agendamento
      const agendamento = await realizarAgendamento(telefone, chat.dados);
      
      if (agendamento.sucesso) {
        chat.etapa = 'agendado';
        conversasAtivas[telefone] = chat;
        
        // Notificar Telegram
        await notificarTelegramAgendamento(nome, telefone, chat.dados, agendamento);
        
        return `✅ *AGENDAMENTO CONFIRMADO!*

📅 Data: ${agendamento.data}
⏰ Horário: ${agendamento.horario}
👨‍🔧 Técnico: ${agendamento.tecnico}

⚠️ O técnico entrará em contato 30min antes.

*Obrigado pela preferência!* 🙏`;
      } else {
        return `❌ Não consegui agendar. ${agendamento.erro}\n\nQuer tentar outro horário?`;
      }
    }
    else if (t.includes('não') || t.includes('nao')) {
      chat.etapa = 'inicio';
      conversasAtivas[telefone] = chat;
      return "Entendido. Posso ajudar em algo mais?\n\n" + conhecimento.saudacao;
    }
  }
  
  // 5. Respostas diretas do conhecimento
  for (const [topico, resposta] of Object.entries(conhecimento.respostas_diretas || {})) {
    if (t.includes(topico)) return resposta;
  }
  
  // Fallback
  return "Desculpe, não entendi. Pode reformular?\n\nDigite *atendente* para falar com uma pessoa.";
}

// ============================================
// FUNÇÕES DE AGENDA
// ============================================

async function buscarHorariosDisponiveis(especialidade) {
  const tecnicos = agenda.tecnicos.filter(t => 
    t.especialidade.includes(especialidade)
  );
  
  let horarios = [];
  const hoje = new Date();
  
  for (let i = 1; i <= 3; i++) {
    const data = new Date(hoje);
    data.setDate(data.getDate() + i);
    const dataStr = data.toISOString().split('T')[0];
    
    tecnicos.forEach(tec => {
      const disp = tec.disponibilidade[dataStr];
      if (disp) {
        disp.forEach(h => {
          horarios.push(`${dataStr} ${h} (${tec.nome})`);
        });
      }
    });
  }
  
  return horarios.slice(0, 5).join('\n') || "Consultar disponibilidade";
}

async function realizarAgendamento(telefone, dados) {
  // Lógica simples: pega primeiro horário disponível
  const horarios = await buscarHorariosDisponiveis('ar');
  if (!horarios.length) {
    return { sucesso: false, erro: "Sem horários disponíveis." };
  }
  
  const [data, hora, tecnico] = horarios[0].split(' ');
  
  const agendamento = {
    id: Date.now(),
    telefone,
    ...dados,
    data,
    horario: hora,
    tecnico: tecnico.replace(/[()]/g, ''),
    status: 'confirmado',
    criadoEm: new Date().toISOString()
  };
  
  agenda.visitas_agendadas.push(agendamento);
  await fs.writeFile('./data/agenda.json', JSON.stringify(agenda, null, 2));
  
  return { sucesso: true, ...agendamento };
}

// ============================================
// NOTIFICAÇÕES TELEGRAM
// ============================================

async function notificarTelegramIntervencao(nome, telefone, texto) {
  const msg = `🚨 *INTERVENÇÃO HUMANA*

👤 ${nome}
📱 ${telefone}
💬 "${texto}"

🔗 Painel: https://SEU-PROJETO.vercel.app/painel.html?telefone=${telefone}`;
  
  await enviarTelegram(msg);
}

async function notificarTelegramAgendamento(nome, telefone, dados, agendamento) {
  const msg = `✅ *NOVO AGENDAMENTO*

👤 Cliente: ${nome}
📱 ${telefone}
📋 ${dados.servico}
🔧 ${dados.btus || ''} ${dados.problema}
📍 ${dados.bairro}

📅 ${agendamento.data} às ${agendamento.horario}
👨‍🔧 Técnico: ${agendamento.tecnico}`;

  await enviarTelegram(msg);
}

async function enviarTelegram(texto) {
  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: texto,
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    console.error('Erro Telegram:', e);
  }
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

async function salvarMensagem(telefone, nome, tipo, texto) {
  const arquivo = `./data/historico_${telefone}.json`;
  let historico = [];
  
  try {
    const existe = await fs.readFile(arquivo, 'utf8');
    historico = JSON.parse(existe);
  } catch (e) {}
  
  historico.push({
    data: new Date().toISOString(),
    nome,
    tipo,
    texto
  });
  
  await fs.writeFile(arquivo, JSON.stringify(historico, null, 2));
}

async function enviarWhatsApp(telefone, mensagem) {
  try {
    await fetch(`https://graph.facebook.com/v18.0/${CONFIG.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefone,
        type: 'text',
        text: { body: mensagem }
      })
    });
  } catch (e) {
    console.error('Erro WhatsApp:', e);
  }
}
