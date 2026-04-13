import { 
  salvarMensagem, 
  buscarMensagens, 
  listarConversas,
  salvarVisita,
  buscarVisitasHoje 
} from './_util/supabase.js';
import { gerarRespostaIA } from './_util/groq.js';

// PROMPT DO VENDEDOR PROFISSIONAL
const PROMPT_VENDEDOR = `Você é Carlos, consultor técnico sênior da Conecta Serviços há 8 anos. 
Perfil: profissional, confiante, consultivo, nunca desesperado por venda.

PRINCÍPIOS DE VENDA:
1. PRIMEIRO entender, DEPOIS propor
2. Nunca dê preço antes de qualificar (saber o que precisa)
3. Crie valor antes de falar de dinheiro
3.5. Use técnicas de vendas: escassez, autoridade, prova social
4. Negocie com elegância (nunca desconto fácil)
5. Sempre tenha próximo passo claro

ESTRUTURA DE ATENDIMENTO:
1. SAUDAÇÃO: calorosa, profissional, curta
2. DIAGNÓSTICO: entender situação (perguntas específicas)
3. QUALIFICAÇÃO: BTUs, metragem, bairro, urgência, etc
4. CONSTRUÇÃO DE VALOR: "entendo que isso está te causando..."
5. PROPOSTA: valor da visita + o que inclui
6. NEGOCIAÇÃO: se necessário, com condições
7. FECHAMENTO: agendamento com data/hora
8. ENCAMINHAMENTO: passar para técnico com contexto completo

REGRAS DE OURO:
- NUNCA diga "só um minuto", "deixa eu ver"
- NUNCA peça desculpas excessivas
- SEMPRE assuma controle da conversa (você guia, cliente responde)
- Use "porque" sempre que possível (autoridade científica)
- Limite de 3 mensagens curtas, não textão

PREÇOS DE VISITA (só informar na etapa proposta):
- Reforma: R$150 

Se cliente pedir desconto: "Consigo ajustar para R$X se confirmarmos hoje para [data próxima]."

Se cliente hesitar: "Entendo que quer avaliar. Só lembrando que [fator urgência/escassez]. Qual sua maior dúvida?"

Se cliente mandar foto/vídeo: "Perfeito, consigo ver [descrever]. Isso confirma que [diagnóstico]."`;

// Config Telegram
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;

