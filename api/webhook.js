// ============================================
// CONFIGURAÇÕES E VARIÁVEIS DE AMBIENTE
// ============================================
const CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  GROQ_KEY: process.env.GROQ_KEY,
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
  SEU_NUMERO: process.env.SEU_NUMERO,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,      // NOVO: Token do Bot Telegram
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,          // NOVO: ID do chat para relatórios
  TELEGRAM_ADMIN_ID: process.env.TELEGRAM_ADMIN_ID         // NOVO: Seu ID para comandos admin
};

// ============================================
// TABELA DE PREÇOS DINÂMICA
// ============================================
const TABELA_PRECOS = {
  ar_condicionado: {
    nome: 'Ar Condicionado',
    base: 120,
    faixa: 'R$120-250',
    variaveis: ['btus', 'ambientes', 'marca', 'andar', 'tipo_instalacao'],
    multiplicador: (dados) => {
      let valor = 120;
      if (dados.btus > 12000) valor += 50;
      if (dados.btus > 24000) valor += 80;
      if (dados.ambientes > 1) valor += 30 * (dados.ambientes - 1);
      if (dados.andar && dados.andar > 3) valor += 40;
      if (dados.tipo_instalacao === 'dupla') valor += 60;
      return valor;
    }
  },
  geladeira: {
    nome: 'Geladeira',
    base: 80,
    faixa: 'R$80-150',
    variaveis: ['tipo', 'marca', 'problema', 'idade'],
    multiplicador: (dados) => {
      let valor = 80;
      if (dados.tipo === 'side_by_side' || dados.tipo === 'frost_free') valor += 40;
      if (dados.tipo === 'industrial') valor += 80;
      if (dados.marca === 'importada' || dados.marca === 'premium') valor += 30;
      if (dados.idade > 10) valor += 20; // aparelho antigo
      return valor;
    }
  },
  maquina_lavar: {
    nome: 'Máquina de Lavar',
    base: 80,
    faixa: 'R$80-140',
    variaveis: ['kg', 'tipo', 'marca', 'problema'],
    multiplicador: (dados) => {
      let valor = 80;
      if (dados.kg > 10) valor += 30;
      if (dados.kg > 15) valor += 40;
      if (dados.tipo === 'secadora_combo') valor += 50;
      return valor;
    }
  },
  reforma: {
    nome: 'Reforma',
    base: 150,
    faixa: 'R$150-500',
    variaveis: ['metragem', 'comodos', 'tipo_reforma', 'urgencia', 'material_incluso'],
    multiplicador: (dados) => {
      let valor = 150;
      if (dados.metragem > 50) valor += (dados.metragem - 50) * 2;
      if (dados.metragem > 100) valor += (dados.metragem - 100) * 1.5;
      if (dados.comodos > 2) valor += 50 * (dados.comodos - 2);
      if (dados.urgencia === 'sim' || dados.urgencia === 'urgente') valor += 100;
      if (dados.material_incluso === 'sim') valor += 200;
      return valor;
    }
  },
  eletrica: {
    nome: 'Serviço Elétrico',
    base: 100,
    faixa: 'R$100-300',
    variaveis: ['tipo_servico', 'urgencia', 'horario'],
    multiplicador: (dados) => {
      let valor = 100;
      if (dados.tipo_servico === 'quadro') valor += 150;
      if (dados.tipo_servico === 'rede') valor += 200;
      if (dados.urgencia === 'sim') valor += 80;
      if (dados.horario === 'noturno') valor += 60;
      return valor;
    }
  }
};

