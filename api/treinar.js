import { redis, KEYS } from './_util/redis.js';

// Configuração padrão (primeira vez)
const CONFIG_PADRAO = {
  saudacao: `Olá! 👋 Sou o assistente de *Reforma e Construção*.

Como posso ajudar?

1️⃣ Orçamento de reforma
2️⃣ Marcenaria sob medida  
3️⃣ Construção civil
4️⃣ Falar com atendente`,

  respostas: {
    "preço|valor|custo|quanto": `💰 Orçamento gratuito!

Envie fotos do local e descreva o que precisa. Avaliamos sem compromisso.`,
    "prazo|tempo|demora|quando": `⏱️ Prazos:
• Pequenas reformas: 3-7 dias
• Marcenaria: 15-30 dias  
• Construção: a definir em visita`,
    "pagamento|paga|forma": `💳 Aceitamos:
• Pix (5% desconto)
• Cartão em até 12x
• Transferência
• 50% entrada + 50% na entrega`,
    "marcenaria|móvel|armário|cozinha": `🪚 Marcenaria Sob Medida!

• Cozinhas planejadas
• Guarda-roupas
• Escritórios
• Racks e painéis

Envie medidas do espaço!`,
    "reforma|banheiro|pintura": `🔨 Reformas em Geral

• Banheiros e cozinhas
• Pintura
• Elétrica e hidráulica
• Pisos e revestimentos

Agende visita técnica!`,
    "construção|casa|obra": `🏗️ Construção Civil

• Fundações e estruturas
• Acabamentos
• Regularização de imóveis
• Projetos completos

Orçamento após visita técnica.`,
    "visita|técnico|avaliação": `📍 Visita Técnica

Valor: R$150 (deduzido do orçamento final)

Informe:
• Endereço completo
• Melhor dia/horário
• Tipo de serviço`,
    "garantia": `✅ Garantia de 1 ano

• Mão de obra: 12 meses
• Materiais: conforme fabricante
• Atendimento pós-venda incluído`
  },

  fluxo_reforma: {
    p1: "Qual cômodo quer reformar? (banheiro, cozinha, quarto, sala, área externa)",
    p2: "Qual bairro?",
    p3: "Descreva o que precisa fazer ou envie fotos:",
    p4: "Seu nome e melhor horário para visita técnica?",
    final: `✅ *Visita agendada!*

Nosso técnico entrará em contato em 24h para confirmar.

💰 Visita técnica: R$150 (deduzida do orçamento)
📋 Orçamento sem compromisso

Obrigado pela preferência! 🙏`
  },

  fluxo_marcenaria: {
    p1: "Qual móvel deseja? (cozinha, guarda-roupa, escritório, rack, outro)",
    p2: "Tem as medidas do espaço? (comprimento x altura x profundidade)",
    final: `✅ *Pedido de marcenaria registrado!*

Nosso marceneiro visitará para medição precisa.

🪚 Prazo médio: 20-30 dias
💳 Orçamento sem compromisso

Aguarde contato! 📞`
  },

  fluxo_construcao: {
    p1: "Qual tipo de obra? (casa nova, ampliação, regularização, reforma estrutural)",
    final: `🏗️ *Projeto de construção anotado!*

Nosso engenheiro fará visita técnica em 48h.

📐 Orçamento técnico gratuito
📋 Inclui regularização (se necessário)

Entraremos em contato! ⚡`
  },

  intervencao: {
    palavras: ["atendente", "humano", "pessoa", "falar com", "especialista", "gerente", "4"],
    mensagem: `🔄 *Transferindo para atendente humano...*

Um momento, por favor. Você será atendido em breve.`
  },

  versao: 1
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET - Carregar configuração
  if (req.method === 'GET') {
    try {
      let config = await redis.get(KEYS.config);
      
      // Se não existe, salvar padrão
      if (!config) {
        await redis.set(KEYS.config, JSON.stringify(CONFIG_PADRAO));
        config = CONFIG_PADRAO;
      } else if (typeof config === 'string') {
        config = JSON.parse(config);
      }
      
      return res.json(config);
      
    } catch (e) {
      console.error('Erro GET:', e);
      return res.json(CONFIG_PADRAO); // Fallback
    }
  }

  // POST - Salvar configuração
  if (req.method === 'POST') {
    try {
      const novaConfig = req.body;
      
      // Validar
      if (!novaConfig || typeof novaConfig !== 'object') {
        return res.status(400).json({ erro: 'Dados inválidos' });
      }
      
      // Adicionar timestamp
      novaConfig.ultima_atualizacao = new Date().toISOString();
      novaConfig.versao = (novaConfig.versao || 1) + 1;
      
      // Salvar no Redis
      await redis.set(KEYS.config, JSON.stringify(novaConfig));
      
      console.log('✅ Config salva:', new Date().toLocaleString('pt-BR'));
      
      return res.json({ 
        ok: true, 
        mensagem: 'Configuração salva com sucesso!',
        versao: novaConfig.versao,
        hora: new Date().toLocaleString('pt-BR')
      });
      
    } catch (e) {
      console.error('Erro POST:', e);
      return res.status(500).json({ 
        erro: 'Erro ao salvar: ' + e.message 
      });
    }
  }

  res.status(405).json({ erro: 'Método não permitido' });
}
