// ============================================
// RC ATENDIMENTO - PORTUGUÊS CORRETO E PROFISSIONAL
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
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
  
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  const changes = body.entry?.[0]?.changes?.[0]?.value;
  if (!changes || changes.statuses) {
    return res.status(200).send('OK');
  }
  
  const msg = changes.messages?.[0];
  if (!msg || !msg.id) return res.status(200).send('OK');
  
  if (processadas.has(msg.id)) return res.status(200).send('OK');
  processadas.add(msg.id);
  
  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  if (telefone === CONFIG.numeroRC) return res.status(200).send('OK');
  
  if (msg.type === 'audio') {
    await enviar(telefone, "No momento não consigo ouvir áudios. Pode escrever, por favor?");
    return res.status(200).send('OK');
  }
  
  if (msg.type !== 'text') return res.status(200).send('OK');
  
  const texto = msg.text.body;
  console.log(`\n📨 ${nome}: ${texto}`);
  
  if (!clientes[telefone]) {
    clientes[telefone] = { nome, etapa: 'INICIO', dados: {} };
  }
  
  const cli = clientes[telefone];
  const resp = processar(cli, texto.toLowerCase(), texto);
  
  if (resp) {
    await enviar(telefone, resp);
  }
  
  return res.status(200).send('OK');
}

function processar(cli, t, original) {
  const d = cli.dados;
  
  // ===== OBJEÇÃO: ESTÁ CARO (DETECÇÃO REFORÇADA) =====
  if (t.match(/(caro|car demais|muito caro|tá caro|tah caro|esta caro|tá muito caro|tah muito caro|absurdo|exagerado|salado|roubando|mamando|abusado|não tenho dinheiro|não posso pagar|tá louco|tah louco|tá doido|tah doido)/)) {
    return "Entendo perfeitamente sua consideração sobre o valor. Posso explicar: o valor da visita técnica cobre o deslocamento do profissional qualificado e a análise detalhada do serviço. O diferencial da RC Reformas é que trabalhamos com profissionais de alta confiança que atendem clientes exigentes na Zona Sul. Além disso, se aprovarem o orçamento, esse valor é abatido do total. Posso verificar disponibilidade para você?";
  }
  
  // ===== OUTRAS OBJEÇÕES =====
  if (t.match(/(comparar|outras empresas|vou pesquisar|vou ver outro)/)) {
    return "Compreendo perfeitamente. Se desejar, pode enviar o orçamento de outra empresa que verificamos se conseguimos cobrir o valor.";
  }
  
  if (t.match(/(não confio|pagar antes|dinheiro adiantado|sinal)/)) {
    return "Entendo sua preocupação. A RC Reformas é uma empresa séria com anos de mercado. Podemos fazer da seguinte forma: 50% no início do serviço e 50% na conclusão. Isso lhe dá segurança e confiança. Posso agendar a visita?";
  }
  
  // ===== IDENTIDADE =====
  if (t.match(/(quem é você|quem e voce|você é robô|voce e robo|é humano|e humano|atendente)/)) {
    return "Sou o Atendimento Digital da RC Reforma e Construção. Estou aqui para ajudá-lo a agendar sua visita técnica com praticidade.";
  }
  
  // ===== CENÁRIOS ESPECIAIS =====
  if (t.match(/(síndico|sindico|condomínio|condominio|empresa|prédio|predio|comercial)/)) {
    return "Infelizmente, no momento estamos com alta demanda e nosso profissional está atendendo apenas pessoas físicas, não empresas ou condomínios.";
  }
  
  if (t.match(/(só material|apenas material|comprar material|venda de material)/)) {
    return "Nossos profissionais realizam apenas serviços, não vendem produtos ou materiais.";
  }
  
  // ===== EVASIVOS =====
  if (t.match(/(depois eu te falo|depois eu falo|só queria saber preço|so queria saber preco|depois eu entro em contato)/)) {
    return "Sem problemas! Quando precisar de atendimento, é só entrar em contato. Estarei por aqui.";
  }
  
  if (t.match(/(vou pensar|volto depois|depois eu decido)/)) {
    return "Claro, fique à vontade para analisar. Sempre que precisar, estamos à disposição.";
  }
  
  // ===== CANCELAMENTO =====
  if (t.match(/(desisti|cancela|quero cancelar|desistir)/)) {
    return "Sinto muito por isso. Pode me contar o que aconteceu? Talvez possamos resolver.";
  }
  
  // ===== FLUXO POR ETAPA =====
  switch (cli.etapa) {
    case 'INICIO':
      return etapaInicio(cli, t, original);
      
    case 'AGUARDANDO_BAIRRO':
      return etapaAguardandoBairro(cli, t, original);
      
    case 'AGUARDANDO_SERVICO':
      return etapaAguardandoServico(cli, t, original);
      
    case 'VALOR_APRESENTADO':
      return etapaValorApresentado(cli, t, original);
      
    case 'AGUARDANDO_DATA':
      return etapaAguardandoData(cli, t, original);
      
    case 'AGUARDANDO_HORARIO':
      return etapaAguardandoHorario(cli, t, original);
      
    case 'AGUARDANDO_ENDERECO':
      return etapaAguardandoEndereco(cli, t, original);
      
    case 'CONFIRMAR_AGENDAMENTO':
      return etapaConfirmar(cli, t, original);
      
    case 'AGENDADO':
      return "Visita confirmada. Se precisar de mais alguma coisa, é só chamar.";
      
    default:
      cli.etapa = 'INICIO';
      return "Olá! Me informe o serviço e o bairro que deseja atendimento, por favor.";
  }
}