// ============================================
// PROMPT AVANÇADO DO VENDEDOR (TREINAMENTO DA IA)
// ============================================
const PROMPT_VENDEDOR = `Você é Carlos Silva, consultor técnico sênior da Conecta Serviços há 8 anos. Especialista em diagnóstico residencial e comercial.

🎯 PERSONALIDADE:
- Profissional, confiante, consultivo
- Nunca desesperado por venda
- Fala como brasileiro natural (gírias leves ok, mas profissional)
- Usa emojis ocasionalmente para humanizar
- Técnico quando necessário, simples quando possível

📋 SISTEMA DE ETAPAS (obrigatório seguir):

ETAPA 1 - SAUDAÇÃO (saudacao):
"Olá! Sou Carlos da Conecta Serviços. Vi que você precisa de ajuda com [serviço detectado]. Posso fazer algumas perguntas rápidas para entender melhor?"

ETAPA 2 - DIAGNÓSTICO (diagnostico):
Fazer perguntas específicas baseadas no serviço:
- Ar condicionado: BTUs, quantos ambientes, andar, marca
- Geladeira: Tipo, marca, problema, idade
- Máquina: Kg, tipo, marca, problema
- Reforma: Metragem, cômodos, tipo, urgência

ETAPA 3 - QUALIFICAÇÃO (qualificacao):
Coletar dados técnicos e logísticos:
- Bairro (ESSENCIAL para enviar técnico)
- Melhor horário para visita
- Urgência do serviço
- Acesso ao local

ETAPA 4 - CONSTRUÇÃO DE VALOR (construcao_valor):
"Entendo que [problema] está te causando [incômodo]. Isso é mais comum do que parece e tem solução definitiva. Nossos técnicos são especialistas certificados..."

ETAPA 5 - PROPOSTA (proposta):
Só agora falar de valores!
"O valor da visita técnica é [FAIXA DE PREÇO DO SERVIÇO]. Isso inclui:
- Diagnóstico completo
- Orçamento detalhado
- 30 dias de garantia no serviço"

ETAPA 6 - NEGOCIAÇÃO (negociacao):
Se pedir desconto: "Consigo ajustar para R$[VALOR] se confirmarmos hoje para [DATA PRÓXIMA]."
Se hesitar: "Entendo que quer avaliar. Só lembrando que [fator urgência/escassez]. Qual sua maior dúvida?"

ETAPA 7 - FECHAMENTO (fechamento):
"Perfeito! Vou agendar para [DIA] às [HORA]. Confirma o endereço: [BAIRRO]?"

ETAPA 8 - ENCAMINHAMENTO (encaminhamento):
Informar que técnico será notificado.

⚠️ REGRAS DE OURO:
- NUNCA dê preço antes de qualificar completamente
- NUNCA diga "só um minuto" ou "deixa eu ver"
- SEMPRE assuma controle da conversa
- Use "porque" para autoridade científica
- Máximo 3 mensagens curtas por resposta
- SEMPRE detecte o bairro para calcular deslocamento

💰 PREÇOS DE VISITA (só informar na etapa proposta):
- Ar condicionado: R$120-250 (conforme BTUs/dificuldade)
- Geladeira: R$80-150 (conforme tipo)
- Máquina: R$80-140 (conforme capacidade)
- Reforma: R$150-500 (conforme metragem/complexidade)
- Elétrica: R$100-300 (conforme tipo)

🔄 SE CLIENTE MANDAR FOTO/VÍDEO:
"Perfeito, consigo ver [descrever problema visualmente]. Isso confirma que é [diagnóstico técnico]. Vamos resolver isso!"

Responda sempre avançando para a próxima etapa lógica.`;

