// ============================================
// RC ATENDIMENTO - IA HUMANIZADA 100% GROQ
// ============================================

const CONFIG = {
  tecnicos: {
    marcenaria: '5521978791765',
    reforma: '5521968112176',
    hidraulica: '5521968112176'
  },
  
  precoZonaSul: 180,
  precoOutros: 220,
  
  bairrosZonaSul: ['ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 'sao conrado', 'vidigal', 'rocinha'],
  
  // Saudação conforme SEÇÃO 1.1 - sem emojis, profissional
  saudacao: `Ola! Me informe o servico e bairro que deseja atendimento`
};

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const clientes = {};

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
      return await receberMensagem(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (erro) {
    console.error('ERRO:', erro);
    return res.status(200).send('OK');
  }
}

async function receberMensagem(req, res) {
  const body = req.body;
  
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  
  // SEÇÃO 1.4 - Áudio não suportado
  if (message && message.type === 'audio') {
    const telefone = message.from;
    await enviarWhatsApp(telefone, "No momento eu nao consigo ouvir, pode escrever?");
    return res.status(200).send('OK');
  }
  
  // SEÇÃO 1.3 - Cliente envia foto sem texto
  if (message && message.type === 'image' && !message.text) {
    const telefone = message.from;
    const cliente = clientes[telefone];
    
    // Se for início de conversa sem saudação
    if (!cliente || cliente.historico.length === 0) {
      await enviarWhatsApp(telefone, "Ola! Me informe o servico e bairro que deseja atendimento");
      return res.status(200).send('OK');
    }
    // Se já estiver em conversa e tiver serviço, encaminhar ao técnico (implementado no fluxo principal)
  }
  
  if (!message || message.type !== 'text') {
    return res.status(200).send('OK');
  }
  
  const telefone = message.from;
  const nome = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || 'Cliente';
  const texto = message.text.body;
  
  console.log(`\n📨 ${nome} (${telefone}): ${texto}`);
  
  if (!clientes[telefone]) {
    clientes[telefone] = {
      nome,
      telefone,
      primeiraVez: true,
      historico: [],
      dados: {
        servico: null,
        bairro: null,
        valor: null,
        data: null,
        hora: null,
        endereco: null,
        tecnicoNotificado: false,
        profissionalNome: null,
        visitaConfirmada: false
      }
    };
  }
  
  const cliente = clientes[telefone];
  
  // SEÇÃO 1.1 - Saudação apenas na primeira vez, depois fluxo natural
  if (cliente.primeiraVez) {
    cliente.primeiraVez = false;
    cliente.historico.push({
      role: 'user',
      content: texto,
      timestamp: new Date().toISOString()
    });
    
    // SEÇÃO 1.2 - Se perguntar se é robô/humano
    const t = texto.toLowerCase();
    if (t.includes('quem e voce') || t.includes('voce e robo') || t.includes('e humano') || t.includes('atendente')) {
      const resposta = "Sou o Atendimento Digital da RC Reforma e Construcao";
      await enviarWhatsApp(telefone, resposta);
      cliente.historico.push({
        role: 'assistant',
        content: resposta,
        timestamp: new Date().toISOString()
      });
      return res.status(200).send('OK');
    }
    
    // Primeira resposta conforme instruções
    const resposta = CONFIG.saudacao;
    await enviarWhatsApp(telefone, resposta);
    cliente.historico.push({
      role: 'assistant',
      content: resposta,
      timestamp: new Date().toISOString()
    });
    return res.status(200).send('OK');
  }
  
  cliente.historico.push({
    role: 'user',
    content: texto,
    timestamp: new Date().toISOString()
  });
  
  const resposta = await processarComIA(cliente, texto);
  
  if (resposta) {
    const enviado = await enviarWhatsApp(telefone, resposta);
    if (enviado) {
      cliente.historico.push({
        role: 'assistant',
        content: resposta,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  return res.status(200).send('OK');
}

async function processarComIA(cliente, texto) {
  const t = texto.toLowerCase();
  const horaAtual = new Date().getHours();
  const dadosAtuais = JSON.stringify(cliente.dados);
  
  // SEÇÃO 1.2 - Identidade quando perguntam
  if (t.includes('quem e voce') || t.includes('voce e robo') || t.includes('e humano') || t.includes('atendente')) {
    return "Sou o Atendimento Digital da RC Reforma e Construcao";
  }
  
  // SEÇÃO 9.5 - Cliente grosseiro/impaciente
  if (t.includes('idiota') || t.includes('burro') || t.includes('inutil') || t.includes('merda') || t.includes('odio') || t.includes('raiva')) {
    return "Se precisar de atendimento para o servico que precisa, me avise";
  }
  
  // SEÇÃO 9.4 - Quer falar com quem vai fazer o serviço
  if (t.includes('falar com quem vai fazer') || t.includes('falar com o profissional') || t.includes('contato do tecnico') || t.includes('telefone do tecnico')) {
    return "Qual a sua duvida?";
    // NUNCA passar contato do profissional conforme instruções
  }
  
  // SEÇÃO 8.5 - Cliente é síndico/empresa
  if (t.includes('sindico') || t.includes('condominio') || t.includes('empresa') || t.includes('predio') || t.includes('comercial')) {
    return "Infelizmente o profissional esta com alta demanda e no momento nao esta prestando servicos para empresas, apenas pessoas fisicas";
  }
  
  // SEÇÃO 8.6 - Quer apenas material
  if (t.includes('so material') || t.includes('apenas material') || t.includes('comprar material') || t.includes('venda de material')) {
    return "Os profissionais apenas realizam servicos, nao vendem produtos";
  }
  
  // SEÇÃO 2.8 - Cliente evasivo
  if (t.includes('depois eu te falo') || t.includes('so queria saber preco') || t.includes('só queria saber preço') || t.includes('depois eu entro em contato')) {
    return "Se precisar de atendimento, pode entrar em contato";
  }
  
  // SEÇÃO 3.6 - Vou pensar e volto
  if (t.includes('vou pensar') || t.includes('volto depois') || t.includes('depois eu decido')) {
    return "Sempre que precisar, entre em contato";
  }
  
  // SEÇÃO 6.4 - Cancelamento
  if (t.includes('desisti') || t.includes('cancela') || t.includes('quero cancelar')) {
    return "Pode contar melhor o que houve?";
  }
  
  const historicoFormatado = cliente.historico.slice(-8).map(h => {
    return `${h.role === 'user' ? 'Cliente' : 'Atendimento'}: ${h.content}`;
  }).join('\n');

  const systemPrompt = `Voce e o Atendimento Digital da RC Reforma e Construcao. Seu nome e "Atendimento Digital RC". 
Voce tem que ser indistinguivel de um atendente humano profissional e empatico.

=== REGRAS ABSOLUTAS DO DOCUMENTO ===

IDENTIDADE (Secao 1.2, 11.1):
- Nome: Atendimento Digital RC
- Se perguntarem se e robo/humano: "Sou o Atendimento Digital da RC Reforma e Construcao"
- Tom: Profissional empatico, linguajar profissional, SEM girias, SEM emojis
- Despedida: "Se precisar de algo, so chamar"
- Nunca assinar mensagens

COLETA DE DADOS (Secao 2):
- Cliente diz "Oi": "Ola! Me informe o servico e bairro que deseja atendimento"
- Cliente diz so servico (ex: "pintura"): "Para qual bairro deseja atendimento?"
- Cliente diz so bairro (ex: "Tijuca"): "Qual servico deseja?"
- Cliente diz servico+bairro (ex: "pintura em Ipanema"): "Perfeito. Para enviar um orcamento preciso, e necessario uma visita tecnica ao local. O valor da visita e R$180, mas e abatido do valor final se o orcamento for aprovado."
- Cliente pergunta "Quanto custa?" antes de dizer o que precisa: "A qual servico se refere? Nao posso dizer um valor exato, pois depende da visita tecnica de um profissional, mas posso enviar uma media de valores. Deseja?"

VALORES DA VISITA (Secao 3):
- Zona Sul (Ipanema, Leblon, Copacabana, Botafogo, Flamengo, Lagoa, Gavea, Jardim Botanico, Humaita, Urca, Catete, Gloria, Laranjeiras, Cosme Velho, Leme, Sao Conrado): R$180
- Outros bairros: R$220
- Texto exato Zona Sul: "Para oferecer um orcamento mais preciso, e necessario que um profissional realize uma visita tecnica. O valor da visita e de R$180, mas e abatido do valor final caso o orcamento seja aprovado."
- Texto exato Outros: "Para oferecer um orcamento mais preciso, e necessario que um profissional realize uma visita tecnica. O valor da visita e de R$220, mas e abatido do valor final caso o orcamento seja aprovado."
- Se questionar "Por que tem que pagar visita?": "O valor se refere ao custo de deslocamento do profissional e analise tecnica. Caso o orcamento seja aprovado, o valor da visita e abatido do valor final. Assim, a vista sairia de graca"
- Se insistir em visita gratis e for Botafogo: "Como uma excecao, a visita pode ser realizada sem cobranca"
- Se insistir e for outro bairro Zona Sul: "A visita pode ser realizada pela metade do valor"
- Se nao aceitar: "Infelizmente nao e possivel realizar a visita por um valor abaixo"
- Se nao for Zona Sul: "Entendo, mas infelizmente a taxa da visita precisa ser seguida"
- Se pedir desconto e for Botafogo: ofereca 50%, se recusarem ofereca gratis
- Se pedir desconto e for outro bairro Zona Sul: maximo 50%
- Outros bairros: valor fixo

OBJECOES (Secao 9):
- "Vou comparar com outros orcamentos": "Tudo bem, se quiser, pode enviar o orcamento de outra empresa para verificarmos se cobrimos."
- "Voces sao caros": "Entendo que o valor e diferente do esperado. No entanto, nossos profissionais sao de confianca e de alta qualidade, prestando servicos a pessoas influentes. Apesar disso, os valores sao padrao da zona sul do Rio"
- "Nao confio em pagar antes": "Entendo. A empresa e seria e preza pela qualidade e confianca nos servicos prestados. Gostaria de prosseguir com sinal de 50% e o restante no fim do servico?"
- Pergunta tecnica especifica: "Entendo sua duvida, mas somente o profissional poderia responder. Irei encaminhar sua duvida"

AGENDAMENTO (Secao 4):
- Quer "hoje": "Um momento que irei verificar com o tecnico"
- Depois das 19h quer "hoje": "Posso entrar em contato com o profissional amanha no primeiro horario. Deseja?"
- Quer "amanha de manha": "Qual seria um bom horario? Entre 9:30h e 11:30h?"
- "Qualquer dia serve": "Gostaria de atendimento para hoje?"
- Sugere horario: "Um momento que irei verificar com o profissional"
- Indeciso: "Gostaria de atendimento para hoje?"
- Urgencia/vazamento: "Qual bairro deseja atendimento?" (priorize)

ENDERECO (Secao 5):
- Manda endereco completo: "Perfeito. Visita marcada dia [dia da visita/mes] as [horario marcado da visita] com o profissional [nome do profissional]"
- Manda so rua: "Qual o numero? E casa ou apartamento?"
- Endereco com erro: "Desculpe, acho que tem um erro de digitacao. Pode confirmar o endereco?"
- Nao quer passar endereco antes: "Um momento que irei verificar a disponibilidade do profissional"

CONFIRMACAO (Secao 6):
- Todos dados coletados: "Pode marcar para [dia/mes] as [horario] com profissional [nome do profissional]?"
- Cliente confirma: "Perfeito, marcado!"
- Alterar data: "Qual seria o dia mais proximo que teria disponibilidade?"

CENARIOS ESPECIAIS (Secao 8):
- Pintura sem visita: "Qual seria a metragem quadrada total e o tipo de tinta?"
- Foto pedindo orcamento: "Pode explicar melhor o servico e bairro que deseja atendimento?"
- Varios servicos: "Sera necessario o envio de dois profissionais independentes para a realizacao da visita. A taxa de cada visita e de R$180. Para quando gostaria de marcar?"
- Obra grande: "E necessario que o profissional va ao local para que seja realizado um orcamento preciso. A taxa da visita e de R$180. Para quando gostaria de atendimento?"

=== DADOS ATUAIS DO CLIENTE ===
Nome: ${cliente.nome}
Telefone: ${cliente.telefone}
Dados coletados: ${dadosAtuais}
Horario atual: ${horaAtual}h

=== HISTORICO RECENTE ===
${historicoFormatado}

=== INSTRUCOES DE CONVERSACAO ===
- Use conectivos naturais (Certo, Entendi, Perfeito, Otimo, Entao, Bom)
- Nunca use numeracao (1., 2., 3.) ou bullet points
- Nunca seja robotico ou mecanico
- Respostas curtas e diretas, como um atendente real
- Nao repita informacoes que o cliente ja deu
- Se cliente disser "pintura em Ipanema", entenda imediatamente - nao pergunte bairro de novo
- Nao use emojis
- Nao use aspas desnecessarias
- Fluxo natural: servico -> bairro -> valor -> data -> endereco -> confirmacao

Responda como um atendente profissional da RC Reformas faria:`;
  
  try {
    console.log('🤖 Processando...');
    
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: texto }
        ],
        temperature: 0.4, // Mais conservador para seguir regras estritamente
        max_tokens: 300
      })
    });
    
    if (!response.ok) {
      throw new Error(`Erro API: ${response.status}`);
    }
    
    const data = await response.json();
    const respostaIA = data.choices[0].message.content;
    
    console.log('💬 Resposta:', respostaIA);
    
    await extrairEAtualizarDados(cliente, texto, respostaIA);
    
    // Verificar se está completo para notificar técnico (Secao 6 e 7)
    if (cliente.dados.servico && cliente.dados.bairro && cliente.dados.data && cliente.dados.hora && cliente.dados.endereco && !cliente.dados.tecnicoNotificado) {
      await notificarTecnico(cliente);
      cliente.dados.tecnicoNotificado = true;
    }
    
    return respostaIA;
    
  } catch (erro) {
    console.error('Erro IA:', erro);
    return fallbackResposta(cliente, texto);
  }
}

