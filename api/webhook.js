
# Criando a estrutura de arquivos do projeto

webhook_code = '''// api/webhook.js
// RC Reforma e Construção - Sistema de Atendimento Humanizado
// Integração: WhatsApp API + Supabase + Painel de Intervenção

import { createClient } from '@supabase/supabase-js';

// ============================================
// CONFIGURAÇÃO
// ============================================
const CONFIG = {
  empresa: {
    nome: 'RC Reforma e Construção',
    instagram: 'https://share.google/5n4VM0DwDTlDgEX3C',
    polo: 'Botafogo'
  },
  
  tecnicos: {
    marcenaria: '5521978791765',
    reforma: '5521968112176',
    hidraulica: '5521968112176',
    eletrica: '5521968112176',
    pintura: '5521968112176',
    gesso: '5521968112176',
    pedreiro: '5521968112176'
  },
  
  precoVisita: 180,
  precoZonaSulComDesconto: 90,
  
  bairrosAtendidos: [
    'ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 
    'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 
    'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 
    'sao conrado', 'vidigal', 'rocinha',
    'centro', 'lapa', 'santa teresa', 'cinelândia', 'cinelandida',
    'praça mauá', 'praca maua', 'carioca', 'uruguaiana'
  ],
  
  servicos: [
    'pedreiro', 'pintura', 'marcenaria', 'hidráulica', 'hidraulica', 
    'elétrica', 'eletrica', 'reforma', 'azulejo', 'gesso', 
    'vazamento', 'encanamento', 'serralheria', 'drywall', 
    'porcelanato', 'revestimento', 'impermeabilização', 'impermeabilizacao',
    'trocar', 'consertar', 'instalar', 'reparar', 'montar',
    'armário', 'armario', 'porta', 'janela', 'piso', 'parede',
    'banheiro', 'cozinha', 'quarto', 'sala', 'área', 'area', 'varanda'
  ],
  
  palavrasRisco: [
    'processo', 'judicial', 'advogado', 'procon', 'reclamação', 'reclamacao',
    'polícia', 'policia', 'denunciar', 'denúncia', 'denuncia', 'crime',
    'golpe', 'fraude', 'enganado', 'enganaram', 'calote', 'caloteiro',
    'não entendi nada', 'nao entendi nada', 'tá me enrolando', 'tah me enrolando',
    'quero falar com humano', 'quero falar com pessoa', 'atendente humano',
    'você não entende', 'voce nao entende', 'robô burro', 'robo burro',
    'cancelar tudo', 'não quero mais', 'nao quero mais', 'desisto',
    'horrível', 'horrivel', 'péssimo', 'pessimo', 'terrível', 'terrivel',
    'ódio', 'odio', 'raiva', 'estressei', 'nervoso', 'indignado'
  ]
};

// ============================================
// SUPABASE CLIENT
// ============================================
let supabase = null;

function getSupabase() {
  if (!supabase && process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  }
  return supabase;
}

// ============================================
// CACHE EM MEMÓRIA (Vercel - ephemeral)
// ============================================
const clientes = new Map();
const processadas = new Set();
const intervenções = new Set();

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  // CORS imediato
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Verificação do webhook (Meta)
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      console.log('🔔 Verificação webhook:', req.query);
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    // Painel de Controle API
    if (req.query.action) {
      return await handlePainel(req, res);
    }

    // Webhook WhatsApp - PROCESSAMENTO ASSÍNCRONO
    if (req.method === 'POST') {
      res.status(200).send('OK');
      
      // Processa em background
      processarWebhookAsync(req.body).catch(err => {
        console.error('Erro async:', err);
      });
      
      return;
    }

    res.status(200).send('OK');
    
  } catch (e) {
    console.error('ERRO GERAL:', e.message);
    res.status(200).send('OK');
  }
}

// ============================================
// PROCESSAMENTO ASSÍNCRONO
// ============================================

async function processarWebhookAsync(body) {
  console.log('📥 Webhook recebido:', JSON.stringify(body).substring(0, 500));
  
  if (!body || body.object !== 'whatsapp_business_account') return;
  
  const entry = body.entry?.[0];
  if (!entry) return;
  
  const changes = entry.changes?.[0]?.value;
  if (!changes) return;
  
  // Ignora status updates
  if (changes.statuses) {
    console.log('ℹ️ Status update ignorado');
    return;
  }
  
  const msg = changes.messages?.[0];
  if (!msg || !msg.id) return;
  
  // Evita duplicados
  if (processadas.has(msg.id)) {
    console.log('♻️ Mensagem já processada:', msg.id);
    return;
  }
  processadas.add(msg.id);
  setTimeout(() => processadas.delete(msg.id), 3600000); // Limpa após 1h
  
  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  console.log(`\\n📨 ${nome} (${telefone}): [${msg.type}]`);
  
  // Ignora próprio número
  if (telefone === process.env.NUMERO_RC) return;
  
  // Salva mensagem no Supabase
  await salvarMensagem(telefone, nome, 'cliente', msg.text?.body || `[${msg.type}]`, msg.timestamp);
  
  // Verifica intervenção humana
  if (intervenções.has(telefone)) {
    console.log('👤 Modo intervenção ativo para:', telefone);
    await notificarIntervencao(telefone, nome, msg.text?.body);
    return;
  }
  
  // Processa por tipo
  let texto = '';
  
  if (msg.type === 'text') {
    texto = msg.text.body;
    console.log('Texto:', texto);
  } else if (msg.type === 'image') {
    texto = '[imagem recebida]';
    await processarImagem(telefone, nome, msg.image);
  } else if (msg.type === 'audio' || msg.type === 'voice') {
    await enviarWhatsApp(telefone, 
      "No momento não consigo ouvir áudios. Pode descrever por escrito o que precisa? Se quiser, envie fotos do local."
    );
    return;
  } else if (msg.type === 'document') {
    texto = '[documento recebido]';
  } else {
    console.log('Tipo não tratado:', msg.type);
    return;
  }
  
  // Inicializa ou recupera cliente
  let cli = clientes.get(telefone);
  if (!cli) {
    // Tenta carregar do Supabase
    cli = await carregarCliente(telefone);
    if (!cli) {
      cli = { 
        nome, 
        etapa: 'INICIO', 
        dados: {},
        ultimaAtividade: Date.now()
      };
    }
    clientes.set(telefone, cli);
  }
  
  cli.ultimaAtividade = Date.now();
  
  // Detecta risco
  if (detectarRisco(texto.toLowerCase())) {
    console.log('🚨 Palavra de risco detectada!');
    intervenções.add(telefone);
    await salvarIntervencao(telefone, true);
    await enviarWhatsApp(telefone, 
      `Entendo sua frustração. Vou transferir você imediatamente para um atendente humano. Por favor, aguarde um momento.`
    );
    await enviarTelegram(`🚨 INTERVENÇÃO AUTOMÁTICA\\n${nome} (${telefone})\\nMensagem: ${texto.substring(0, 100)}`);
    return;
  }
  
  // Processa resposta com fluxo humanizado
  const resp = await processarMensagem(cli, texto.toLowerCase(), texto, nome, telefone);
  
  if (resp) {
    await enviarWhatsApp(telefone, resp);
    await salvarMensagem(telefone, nome, 'bot', resp, Date.now());
  }
  
  // Salva estado no Supabase
  await salvarCliente(telefone, cli);
}

// ============================================
// SUPABASE - OPERAÇÕES
// ============================================

async function salvarMensagem(telefone, nome, tipo, conteudo, timestamp) {
  const sb = getSupabase();
  if (!sb) return;
  
  try {
    await sb.from('mensagens').insert({
      telefone,
      nome,
      tipo,
      conteudo,
      timestamp: new Date(timestamp * 1000 || Date.now()).toISOString(),
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('Erro ao salvar mensagem:', e);
  }
}

async function carregarCliente(telefone) {
  const sb = getSupabase();
  if (!sb) return null;
  
  try {
    const { data } = await sb
      .from('clientes')
      .select('*')
      .eq('telefone', telefone)
      .single();
    
    if (data) {
      return {
        nome: data.nome,
        etapa: data.etapa,
        dados: data.dados || {},
        ultimaAtividade: new Date(data.updated_at).getTime()
      };
    }
  } catch (e) {
    console.error('Erro ao carregar cliente:', e);
  }
  return null;
}

async function salvarCliente(telefone, cli) {
  const sb = getSupabase();
  if (!sb) return;
  
  try {
    await sb.from('clientes').upsert({
      telefone,
      nome: cli.nome,
      etapa: cli.etapa,
      dados: cli.dados,
      updated_at: new Date().toISOString()
    }, { onConflict: 'telefone' });
  } catch (e) {
    console.error('Erro ao salvar cliente:', e);
  }
}

async function salvarIntervencao(telefone, ativa) {
  const sb = getSupabase();
  if (!sb) return;
  
  try {
    if (ativa) {
      await sb.from('intervencoes').upsert({
        telefone,
        ativa: true,
        created_at: new Date().toISOString()
      }, { onConflict: 'telefone' });
    } else {
      await sb.from('intervencoes').delete().eq('telefone', telefone);
    }
  } catch (e) {
    console.error('Erro ao salvar intervenção:', e);
  }
}

async function notificarIntervencao(telefone, nome, mensagem) {
  const sb = getSupabase();
  if (!sb) return;
  
  try {
    await sb.from('mensagens').insert({
      telefone,
      nome,
      tipo: 'cliente',
      conteudo: mensagem || '[mensagem]',
      requer_atencao: true,
      timestamp: new Date().toISOString()
    });
    
    // Notifica via Telegram
    await enviarTelegram(`👤 ${nome} (${telefone}): ${mensagem?.substring(0, 50)}...`);
  } catch (e) {
    console.error('Erro ao notificar:', e);
  }
}

// ============================================
// PAINEL DE CONTROLE - API
// ============================================

async function handlePainel(req, res) {
  const { action } = req.query;
  const sb = getSupabase();
  
  switch (action) {
    case 'list': {
      // Lista conversas ativas
      const conversas = [];
      
      // Do cache/memória
      for (const [telefone, cli] of clientes) {
        const emIntervencao = intervenções.has(telefone);
        conversas.push({
          telefone,
          nome: cli.nome,
          etapa: cli.etapa,
          ultimaAtividade: new Date(cli.ultimaAtividade).toLocaleString('pt-BR'),
          emIntervencao,
          resumo: cli.dados.servico && cli.dados.bairro 
            ? `${cli.dados.servico} em ${cli.dados.bairro}` 
            : 'Iniciando',
          unread: 0
        });
      }
      
      // Do Supabase (mensagens não lidas)
      if (sb) {
        try {
          const { data: recentes } = await sb
            .from('mensagens')
            .select('*')
            .eq('tipo', 'cliente')
            .is('lida', false)
            .order('timestamp', { ascending: false });
          
          if (recentes) {
            const agrupados = recentes.reduce((acc, msg) => {
              if (!acc[msg.telefone]) {
                acc[msg.telefone] = { count: 0, lastMsg: msg };
              }
              acc[msg.telefone].count++;
              return acc;
            }, {});
            
            for (const [tel, info] of Object.entries(agrupados)) {
              const existente = conversas.find(c => c.telefone === tel);
              if (existente) {
                existente.unread = info.count;
                existente.lastMessage = info.lastMsg.conteudo;
                existente.lastMessageAt = info.lastMsg.timestamp;
              } else {
                conversas.push({
                  telefone: tel,
                  nome: info.lastMsg.nome,
                  etapa: 'DESCONHECIDO',
                  ultimaAtividade: new Date(info.lastMsg.timestamp).toLocaleString('pt-BR'),
                  emIntervencao: intervenções.has(tel),
                  resumo: 'Nova conversa',
                  unread: info.count,
                  lastMessage: info.lastMsg.conteudo,
                  lastMessageAt: info.lastMsg.timestamp
                });
              }
            }
          }
        } catch (e) {
          console.error('Erro ao buscar mensagens:', e);
        }
      }
      
      return res.json(conversas.sort((a, b) => 
        new Date(b.lastMessageAt || b.ultimaAtividade) - new Date(a.lastMessageAt || a.ultimaAtividade)
      ));
    }
    
    case 'messages': {
      const { phone } = req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      let mensagens = [];
      
      // Busca do Supabase
      if (sb) {
        try {
          const { data } = await sb
            .from('mensagens')
            .select('*')
            .eq('telefone', phone)
            .order('timestamp', { ascending: true })
            .limit(100);
          
          if (data) {
            mensagens = data.map(m => ({
              id: m.id,
              content: m.conteudo,
              from: m.tipo === 'cliente' ? 'client' : (m.tipo === 'humano' ? 'human' : 'bot'),
              timestamp: m.timestamp,
              pending: false
            }));
            
            // Marca como lida
            await sb.from('mensagens')
              .update({ lida: true })
              .eq('telefone', phone)
              .is('lida', false);
          }
        } catch (e) {
          console.error('Erro ao buscar mensagens:', e);
        }
      }
      
      const cli = clientes.get(phone);
      
      return res.json({
        telefone: phone,
        nome: cli?.nome || mensagens[0]?.nome || 'Desconhecido',
        etapa: cli?.etapa || 'N/A',
        emIntervencao: intervenções.has(phone),
        mensagens,
        dados: cli?.dados || {}
      });
    }
    
    case 'intervene': {
      const { phone } = req.body || req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      intervenções.add(phone);
      await salvarIntervencao(phone, true);
      await enviarWhatsApp(phone, `Olá! Um atendente humano assumiu esta conversa. Em que posso ajudar?`);
      await enviarTelegram(`🚨 INTERVENÇÃO MANUAL\\n${phone}`);
      
      return res.json({ sucesso: true, mensagem: 'Intervenção ativada' });
    }
    
    case 'release': {
      const { phone } = req.body || req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      intervenções.delete(phone);
      await salvarIntervencao(phone, false);
      await enviarWhatsApp(phone, `Obrigado! Retomando atendimento automatizado. Como posso ajudar?`);
      
      return res.json({ sucesso: true, mensagem: 'Robô liberado' });
    }
    
    case 'send': {
      const { phone, mensagem } = req.body;
      if (!phone || !mensagem) return res.status(400).json({ erro: 'Telefone e mensagem obrigatórios' });
      
      await enviarWhatsApp(phone, mensagem);
      await salvarMensagem(phone, 'Atendente', 'humano', mensagem, Date.now());
      
      return res.json({ sucesso: true });
    }
    
    case 'stats': {
      return res.json({
        totalConversas: clientes.size,
        emAtendimento: Array.from(clientes.values()).filter(c => c.etapa !== 'AGENDADO' && c.etapa !== 'INICIO').length,
        intervencoesAtivas: intervenções.size,
        online: true
      });
    }
    
    default:
      return res.status(400).json({ erro: 'Ação desconhecida' });
  }
}

// ============================================
// LÓGICA DE VENDAS HUMANIZADA (SEM BOTÕES/EMOJIS)
// ============================================

async function processarMensagem(cli, t, original, nome, telefone) {
  const d = cli.dados;
  
  // Saudação inicial fluida
  if (cli.etapa === 'INICIO' && t.match(/(oi|olá|ola|bom dia|boa tarde|boa noite|hey)/)) {
    return `Olá, ${nome}! Sou da RC Reforma e Construção. Para te ajudar rápido, me conta: qual serviço precisa e qual bairro do Rio? Se quiser, envie fotos do local.`;
  }

  // Objeções em qualquer etapa - respostas naturais
  if (t.match(/(caro|muito caro|tá caro|tah caro|absurdo|roubando|não tenho dinheiro|nao tenho dinheiro)/)) {
    return `Entendo, ${nome}. Deixa eu explicar: a visita técnica custa R$180, mas temos descontos especiais. Na Zona Sul fica R$90, e em Botafogo é gratuita como cortesia. O técnico vai até você, avalia tudo e faz um orçamento detalhado. Se aprovar o serviço, esse valor vira desconto no total. Posso verificar disponibilidade?`;
  }

  if (t.match(/(quem é você|quem e voce|você é robô|voce e robo|é máquina|e maquina)/)) {
    return `Sou o assistente virtual da RC Reforma e Construção. Estou aqui para agilizar seu atendimento, mas se quiser falar com uma pessoa real, é só pedir a qualquer momento. Como posso ajudar hoje?`;
  }

  if (t.match(/(vou pensar|volto depois|depois eu decido|deixa eu ver)/)) {
    return `Sem problemas, ${nome}. Analise com calma. Quando quiser agendar, é só chamar. Normalmente temos vagas para hoje ou amanhã. Boa sorte!`;
  }

  // Fluxo principal
  switch (cli.etapa) {
    case 'INICIO':
      return await etapaInicio(cli, t, original, nome);
    case 'AGUARDANDO_BAIRRO':
      return etapaAguardandoBairro(cli, t, original);
    case 'AGUARDANDO_SERVICO':
      return etapaAguardandoServico(cli, t, original);
    case 'CONFIRMA_ATENDIMENTO_HOJE':
      return etapaConfirmaAtendimentoHoje(cli, t, original);
    case 'APRESENTA_VALOR':
      return etapaApresentaValor(cli, t, original);
    case 'VERIFICAR_AGENDA':
      return await etapaVerificarAgenda(cli, t, original);
    case 'AGUARDANDO_HORARIO':
      return etapaAguardandoHorario(cli, t, original);
    case 'AGUARDANDO_ENDERECO':
      return etapaAguardandoEndereco(cli, t, original);
    case 'CONFIRMAR_VISITA':
      return await etapaConfirmarVisita(cli, t, original, telefone);
    case 'AGENDADO':
      return `Olá! Sua visita está confirmada. Se precisar remarcar ou tirar dúvidas, é só avisar.`;
    default:
      cli.etapa = 'INICIO';
      return `Olá, ${nome}! Me informe o serviço e o bairro que deseja atendimento.`;
  }
}

// ===== ETAPAS DO FLUXO =====

async function etapaInicio(cli, t, original, nome) {
  const d = cli.dados;
  const { servico, bairro } = extrairServicoEBairro(t, original);
  
  if (servico && bairro) {
    d.servico = servico;
    d.bairro = bairro;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    
    return `Perfeito, ${servico} em ${bairro}. Você precisa de atendimento urgente para hoje ou podemos agendar para amanhã ou outro dia? Tenho vagas disponíveis.`;
  }
  
  if (servico) {
    d.servico = servico;
    cli.etapa = 'AGUARDANDO_BAIRRO';
    return `Certo, você precisa de ${servico}. Qual bairro do Rio de Janeiro?`;
  }
  
  if (bairro) {
    d.bairro = bairro;
    cli.etapa = 'AGUARDANDO_SERVICO';
    return `Entendi, ${bairro}. Qual serviço você precisa nessa região?`;
  }
  
  if (t.match(/(quanto custa|qual o preço|qual o preco|valor|preco)/)) {
    return `Para valores precisos, preciso saber o serviço e bairro, pois cada caso é único. Mas posso adiantar que a visita técnica é R$180, R$90 na Zona Sul, e gratuita em Botafogo. Qual serviço e bairro você precisa?`;
  }
  
  return `Oi, sou da RC Reforma. Para ajudar, me diga qual serviço precisa e em qual bairro. Por exemplo: pintura em Ipanema, vazamento em Copacabana, ou reforma em Botafogo.`;
}

function etapaAguardandoBairro(cli, t, original) {
  const d = cli.dados;
  const bairro = extrairBairro(t, original);
  
  if (bairro) {
    d.bairro = bairro;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    return `Ótimo, ${d.servico} em ${bairro}. Precisa de atendimento para hoje, é urgente, ou podemos agendar?`;
  }
  
  return `Qual bairro do Rio de Janeiro você precisa de atendimento?`;
}

function etapaAguardandoServico(cli, t, original) {
  const d = cli.dados;
  const servico = extrairServico(t);
  
  if (servico) {
    d.servico = servico;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    return `Perfeito, ${servico} em ${d.bairro}. Precisa de atendimento urgente para hoje ou podemos agendar?`;
  }
  
  return `Qual serviço você precisa em ${d.bairro}? Posso indicar pedreiro, pintura, hidráulica, elétrica, marcenaria, ou outro.`;
}

function etapaConfirmaAtendimentoHoje(cli, t, original) {
  const d = cli.dados;
  
  if (t.match(/(hoje|urgente|urgência|urgencia|vazando|quebrou|estourou|emergência|emergencia)/)) {
    d.urgente = true;
    cli.etapa = 'APRESENTA_VALOR';
    
    const valor = d.bairro.toLowerCase().includes('botafogo') ? 0 : 
                  verificarAtendimento(d.bairro) ? 90 : 180;
    
    let msg = `Entendi que é urgente. Antes de confirmar para hoje, explico o valor: a visita técnica fica ${valor === 0 ? 'gratuita' : 'R$' + valor}. O profissional vai até você, avalia tudo e faz um orçamento detalhado no local. `;
    
    if (valor > 0) {
      msg += `Se aprovar o serviço, esse valor é abatido do total. `;
    }
    
    if (valor === 0) {
      msg += `Como você é de Botafogo, temos visita técnica gratuita como cortesia. `;
    }
    
    msg += `Posso verificar disponibilidade para hoje?`;
    return msg;
  }
  
  if (t.match(/(amanhã|amanha|depois|próximo|proximo|outro dia|semana que vem)/)) {
    d.urgente = false;
    cli.etapa = 'APRESENTA_VALOR';
    return `Sem problemas. Para agendar, temos descontos especiais: Zona Sul sai R$90 e Botafogo é gratuita. Posso verificar na agenda?`;
  }
  
  return `Você precisa de atendimento para hoje, é urgente, ou prefere agendar para amanhã ou outro dia?`;
}

function etapaApresentaValor(cli, t, original) {
  const d = cli.dados;
  
  if (t.match(/(não|nao|não vou pagar|nao vou pagar|grátis|gratis|caro demais)/)) {
    if (d.bairro.toLowerCase().includes('botafogo')) {
      d.valorVisita = 0;
      cli.etapa = 'VERIFICAR_AGENDA';
      return `Como você é de Botafogo, a visita técnica é gratuita, sem custo nenhum. Posso verificar disponibilidade na agenda?`;
    }
    
    if (verificarAtendimento(d.bairro)) {
      return `Posso oferecer 50% de desconto para Zona Sul, ficando R$90. Ou, se conseguir trazer o serviço para Botafogo, fica 100% gratuito. O que prefere?`;
    }
  }
  
  if (t.match(/(sim|pode|ok|claro|verifica|agenda|vamos|pode ser)/)) {
    cli.etapa = 'VERIFICAR_AGENDA';
    return `Ótimo, deixa eu consultar a agenda. Para quando você prefere? Hoje, amanhã, ou outro dia específico?`;
  }
  
  return `Posso verificar disponibilidade na agenda para ${d.servico} em ${d.bairro}?`;
}

async function etapaVerificarAgenda(cli, t, original) {
  const d = cli.dados;
  
  if (t.match(/(hoje)/)) {
    const horaAtual = new Date().getHours();
    if (horaAtual >= 18) {
      return `Já são mais de 18h. Posso agendar o primeiro horário de amanhã? Ou prefere outro dia?`;
    }
    
    d.data = 'hoje';
    d.dataFormatada = new Date().toLocaleDateString('pt-BR');
    cli.etapa = 'AGUARDANDO_HORARIO';
    
    return `Temos vaga para hoje. Qual horário seria melhor? Manhã das 9h às 12h, tarde das 14h às 17h, ou noite das 18h às 20h?`;
  }
  
  if (t.match(/(amanhã|amanha)/)) {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    d.data = 'amanhã';
    d.dataFormatada = amanha.toLocaleDateString('pt-BR');
    cli.etapa = 'AGUARDANDO_HORARIO';
    
    return `Amanhã temos disponibilidade. Qual período prefere? Manhã das 9h às 12h ou tarde das 14h às 17h?`;
  }
  
  const dataEspecifica = extrairData(t, original);
  if (dataEspecifica) {
    d.data = dataEspecifica;
    d.dataFormatada = dataEspecifica;
    cli.etapa = 'AGUARDANDO_HORARIO';
    return `Anotado: ${dataEspecifica}. Qual horário seria ideal?`;
  }
  
  return `Para quando você precisa? Pode ser hoje, amanhã, ou me diga o dia específico.`;
}

function etapaAguardandoHorario(cli, t, original) {
  const d = cli.dados;
  const hora = extrairHora(original);
  
  if (hora) {
    d.hora = hora;
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `${hora} anotado. Agora preciso do endereço completo: rua, número, complemento. É apartamento ou casa?`;
  }
  
  if (t.match(/manhã|manha/)) {
    d.hora = 'manhã (9h-12h)';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `Manhã anotado. Agora o endereço completo, por favor: rua, número, complemento.`;
  }
  
  if (t.match(/tarde/)) {
    d.hora = 'tarde (14h-17h)';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `Tarde anotada. Preciso do endereço completo: rua, número, complemento.`;
  }
  
  if (t.match(/noite/)) {
    d.hora = 'noite (18h-20h)';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `Noite anotada. Qual o endereço completo?`;
  }
  
  return `Qual horário funciona melhor para você? Pode me dizer o horário específico ou período (manhã, tarde, noite).`;
}

function etapaAguardandoEndereco(cli, t, original) {
  const d = cli.dados;
  
  if (original.length > 8 && (t.match(/(rua|av|avenida|número|numero|apartamento|casa|bloco)/) || t.match(/\\d+/))) {
    d.endereco = original;
    cli.etapa = 'CONFIRMAR_VISITA';
    
    const valor = d.bairro.toLowerCase().includes('botafogo') ? 0 : 
                  verificarAtendimento(d.bairro) ? 90 : 180;
    d.valorVisita = valor;
    
    return `Resumo do agendamento: ${d.servico} no dia ${d.data} às ${d.hora}, endereço ${original}. O valor da visita é ${valor === 0 ? 'gratuito' : 'R$' + valor}. Tudo correto? Responda sim para confirmar ou me diga o que precisa alterar.`;
  }
  
  return `Preciso do endereço completo com rua, número e complemento. Qual é?`;
}

async function etapaConfirmarVisita(cli, t, original, telefone) {
  const d = cli.dados;
  
  if (t.match(/(sim|pode|ok|confirmo|tá bom|tah bom|perfeito|pode ser)/)) {
    cli.etapa = 'AGENDADO';
    
    // Salva agendamento no Supabase
    const sb = getSupabase();
    if (sb) {
      try {
        await sb.from('agendamentos').insert({
          telefone,
          nome: cli.nome,
          servico: d.servico,
          bairro: d.bairro,
          data: d.data,
          data_formatada: d.dataFormatada,
          hora: d.hora,
          endereco: d.endereco,
          valor: d.valorVisita,
          status: 'confirmado',
          created_at: new Date().toISOString()
        });
      } catch (e) {
        console.error('Erro ao salvar agendamento:', e);
      }
    }
    
    // Notifica técnico
    const tecnico = CONFIG.tecnicos[d.servico] || CONFIG.tecnicos.reforma;
    await enviarWhatsApp(tecnico, 
      `Nova visita agendada: ${d.servico} | ${d.data} ${d.hora} | ${d.endereco} | Cliente: ${cli.nome} | Tel: ${telefone} | Valor: ${d.valorVisita === 0 ? 'Gratuito' : 'R$'+d.valorVisita}`
    );
    
    // Notifica Telegram
    await enviarTelegram(
      `Visita confirmada: ${d.data} às ${d.hora} | ${d.servico} em ${d.endereco} | ${cli.nome} (${telefone}) | ${d.valorVisita === 0 ? 'Gratuito' : 'R$'+d.valorVisita}`
    );
    
    let msg = `Visita confirmada para ${d.data} às ${d.hora}. Endereço: ${d.endereco}. Serviço: ${d.servico}. `;
    if (d.valorVisita > 0) {
      msg += `Valor: R$${d.valorVisita} a pagar no ato da visita. `;
    } else {
      msg += `Visita técnica gratuita. `;
    }
    msg += `O técnico vai entrar em contato em até 48 horas. Se precisar remarcar, avise com 2 horas de antecedência. Mais alguma dúvida?`;
    
    return msg;
  }
  
  if (t.match(/(não|nao|mudar|alterar|trocar|errado)/)) {
    cli.etapa = 'VERIFICAR_AGENDA';
    return `Sem problema. O que precisa alterar? Data, horário, endereço ou serviço? Me informa que ajusto aqui.`;
  }
  
  return `Posso confirmar para ${d.data} às ${d.hora}? Responda sim ou diga o que precisa alterar.`;
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function extrairServicoEBairro(t, original) {
  return {
    servico: extrairServico(t),
    bairro: extrairBairro(t, original)
  };
}

function extrairServico(t) {
  for (const s of CONFIG.servicos) {
    if (t.includes(s)) return s;
  }
  return null;
}

function extrairBairro(t, original) {
  for (const b of CONFIG.bairrosAtendidos) {
    if (t.includes(b)) return b;
  }
  
  const m = original.match(/(em|no|na)\\s+([A-Za-zÀ-ÿ\\s]+)/i);
  if (m) {
    const possivel = m[2].trim().toLowerCase();
    for (const b of CONFIG.bairrosAtendidos) {
      if (possivel.includes(b)) return b;
    }
    if (possivel.length > 2) return possivel;
  }
  return null;
}

function extrairHora(txt) {
  const m = txt.match(/(\\d{1,2})[:h]?(\\d{2})?/);
  return m ? `${m[1].padStart(2,'0')}:${m[2]||'00'}` : null;
}

function extrairData(t, original) {
  const hoje = new Date();
  
  if (t.match(/segunda/)) return getDataFutura(1);
  if (t.match(/terça|terca/)) return getDataFutura(2);
  if (t.match(/quarta/)) return getDataFutura(3);
  if (t.match(/quinta/)) return getDataFutura(4);
  if (t.match(/sexta/)) return getDataFutura(5);
  
  const m = original.match(/(\\d{1,2})[\\/\\-](\\d{1,2})/);
  if (m) return `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
  
  const d = original.match(/dia\\s+(\\d{1,2})/i);
  if (d) return `${d[1].padStart(2,'0')}/${(hoje.getMonth()+1).toString().padStart(2,'0')}`;
  
  return null;
}

function getDataFutura(diasSemana) {
  const hoje = new Date();
  const atual = hoje.getDay();
  const dias = (diasSemana + 7 - atual) % 7 || 7;
  hoje.setDate(hoje.getDate() + dias);
  return hoje.toLocaleDateString('pt-BR');
}

function verificarAtendimento(bairro) {
  if (!bairro) return false;
  const n = bairro.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  return CONFIG.bairrosAtendidos.some(b => n.includes(b));
}

function detectarRisco(texto) {
  return CONFIG.palavrasRisco.some(p => texto.includes(p));
}

// ============================================
// INTEGRAÇÕES EXTERNAS
// ============================================

async function enviarWhatsApp(numero, texto) {
  console.log(`📤 PARA ${numero}: ${texto.substring(0, 80)}...`);
  
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    console.error('❌ WhatsApp não configurado');
    return false;
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const res = await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: numero,
        type: 'text',
        text: { body: texto }
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!res.ok) {
      const data = await res.json();
      console.error('❌ Erro WhatsApp API:', res.status, data);
      return false;
    }
    
    console.log('✅ Enviado');
    return true;
    
  } catch (e) {
    console.error('❌ Erro ao enviar:', e.message);
    return false;
  }
}

async function enviarTelegram(mensagem) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('ℹ️ Telegram não configurado');
    return false;
  }
  
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: mensagem,
        parse_mode: 'Markdown'
      })
    });
    return res.ok;
  } catch (e) {
    console.error('❌ Erro Telegram:', e.message);
    return false;
  }
}

async function processarImagem(telefone, nome, imagemData) {
  const tecnico = CONFIG.tecnicos.reforma;
  await enviarWhatsApp(tecnico, `${nome} (${telefone}) enviou uma foto. Verifique no painel de atendimento.`);
  await enviarTelegram(`Nova imagem de ${nome} (${telefone})`);
}
'''

print("Código do webhook criado (api/webhook.js)")
print(f"Total de linhas: {len(webhook_code.split(chr(10)))}")