// ============================================
// HANDLER PRINCIPAL (API ROUTE)
// ============================================
export default async function handler(req, res) {
  // Verificação do webhook WhatsApp (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === 'agente123') {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // Processamento de mensagens (POST)
  if (req.method === 'POST') {
    try {
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      
      if (!message) return res.status(200).send('OK');
      
      const telefone = message.from;
      const nome = value.contacts?.[0]?.profile?.name || 'Cliente';
      
      // Ignorar mensagens do próprio sistema
      if (telefone === CONFIG.WHATSAPP_PHONE_ID) return res.status(200).send('OK');
      
      // ========== PROCESSAR MENSAGEM ==========
      let conteudoProcessado = await processarMensagem(message);
      
      // ========== BUSCAR CONTEXTO ==========
      const conversa = await buscarConversa(telefone);
      
      // Atualizar histórico (últimas 10 mensagens)
      const novoHistorico = [...(conversa.historico_msg || []), {
        role: 'user',
        content: conteudoProcessado.texto,
        timestamp: new Date().toISOString()
      }].slice(-10);
      
      // ========== IA PROCESSAR ==========
      const contextoCompleto = montarContexto(conversa, nome, conteudoProcessado);
      const respostaIA = await chamarGroq(contextoCompleto);
      
      // ========== INTERPRETAR RESPOSTA ==========
      const acao = interpretarResposta(respostaIA, conversa);
      
      // Calcular valor se necessário
      if (acao.novosDados.servico_detectado && !acao.valorCalculado) {
        acao.valorCalculado = calcularValorVisita(
          acao.novosDados.servico_detectado, 
          { ...conversa.dados_json, ...acao.novosDados }
        );
      }
      
      // ========== SALVAR NO BANCO ==========
      await salvarConversa(telefone, {
        ...conversa,
        nome_cliente: nome,
        historico_msg: [...novoHistorico, {
          role: 'assistant',
          content: respostaIA,
          timestamp: new Date().toISOString()
        }],
        etapa: acao.novaEtapa || conversa.etapa || 'saudacao',
        dados_json: { ...conversa.dados_json, ...acao.novosDados },
        servico_detectado: acao.novosDados.servico_detectado || conversa.servico_detectado,
        valor_visita: acao.valorCalculado || conversa.valor_visita,
        bairro: acao.novosDados.bairro || conversa.bairro,
        status: acao.encaminharTecnico ? 'aguardando_tecnico' : conversa.status || 'novo'
      });
      
      // ========== EXECUTAR AÇÕES ==========
      
      // 1. Responder cliente
      await enviarWhatsApp(telefone, respostaIA);
      
      // 2. Se identificou serviço completo, alertar técnicos
      if (acao.encaminharTecnico) {
        await processarEncaminhamentoTecnico(
          nome, 
          telefone, 
          acao.novosDados, 
          acao.valorCalculado,
          conversa
        );
      }
      
      // 3. Enviar relatório ao Telegram (se houver atualização importante)
      if (deveNotificarTelegram(acao, conversa)) {
        await enviarRelatorioTelegram({
          nome,
          telefone,
          bairro: acao.novosDados.bairro || conversa.bairro,
          servico: acao.novosDados.servico_detectado || conversa.servico_detectado,
          etapa: acao.novaEtapa,
          valor: acao.valorCalculado,
          status: acao.encaminharTecnico ? 'FECHAMENTO' : 'EM_ANDAMENTO'
        });
      }
      
      // 4. Log para treinamento
      await salvarLog({
        telefone,
        tipo_msg: message.type,
        conteudo_original: conteudoProcessado.texto,
        interpretacao_ia: conteudoProcessado.descricao_midia,
        resposta_enviada: respostaIA,
        etapa_conversa: acao.novaEtapa,
        acao_tomada: acao
      });
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('Erro no handler:', erro);
      await enviarTelegramAdmin(`🚨 ERRO NO SISTEMA: ${erro.message}`);
      return res.status(500).send('Erro interno');
    }
  }
  
  return res.status(405).send('Method not allowed');
}

// ============================================
// FUNÇÕES DE PROCESSAMENTO DE MENSAGEM
// ============================================