// Estado em memória (intervenção ativa)
const intervençãoAtiva = {};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams);
  
  // --- GET: Verificação Meta ---
  if (req.method === 'GET' && query['hub.mode']) {
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === 'roboatendente') {
      return res.status(200).send(query['hub.challenge']);
    }
    return res.status(403).send('Forbidden');
  }
  
  // --- GET: Listar conversas (com histórico do Supabase) ---
  if (req.method === 'GET' && query.acao === 'listar') {
    const conversas = await listarConversas();
    return res.json(conversas.map(c => ({
      telefone: c.telefone,
      nome: c.nome,
      intervencao: !!intervençãoAtiva[c.telefone],
      ultima: c.ultima?.substring(0, 40) + '...' || '...',
      data: new Date(c.ultima_data).toLocaleDateString('pt-BR')
    })));
  }
  
  // --- GET: Buscar mensagens (histórico completo) ---
  if (req.method === 'GET' && query.acao === 'mensagens') {
    const msgs = await buscarMensagens(query.telefone, 100); // Últimas 100 mensagens
    return res.json(msgs);
  }
  
  // --- GET: Relatório diário ---
  if (req.method === 'GET' && query.acao === 'relatorio') {
    return enviarRelatorioDiario(res);
  }
  
  // --- POST: Receber mensagem WhatsApp ---
  if (req.method === 'POST' && !query.acao) {
    try {
      const body = req.body;
      
      if (body.object !== 'whatsapp_business_account') {
        return res.status(200).send('OK');
      }
      
      const value = body.entry?.[0]?.changes?.[0]?.value;
      const message = value?.messages?.[0];
      
      if (!message || message.type !== 'text') {
        return res.status(200).send('OK');
      }
      
      const telefone = message.from;
      const nome = value.contacts?.[0]?.profile?.name || 'Cliente';
      const texto = message.text.body;
      
      console.log(`📩 ${nome} (${telefone}): ${texto}`);
      
      // Salvar mensagem do cliente no banco
      await salvarMensagem(telefone, nome, 'cliente', texto);
      
      // Se em intervenção, não responde
      if (intervençãoAtiva[telefone]) {
        // Notificar Telegram que chegou mensagem
        enviarTelegram(`💬 *Mensagem durante intervenção*
        
👤 ${nome}
📱 ${telefone}
📝 ${texto.substring(0, 100)}`);
        
        return res.status(200).send('OK');
      }
      
      // Buscar histórico para contexto da IA
      const historico = await buscarMensagens(telefone, 20);
      
      // GERAR RESPOSTA COM IA (Groq)
      const respostaIA = await gerarRespostaIA(telefone, nome, texto, historico);
      
      // Se IA pediu intervenção, ativar
      if (respostaIA.intervencao) {
        intervençãoAtiva[telefone] = true;
        
        // Notificar Telegram URGENTE
        enviarTelegram(`🚨 *IA PEDIU INTERVENÇÃO*

👤 ${nome}
📱 ${telefone}
💬 "${texto.substring(0, 100)}"

Motivo: IA detectou necessidade de atendente humano

🔗 Acesse: ${process.env.VERCEL_URL || 'seu-link.vercel.app'}/painel.html`);
      }
      
      // Enviar resposta ao cliente
      await enviarWhatsApp(telefone, respostaIA.texto);
      
      // Salvar resposta da IA no banco
      await salvarMensagem(telefone, 'Robô IA', 'robo', respostaIA.texto);
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('❌ Erro:', erro);
      return res.status(200).send('OK');
    }
  }
  
  // --- POST: Ações do painel ---
  if (req.method === 'POST') {
    const { acao } = query;
    const body = req.body;
    const tel = body.telefone;
    
    if (!tel) return res.json({ erro: 'Telefone não informado' });
    
    // INTERVIR
    if (acao === 'intervir') {
      intervençãoAtiva[tel] = true;
      
      await enviarWhatsApp(tel, '🔄 Atendente humano assumiu o chat. Como posso ajudar?');
      await salvarMensagem(tel, 'Sistema', 'sistema', '[Atendente humano assumiu]');
      
      return res.json({ ok: true });
    }
    
    // LIBERAR
    if (acao === 'liberar') {
      intervençãoAtiva[tel] = false;
      
      await enviarWhatsApp(tel, '🤖 Robô IA retomou o atendimento. Como posso ajudar?');
      await salvarMensagem(tel, 'Sistema', 'sistema', '[Robô IA retomou]');
      
      return res.json({ ok: true });
    }
    
    // ENVIAR mensagem humana
    if (acao === 'enviar') {
      if (!intervençãoAtiva[tel]) {
        return res.json({ erro: 'Não está em intervenção' });
      }
      
      await enviarWhatsApp(tel, body.mensagem);
      await salvarMensagem(tel, 'Atendente', 'humano', body.mensagem);
      
      return res.json({ ok: true });
    }
    
    // SALVAR VISITA (quando você marca manualmente)
    if (acao === 'visita') {
      await salvarVisita({
        telefone: tel,
        nome: body.nome,
        servico: body.servico,
        endereco: body.endereco,
        data_visita: body.data,
        status: 'agendada'
      });
      
      enviarTelegram(`✅ *VISITA MARCADA MANUALMENTE*
      
👤 ${body.nome}
📱 ${tel}
🏠 ${body.servico}
📍 ${body.endereco}
📅 ${body.data}`);
      
      return res.json({ ok: true });
    }
  }
  
  res.status(405).end();
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

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
    console.error('❌ Erro WhatsApp:', e);
  }
}

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
  } catch (e) {
    console.error('❌ Erro Telegram:', e);
  }
}

async function enviarRelatorioDiario(res) {
  const visitas = await buscarVisitasHoje();
  
  const hoje = new Date().toLocaleDateString('pt-BR');
  
  if (visitas.length === 0) {
    enviarTelegram(`📊 *RELATÓRIO ${hoje}*\n\nNenhuma visita agendada hoje.`);
    return res?.json({ mensagem: 'Sem visitas' });
  }
  
  let texto = `📊 *RELATÓRIO DIÁRIO - ${hoje}*\n\n`;
  texto += `*Total:* ${visitas.length} visitas\n\n`;
  
  visitas.forEach((v, i) => {
    texto += `*${i + 1}.* ${v.nome}\n`;
    texto += `   📱 ${v.telefone}\n`;
    texto += `   🏠 ${v.servico}\n`;
    texto += `   📍 ${v.endereco || 'Não informado'}\n`;
    texto += `   📅 ${v.data_visita}\n`;
    texto += `   Status: ${v.status}\n\n`;
  });
  
  enviarTelegram(texto);
  res?.json({ ok: true, enviados: visitas.length });
}