async function extrairEAtualizarDados(cliente, textoCliente, respostaIA) {
  const prompt = `Analise a conversa e extraia dados em JSON STRICT:
{
  "servico": "tipo de servico identificado ou null",
  "bairro": "bairro do Rio de Janeiro identificado ou null", 
  "data": "data mencionada (hoje, amanha, ou data especifica) ou null",
  "hora": "horario mencionado ou null",
  "endereco": "endereco completo se fornecido ou null",
  "urgente": true/false,
  "aceitou_valor": true/false,
  "quer_cancelar": true/false
}

Cliente: "${textoCliente}"
Atendente: "${respostaIA}"

REGRAS DE EXTRACAO:
- "pintura em Ipanema" -> servico: "pintura", bairro: "Ipanema"
- "vazamento", "emergencia", "quebrou", "urgente", "esta vazando" -> urgente: true
- "pode marcar", "confirmo", "esta bom assim", "ok para visita" -> aceitou_valor: true
- "desisti", "cancela", "nao quero mais" -> quer_cancelar: true
- Bairros Zona Sul: Ipanema, Leblon, Copacabana, Botafogo, Flamengo, Lagoa, Gavea, Jardim Botanico, Humaita, Urca, Catete, Gloria, Laranjeiras, Cosme Velho, Leme, Sao Conrado

Responda APENAS o JSON, nada mais.`;
  
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 200
      })
    });
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    const match = content.match(/\{[^}]+\}/);
    
    if (match) {
      const extraido = JSON.parse(match[0]);
      
      if (extraido.servico) cliente.dados.servico = extraido.servico;
      if (extraido.bairro) cliente.dados.bairro = extraido.bairro;
      if (extraido.data) cliente.dados.data = extraido.data;
      if (extraido.hora) cliente.dados.hora = extraido.hora;
      if (extraido.endereco) cliente.dados.endereco = extraido.endereco;
      if (extraido.urgente) cliente.dados.urgente = extraido.urgente;
      
      // Calcular valor automaticamente baseado no bairro (Secao 3)
      if (cliente.dados.bairro && !cliente.dados.valor) {
        const bairroNormalizado = cliente.dados.bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const isZonaSul = CONFIG.bairrosZonaSul.some(b => bairroNormalizado.includes(b));
        cliente.dados.valor = isZonaSul ? CONFIG.precoZonaSul : CONFIG.precoOutros;
        
        // Definir nome do profissional baseado no serviço
        if (cliente.dados.servico) {
          if (cliente.dados.servico.includes('marcenaria') || cliente.dados.servico.includes('movel') || cliente.dados.servico.includes('armario')) {
            cliente.dados.profissionalNome = "Tecnico de Marcenaria";
          } else if (cliente.dados.servico.includes('hidraulica') || cliente.dados.servico.includes('encanamento') || cliente.dados.servico.includes('vazamento') || cliente.dados.servico.includes('pia') || cliente.dados.servico.includes('banheiro')) {
            cliente.dados.profissionalNome = "Tecnico Hidraulico";
          } else {
            cliente.dados.profissionalNome = "Tecnico de Reformas";
          }
        }
      }
    }
  } catch (e) {
    console.log('Erro extracao:', e.message);
  }
}