async function processarMensagem(message) {
  let conteudo = {
    tipo: message.type,
    texto: '',
    descricao_midia: '',
    midia_id: null
  };
  
  switch (message.type) {
    case 'text':
      conteudo.texto = message.text.body;
      break;
      
    case 'audio':
      conteudo.texto = '[áudio do cliente]';
      conteudo.descricao_midia = 'Cliente enviou áudio descrevendo o problema';
      // TODO: Implementar transcrição com Whisper/AssemblyAI
      break;
      
    case 'image':
      conteudo.texto = '[imagem do cliente]';
      conteudo.midia_id = message.image.id;
      conteudo.descricao_midia = await analisarImagem(message.image.id);
      break;
      
    case 'video':
      conteudo.texto = '[vídeo do cliente]';
      conteudo.descricao_midia = 'Cliente enviou vídeo demonstrando o problema';
      break;
      
    case 'document':
      conteudo.texto = '[documento do cliente]';
      conteudo.descricao_midia = 'Cliente enviou documento';
      break;
      
    case 'location':
      conteudo.texto = `[localização: ${message.location.latitude}, ${message.location.longitude}]`;
      conteudo.descricao_midia = 'Cliente compartilhou localização';
      break;
      
    default:
      conteudo.texto = '[mensagem não reconhecida]';
  }
  
  return conteudo;
}

function montarContexto(conversa, nome, conteudo) {
  let contexto = `=== CONTEXTO DA CONVERSA ===\n`;
  contexto += `VOCÊ É CARLOS, CONSULTOR TÉCNICO DA CONECTA SERVIÇOS.\n\n`;
  contexto += `CLIENTE: ${nome} (${conversa.telefone})\n`;
  contexto += `ETAPA ATUAL: ${conversa.etapa || 'saudacao'}\n`;
  contexto += `DATA/HORA: ${new Date().toLocaleString('pt-BR')}\n\n`;
  
  if (conversa.servico_detectado) {
    contexto += `SERVIÇO IDENTIFICADO: ${TABELA_PRECOS[conversa.servico_detectado]?.nome || conversa.servico_detectado}\n`;
    contexto += `DADOS COLETADOS: ${JSON.stringify(conversa.dados_json || {}, null, 2)}\n`;
    if (conversa.valor_visita) {
      contexto += `VALOR CALCULADO: R$${conversa.valor_visita}\n`;
    }
  }
  
  if (conteudo.descricao_midia) {
    contexto += `ANÁLISE DA MÍDIA: ${conteudo.descricao_midia}\n`;
  }
  
  contexto += `\n=== MENSAGEM DO CLIENTE ===\n${conteudo.texto}\n\n`;
  
  if (conversa.historico_msg?.length > 0) {
    contexto += `=== HISTÓRICO RECENTE ===\n`;
    conversa.historico_msg.slice(-3).forEach(msg => {
      const prefixo = msg.role === 'user' ? 'Cliente' : 'Carlos';
      contexto += `${prefixo}: ${msg.content.substring(0, 150)}${msg.content.length > 150 ? '...' : ''}\n`;
    });
    contexto += `\n`;
  }
  
  contexto += `=== INSTRUÇÃO ===\nCom base no contexto acima, responda como Carlos avançando para a próxima etapa do atendimento. Seja natural e profissional.`;
  
  return contexto;
}

// ============================================
// INTEGRAÇÃO COM GROQ (IA)
// ============================================

async function chamarGroq(contexto) {
  try {
    const resposta = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192', // ou 'mixtral-8x7b-32768' para mais velocidade
        messages: [
          { role: 'system', content: PROMPT_VENDEDOR },
          { role: 'user', content: contexto }
        ],
        temperature: 0.7, // Equilíbrio entre criatividade e consistência
        max_tokens: 500,
        top_p: 0.9,
        frequency_penalty: 0.2, // Evita repetições
        presence_penalty: 0.1   // Incentiva novos tópicos
      })
    });
    
    if (!resposta.ok) {
      throw new Error(`Groq API error: ${resposta.status}`);
    }
    
    const dados = await resposta.json();
    return dados.choices?.[0]?.message?.content || 'Entendi. Pode me dar mais detalhes sobre o que precisa?';
    
  } catch (erro) {
    console.error('Erro na Groq:', erro);
    return 'Desculpe, tive um problema técnico. Pode repetir?';
  }
}

// ============================================
// INTERPRETAÇÃO INTELIGENTE DA RESPOSTA
// ============================================