// ===== ETAPAS =====

function etapaInicio(cli, t, original) {
  const d = cli.dados;
  const { servico, bairro } = extrair(t, original);
  
  if (servico && bairro) {
    d.servico = servico;
    d.bairro = bairro;
    d.valor = calcValor(bairro);
    cli.etapa = 'VALOR_APRESENTADO';
    
    return `Perfeito! Para enviar um orçamento preciso, é necessário uma visita técnica no local. O investimento da visita é de R$${d.valor}, mas fique tranquilo: esse valor é abatido do total se o orçamento for aprovado. Para quando gostaria de agendar?`;
  }
  
  if (servico) {
    d.servico = servico;
    cli.etapa = 'AGUARDANDO_BAIRRO';
    return `Certo. Qual o bairro que deseja atendimento?`;
  }
  
  if (bairro) {
    d.bairro = bairro;
    cli.etapa = 'AGUARDANDO_SERVICO';
    return `Qual serviço deseja?`;
  }
  
  if (t.match(/(quanto custa|qual o preço|valor)/)) {
    return `Para qual serviço? Não posso informar um valor exato sem conhecer o local, mas posso enviar uma média de valores. Deseja?`;
  }
  
  return `Olá! Me informe o serviço e o bairro que deseja atendimento, por favor.`;
}

function etapaAguardandoBairro(cli, t, original) {
  const d = cli.dados;
  const bairro = extrairBairro(t, original);
  
  if (bairro) {
    d.bairro = bairro;
    d.valor = calcValor(bairro);
    cli.etapa = 'VALOR_APRESENTADO';
    
    return `Ótimo! Para oferecer um orçamento mais preciso, é necessário que um profissional realize uma visita técnica. O investimento da visita é de R$${d.valor}, mas esse valor é abatido do total caso o orçamento seja aprovado. Gostaria de agendar?`;
  }
  
  return `Certo. Qual o bairro que deseja atendimento?`;
}

function etapaAguardandoServico(cli, t, original) {
  const d = cli.dados;
  const servico = extrairServico(t);
  
  if (servico) {
    d.servico = servico;
    d.valor = calcValor(d.bairro);
    cli.etapa = 'VALOR_APRESENTADO';
    
    return `Perfeito! Para oferecer um orçamento mais preciso, é necessário que um profissional realize uma visita técnica. O investimento da visita é de R$${d.valor}, mas esse valor é abatido do total caso o orçamento seja aprovado. Gostaria de agendar?`;
  }
  
  return `Qual serviço deseja?`;
}