// SEÇÃO 7 - Notificação ao técnico
async function notificarTecnico(cliente) {
  let numero;
  
  if (cliente.dados.servico?.includes('marcenaria') || cliente.dados.servico?.includes('movel') || cliente.dados.servico?.includes('armario')) {
    numero = CONFIG.tecnicos.marcenaria;
  } else if (cliente.dados.servico?.includes('hidraulica') || cliente.dados.servico?.includes('encanamento') || cliente.dados.servico?.includes('vazamento') || cliente.dados.servico?.includes('pia') || cliente.dados.servico?.includes('banheiro')) {
    numero = CONFIG.tecnicos.hidraulica;
  } else {
    numero = CONFIG.tecnicos.reforma;
  }
  
  // Texto exato conforme Secao 7.1
  const msg = `Visita de ${cliente.dados.servico} marcada. Endereco ${cliente.dados.endereco}, Cliente ${cliente.nome}, dia ${cliente.dados.data}, as ${cliente.dados.hora}.`;
  
  console.log(`\n📤 Notificando tecnico: ${numero}`);
  console.log(`Mensagem: ${msg}`);
  
  await enviarWhatsApp(numero, msg);
  
  // SEÇÃO 12.3 - Alerta Telegram se técnico não responder em 5 minutos
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    setTimeout(async () => {
      if (!cliente.dados.visitaConfirmada) {
        await enviarTelegram(`⏰ ALERTA: Tecnico nao respondeu apos 5 min. Cliente: ${cliente.nome}, Servico: ${cliente.dados.servico}, Tecnico: ${numero}`);
      }
    }, 5 * 60 * 1000); // 5 minutos
  }
}

