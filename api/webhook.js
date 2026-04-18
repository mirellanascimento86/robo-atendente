// api/webhook.js - Versão simplificada para Vercel
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// Configuração
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "meu_token_123";

// Inicializar Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Dados dos profissionais
const PROFESSIONAIS = {
  ar_condicionado: [
    { nome: "Técnico Ar 1", telefone: "5511999999991", preco_visita: 180 },
    { nome: "Técnico Ar 2", telefone: "5511999999992", preco_visita: 180 }
  ],
  geladeira: [
    { nome: "Técnico Refri", telefone: "5511999999993", preco_visita: 180 }
  ],
  lava_seca: [
    { nome: "Técnico Lava", telefone: "5511999999994", preco_visita: 180 }
  ],
  marcenaria: [
    { nome: "João", telefone: "5511999999995", preco_visita: 180, antecedencia: 60 },
    { nome: "Eli", telefone: "5511999999996", preco_visita: 160 }
  ],
  reforma: [
    { nome: "Pedreiro Carlos", telefone: "5511999999997", preco_visita: 180 },
    { nome: "Pintor Ana", telefone: "5511999999998", preco_visita: 180 }
  ]
};

// Funções auxiliares
function identificarServico(texto) {
  const t = texto.toLowerCase();
  if (t.includes("ar") && (t.includes("condicionado") || t.includes("split"))) return "ar_condicionado";
  if (t.includes("geladeira") || t.includes("refrigerador")) return "geladeira";
  if (t.includes("lava") || t.includes("secadora") || t.includes("máquina")) return "lava_seca";
  if (t.includes("marcenaria") || t.includes("móvel") || t.includes("armário")) return "marcenaria";
  if (t.includes("reforma") || t.includes("pedreiro") || t.includes("pintor")) return "reforma";
  return null;
}

function identificarBairro(texto) {
  const bairros = ["copacabana", "ipanema", "leblon", "botafogo", "flamengo", "tijuca", "barra", "jacarepaguá", "madureira"];
  const t = texto.toLowerCase();
  for (let b of bairros) {
    if (t.includes(b)) return b.charAt(0).toUpperCase() + b.slice(1);
  }
  return null;
}

function isZonaSul(bairro) {
  const zs = ["copacabana", "ipanema", "leblon", "botafogo", "flamengo", "laranjeiras", "cosme velho", "humaitá", "jardim botânico", "gávea", "lagoa"];
  return zs.some(b => bairro.toLowerCase().includes(b));
}

// Enviar mensagem WhatsApp
async function enviarWhatsApp(para, texto) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: para,
        type: "text",
        text: { body: texto }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (e) {
    console.error("Erro WhatsApp:", e.message);
  }
}

// Enviar Telegram
async function enviarTelegram(mensagem) {
  if (!TELEGRAM_TOKEN) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: mensagem,
        parse_mode: "HTML"
      }
    );
  } catch (e) {
    console.error("Erro Telegram:", e.message);
  }
}

