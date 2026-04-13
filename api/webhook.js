import fs from 'fs';
import path from 'path';

// Banco em memória
const banco = {
  conversas: {},
  mensagens: {},
  intervencao: {},
  visitas: [], // Para relatório
  config: null
};

// Carregar configuração
function carregarConfig() {
  try {
    const tmpPath = path.join('/tmp', 'config.json');
    const defaultPath = path.join(process.cwd(), 'data', 'config.json');
    
    // Prioriza /tmp (onde treinar.js salva)
    const configPath = fs.existsSync(tmpPath) ? tmpPath : defaultPath;
    
    const data = fs.readFileSync(configPath, 'utf8');
    banco.config = JSON.parse(data);
    console.log('✅ Config carregada');
  } catch (e) {
    console.error('❌ Erro config:', e);
    // Fallback
    banco.config = {
      saudacao: "Olá! Sou o assistente de Reforma. Como posso ajudar?\n\n1️⃣ Reforma\n2️⃣ Marcenaria\n3️⃣ Construção\n4️⃣ Atendente",
      respostas_rapidas: {},
      fluxos: {},
      palavras_intervencao: ["atendente", "humano"],
      resposta_intervencao: "Transferindo..."
    };
  }
}

carregarConfig();
// Recarrega a cada 30 segundos (para pegar alterações do treinar)
setInterval(carregarConfig, 30000);

// CONFIGURAÇÕES TELEGRAM
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // VERIFICAÇÃO WEBHOOK
  if (req.method === 'GET' && !req.query.acao) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === 'roboatendente') {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }
  
  // API PAINEL - Listar conversas
  if (req.method === 'GET' && req.query.acao === 'conversas') {
    const lista = Object.keys(banco.conversas).map(tel => ({
      telefone: tel,
      nome: banco.conversas[tel].nome,
      intervencao: banco.intervencao[tel] || false,
      ultima: banco.mensagens[tel]?.slice(-1)[0]?.texto?.substring(0, 30) + '...' || '...'
    }));
    return res.json(lista);
  }
  
  // API PAINEL - Mensagens
  if (req.method === 'GET' && req.query.acao === 'mensagens') {
    return res.json(banco.mensagens[req.query.telefone] || []);
  }
  
  // RECEBER MENSAGEM WHATSAPP
  if (req.method === 'POST' && !req.query.acao) {
    try {
      const body = req.body;
      
      if (body.object === 'whatsapp_business_account') {
        const value = body.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];
        
        if (message?.type === 'text') {
          const tel = message.from;
          const nome = value.contacts?.[0]?.profile?.name || 'Cliente';
          const texto = message.text.body;
          
          // Salvar
          if (!banco.conversas[tel]) banco.conversas[tel] = { nome, etapa: 'inicio', dados: {} };
          if (!banco.mensagens[tel]) banco.mensagens[tel] = [];
          
          banco.mensagens[tel].push({
            tipo: 'cliente', nome, texto,
            hora: new Date().toLocaleTimeString('pt-BR')
          });
          
          // Se intervenção ativa, não responde
          if (banco.intervencao[tel]) {
            return res.status(200).send('OK');
          }
          
          // GERAR RESPOSTA
          const resp = processarMensagem(tel, nome, texto);
          
          if (resp) {
            await enviarWhatsApp(tel, resp);
            banco.mensagens[tel].push({
              tipo: 'robo', nome: 'Robô', texto: resp,
              hora: new Date().toLocaleTimeString('pt-BR')
            });
          }
        }
      }
      
      return res.status(200).send('OK');
    } catch (e) {
      console.error('Erro:', e);
      return res.status(200).send('OK');
    }
  }
  
  // AÇÕES DO PAINEL
  if (req.method === 'POST') {
    const { acao } = req.query;
    const body = req.body;
    
    if (acao === 'intervir') {
      banco.intervencao[body.telefone] = true;
      await enviarWhatsApp(body.telefone, banco.config.resposta_intervencao);
      return res.json({ ok: true });
    }
    
    if (acao === 'liberar') {
      banco.intervencao[body.telefone] = false;
      await enviarWhatsApp(body.telefone, '🤖 Robô retomou. Como posso ajudar?');
      return res.json({ ok: true });
    }
    
    if (acao === 'enviar') {
      await enviarWhatsApp(body.telefone, body.mensagem);
      banco.mensagens[body.telefone].push({
        tipo: 'humano', nome: 'Você', texto: body.mensagem,
        hora: new Date().toLocaleTimeString('pt-BR')
      });
      return res.json({ ok: true });
    }
  }
  
  res.status(405).end();
}