function interpretarResposta(texto, conversaAtual) {
  const t = texto.toLowerCase();
  const resultado = {
    novaEtapa: null,
    novosDados: {},
    encaminharTecnico: false,
    valorCalculado: 0
  };
  
  // Detectar intenção de serviço (apenas se ainda não tiver)
  if (!conversaAtual.servico_detectado) {
    const servicosDetectados = {
      'ar condicionado': 'ar_condicionado',
      'ar-condicionado': 'ar_condicionado',
      'geladeira': 'geladeira',
      'refrigerador': 'geladeira',
      'máquina de lavar': 'maquina_lavar',
      'lavadora': 'maquina_lavar',
      'reforma': 'reforma',
      'elétrica': 'eletrica',
      'eletricista': 'eletrica'
    };
    
    for (const [chave, valor] of Object.entries(servicosDetectados)) {
      if (t.includes(chave)) {
        resultado.novosDados.servico_detectado = valor;
        resultado.novaEtapa = 'diagnostico';
        break;
      }
    }
  } else {
    resultado.novosDados.servico_detectado = conversaAtual.servico_detectado;
  }
  
  // Detectar progressão de etapa pela resposta da IA
  if (t.includes('bairro') || t.includes('onde fica') || t.includes('localização')) {
    resultado.novaEtapa = 'qualificacao_bairro';
  }
  else if (t.includes('btus') || t.includes('metragem') || t.includes('m²') || t.includes('quilos')) {
    resultado.novaEtapa = 'qualificacao_tecnica';
  }
  else if (t.includes('valor') || t.includes('preço') || t.includes('custa') || t.includes('investimento')) {
    resultado.novaEtapa = 'proposta';
  }
  else if (t.includes('r$') && (t.includes('visita') || t.includes('orçamento') || t.includes('confirmar'))) {
    resultado.novaEtapa = 'negociacao';
    
    // Extrair valor mencionado
    const match = texto.match(/R\$\s*(\d{2,3})/i);
    if (match) resultado.valorCalculado = parseInt(match[1]);
  }
  else if (t.includes('agendado') || t.includes('confirmado') || t.includes('fechado') || 
           t.includes('marcado') || t.includes('combinado')) {
    resultado.novaEtapa = 'fechamento';
    resultado.encaminharTecnico = true;
  }
  else if (t.includes('técnico') && t.includes('notificar')) {
    resultado.novaEtapa = 'encaminhamento';
    resultado.encaminharTecnico = true;
  }
  
  // Extrair dados técnicos do texto (regex inteligente)
  extrairDadosTecnicos(texto, resultado.novosDados);
  
  return resultado;
}

function extrairDadosTecnicos(texto, dados) {
  const t = texto.toLowerCase();
  
  // Extrair BTUs
  const btusMatch = t.match(/(\d{2,5})\s*btus?/);
  if (btusMatch) dados.btus = parseInt(btusMatch[1]);
  
  // Extrair metragem
  const metroMatch = t.match(/(\d+)\s*m²?/);
  if (metroMatch) dados.metragem = parseInt(metroMatch[1]);
  
  // Extrair bairro (padrão: "bairro X" ou "no X")
  const bairroMatch = texto.match(/bairro\s+([A-Za-zÀ-ÖØ-öø-ÿ\s]+)/i) || 
                      texto.match(/moro\s+(?:no|na)\s+([A-Za-zÀ-ÖØ-öø-ÿ\s]+)/i);
  if (bairroMatch) dados.bairro = bairroMatch[1].trim();
  
  // Extrair cômodos
  const comodosMatch = t.match(/(\d+)\s*cômodos?/);
  if (comodosMatch) dados.comodos = parseInt(comodosMatch[1]);
  
  // Detectar urgência
  if (t.includes('urgente') || t.includes('emergência') || t.includes('parou') || t.includes('quebrou')) {
    dados.urgencia = 'sim';
  }
  
  // Detectar tipo de problema
  if (t.includes('não liga') || t.includes('parou') || t.includes('queimou')) {
    dados.problema = 'eletrico';
  } else if (t.includes('vazando') || t.includes('água')) {
    dados.problema = 'vazamento';
  } else if (t.includes('barulho') || t.includes('ruído')) {
    dados.problema = 'mecanico';
  }
}

