import fs from 'fs/promises';
import path from 'path';

// Banco em memória
const banco = {
  conversas: {},
  mensagens: {},
  intervencao: {},
  config: null // Carregado do arquivo
};

// Carregar configuração do arquivo
async function carregarConfig() {
  try {
    const configPath = path.join(process.cwd(), 'data', 'config.json');
    const dados = await fs.readFile(configPath, 'utf8');
    banco.config = JSON.parse(dados);
    console.log('✅ Configuração carregada');
  } catch (e) {
    console.error('❌ Erro ao carregar config:', e);
    // Configuração padrão de emergência
    banco.config = {
      saudacao: "Olá! Sou o assistente de Reforma e Construção. Como posso ajudar?",
      respostas_rapidas: {},
      fluxos: {},
      palavras_intervencao: ["atendente", "humano"],
      resposta_intervencao: "Transferindo para atendente..."
    };
  }
}

// Carregar no início
carregarConfig();

export default async function handler(req, res) {
  
  // VERIFICAÇÃO GET (Meta)
  if (req.method === 'GET' && !req.query.acao) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === 'roboatendente') {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }
  
  // API DO PAINEL - Listar conversas
  if (req.method === 'GET' && req.query.acao === 'conversas') {
    const lista = Object.keys(banco.conversas).map(tel => ({
      telefone: tel,
      nome: banco.conversas[tel].nome,
      intervencao: banco.intervencao[tel] || false,
      ultima: banco.mensagens[tel]?.slice(-1)[0]?.texto?.substring(0, 30) + '...' || '...'
    }));
    return res.json(lista);
  }
  
  // API DO PAINEL - Buscar mensagens
  if (req.method === 'GET' && req.query.acao === 'mensagens') {
    const tel = req.query.telefone;
    return res.json(banco.mensagens[tel] || []);
  }
  
  // RECEBER MENSAGEM DO WHATSAPP
  if (req.method === 'POST' && !req.query.acao) {
    try {
      const body = req.body;
      
      if (body.object === 'whatsapp_business_account') {
        const value = body.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];
        
        if (message && message.type === 'text') {
          const telefone = message.from;
          const nome = value.contacts?.[0]?.profile?.name || 'Cliente';
          const texto = message.text.body;
          
          console.log(`📩 ${nome}: ${texto}`);
          
          // Salvar no banco
          if (!banco.conversas[telefone]) {
            banco.conversas[telefone] = { nome, data: new Date().toISOString() };
          }
          if (!banco.mensagens[telefone]) {
            banco.mensagens[telefone] = [];
          }
          
          banco.mensagens[telefone].push({
            tipo: 'cliente',
            nome: nome,
            texto: texto,
            hora: new Date().toLocaleTimeString('pt-BR')
          });
          
          // VERIFICAR INTERVENÇÃO
          if (banco.intervencao[telefone]) {
            console.log('👤 Intervenção ativa - robô não responde');
            return res.status(200).send('OK');
          }
          
          // GERAR RESPOSTA DO ROBÔ (lê do arquivo config)
          const resposta = gerarRespostaRobo(texto, nome);
          
          await enviarWhatsApp(telefone, resposta);
          
          banco.mensagens[telefone].push({
            tipo: 'robo',
            nome: 'Robô',
            texto: resposta,
            hora: new Date().toLocaleTimeString('pt-BR')
          });
        }
      }
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('Erro:', erro);
      return res.status(200).send('OK');
    }
  }
  
  // AÇÕES DO PAINEL (POST com query acao)
  if (req.method === 'POST' && req.query.acao) {
    const { acao } = req.query;
    const body = req.body;
    
    // INTERVIR
    if (acao === 'intervir') {
      banco.intervencao[body.telefone] = true;
      await enviarWhatsApp(body.telefone, banco.config.resposta_intervencao);
      return res.json({ ok: true });
    }
    
    // LIBERAR
    if (acao === 'liberar') {
      banco.intervencao[body.telefone] = false;
      await enviarWhatsApp(body.telefone, '🤖 Robô retomou o atendimento. Como posso ajudar?');
      return res.json({ ok: true });
    }
    
    // ENVIAR MENSAGEM HUMANA
    if (acao === 'enviar') {
      await enviarWhatsApp(body.telefone, body.mensagem);
      
      banco.mensagens[body.telefone].push({
        tipo: 'humano',
        nome: 'Você',
        texto: body.mensagem,
        hora: new Date().toLocaleTimeString('pt-BR')
      });
      
      return res.json({ ok: true });
    }
    
    return res.json({ erro: 'Ação inválida' });
  }
  
  res.status(405).end();
}

// FUNÇÃO: GERAR RESPOSTA DO ROBÔ (lê do arquivo config.json)
function gerarRespostaRobo(mensagem, nome) {
  const t = mensagem.toLowerCase();
  const config = banco.config;
  
  // 1. VERIFICAR PALAVRAS DE INTERVENÇÃO
  for (const palavra of config.palavras_intervencao) {
    if (t.includes(palavra.toLowerCase())) {
      return config.resposta_intervencao;
    }
  }
  
  // 2. VERIFICAR RESPOSTAS RÁPIDAS
  for (const [chaves, resposta] of Object.entries(config.respostas_rapidas)) {
    const listaChaves = chaves.split('|');
    if (listaChaves.some(chave => t.includes(chave.toLowerCase()))) {
      return resposta;
    }
  }
  
  // 3. DETECTAR FLUXO (1, 2, 3 ou palavras-chave)
  if (t.includes('1') || t.includes('orçamento') || t.includes('reforma')) {
    return config.fluxos.orcamento_reforma.pergunta_1;
  }
  
  if (t.includes('2') || t.includes('marcenaria') || t.includes('móvel') || t.includes('armário')) {
    return config.fluxos.marcenaria.pergunta_1;
  }
  
  if (t.includes('3') || t.includes('construção') || t.includes('obra') || t.includes('casa')) {
    return config.fluxos.construcao.pergunta_1;
  }
  
  // 4. SAUDAÇÃO
  if (t.includes('oi') || t.includes('olá') || t.includes('ola') || t.includes('bom dia') || t.includes('boa tarde') || t.includes('boa noite')) {
    return config.saudacao.replace('{nome}', nome);
  }
  
  // 5. RESPOSTA PADRÃO
  return `Entendi, ${nome}. 🤔\n\nPosso ajudar com:\n\n1️⃣ Orçamento de reforma\n2️⃣ Marcenaria sob medida\n3️⃣ Construção civil\n4️⃣ Falar com atendente\n\nO que você precisa?`;
}

// ENVIAR WHATSAPP
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
    console.log('📤 Enviado');
  } catch (e) {
    console.error('Erro ao enviar:', e);
  }
}