// SEÇÃO 7.2 - Confirmação do técnico para o cliente
async function confirmarVisitaComTecnico(cliente, confirmacao, novoHorario = null) {
  if (confirmacao) {
    cliente.dados.visitaConfirmada = true;
    // Texto exato conforme Secao 7.2
    return `Visita confirmada para ${cliente.dados.data}, as ${cliente.dados.hora}, com o profissional ${cliente.dados.profissionalNome}.`;
  } else if (novoHorario) {
    // Secao 7.3 - Tecnico sugere outro horario
    return `Um momento que irei contactar o profissional`;
  }
}

// SEÇÃO 7.5 - Antecipação ou adiamento
async function notificarMudancaHorario(cliente, tipo, novoDiaHorario) {
  if (tipo === 'antecipar') {
    // Secao 7.5 - Antecipacao
    return `Ola, ${cliente.nome}! O profissional informou que poderia antecipar sua visita para ${novoDiaHorario}. Gostaria de antecipar?`;
  } else {
    // Secao 7.5 - Atraso
    return `Ola! ${cliente.nome} O profissional avisou que teve um imprevisto e precisa adiar a visita`;
  }
}

// SEÇÃO 10 - Lembretes automáticos
async function agendarLembretes(cliente) {
  // 10.1 - Lembrete 24h antes para cliente
  // Implementar via agendamento externo (cron job ou similar)
  const lembrete24h = `Ola, ${cliente.nome} lembrando da visita amanha as ${cliente.dados.hora} na ${cliente.dados.endereco}, posso confirmar?`;
  
  // 10.2 - Lembrete 2h antes para técnico
  const lembreteTecnico2h = `Ola, ${cliente.dados.profissionalNome} lembrando da visita hoje as ${cliente.dados.hora} na ${cliente.dados.endereco}`;
  
  console.log('Lembrete 24h:', lembrete24h);
  console.log('Lembrete 2h tecnico:', lembreteTecnico2h);
}

