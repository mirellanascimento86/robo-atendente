// ============================================
// RC ATENDIMENTO - VERSÃO DIAGNÓSTICO COMPLETO
// ============================================

const CONFIG = {
  tecnicos: {
    marcenaria: '5521978791765',
    reforma: '5521968112176',
    hidraulica: '5521968112176'
  },
  
  precoZonaSul: 180,
  precoOutros: 220,
  
  bairrosZonaSul: [
    'ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 
    'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 
    'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 
    'sao conrado', 'vidigal', 'rocinha'
  ],
  
  numeroRC: process.env.NUMERO_RC || ''
};

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const clientes = {};
const processadas = new Set();

// LOG INICIAL CRÍTICO
console.log('🔧 ===========================================');
console.log('🔧 INICIANDO RC ATENDIMENTO');
console.log('🔧 ===========================================');
console.log('🔧 WHATSAPP_TOKEN configurado:', WHATSAPP_TOKEN ? 'SIM (' + WHATSAPP_TOKEN.substring(0, 20) + '...)' : 'NÃO');
console.log('🔧 WHATSAPP_PHONE_ID:', WHATSAPP_PHONE_ID || 'NÃO CONFIGURADO');
console.log('🔧 NUMERO_RC:', CONFIG.numeroRC || 'NÃO CONFIGURADO');
console.log('🔧 ===========================================');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // VERIFICAÇÃO WEBHOOK (GET)
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      console.log('✅ Verificação webhook recebida');
      if (req.query['hub.verify_token'] === 'roboatendente') {
        console.log('✅ Token verificado com sucesso');
        return res.status(200).send(req.query['hub.challenge']);
      }
      console.log('❌ Token de verificação incorreto');
      return res.status(403).send('Forbidden');
    }
    
    // RECEBER MENSAGEM (POST)
    if (req.method === 'POST') {
      return await receber(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (e) {
    console.error('❌ ERRO GERAL:', e.message);
    return res.status(200).send('OK');
  }
}

async function receber(req, res) {
  const body = req.body;
  
  console.log('\n📥 ===========================================');
  console.log('📥 WEBHOOK RECEBIDO');
  console.log('📥 ===========================================');
  console.log('📥 Body:', JSON.stringify(body, null, 2).substring(0, 500));
  
  // Validações
  if (!body) {
    console.log('❌ Body vazio');
    return res.status(200).send('OK');
  }
  
  if (body.object !== 'whatsapp_business_account') {
    console.log('❌ Não é whatsapp_business_account:', body.object);
    return res.status(200).send('OK');
  }
  
  const entry = body.entry?.[0];
  if (!entry) {
    console.log('❌ Sem entry');
    return res.status(200).send('OK');
  }
  
  const changes = entry?.changes?.[0]?.value;
  if (!changes) {
    console.log('❌ Sem changes');
    return res.status(200).send('OK');
  }
  
  // IGNORA STATUS (delivery, read, sent) - EVITA LOOP
  if (changes.statuses) {
    console.log('📊 Status ignorado (anti-loop)');
    return res.status(200).send('OK');
  }
  
  const msg = changes.messages?.[0];
  if (!msg) {
    console.log('❌ Sem mensagem');
    return res.status(200).send('OK');
  }
  
  if (!msg.id) {
    console.log('❌ Mensagem sem ID');
    return res.status(200).send('OK');
  }
  
  // Anti-duplicata
  if (processadas.has(msg.id)) {
    console.log('♻️ Mensagem duplicada ignorada');
    return res.status(200).send('OK');
  }
  processadas.add(msg.id);
  
  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  console.log(`\n📨 MENSAGEM DE ${nome} (${telefone})`);
  console.log(`📨 Tipo: ${msg.type}`);
  console.log(`📨 Conteúdo: ${msg.text?.body || '[não-texto]'}`);
  
  // IGNORA PRÓPRIAS MENSAGENS
  if (telefone === CONFIG.numeroRC) {
    console.log('🤖 Mensagem própria ignorada (anti-loop)');
    return res.status(200).send('OK');
  }
  
  // PROCESSA TEXTO
  if (msg.type !== 'text') {
    if (msg.type === 'audio') {
      console.log('🎵 Áudio detectado - respondendo');
      await enviar(telefone, "No momento eu nao consigo ouvir, pode escrever?");
    }
    return res.status(200).send('OK');
  }
  
  const texto = msg.text.body;
  console.log('📝 Processando texto:', texto);
  
  // Inicializa cliente
  if (!clientes[telefone]) {
    clientes[telefone] = { nome, etapa: 'INICIO', dados: {} };
    console.log('👤 Novo cliente criado');
  }
  
  const cli = clientes[telefone];
  
  // Anti-loop temporal (2 segundos)
  const agora = Date.now();
  if (cli.ultimoTimestamp && (agora - cli.ultimoTimestamp < 2000)) {
    console.log('⏱️ Mensagem muito rápida - ignorada');
    return res.status(200).send('OK');
  }
  cli.ultimoTimestamp = agora;
  
  // PROCESSA
  console.log('🔄 Etapa atual:', cli.etapa);
  const resp = processar(cli, texto.toLowerCase(), texto);
  console.log('💬 Resposta gerada:', resp);
  
  if (resp) {
    console.log('📤 Enviando resposta...');
    const ok = await enviar(telefone, resp);
    console.log(ok ? '✅ Resposta enviada com sucesso' : '❌ FALHA AO ENVIAR RESPOSTA');
  }
  
  return res.status(200).send('OK');
}

function processar(cli, t, original) {
  const d = cli.dados;
  
  // RESPOSTAS DIRETAS
  if (t.match(/(quem e voce|voce e robo|e humano)/)) {
    return "Sou o Atendimento Digital da RC Reforma e Construcao";
  }
  
  if (t.match(/(sindico|empresa|condominio)/)) {
    return "Infelizmente o profissional esta com alta demanda e no momento nao esta prestando servicos para empresas, apenas pessoas fisicas";
  }
  
  // FLUXO
  switch (cli.etapa) {
    case 'INICIO':
      const { servico, bairro } = extrair(t, original);
      
      if (servico && bairro) {
        d.servico = servico;
        d.bairro = bairro;
        d.valor = calcValor(bairro);
        cli.etapa = 'AGUARDANDO_DATA';
        return `Perfeito. Para enviar um orcamento preciso, e necessario uma visita tecnica ao local. O valor da visita e R$${d.valor}, mas e abatido do valor final se o orcamento for aprovado. Para quando gostaria de agendar?`;
      }
      
      if (servico) {
        d.servico = servico;
        cli.etapa = 'AGUARDANDO_BAIRRO';
        return "Certo, qual o bairro que deseja atendimento?";
      }
      
      if (bairro) {
        d.bairro = bairro;
        cli.etapa = 'AGUARDANDO_SERVICO';
        return "Qual servico deseja?";
      }
      
      return "Ola! Me informe o servico e bairro que deseja atendimento";
      
    case 'AGUARDANDO_BAIRRO':
      const b = extrairBairro(t, original);
      if (b) {
        d.bairro = b;
        d.valor = calcValor(b);
        cli.etapa = 'AGUARDANDO_DATA';
        return `Para oferecer um orcamento mais preciso, e necessario que um profissional realize uma visita tecnica. O valor da visita e de R$${d.valor}, mas e abatido do valor final caso o orcamento seja aprovado. Para quando gostaria de agendar?`;
      }
      return "Certo, qual o bairro que deseja atendimento?";
      
    case 'AGUARDANDO_SERVICO':
      const s = extrairServico(t);
      if (s) {
        d.servico = s;
        d.valor = calcValor(d.bairro);
        cli.etapa = 'AGUARDANDO_DATA';
        return `Para oferecer um orcamento mais preciso, e necessario que um profissional realize uma visita tecnica. O valor da visita e de R$${d.valor}, mas e abatido do valor final caso o orcamento seja aprovado. Para quando gostaria de agendar?`;
      }
      return "Qual servico deseja?";
      
    case 'AGUARDANDO_DATA':
      if (t.match(/hoje/)) {
        d.data = 'hoje';
        cli.etapa = 'AGUARDANDO_HORARIO';
        return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
      }
      if (t.match(/amanha/)) {
        d.data = 'amanha';
        cli.etapa = 'AGUARDANDO_HORARIO';
        return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
      }
      return "Para quando gostaria de agendar?";
      
    case 'AGUARDANDO_HORARIO':
      const h = extrairHora(original) || '10:00';
      d.hora = h;
      cli.etapa = 'AGUARDANDO_ENDERECO';
      return "Qual o endereco completo para a visita?";
      
    case 'AGUARDANDO_ENDERECO':
      if (original.length > 10) {
        d.endereco = original;
        cli.etapa = 'CONFIRMAR';
        return `Pode marcar para ${d.data} as ${d.hora} com profissional ${nomeTec(d.servico)}?`;
      }
      return "Qual o endereco completo para a visita?";
      
    case 'CONFIRMAR':
      if (t.match(/(sim|pode|ok)/)) {
        cli.etapa = 'AGENDADO';
        return "Perfeito, marcado!";
      }
      return `Pode marcar para ${d.data} as ${d.hora} com profissional ${nomeTec(d.servico)}?`;
      
    case 'AGENDADO':
      return "Visita confirmada. Se precisar de algo mais, e so chamar.";
      
    default:
      return "Ola! Me informe o servico e bairro que deseja atendimento";
  }
}

// FUNÇÕES AUXILIARES
function extrair(t, txt) {
  const servicos = ['pintura', 'marcenaria', 'hidraulica', 'eletrica', 'reforma', 'azulejo', 'pedreiro', 'gesso', 'vazamento'];
  const bairros = [...CONFIG.bairrosZonaSul, 'tijuca', 'madureira', 'meier', 'vila isabel', 'barra', 'recreio'];
  
  let servico = null, bairro = null;
  
  for (const s of servicos) {
    if (t.includes(s)) { servico = s; break; }
  }
  
  for (const b of bairros) {
    if (t.includes(b)) { bairro = b; break; }
  }
  
  const m = txt.match(/(em|na|no)\s+([A-Za-z\s]+)/i);
  if (m && !bairro) {
    const p = m[2].trim().toLowerCase();
    for (const b of bairros) {
      if (p.includes(b)) { bairro = b; break; }
    }
  }
  
  return { servico, bairro };
}

function extrairServico(t) { return extrair(t, '').servico; }
function extrairBairro(t, txt) { return extrair(t, txt).bairro; }
function extrairHora(txt) {
  const m = txt.match(/(\d{1,2})[:h]?(\d{2})?/);
  return m ? `${m[1].padStart(2,'0')}:${m[2]||'00'}` : null;
}
function calcValor(b) {
  const n = b.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return CONFIG.bairrosZonaSul.some(x => n.includes(x)) ? CONFIG.precoZonaSul : CONFIG.precoOutros;
}
function nomeTec(s) {
  if (s?.match(/marcenaria/)) return "Tecnico de Marcenaria";
  if (s?.match(/hidraulica/)) return "Tecnico Hidraulico";
  return "Tecnico de Reformas";
}

// ENVIO COM DIAGNÓSTICO COMPLETO
async function enviar(numero, texto) {
  console.log(`\n📤 ===========================================`);
  console.log(`📤 ENVIANDO MENSAGEM`);
  console.log(`📤 ===========================================`);
  console.log(`📤 Para: ${numero}`);
  console.log(`📤 Texto: ${texto}`);
  console.log(`📤 -------------------------------------------`);
  
  // VERIFICA CONFIGURAÇÃO
  if (!WHATSAPP_TOKEN) {
    console.error('❌ ERRO CRÍTICO: WHATSAPP_TOKEN não está configurado!');
    console.error('❌ Vá em Vercel → Environment Variables e adicione WHATSAPP_TOKEN');
    return false;
  }
  
  if (!WHATSAPP_PHONE_ID) {
    console.error('❌ ERRO CRÍTICO: WHATSAPP_PHONE_ID não está configurado!');
    console.error('❌ Vá em Vercel → Environment Variables e adicione WHATSAPP_PHONE_ID');
    return false;
  }
  
  console.log(`📤 Token: ${WHATSAPP_TOKEN.substring(0, 20)}...`);
  console.log(`📤 Phone ID: ${WHATSAPP_PHONE_ID}`);
  console.log(`📤 URL: https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`);
  
  try {
    const resposta = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: numero,
        type: 'text',
        text: { body: texto }
      })
    });
    
    const dados = await resposta.json();
    
    console.log(`📤 Status HTTP: ${resposta.status}`);
    console.log(`📤 Resposta:`, JSON.stringify(dados, null, 2));
    
    if (!resposta.ok) {
      console.error(`❌ ===========================================`);
      console.error(`❌ ERRO DA API WHATSAPP`);
      console.error(`❌ ===========================================`);
      console.error(`❌ Código HTTP: ${resposta.status}`);
      
      // ERROS ESPECÍFICOS
      if (dados.error) {
        console.error(`❌ Código do erro: ${dados.error.code}`);
        console.error(`❌ Mensagem: ${dados.error.message}`);
        
        if (dados.error.code === 190) {
          console.error(`🚨 TOKEN EXPIRADO OU INVÁLIDO!`);
          console.error(`🚨 Solução: Gere um novo token em business.facebook.com`);
          console.error(`🚨 O token de teste expira em 1 hora. Use System User Token.`);
        }
        
        if (dados.error.code === 100) {
          console.error(`🚨 PHONE_ID INVÁLIDO!`);
          console.error(`🚨 Verifique se o PHONE_ID está correto no Meta Developer`);
        }
        
        if (dados.error.code === 10) {
          console.error(`🚨 NÚMERO DO DESTINATÁRIO NÃO ESTÁ NO WHATSAPP`);
        }
        
        if (dados.error.message?.includes('Account not registered')) {
          console.error(`🚨 NÚMERO DA RC NÃO ESTÁ REGISTRADO NA API`);
          console.error(`🚨 Vá em Meta Business → WhatsApp → Registrar número`);
        }
      }
      
      return false;
    }
    
    console.log(`✅ ===========================================`);
    console.log(`✅ MENSAGEM ENVIADA COM SUCESSO!`);
    console.log(`✅ ID: ${dados.messages?.[0]?.id}`);
    console.log(`✅ ===========================================`);
    return true;
    
  } catch (e) {
    console.error(`❌ ===========================================`);
    console.error(`❌ EXCEÇÃO AO ENVIAR`);
    console.error(`❌ ===========================================`);
    console.error(`❌ Mensagem: ${e.message}`);
    console.error(`❌ Stack: ${e.stack}`);
    return false;
  }
}