function calcularValorVisita(tipoServico, dados) {
  const servico = TABELA_PRECOS[tipoServico];
  if (!servico) return 100; // valor padrão
  
  return servico.multiplicador(dados);
}

// ============================================
// ENCAMINHAMENTO PARA TÉCNICOS
// ============================================

async function processarEncaminhamentoTecnico(nome, telefone, dados, valor, conversa) {
  // Buscar técnicos disponíveis
  const tecnicos = await buscarTecnicosDisponiveis(
    dados.servico_detectado || conversa.servico_detectado,
    dados.bairro || conversa.bairro
  );
  
  if (tecnicos.length === 0) {
    // Notificar admin que não há técnicos
    await enviarTelegramAdmin(
      `⚠️ SEM TÉCNICOS DISPONÍVEIS\n\n` +
      `Cliente: ${nome} (${telefone})\n` +
      `Serviço: ${dados.servico_detectado}\n` +
      `Bairro: ${dados.bairro || 'Não informado'}\n` +
      `Cadastrar técnico urgente!`
    );
    return;
  }
  
  // Notificar cada técnico
  for (const tecnico of tecnicos) {
    const mensagemTecnico = 
      `🔧 *NOVA OPORTUNIDADE - CONECTA SERVIÇOS*\n\n` +
      `*Cliente:* ${nome}\n` +
      `*Telefone:* ${telefone}\n` +
      `*Serviço:* ${TABELA_PRECOS[dados.servico_detectado]?.nome || dados.servico_detectado}\n` +
      `*Bairro:* ${dados.bairro || conversa.bairro || 'A confirmar'}\n` +
      `*Valor Visita:* R$${valor}\n` +
      `*Urgência:* ${dados.urgencia === 'sim' ? '⚠️ URGENTE' : 'Normal'}\n\n` +
      `*Detalhes:*\n${formatarDetalhes(dados)}\n\n` +
      `Responda:\n` +
      `✅ *SIM* - Para aceitar\n` +
      `❌ *NÃO* - Para recusar\n` +
      `⏰ *HORARIO* - Para ver disponibilidade`;
    
    await enviarWhatsApp(tecnico.telefone, mensagemTecnico);
  }
  
  // Notificar você (admin)
  await enviarWhatsApp(CONFIG.SEU_NUMERO,
    `🎯 *LEAD QUALIFICADO - FECHAMENTO*\n\n` +
    `*Cliente:* ${nome}\n` +
    `*Telefone:* ${telefone}\n` +
    `*Serviço:* ${TABELA_PRECOS[dados.servico_detectado]?.nome}\n` +
    `*Bairro:* ${dados.bairro || conversa.bairro}\n` +
    `*Valor:* R$${valor}\n` +
    `*Técnicos notificados:* ${tecnicos.length}\n` +
    `*Status:* Aguardando confirmação do técnico`
  );
  
  // Atualizar status no banco
  await salvarConversa(telefone, {
    ...conversa,
    tecnicos_notificados: tecnicos.map(t => t.telefone),
    status: 'aguardando_tecnico',
    data_fechamento: new Date().toISOString()
  });
}

function formatarDetalhes(dados) {
  let detalhes = '';
  const campos = {
    btus: 'BTUs',
    ambientes: 'Ambientes',
    metragem: 'Metragem',
    comodos: 'Cômodos',
    tipo: 'Tipo',
    marca: 'Marca',
    problema: 'Problema',
    urgencia: 'Urgência'
  };
  
  for (const [key, label] of Object.entries(campos)) {
    if (dados[key]) {
      detalhes += `• ${label}: ${dados[key]}\n`;
    }
  }
  
  return detalhes || 'Detalhes básicos';
}

// ============================================
// RELATÓRIOS TELEGRAM
// ============================================

