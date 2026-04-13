import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Memória de conversas (contexto para IA)
const contextos = {};

// Instruções do sistema (personalidade do robô)
const INSTRUCOES_SISTEMA = `Você é um assistente virtual de uma empresa de REFORMA E CONSTRUÇÃO.

SERVIÇOS OFERECIDOS:
- Reformas (banheiro, cozinha, pintura, elétrica, hidráulica)
- Marcenaria sob medida (cozinhas, guarda-roupas, escritórios)
- Construção civil (casas, ampliações, regularizações)

PREÇOS:
- Orçamento: GRATUITO
- Visita técnica: R$150 (deduzida do orçamento final)
- Pagamento: Pix (5% desconto), cartão 12x, ou 50% entrada + 50% entrega

PRAZOS:
- Reformas pequenas: 3-7 dias
- Marcenaria: 15-30 dias
- Construção: a definir em visita

REGRAS IMPORTANTES:
1. Seja cordial, profissional e objetivo
2. Nunca invente preços específicos - sempre diga "orçamento gratuito"
3. Para agendar, colete: nome, telefone, bairro, tipo de serviço, descrição
4. Se cliente estiver insatisfeito, irritado ou pedir "atendente", transfira imediatamente
5. Nunca prometa prazos exatos sem visita técnica
6. Sempre ofereça visita técnica para avaliação precisa

QUANDO TRANSFERIR PARA HUMANO:
- Cliente pedir "atendente", "humano", "pessoa"
- Cliente reclamar, estar irritado ou insatisfeito
- Cliente dizer "cancelar", "problema", "reclamação"
- Cliente perguntar algo que você não sabe responder com certeza

FORMATO DA RESPOSTA:
Responda de forma natural, como um atendente humano profissional. Use emojis ocasionalmente. Seja claro e direto.`;

export async function gerarRespostaIA(telefone, nome, mensagemCliente, historico = []) {
  try {
    // Montar contexto
    const mensagens = [
      { role: 'system', content: INSTRUCOES_SISTEMA },
      ...historico.map(h => ({
        role: h.tipo === 'cliente' ? 'user' : 'assistant',
        content: h.texto
      })),
      { role: 'user', content: `${nome}: ${mensagemCliente}` }
    ];
    
    const resposta = await groq.chat.completions.create({
      messages: mensagens,
      model: 'llama3-8b-8192', // Modelo rápido e barato
      temperature: 0.7,
      max_tokens: 500
    });
    
    const texto = resposta.choices[0]?.message?.content || 'Desculpe, não entendi. Pode repetir?';
    
    // Verificar se pediu intervenção (IA detectou necessidade)
    const pediuIntervencao = texto.toLowerCase().includes('transferir') || 
                             texto.toLowerCase().includes('atendente') ||
                             texto.toLowerCase().includes('humano');
    
    return {
      texto: texto,
      intervencao: pediuIntervencao
    };
    
  } catch (e) {
    console.error('Erro Groq:', e);
    return {
      texto: 'Desculpe, estou com dificuldades técnicas. Um atendente entrará em contato.',
      intervencao: true // Força intervenção em caso de erro
    };
  }
}

export function limparContexto(telefone) {
  delete contextos[telefone];
}
