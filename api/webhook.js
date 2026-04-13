import { redis, KEYS } from './_util/redis.js';

// Cache local (memória) para performance
let cacheConfig = null;
let cacheHora = 0;

// Banco em memória para mensagens (Redis é lento para chat em tempo real)
const memoria = {
  mensagens: {},
  conversas: {},
  estados: {},
  intervencao: {}
};

// Carregar config do Redis (com cache 10 segundos)
async function getConfig() {
  const agora = Date.now();
  
  // Recarregar se passou 10 segundos ou não tem cache
  if (!cacheConfig || (agora - cacheHora) > 10000) {
    try {
      let config = await redis.get(KEYS.config);
      
      if (!config) {
        // Se não existe no Redis, usar padrão do treinar.js
        return null;
      }
      
      if (typeof config === 'string') {
        config = JSON.parse(config);
      }
      
      cacheConfig = config;
      cacheHora = agora;
      
      console.log('🔄 Config recarregada do banco');
      
    } catch (e) {
      console.error('Erro carregar config:', e);
    }
  }
  
  return cacheConfig;
}

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
  
  // --- GET: Listar conversas ---
  if (req.method === 'GET' && query.acao === 'listar') {
    const lista = Object.keys(memoria.conversas).map(tel => ({
      telefone: tel,
      nome: memoria.conversas[tel].nome || 'Cliente',
      intervencao: !!memoria.intervencao[tel],
      ultima: memoria.mensagens[tel]?.slice(-1)[0]?.texto?.substring(0, 40) + '...' || '...'
    }));
    return res.json(lista);
  }
  
  // --- GET: Buscar mensagens ---
  if (req.method === 'GET' && query.acao === 'mensagens') {
    return res.json(memoria.mensagens[query.telefone] || []);
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
      
      // Inicializar se novo
      if (!memoria.conversas[telefone]) {
        memoria.conversas[telefone] = { nome, inicio: new Date().toISOString() };
        memoria.mensagens[telefone] = [];
        memoria.estados[telefone] = 'inicio';
        memoria.intervencao[telefone] = false; // Garantir que começa false
      }
      
      // Salvar mensagem
      memoria.mensagens[telefone].push({
        tipo: 'cliente',
        nome: nome,
        texto: texto,
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      // Se em intervenção, não responde (mas salva a mensagem!)
      if (memoria.intervencao[telefone]) {
        console.log('👤 Intervenção ativa - mensagem salva, robô não responde');
        return res.status(200).send('OK');
      }
      
      // Carregar config do banco
      const config = await getConfig();
      
      if (!config) {
        // Se não tem config, usar mensagem padrão
        await enviarWhatsApp(telefone, 'Olá! Estou em manutenção. Tente novamente em instantes.');
        return res.status(200).send('OK');
      }
      
      // Processar e responder
      const resp = processar(telefone, nome, texto, config);
      
      if (resp) {
        await enviarWhatsApp(telefone, resp);
        memoria.mensagens[telefone].push({
          tipo: 'robo',
          nome: 'Robô',
          texto: resp,
          hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
        });
      }
      
      return res.status(200).send('OK');
      
    } catch (e) {
      console.error('❌ Erro:', e);
      return res.status(200).send('OK');
    }
  }
  
  // --- POST: Ações do painel ---
  if (req.method === 'POST') {
    const { acao } = query;
    const body = req.body;
    const tel = body.telefone;
    
    if (!tel) {
      return res.json({ erro: 'Telefone não informado' });
    }
    
    // INTERVIR - Assumir controle (CORRIGIDO: não responde nada, só muda estado)
    if (acao === 'intervir') {
      console.log(`🚨 Intervindo em ${tel}`);
      
      // LIMPAR ESTADO PRIMEIRO
      memoria.estados[tel] = 'inicio';
      memoria.intervencao[tel] = true;
      
      // Carregar config para mensagem de intervenção
      const config = await getConfig();
      const msgIntervencao = config?.intervencao?.mensagem || 'Atendente humano assumiu.';
      
      // Enviar mensagem de intervenção
      await enviarWhatsApp(tel, msgIntervencao);
      
      // Registrar no histórico
      memoria.mensagens[tel].push({
        tipo: 'sistema',
        nome: 'Sistema',
        texto: '[Atendente humano assumiu o controle]',
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      return res.json({ ok: true, status: 'intervencao_ativada' });
    }
    
    // LIBERAR - Devolver ao robô (CORRIGIDO: limpa tudo)
    if (acao === 'liberar') {
      console.log(`🤖 Liberando ${tel}`);
      
      // LIMPAR COMPLETAMENTE
      memoria.intervencao[tel] = false;
      memoria.estados[tel] = 'inicio';
      
      // Enviar mensagem
      await enviarWhatsApp(tel, '🤖 Robô retomou o atendimento. Como posso ajudar?');
      
      memoria.mensagens[tel].push({
        tipo: 'sistema',
        nome: 'Sistema',
        texto: '[Robô retomou o atendimento]',
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      return res.json({ ok: true, status: 'robo_ativado' });
    }
    
    // ENVIAR - Mensagem humana
    if (acao === 'enviar') {
      if (!memoria.intervencao[tel]) {
        return res.json({ erro: 'Não está em intervenção. Clique em ASSUMIR primeiro.' });
      }
      
      await enviarWhatsApp(tel, body.mensagem);
      
      memoria.mensagens[tel].push({
        tipo: 'humano',
        nome: 'Você',
        texto: body.mensagem,
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      return res.json({ ok: true });
    }
  }
  
  res.status(405).end();
}

// ============================================
// PROCESSAR MENSAGEM COM CONFIG DO BANCO
// ============================================

function processar(tel, nome, texto, config) {
  const t = texto.toLowerCase();
  const estado = memoria.estados[tel];
  
  // 1. Verificar intervenção
  for (const p of config.intervencao.palavras) {
    if (t.includes(p.toLowerCase())) {
      memoria.intervencao[tel] = true;
      memoria.estados[tel] = 'inicio';
      return config.intervencao.mensagem;
    }
  }
  
  // 2. Respostas rápidas
  for (const [chaves, resp] of Object.entries(config.respostas)) {
    if (chaves.split('|').some(c => t.includes(c.toLowerCase()))) {
      return resp;
    }
  }
  
  // 3. Fluxo Reforma
  if (t.includes('1') || t.includes('reforma')) {
    memoria.estados[tel] = 'ref1';
    return config.fluxo_reforma.p1;
  }
  
  if (estado === 'ref1') { memoria.estados[tel] = 'ref2'; return config.fluxo_reforma.p2; }
  if (estado === 'ref2') { memoria.estados[tel] = 'ref3'; return config.fluxo_reforma.p3; }
  if (estado === 'ref3') { memoria.estados[tel] = 'ref4'; return config.fluxo_reforma.p4; }
  if (estado === 'ref4') { 
    memoria.estados[tel] = 'inicio'; 
    return config.fluxo_reforma.final; 
  }
  
  // 4. Fluxo Marcenaria
  if (t.includes('2') || t.includes('marcenaria')) {
    memoria.estados[tel] = 'marc1';
    return config.fluxo_marcenaria.p1;
  }
  
  if (estado === 'marc1') { memoria.estados[tel] = 'marc2'; return config.fluxo_marcenaria.p2; }
  if (estado === 'marc2') { 
    memoria.estados[tel] = 'inicio'; 
    return config.fluxo_marcenaria.final; 
  }
  
  // 5. Fluxo Construção
  if (t.includes('3') || t.includes('construção') || t.includes('construcao')) {
    memoria.estados[tel] = 'cons1';
    return config.fluxo_construcao.p1;
  }
  
  if (estado === 'cons1') { 
    memoria.estados[tel] = 'inicio'; 
    return config.fluxo_construcao.final; 
  }
  
  // 6. Saudação
  if (t.includes('oi') || t.includes('olá') || t.includes('ola') || t.includes('bom') || t.includes('boa')) {
    return config.saudacao;
  }
  
  // 7. Padrão
  return `Olá ${nome}! 👋\n\nPosso ajudar com:\n\n1️⃣ Orçamento de reforma\n2️⃣ Marcenaria sob medida\n3️⃣ Construção civil\n4️⃣ Falar com atendente\n\nO que você precisa?`;
}

// ============================================
// ENVIAR WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
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
    
    if (!res.ok) {
      const erro = await res.json();
      console.error('❌ Erro WhatsApp API:', erro);
    } else {
      console.log('📤 Enviado para', numero);
    }
    
  } catch (e) {
    console.error('❌ Erro enviar:', e);
  }
}