// Handler principal
module.exports = async (req, res) => {
  // Verificação do webhook (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // Recebimento de mensagens (POST)
  if (req.method === "POST") {
    try {
      const body = req.body;
      
      if (!body.entry || !body.entry[0].changes || !body.entry[0].changes[0].value.messages) {
        return res.status(200).send("OK");
      }

      const mensagem = body.entry[0].changes[0].value.messages[0];
      const telefone = mensagem.from;
      const texto = mensagem.text?.body || "";
      
      // Identificar empresa
      const phoneId = body.entry[0].changes[0].value?.metadata?.phone_number_id;
      let empresa = "conserta_rio";
      if (phoneId === process.env.PHONE_ID_RC) empresa = "rc_reforma";
      if (phoneId === process.env.PHONE_ID_MAB) empresa = "mab_construcao";

      // Buscar cliente
      let { data: cliente } = await supabase
        .from("clientes")
        .select("*")
        .eq("telefone", telefone)
        .single();

      // Novo cliente
      if (!cliente) {
        await supabase.from("clientes").insert([{
          telefone: telefone,
          empresa_origem: empresa,
          etapa: "novo",
          criado_em: new Date().toISOString()
        }]);
        
        await enviarWhatsApp(telefone, "Olá! Bem-vind(a) ao atendimento digital. Qual serviço deseja e qual bairro?");
        return res.status(200).send("OK");
      }

      const etapa = cliente.etapa || "inicio";
      
      // Fluxo principal
      if (etapa === "novo" || etapa === "inicio") {
        const servico = identificarServico(texto);
        const bairro = identificarBairro(texto);
        
        if (servico && bairro) {
          await supabase.from("clientes").update({
            servico: servico,
            bairro: bairro,
            etapa: "perguntar_urgencia"
          }).eq("telefone", telefone);
          
          await enviarWhatsApp(telefone, "Gostaria de atendimento para hoje?");
        } else if (servico || bairro) {
          const campo = servico ? "servico" : "bairro";
          await supabase.from("clientes").update({
            [campo]: servico || bairro,
            etapa: "aguardando_complemento",
            dado_temp: campo
          }).eq("telefone", telefone);
          
          await enviarWhatsApp(telefone, servico ? "Certo, e qual bairro?" : "Certo, e qual serviço gostaria?");
        } else {
          await enviarWhatsApp(telefone, "Preciso das informações solicitadas para prosseguir");
        }
      }
      else if (etapa === "aguardando_complemento") {
        const campo = cliente.dado_temp === "servico" ? "bairro" : "servico";
        await supabase.from("clientes").update({
          [campo]: texto,
          etapa: "perguntar_urgencia"
        }).eq("telefone", telefone);
        await enviarWhatsApp(telefone, "Gostaria de atendimento para hoje?");
      }
      else if (etapa === "perguntar_urgencia") {
        const t = texto.toLowerCase();
        if (t.includes("sim") || t.includes("hoje")) {
          if (["ar_condicionado", "geladeira", "lava_seca"].includes(cliente.servico)) {
            await supabase.from("clientes").update({ etapa: "confirmar_visita", preco_visita: 180 }).eq("telefone", telefone);
            await enviarWhatsApp(telefone, "Para um orçamento mais preciso, é necessário uma visita. Há uma pequena taxa no valor de R$180, que inclui o deslocamento do profissional e análise técnica. Caso o orçamento seja aprovado, essa taxa é descontada do valor final. Gostaria de prosseguir?");
          } else {
            await supabase.from("clientes").update({ etapa: "detalhes_servico" }).eq("telefone", telefone);
            await enviarWhatsApp(telefone, "Irei verificar a disponibilidade do profissional. Pode me explicar melhor o que deseja?");
          }
        } else {
          await supabase.from("clientes").update({ etapa: "agendar_data" }).eq("telefone", telefone);
          await enviarWhatsApp(telefone, "Para qual data você gostaria de agendar?");
        }
      }
      else if (etapa === "confirmar_visita") {
        const t = texto.toLowerCase();
        if (t.includes("sim") || t.includes("quero")) {
          await supabase.from("clientes").update({ etapa: "dados_equipamento" }).eq("telefone", telefone);
          await enviarWhatsApp(telefone, "Irei verificar a disponibilidade do profissional. Pode me informar o modelo e problema do aparelho?");
        } else if (t.includes("caro") || t.includes("desconto")) {
          const b = cliente.bairro?.toLowerCase() || "";
          if (isZonaSul(b)) {
            if (b.includes("botafogo")) {
              await supabase.from("clientes").update({ etapa: "dados_equipamento", preco_visita: 0 }).eq("telefone", telefone);
              await enviarWhatsApp(telefone, "Como o local é próximo de nós, o técnico pode realizar a visita sem a taxa. Gostaria?");
            } else {
              await supabase.from("clientes").update({ etapa: "confirmar_desconto", preco_visita: 90 }).eq("telefone", telefone);
              await enviarWhatsApp(telefone, "Para nós é muito importante ter você como um de nossos clientes. A visita pode ser realizada pela metade do valor, ou seja, R$90. Esse é o valor mínimo que posso conseguir. Gostaria de prosseguir?");
            }
          }
        }
      }
      else if (etapa === "dados_equipamento") {
        await supabase.from("clientes").update({ 
          dados_equipamento: texto,
          etapa: "confirmar_horario",
          profissional_nome: "Técnico Disponível",
          horario_inicio: "09:00",
          horario_fim: "11:00"
        }).eq("telefone", telefone);
        await enviarWhatsApp(telefone, "O profissional possui disponibilidade para hoje entre 09:00 e 11:00. Gostaria de agendar?");
      }
      else if (etapa === "confirmar_horario") {
        if (texto.toLowerCase().includes("sim")) {
          await supabase.from("clientes").update({ etapa: "aguardar_endereco" }).eq("telefone", telefone);
          await enviarWhatsApp(telefone, "Perfeito! Pode me informar o endereço completo?");
        }
      }
      else if (etapa === "aguardar_endereco") {
        const hoje = new Date();
        const dataStr = `${String(hoje.getDate()).padStart(2, "0")}/${String(hoje.getMonth() + 1).padStart(2, "0")}`;
        const preco = cliente.preco_visita || 180;
        
        await supabase.from("agendamentos").insert([{
          cliente_telefone: telefone,
          servico: cliente.servico,
          bairro: cliente.bairro,
          endereco: texto,
          profissional_nome: cliente.profissional_nome,
          data: hoje.toISOString().split("T")[0],
          horario_inicio: cliente.horario_inicio,
          horario_fim: cliente.horario_fim,
          valor_visita: preco,
          status: "agendado"
        }]);
        
        await enviarWhatsApp(telefone, `Visita agendada para dia ${dataStr} entre ${cliente.horario_inicio} e ${cliente.horario_fim} em ${texto} com o profissional ${cliente.profissional_nome}. Lembrando que a taxa da visita deve ser realizada no ato da visita ao profissional.`);
        await enviarTelegram(`✅ NOVO AGENDAMENTO\nCliente: ${telefone}\nServiço: ${cliente.servico}\nBairro: ${cliente.bairro}\nValor: R$${preco}`);
        await supabase.from("clientes").update({ etapa: "agendado", endereco: texto }).eq("telefone", telefone);
      }

      return res.status(200).send("OK");
    } catch (error) {
      console.error("Erro:", error);
      await enviarTelegram(`❌ ERRO: ${error.message}`);
      return res.status(200).send("OK");
    }
  }

  res.status(405).send("Method Not Allowed");
};