function etapaValorApresentado(cli, t, original) {
  const d = cli.dados;
  
  // Por que pagar visita?
  if (t.match(/(por que tem que pagar|por que pagar|para que serve a visita|por que cobra)/)) {
    return `O valor da visita cobre o deslocamento do profissional qualificado e a análise técnica detalhada do que precisa ser feito. Se aprovarem o orçamento, a visita sai de graça pois o valor é abatido do total. Posso verificar disponibilidade?`;
  }
  
  // Não vou pagar
  if (t.match(/(não vou pagar|visita grátis|gratuita|orçamento grátis|não aceito pagar)/)) {
    const isBotafogo = d.bairro?.toLowerCase().includes('botafogo');
    const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
      d.bairro?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
    );
    
    if (isBotafogo) {
      d.valor = 0;
      cli.etapa = 'AGUARDANDO_DATA';
      return `Como exceção para o bairro de Botafogo, posso oferecer a visita sem cobrança. Para quando gostaria de agendar?`;
    } else if (isZonaSul) {
      return `Posso oferecer 50% de desconto no valor da visita. Ficaria em R$90. Podemos prosseguir?`;
    } else {
      return `Entendo, mas infelizmente para este bairro a taxa da visita precisa ser mantida. Posso garantir que vale a pena pelo profissionalismo do atendimento. Podemos agendar?`;
    }
  }
  
  // Desconto
  if (t.match(/(desconto|faz mais barato|tem desconto|consegue abaixar)/)) {
    const isBotafogo = d.bairro?.toLowerCase().includes('botafogo');
    const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
      d.bairro?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
    );
    
    if (isBotafogo) {
      return `Posso oferecer 50% de desconto. Se preferir, como exceção, posso tentar a visita sem cobrança. O que prefere?`;
    } else if (isZonaSul) {
      return `Posso oferecer até 50% de desconto no valor da visita. Ficaria em R$90. Deseja prosseguir?`;
    } else {
      return `Para este bairro o valor é fixo, mas garanto que o profissionalismo compensa. Podemos agendar?`;
    }
  }
  
  // AVANÇA PARA DATA
  if (t.match(/(pode ser|quando|data|horário|hoje|amanhã|agendar|marcar|ok|sim|pode|claro|tá bom|tah bom)/)) {
    cli.etapa = 'AGUARDANDO_DATA';
    return `Perfeito! Para quando gostaria de agendar? Posso verificar hoje ou amanhã se preferir.`;
  }
  
  return `Gostaria de agendar a visita técnica? Posso verificar a disponibilidade para você.`;
}

function etapaAguardandoData(cli, t, original) {
  const d = cli.dados;
  const horaAtual = new Date().getHours();
  
  // Urgência
  if (t.match(/(urgente|vazando|vazamento|quebrou|emergência|emergencia|inundando)/)) {
    d.urgente = true;
    d.data = 'hoje';
    cli.etapa = 'AGUARDANDO_HORARIO';
    return `Entendi, é urgente. Qual seria um bom horário? Temos disponibilidade entre 9h30 e 11h30 pela manhã.`;
  }
  
  // Hoje
  if (t.match(/(hoje|hoje ainda|ainda hoje)/)) {
    if (horaAtual >= 19) {
      return `Já são mais de 19h, mas posso entrar em contato com o profissional para o primeiro horário de amanhã. Deseja?`;
    }
    d.data = 'hoje';
    cli.etapa = 'AGUARDANDO_HORARIO';
    return `Qual seria um bom horário? Temos disponibilidade entre 9h30 e 11h30 pela manhã, ou à tarde se preferir.`;
  }
  
  // Amanhã
  if (t.match(/(amanhã|amanha)/)) {
    d.data = 'amanhã';
    cli.etapa = 'AGUARDANDO_HORARIO';
    return `Qual seria um bom horário? Temos disponibilidade entre 9h30 e 11h30 pela manhã.`;
  }
  
  // Horário específico
  const hora = extrairHora(original);
  if (hora) {
    d.hora = hora;
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `Perfeito! Agora preciso do endereço completo para confirmar a visita. Qual é?`;
  }
  
  // Qualquer dia
  if (t.match(/(qualquer dia|tanto faz|o que tiver)/)) {
    return `Posso oferecer hoje ou amanhã. Qual prefere?`;
  }
  
  // Indeciso
  if (t.match(/(não sei|ainda não sei|vou ver)/)) {
    return `Sem problemas. Posso oferecer hoje à tarde ou amanhã de manhã. Alguma dessas opções serve?`;
  }
  
  // Sim/genérico
  if (t.match(/(sim|pode|ok|tá|tah)/)) {
    cli.etapa = 'AGUARDANDO_HORARIO';
    return `Qual seria um bom horário? Temos disponibilidade entre 9h30 e 11h30 pela manhã.`;
  }
  
  return `Para quando gostaria de agendar? Posso verificar hoje ou amanhã.`;
}