function deveNotificarTelegram(acao, conversa) {
  // Notificar em mudanças importantes de status
  const etapasImportantes = ['proposta', 'negociacao', 'fechamento', 'encaminhamento'];
  return etapasImportantes.includes(acao.novaEtapa) || acao.encaminharTecnico;
}

async function enviarRelatorioTelegram(dados) {
  const emojiStatus = {
    'FECHAMENTO': '✅',
    'EM_ANDAMENTO': '🔄',
    'CANCELADO': '❌',
    'CONCLUIDO': '🎉'
  };
  
  const mensagem = 
    `${emojiStatus[dados.status] || '📊'} *RELATÓRIO DE ATENDIMENTO*\n\n` +
    `*Cliente:* ${dados.nome}\n` +
    `*Telefone:* ${dados.telefone}\n` +
    `*Bairro:* ${dados.bairro || 'Não informado'}\n` +
    `*Serviço:* ${TABELA_PRECOS[dados.servico]?.nome || dados.servico}\n` +
    `*Etapa:* ${dados.etapa?.toUpperCase()}\n` +
    `*Valor:* ${dados.valor ? `R$${dados.valor}` : 'A calcular'}\n` +
    `*Status:* ${dados.status}\n` +
    `*Data:* ${new Date().toLocaleString('pt-BR')}`;
  
  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: mensagem,
        parse_mode: 'Markdown'
      })
    });
  } catch (erro) {
    console.error('Erro ao enviar relatório Telegram:', erro);
  }
}

async function enviarTelegramAdmin(mensagem) {
  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.TELEGRAM_ADMIN_ID,
        text: mensagem,
        parse_mode: 'Markdown'
      })
    });
  } catch (erro) {
    console.error('Erro ao notificar admin:', erro);
  }
}

// ============================================
// FUNÇÕES SUPABASE (BANCO DE DADOS)
// ============================================

async function buscarConversa(telefone) {
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/conversas?telefone=eq.${telefone}&order=atualizado_em.desc&limit=1`, {
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Accept': 'application/json'
      }
    });
    
    if (!res.ok) throw new Error('Erro ao buscar conversa');
    
    const dados = await res.json();
    return dados[0] || { 
      telefone, 
      etapa: 'saudacao', 
      dados_json: {}, 
      historico_msg: [],
      status: 'novo'
    };
  } catch (erro) {
    console.error('Erro buscarConversa:', erro);
    return { telefone, etapa: 'saudacao', dados_json: {}, historico_msg: [], status: 'novo' };
  }
}

async function salvarConversa(telefone, dados) {
  try {
    const existe = await buscarConversa(telefone);
    
    const body = {
      ...dados,
      atualizado_em: new Date().toISOString()
    };
    
    let res;
    if (existe.id) {
      // Update
      res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/conversas?id=eq.${existe.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(body)
      });
    } else {
      // Insert
      res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/conversas`, {
        method: 'POST',
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ 
          ...body, 
          telefone,
          criado_em: new Date().toISOString() 
        })
      });
    }
    
    if (!res.ok) {
      const erro = await res.text();
      throw new Error(`Erro ao salvar: ${erro}`);
    }
    
    return true;
  } catch (erro) {
    console.error('Erro salvarConversa:', erro);
    return false;
  }
}

async function buscarTecnicosDisponiveis(servico, bairro) {
  try {
    // Buscar técnicos ativos com especialidade
    const url = new URL(`${CONFIG.SUPABASE_URL}/rest/v1/tecnicos`);
    url.searchParams.append('ativo', 'eq.true');
    url.searchParams.append('especialidades', 'cs.{"' + servico + '"}');
    
    const res = await fetch(url, {
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
      }
    });
    
    if (!res.ok) throw new Error('Erro ao buscar técnicos');
    
    const tecnicos = await res.json();
    
    // Priorizar técnicos do bairro
    if (bairro) {
      const comBairro = tecnicos.filter(t => 
        t.bairros_atendidos?.some(b => 
          b.toLowerCase().includes(bairro.toLowerCase()) ||
          bairro.toLowerCase().includes(b.toLowerCase())
        )
      );
      
      if (comBairro.length > 0) return comBairro;
    }
    
    return tecnicos;
  } catch (erro) {
    console.error('Erro buscarTecnicos:', erro);
    return [];
  }
}

