// ============================================
// RC ATENDIMENTO - VERSÃO MÍNIMA FUNCIONAL
// SEM LOOP - SEM IA - SÓ WHATSAPP
// ============================================

// CONFIGURAÇÃO - PREENCHA OU USE VARIÁVEIS DE AMBIENTE
const CONFIG = {
  // Números dos técnicos
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
  
  // SEU NÚMERO DA RC REFORMAS (com 55, sem +)
  // Exemplo: '5521988887777'
  numeroRC: process.env.NUMERO_RC || '5521XXXXXXXXX'
};

// CREDENCIAIS WHATSAPP CLOUD API
// O TOKEN DEVE SER DO SYSTEM USER (PERMANENTE), NÃO O DE TESTE DE 1 HORA
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'EAAxxxx...COLE_AQUI';
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '123456789012345';

// Armazenamento simples
const clientes = {};
const processadas = new Set();

export default async function handler(req, res) {
  // Libera CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // VERIFICAÇÃO WEBHOOK (Meta)
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
    // RECEBER MENSAGEM
    if (req.method === 'POST') {
      return await receber(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (e) {
    console.error('ERRO:', e.message);
    return res.status(200).send('OK');
  }
}

async function receber(req, res) {
  const body = req.body;
  
  // Log para debug
  console.log('📥 Webhook recebido:', JSON.stringify(body).substring(0, 200));
  
  // Validações básicas
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  const changes = body.entry?.[0]?.changes?.[0]?.value;
  if (!changes) return res.status(200).send('OK');
  
  // Ignora status (delivery, read, sent) - EVITA LOOP
  if (changes.statuses) {
    console.log('📊 Status ignorado');
    return res.status(200).send('OK');
  }
  
  const msg = changes.messages?.[0];
  if (!msg || !msg.id) return res.status(200).send('OK');
  
  // Anti-duplicata
  if (processadas.has(msg.id)) {
    console.log('♻️ Duplicada');
    return res.status(200).send('OK');
  }
  processadas.add(msg.id);
  if (processadas.size > 500) processadas.clear();
  
  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  // IGNORA MENSAGENS DA PRÓPRIA RC (EVITA LOOP)
  if (telefone === CONFIG.numeroRC) {
    console.log('🤖 Própria mensagem ignorada');
    return res.status(200).send('OK');
  }
  
  // IGNORA TÉCNICOS (eles respondem em outro fluxo)
  const tecnicos = Object.values(CONFIG.tecnicos);
  if (tecnicos.includes(telefone)) {
    console.log('🔧 Resposta de técnico');
    return res.status(200).send('OK');
  }
  
  console.log(`\n📨 ${nome} (${telefone}): ${msg.text?.body || '[midia]'}`);
  
  // Áudio não suportado
  if (msg.type === 'audio') {
    await enviar(telefone, "No momento eu nao consigo ouvir, pode escrever?");
    return res.status(200).send('OK');
  }
  
  // Só processa texto
  if (msg.type !== 'text') return res.status(200).send('OK');
  
  const texto = msg.text.body;
  
  // Inicializa cliente
  if (!clientes[telefone]) {
    clientes[telefone] = { nome, etapa: 'INICIO', dados: {} };
  }
  
  const cli = clientes[telefone];
  
  // PROCESSA
  const resp = processar(cli, texto.toLowerCase(), texto);
  console.log('💬 Resposta:', resp);
  
  if (resp) {
    const ok = await enviar(telefone, resp);
    if (ok) console.log('✅ Enviado com sucesso');
    else console.log('❌ Falha ao enviar');
  }
  
  return res.status(200).send('OK');
}

function processar(cli, t, original) {
  const d = cli.dados;
  
  // ===== RESPOSTAS DIRETAS =====
  
  if (t.match(/(quem e voce|voce e robo|e humano)/)) {
    return "Sou o Atendimento Digital da RC Reforma e Construcao";
  }
  
  if (t.match(/(sindico|empresa|condominio)/)) {
    return "Infelizmente o profissional esta com alta demanda e no momento nao esta prestando servicos para empresas, apenas pessoas fisicas";
  }
  
  if (t.match(/(so material|comprar material)/)) {
    return "Os profissionais apenas realizam servicos, nao vendem produtos";
  }
  
  // ===== FLUXO =====
  
  switch (cli.etapa) {
    case 'INICIO':
      // Extrai serviço e bairro
      const { servico, bairro } = extrair(original);
      
      if (servico && bairro) {
        d.servico = servico;
        d.bairro = bairro;
        d.valor = calcValor(bairro);
        cli.etapa = 'AGUARDANDO_DATA';
        return `Perfeito. Para enviar um orcamento preciso, e necessario uma visita tecnica ao local. O valor da visita e R$${d.valor}, mas e abatido do valor final se o orcamento for aprovado. Para quando gostaria de agendar?`;
      }
      
      if (servico && !bairro) {
        d.servico = servico;
        cli.etapa = 'AGUARDANDO_BAIRRO';
        return "Certo, qual o bairro que deseja atendimento?";
      }
      
      if (!servico && bairro) {
        d.bairro = bairro;
        cli.etapa = 'AGUARDANDO_SERVICO';
        return "Qual servico deseja?";
      }
      
      return "Ola! Me informe o servico e bairro que deseja atendimento";
      
    case 'AGUARDANDO_BAIRRO':
      const b = extrairBairro(original);
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
      // Urgência
      if (t.match(/(urgente|vazando|emergencia)/)) {
        d.urgente = true;
        d.data = 'hoje';
        cli.etapa = 'AGUARDANDO_HORARIO';
        return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
      }
      
      // Hoje
      if (t.match(/hoje/)) {
        d.data = 'hoje';
        cli.etapa = 'AGUARDANDO_HORARIO';
        return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
      }
      
      // Amanhã
      if (t.match(/amanha/)) {
        d.data = 'amanha';
        cli.etapa = 'AGUARDANDO_HORARIO';
        return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
      }
      
      // Horário específico
      const h = extrairHora(original);
      if (h) {
        d.hora = h;
        cli.etapa = 'AGUARDANDO_ENDERECO';
        return "Qual o endereco completo para a visita?";
      }
      
      return "Para quando gostaria de agendar?";
      
    case 'AGUARDANDO_HORARIO':
      const hora = extrairHora(original);
      if (hora) d.hora = hora;
      else d.hora = '10:00';
      
      cli.etapa = 'AGUARDANDO_ENDERECO';
      return "Qual o endereco completo para a visita?";
      
    case 'AGUARDANDO_ENDERECO':
      if (original.length > 10 && t.match(/(rua|av|numero|apartamento|casa)/)) {
        d.endereco = original;
        cli.etapa = 'CONFIRMAR';
        return `Pode marcar para ${d.data} as ${d.hora} com profissional ${nomeTecnico(d.servico)}?`;
      }
      return "Qual o endereco completo para a visita?";
      
    case 'CONFIRMAR':
      if (t.match(/(sim|pode|ok|confirmo)/)) {
        // Notifica técnico
        notificarTecnico(cli);
        cli.etapa = 'AGENDADO';
        return "Perfeito, marcado!";
      }
      if (t.match(/(nao|mudar|alterar)/)) {
        cli.etapa = 'AGUARDANDO_DATA';
        return "Qual seria o dia mais proximo que teria disponibilidade?";
      }
      return `Pode marcar para ${d.data} as ${d.hora} com profissional ${nomeTecnico(d.servico)}?`;
      
    case 'AGENDADO':
      return "Visita confirmada. Se precisar de algo mais, e so chamar.";
      
    default:
      return "Ola! Me informe o servico e bairro que deseja atendimento";
  }
}

// ===== FUNÇÕES AUXILIARES =====

function extrair(texto) {
  const t = texto.toLowerCase();
  
  const servicos = ['pintura', 'marcenaria', 'hidraulica', 'eletrica', 'reforma', 'azulejo', 'pedreiro', 'gesso', 'vazamento', 'encanamento'];
  const bairros = [...CONFIG.bairrosZonaSul, 'tijuca', 'madureira', 'meier', 'vila isabel', 'barra', 'recreio'];
  
  let servico = null;
  let bairro = null;
  
  for (const s of servicos) {
    if (t.includes(s)) { servico = s; break; }
  }
  
  for (const b of bairros) {
    if (t.includes(b)) { bairro = b; break; }
  }
  
  // Detecta "pintura em Ipanema"
  const match = texto.match(/(em|na|no)\s+([A-Za-z\s]+)/i);
  if (match && !bairro) {
    const possivel = match[2].trim().toLowerCase();
    for (const b of bairros) {
      if (possivel.includes(b)) { bairro = b; break; }
    }
  }
  
  return { servico, bairro };
}

function extrairServico(t) {
  return extrair(t).servico;
}

function extrairBairro(texto) {
  return extrair(texto).bairro;
}

function extrairHora(texto) {
  const m = texto.match(/(\d{1,2})[:h]?(\d{2})?/);
  if (m) {
    const h = m[1].padStart(2, '0');
    const min = m[2] || '00';
    return `${h}:${min}`;
  }
  return null;
}

function calcValor(bairro) {
  const norm = bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isZS = CONFIG.bairrosZonaSul.some(b => norm.includes(b));
  return isZS ? CONFIG.precoZonaSul : CONFIG.precoOutros;
}

function nomeTecnico(servico) {
  if (servico?.match(/marcenaria/)) return "de Marcenaria";
  if (servico?.match(/hidraulica|vazamento/)) return "Hidraulico";
  if (servico?.match(/eletrica/)) return "Eletricista";
  return "de Reformas";
}

function notificarTecnico(cli) {
  const d = cli.dados;
  let num;
  if (d.servico?.match(/marcenaria/)) num = CONFIG.tecnicos.marcenaria;
  else if (d.servico?.match(/hidraulica/)) num = CONFIG.tecnicos.hidraulica;
  else num = CONFIG.tecnicos.reforma;
  
  const msg = `Visita de ${d.servico} marcada. Endereco ${d.endereco}, Cliente ${cli.nome}, dia ${d.data}, as ${d.hora}.`;
  
  enviar(num, msg);
  console.log(`📤 Técnico notificado: ${num}`);
}

// ===== ENVIO WHATSAPP =====

async function enviar(numero, texto) {
  console.log(`\n📤 PARA ${numero}:\n${texto}\n---`);
  
  if (!WHATSAPP_TOKEN || WHATSAPP_TOKEN === 'EAAxxxx...COLE_AQUI') {
    console.error('❌ ERRO: Token não configurado!');
    return false;
  }
  
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
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
    
    const data = await res.json();
    
    if (!res.ok) {
      console.error('❌ ERRO API:', res.status, JSON.stringify(data));
      
      // Códigos de erro comuns
      if (data.error?.code === 190) {
        console.error('🚨 TOKEN EXPIRADO! Gere um novo em business.facebook.com');
      }
      if (data.error?.code === 100) {
        console.error('🚨 PHONE_ID inválido ou número não registrado');
      }
      if (data.error?.code === 10) {
        console.error('🚨 Número destinatário não está no WhatsApp');
      }
      
      return false;
    }
    
    console.log('✅ Sucesso:', data.messages?.[0]?.id);
    return true;
    
  } catch (e) {
    console.error('❌ EXCEÇÃO:', e.message);
    return false;
  }
}
