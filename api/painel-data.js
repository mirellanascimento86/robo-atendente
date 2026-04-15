import fs from 'fs/promises';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (req.method === 'GET') {
        const { tipo, telefone } = req.query;
        
        if (tipo === 'conversas') {
            // Listar todas as conversas ativas
            const arquivos = await fs.readdir('./data');
            const conversas = [];
            
            for (const arq of arquivos) {
                if (arq.startsWith('historico_')) {
                    const tel = arq.replace('historico_', '').replace('.json', '');
                    const dados = await fs.readFile(`./data/${arq}`, 'utf8');
                    const msgs = JSON.parse(dados);
                    const ultima = msgs[msgs.length - 1];
                    
                    conversas.push({
                        telefone: tel,
                        ultimaMensagem: ultima?.texto?.substring(0, 30) + '...',
                        intervencao: global.conversasAtivas?.[tel]?.intervencao || false
                    });
                }
            }
            
            return res.json(conversas);
        }
        
        if (tipo === 'mensagens' && telefone) {
            try {
                const dados = await fs.readFile(`./data/historico_${telefone}.json`, 'utf8');
                return res.json(JSON.parse(dados));
            } catch (e) {
                return res.json([]);
            }
        }
        
        if (tipo === 'relatorio') {
            // Gerar relatório diário
            const hoje = new Date().toISOString().split('T')[0];
            const agenda = JSON.parse(await fs.readFile('./data/agenda.json', 'utf8'));
            
            const visitasHoje = agenda.visitas_agendadas.filter(v => 
                v.data === hoje || v.criadoEm.startsWith(hoje)
            );
            
            const relatorio = {
                data: hoje,
                totalVisitas: visitasHoje.length,
                confirmadas: visitasHoje.filter(v => v.status === 'confirmado').length,
                pendentes: visitasHoje.filter(v => v.status === 'pendente').length,
                bairros: {},
                clientes: visitasHoje.map(v => ({
                    nome: v.telefone, // ou buscar nome no histórico
                    bairro: v.bairro,
                    servico: v.servico,
                    status: v.status
                }))
            };
            
            // Contar por bairro
            visitasHoje.forEach(v => {
                relatorio.bairros[v.bairro] = (relatorio.bairros[v.bairro] || 0) + 1;
            });
            
            return res.json(relatorio);
        }
    }
    
    if (req.method === 'POST') {
        const { acao, telefone, mensagem } = req.body;
        
        if (acao === 'intervir') {
            global.conversasAtivas = global.conversasAtivas || {};
            global.conversasAtivas[telefone] = { 
                ...(global.conversasAtivas[telefone] || {}),
                intervencao: true 
            };
            return res.json({ ok: true });
        }
        
        if (acao === 'liberar') {
            if (global.conversasAtivas?.[telefone]) {
                global.conversasAtivas[telefone].intervencao = false;
            }
            return res.json({ ok: true });
        }
        
        if (acao === 'enviar') {
            // Enviar mensagem humana via WhatsApp
            await enviarWhatsAppAPI(telefone, mensagem);
            
            // Salvar no histórico
            await salvarMensagemArquivo(telefone, 'Atendente', 'humano', mensagem);
            
            return res.json({ ok: true });
        }
    }
    
    res.status(400).json({ erro: 'Requisição inválida' });
}

// Funções auxiliares
async function enviarWhatsAppAPI(telefone, mensagem) {
    const CONFIG = {
        WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
        WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID
    };
    
    await fetch(`https://graph.facebook.com/v18.0/${CONFIG.WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: telefone,
            type: 'text',
            text: { body: mensagem }
        })
    });
}

async function salvarMensagemArquivo(telefone, nome, tipo, texto) {
    const arquivo = `./data/historico_${telefone}.json`;
    let historico = [];
    
    try {
        const existe = await fs.readFile(arquivo, 'utf8');
        historico = JSON.parse(existe);
    } catch (e) {}
    
    historico.push({
        data: new Date().toISOString(),
        nome,
        tipo,
        texto
    });
    
    await fs.writeFile(arquivo, JSON.stringify(historico, null, 2));
}