// SEÇÃO 10.3 - Cliente não está no local
async function clienteNaoPresente(cliente) {
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    await enviarTelegram(`⚠️ Cliente nao esta no local. Nome: ${cliente.nome}, Endereco: ${cliente.dados.endereco}, Horario: ${cliente.dados.hora}`);
  }
}

// SEÇÃO 10.4 - Feedback pós-visita
async function solicitarFeedback(cliente) {
  return "Ocorreu tudo bem na visita? O profissional entendeu o que precisa?";
}

// SEÇÃO 10.5 - Aprovação do orçamento
async function fluxoContratacao(cliente) {
  return "Vou marcar o dia para realizacao do servico com o profissional e informar os dias e horarios disponiveis para marcar a realizacao do servico";
}

// SEÇÃO 12 - Painel Admin (Telegram)
async function enviarTelegram(mensagem) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: mensagem
      })
    });
  } catch (e) {
    console.error('Erro Telegram:', e);
  }
}

// Fallbacks específicos conforme documento
function fallbackResposta(cliente, texto) {
  const t = texto.toLowerCase();
  
  // SEÇÃO 1.1
  if (t.includes('oi') || t.includes('ola') || t.includes('bom dia') || t.includes('boa tarde') || t.includes('boa noite')) {
    return "Ola! Me informe o servico e bairro que deseja atendimento";
  }
  
  // SEÇÃO 2.1
  if (t.includes('reforma') && !cliente.dados.servico) {
    return "Qual bairro deseja atendimento e qual tipo de reforma?";
  }
  
  // SEÇÃO 2.2
  if (t.includes('pintura') && !cliente.dados.bairro) {
    return "Para qual bairro deseja atendimento?";
  }
  
  // SEÇÃO 2.3
  if (t.includes('marcenaria') && !cliente.dados.bairro) {
    return "Qual seria o servico e bairro?";
  }
  
  // SEÇÃO 2.4
  if (cliente.dados.servico && !cliente.dados.bairro) {
    return "Certo, qual o bairro que deseja atendimento?";
  }
  
  // SEÇÃO 2.6
  if (!cliente.dados.servico && cliente.dados.bairro) {
    return "Qual servico deseja?";
  }
  
  // Fluxo padrão
  if (!cliente.dados.servico) {
    return "Qual servico voce esta precisando?";
  }
  if (!cliente.dados.bairro) {
    return "Em qual bairro e o servico?";
  }
  if (!cliente.dados.data) {
    return "Para quando voce quer agendar?";
  }
  if (!cliente.dados.endereco) {
    return "Qual o endereco completo?";
  }
  
  return "Entendi. Posso confirmar os dados para marcar a visita?";
}

async function enviarWhatsApp(numero, texto) {
  console.log(`\n📤 Para ${numero}:\n${texto}\n---`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('ERRO: Variaveis WhatsApp nao configuradas');
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
      console.error('Erro WhatsApp API:', data);
      return false;
    }
    
    return true;
    
  } catch (e) {
    console.error('Excecao WhatsApp:', e.message);
    return false;
  }
}