async function salvarLog(dados) {
  try {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/logs_mensagens`, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...dados,
        criado_em: new Date().toISOString()
      })
    });
  } catch (erro) {
    console.error('Erro ao salvar log:', erro);
  }
}

// ============================================
// FUNÇÕES WHATSAPP
// ============================================

async function enviarWhatsApp(telefone, mensagem) {
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${CONFIG.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: telefone,
        type: 'text',
        text: { 
          body: mensagem,
          preview_url: false
        }
      })
    });
    
    if (!res.ok) {
      const erro = await res.json();
      throw new Error(`WhatsApp API error: ${JSON.stringify(erro)}`);
    }
    
    return await res.json();
  } catch (erro) {
    console.error('Erro enviarWhatsApp:', erro);
    throw erro;
  }
}

// ============================================
// ANÁLISE DE IMAGEM (PLACEHOLDER)
// ============================================

async function analisarImagem(imageId) {
  // TODO: Implementar com GPT-4 Vision ou Hugging Face
  // Por enquanto, retorna genérico para não quebrar fluxo
  return 'Imagem recebida para análise técnica (análise visual será implementada)';
}

// ============================================
// COMANDOS DO TÉCNICO VIA WHATSAPP
// ============================================

export async function processarRespostaTecnico(req, res) {
  // Endpoint separado para quando técnico responde
  const { from, text } = req.body;
  
  if (!text || !from) return res.status(400).send('Dados inválidos');
  
  const resposta = text.body.toLowerCase();
  
  // Buscar última oportunidade enviada para este técnico
  const oportunidade = await buscarOportunidadePendente(from);
  
  if (!oportunidade) {
    await enviarWhatsApp(from, 'Não encontrei oportunidades pendentes para você. Entre em contato com o admin.');
    return res.status(200).send('OK');
  }
  
  if (resposta.includes('sim') || resposta.includes('✅') || resposta.includes('aceito')) {
    // Técnico aceitou
    await aceitarOportunidade(oportunidade, from);
    
    await enviarWhatsApp(from, 
      `✅ Oportunidade confirmada!\n\n` +
      `Cliente: ${oportunidade.nome_cliente}\n` +
      `Telefone: ${oportunidade.telefone_cliente}\n` +
      `Endereço: ${oportunidade.bairro}\n\n` +
      `Entre em contato com o cliente em até 30 minutos.`
    );
    
    // Notificar cliente
    await enviarWhatsApp(oportunidade.telefone_cliente,
      `Ótima notícia! Nosso técnico ${oportunidade.nome_tecnico} confirmou sua visita.\n` +
      `Ele entrará em contato em breve para combinar o horário.`
    );
    
    // Atualizar relatório
    await enviarRelatorioTelegram({
      ...oportunidade,
      status: 'TECNICO_CONFIRMADO',
      etapa: 'tecnico_alocado'
    });
    
  } else if (resposta.includes('não') || resposta.includes('nao') || resposta.includes('❌')) {
    // Técnico recusou
    await recusarOportunidade(oportunidade, from);
    
    await enviarWhatsApp(from, 'Entendido. Vamos procurar outro profissional para esta oportunidade.');
    
    // Notificar próximo técnico
    await buscarENotificarProximoTecnico(oportunidade);
    
  } else if (resposta.includes('horario') || resposta.includes('horário')) {
    // Técnico quer ver horários
    await enviarWhatsApp(from,
      `Horários disponíveis para ${oportunidade.nome_cliente}:\n` +
      `Manhã: 8h - 12h\n` +
      `Tarde: 14h - 18h\n\n` +
      `Responda com o horário preferido ou MANHA/TARDE.`
    );
  }
  
  return res.status(200).send('OK');
}