// PROCESSAR MENSAGEM DO CLIENTE
function processarMensagem(tel, nome, texto) {
  const t = texto.toLowerCase();
  const chat = banco.conversas[tel];
  const config = banco.config;
  
  // Verificar intervenção
  for (const palavra of config.palavras_intervencao) {
    if (t.includes(palavra)) {
      banco.intervencao[tel] = true;
      enviarTelegram(`🚨 *INTERVENÇÃO*\n\n👤 ${nome}\n📱 ${tel}\n💬 ${texto}`);
      return config.resposta_intervencao;
    }
  }
  
  // Respostas rápidas
  for (const [chaves, resp] of Object.entries(config.respostas_rapidas)) {
    if (chaves.split('|').some(c => t.includes(c))) {
      return resp;
    }
  }
  
  // Fluxo Reforma
  if (t.includes('1') || t.includes('reforma')) {
    chat.etapa = 'ref_comodo';
    return config.fluxos.reforma.pergunta_1;
  }
  
  if (chat.etapa === 'ref_comodo') {
    chat.dados.comodo = texto;
    chat.etapa = 'ref_bairro';
    return config.fluxos.reforma.pergunta_2;
  }
  
  if (chat.etapa === 'ref_bairro') {
    chat.dados.bairro = texto;
    chat.etapa = 'ref_desc';
    return config.fluxos.reforma.pergunta_3;
  }
  
  if (chat.etapa === 'ref_desc') {
    chat.dados.descricao = texto;
    chat.etapa = 'ref_contato';
    return config.fluxos.reforma.pergunta_4;
  }
  
  if (chat.etapa === 'ref_contato') {
    chat.dados.contato = texto;
    chat.etapa = 'inicio';
    
    // MARCOU VISITA - Salvar e notificar
    const visita = {
      nome, telefone: tel,
      servico: 'Reforma',
      comodo: chat.dados.comodo,
      bairro: chat.dados.bairro,
      descricao: chat.dados.descricao,
      contato: chat.dados.contato,
      data: new Date().toLocaleDateString('pt-BR'),
      hora: new Date().toLocaleTimeString('pt-BR')
    };
    
    banco.visitas.push(visita);
    
    // NOTIFICAR TELEGRAM VISITA MARCADA
    enviarTelegram(`✅ *VISITA MARCADA*\n\n👤 ${nome}\n📱 ${tel}\n🏠 ${chat.dados.comodo}\n📍 ${chat.dados.bairro}\n📝 ${chat.dados.descricao}\n📞 ${texto}\n⏰ ${visita.hora}`);
    
    return config.fluxos.reforma.final;
  }
  
  // Fluxo Marcenaria
  if (t.includes('2') || t.includes('marcenaria')) {
    chat.etapa = 'marc_moveis';
    return config.fluxos.marcenaria.pergunta_1;
  }
  
  if (chat.etapa === 'marc_moveis') {
    chat.dados.moveis = texto;
    chat.etapa = 'marc_medidas';
    return config.fluxos.marcenaria.pergunta_2;
  }
  
  if (chat.etapa === 'marc_medidas') {
    chat.dados.medidas = texto;
    chat.etapa = 'inicio';
    
    enviarTelegram(`🪚 *MARCENARIA*\n\n👤 ${nome}\n📱 ${tel}\n🪑 ${chat.dados.moveis}\n📐 ${texto}`);
    
    return config.fluxos.marcenaria.final;
  }
  
  // Fluxo Construção
  if (t.includes('3') || t.includes('construção') || t.includes('construcao')) {
    chat.etapa = 'cons_tipo';
    return config.fluxos.construcao.pergunta_1;
  }
  
  if (chat.etapa === 'cons_tipo') {
    chat.dados.tipo = texto;
    chat.etapa = 'inicio';
    
    enviarTelegram(`🏗️ *CONSTRUÇÃO*\n\n👤 ${nome}\n📱 ${tel}\n🏗️ ${texto}`);
    
    return config.fluxos.construcao.final;
  }
  
  // Saudação
  if (t.includes('oi') || t.includes('olá') || t.includes('ola') || t.includes('bom dia')) {
    return config.saudacao.replace('{nome}', nome);
  }
  
  // Padrão
  return `Entendi, ${nome}. Posso ajudar com:\n\n1️⃣ Orçamento de reforma\n2️⃣ Marcenaria\n3️⃣ Construção\n4️⃣ Falar com atendente`;
}

// ENVIAR WHATSAPP
async function enviarWhatsApp(numero, texto) {
  try {
    await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numero,
        type: 'text',
        text: { body: texto }
      })
    });
  } catch (e) {
    console.error('Erro WhatsApp:', e);
  }
}

// ENVIAR TELEGRAM
async function enviarTelegram(texto) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT,
        text: texto,
        parse_mode: 'Markdown'
      })
    });
    console.log('📤 Telegram enviado');
  } catch (e) {
    console.error('Erro Telegram:', e);
  }
}

// RELATÓRIO DIÁRIO 19H
// Vercel não suporta cron nativo, então usamos uma API externa ou verificamos a cada requisição
// Alternativa: configurar um serviço externo para chamar /api/relatorio às 19h

export { banco }; // Exportar para usar no relatório