function etapaAguardandoHorario(cli, t, original) {
  const d = cli.dados;
  const hora = extrairHora(original);
  
  if (hora) {
    d.hora = hora;
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `Perfeito! Agora preciso do endereço completo para confirmar a visita. Qual é?`;
  }
  
  if (t.match(/(manhã|manha)/)) {
    d.hora = '10:00';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `Perfeito! Agora preciso do endereço completo para confirmar a visita. Qual é?`;
  }
  
  if (t.match(/tarde/)) {
    d.hora = '14:00';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `Perfeito! Agora preciso do endereço completo para confirmar a visita. Qual é?`;
  }
  
  if (t.match(/(sim|pode|ok)/)) {
    d.hora = '10:00';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `Perfeito! Agora preciso do endereço completo para confirmar a visita. Qual é?`;
  }
  
  return `Qual seria um bom horário? Temos disponibilidade entre 9h30 e 11h30 pela manhã.`;
}

function etapaAguardandoEndereco(cli, t, original) {
  const d = cli.dados;
  
  if (original.length > 10 && t.match(/(rua|av|avenida|número|numero|apartamento|casa)/)) {
    d.endereco = original;
    cli.etapa = 'CONFIRMAR_AGENDAMENTO';
    return `Posso confirmar: visita de ${d.servico} para ${d.data} às ${d.hora} no endereço ${original}. Está correto?`;
  }
  
  if (t.match(/(rua|av)/) && !t.match(/\d+/)) {
    return `Qual o número? É casa ou apartamento?`;
  }
  
  return `Qual o endereço completo para a visita? (Rua, número, complemento)`;
}

function etapaConfirmar(cli, t, original) {
  const d = cli.dados;
  
  if (t.match(/(sim|pode|ok|confirmo|tá bom|tah bom|perfeito|ótimo|otimo)/)) {
    // Notifica técnico
    const num = d.servico?.match(/marcenaria/) ? CONFIG.tecnicos.marcenaria :
                d.servico?.match(/hidráulica|hidraulica/) ? CONFIG.tecnicos.hidraulica :
                CONFIG.tecnicos.reforma;
    
    enviar(num, `Visita de ${d.servico} marcada. Endereço: ${d.endereco}, Cliente: ${cli.nome}, Dia: ${d.data}, Horário: ${d.hora}.`);
    
    cli.etapa = 'AGENDADO';
    return `Perfeito, está marcado! O técnico confirmará em breve. Se precisar de mais alguma coisa, é só chamar.`;
  }
  
  if (t.match(/(não|nao|mudar|alterar|trocar|outro dia)/)) {
    cli.etapa = 'AGUARDANDO_DATA';
    return `Sem problemas. Qual seria o dia mais próximo que teria disponibilidade?`;
  }
  
  return `Posso confirmar o agendamento para ${d.data} às ${d.hora}?`;
}

// ===== FUNÇÕES AUXILIARES =====

function extrair(t, txt) {
  const servicos = ['pintura', 'marcenaria', 'hidráulica', 'hidraulica', 'elétrica', 'eletrica', 'reforma', 'azulejo', 'pedreiro', 'gesso', 'vazamento', 'encanamento'];
  const bairros = [...CONFIG.bairrosZonaSul, 'tijuca', 'madureira', 'meier', 'vila isabel', 'barra', 'recreio', 'jacarepaguá', 'jacarepagua'];
  
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

function calcValor(bairro) {
  const n = bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return CONFIG.bairrosZonaSul.some(b => n.includes(b)) ? CONFIG.precoZonaSul : CONFIG.precoOutros;
}

async function enviar(numero, texto) {
  console.log(`\n📤 PARA ${numero}: ${texto}`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('❌ Token ou Phone ID não configurados');
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
      console.error('❌ Erro API:', res.status, data);
      return false;
    }
    
    console.log('✅ Enviado');
    return true;
    
  } catch (e) {
    console.error('❌ Exceção:', e.message);
    return false;
  }
}
