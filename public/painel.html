<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="theme-color" content="#075e54">
    <title>WhatsApp Pro</title>
    <style>
        * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box; 
            -webkit-tap-highlight-color: transparent;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        
        :root {
            --primary: #075e54;
            --primary-dark: #054d44;
            --secondary: #128c7e;
            --accent: #25d366;
            --bg: #0a1014;
            --sidebar-bg: #111b21;
            --chat-bg: #0a1014;
            --incoming: #202c33;
            --outgoing: #005c4b;
            --text: #e9edef;
            --text-secondary: #8696a0;
            --border: #2a3942;
            --danger: #f15c6d;
            --warning: #ffd700;
        }
        
        body {
            background: var(--bg);
            color: var(--text);
            height: 100vh;
            height: 100dvh;
            overflow: hidden;
        }
        
        #loading {
            position: fixed;
            inset: 0;
            background: var(--primary);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            transition: opacity 0.5s;
        }
        #loading.fade-out { opacity: 0; pointer-events: none; }
        .spinner {
            width: 60px;
            height: 60px;
            border: 4px solid rgba(255,255,255,0.2);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 20px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        #loading p { color: white; font-size: 16px; }
        
        #debugPanel {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #ff4444;
            color: white;
            padding: 10px;
            font-size: 12px;
            z-index: 10000;
            display: none;
            max-height: 150px;
            overflow-y: auto;
        }
        #debugPanel.show { display: block; }
        
        #app {
            display: flex;
            height: 100%;
            width: 100%;
        }
        
        .sidebar {
            width: 100%;
            height: 100%;
            background: var(--sidebar-bg);
            display: flex;
            flex-direction: column;
            transition: transform 0.3s ease;
        }
        
        .sidebar.hidden-mobile {
            transform: translateX(-100%);
            position: absolute;
        }
        
        @media (min-width: 900px) {
            .sidebar {
                width: 380px;
                border-right: 1px solid var(--border);
                position: relative;
                transform: none !important;
            }
            .sidebar.hidden-mobile {
                transform: none;
                position: relative;
            }
        }
        
        .header {
            background: var(--sidebar-bg);
            padding: 12px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--border);
        }
        .header h1 { 
            font-size: 20px; 
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .header-actions {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        
        .icon-btn {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: none;
            background: transparent;
            color: var(--text-secondary);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .icon-btn:hover { background: rgba(255,255,255,0.1); color: var(--text); }
        .icon-btn svg { width: 24px; height: 24px; }
        
        .connection-badge {
            font-size: 11px;
            padding: 4px 10px;
            border-radius: 12px;
            background: var(--accent);
            color: white;
            font-weight: 600;
        }
        .connection-badge.offline { background: var(--danger); }
        
        .search-container {
            padding: 8px 12px;
            background: var(--sidebar-bg);
            border-bottom: 1px solid var(--border);
        }
        .search-box {
            background: #202c33;
            border-radius: 8px;
            display: flex;
            align-items: center;
            padding: 8px 12px;
            gap: 10px;
        }
        .search-box input {
            flex: 1;
            border: none;
            background: transparent;
            color: var(--text);
            font-size: 15px;
            outline: none;
        }
        .search-box input::placeholder { color: var(--text-secondary); }
        
        .chat-list {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 8px 0;
        }
        
        .chat-item {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            cursor: pointer;
            transition: all 0.2s;
            position: relative;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .chat-item:hover { background: rgba(255,255,255,0.05); }
        .chat-item.active { background: #2a3942; }
        
        .chat-avatar {
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: linear-gradient(135deg, #667781 0%, #8696a0 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            font-weight: 600;
            color: white;
            margin-right: 14px;
            flex-shrink: 0;
        }
        
        .chat-info {
            flex: 1;
            min-width: 0;
        }
        .chat-header-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        }
        .chat-name {
            font-weight: 500;
            font-size: 16px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--text);
        }
        .chat-time {
            font-size: 12px;
            color: var(--accent);
            flex-shrink: 0;
        }
        
        .chat-preview {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 14px;
            color: var(--text-secondary);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        .status-indicator {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 12px;
            padding: 2px 8px;
            border-radius: 10px;
            margin-left: 8px;
            font-weight: 600;
        }
        .status-indicator.bot { background: rgba(37, 211, 102, 0.15); color: var(--accent); }
        .status-indicator.human { background: rgba(241, 92, 109, 0.15); color: var(--danger); }
        
        .chat-area {
            flex: 1;
            display: none;
            flex-direction: column;
            background: var(--chat-bg);
            width: 100%;
            height: 100%;
        }
        .chat-area.active { display: flex; }
        
        @media (min-width: 900px) {
            .chat-area { display: flex; }
            .chat-area:not(.has-chat) .chat-placeholder { display: flex; }
        }
        
        .chat-header {
            background: var(--sidebar-bg);
            padding: 10px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--border);
            min-height: 60px;
        }
        
        .chat-header-info {
            display: flex;
            align-items: center;
            gap: 14px;
            flex: 1;
            min-width: 0;
        }
        
        .back-btn {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: none;
            background: transparent;
            color: var(--text);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            margin: -8px;
        }
        @media (min-width: 900px) { .back-btn { display: none; } }
        
        .chat-title { flex: 1; min-width: 0; }
        .chat-title h3 {
            font-size: 17px;
            font-weight: 600;
            margin-bottom: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .chat-title p {
            font-size: 13px;
            color: var(--text-secondary);
        }
        
        .chat-actions {
            display: flex;
            gap: 8px;
        }
        
        .action-btn {
            padding: 10px 20px;
            border: none;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
        }
        .action-btn.intervene { background: var(--danger); color: white; }
        .action-btn.release { background: var(--accent); color: #111; }
        .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .intervention-banner {
            background: linear-gradient(90deg, var(--danger), #ff6b6b);
            color: white;
            padding: 12px 16px;
            text-align: center;
            font-size: 14px;
            font-weight: 600;
            display: none;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        .intervention-banner.active { display: flex; }
        
        .messages-container {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            background-image: url("data:image/svg+xml,%3Csvg width='400' height='400' viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h400v400H0z' fill='%230a1014'/%3E%3Cpath d='M0 0h400v400H0z' fill='none' stroke='%23111b21' stroke-width='2'/%3E%3C/svg%3E");
        }
        
        .message {
            max-width: 85%;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 14.5px;
            line-height: 1.4;
            word-wrap: break-word;
            position: relative;
            animation: messageIn 0.3s ease;
        }
        @keyframes messageIn {
            from { opacity: 0; transform: translateY(20px) scale(0.9); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        
        .message.incoming {
            background: var(--incoming);
            align-self: flex-start;
            border-top-left-radius: 2px;
            color: var(--text);
        }
        .message.outgoing {
            background: var(--outgoing);
            align-self: flex-end;
            border-top-right-radius: 2px;
            color: white;
        }
        .message.system {
            background: rgba(255, 193, 7, 0.15);
            align-self: center;
            font-size: 12.5px;
            color: #ffd700;
            padding: 8px 16px;
            border-radius: 16px;
            max-width: 90%;
            text-align: center;
            border: 1px solid rgba(255, 193, 7, 0.3);
        }
        
        .message-content { margin-bottom: 4px; }
        
        .message-meta {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 4px;
            font-size: 11px;
            opacity: 0.7;
            margin-top: 2px;
        }
        .message.outgoing .message-meta { color: #a5f3c5; }
        
        .date-separator {
            align-self: center;
            background: #1e2a30;
            color: var(--text-secondary);
            padding: 8px 16px;
            border-radius: 16px;
            font-size: 12px;
            font-weight: 500;
            margin: 16px 0;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .input-container {
            background: var(--sidebar-bg);
            padding: 10px 16px;
            display: flex;
            align-items: flex-end;
            gap: 10px;
            border-top: 1px solid var(--border);
        }
        
        .input-wrapper {
            flex: 1;
            background: #2a3942;
            border-radius: 24px;
            padding: 12px 20px;
            max-height: 120px;
            overflow-y: auto;
        }
        
        .input-wrapper input {
            width: 100%;
            border: none;
            outline: none;
            background: transparent;
            color: var(--text);
            font-size: 15.5px;
            line-height: 1.4;
        }
        .input-wrapper input::placeholder { color: var(--text-secondary); }
        .input-wrapper input:disabled { opacity: 0.5; }
        
        .send-btn {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            border: none;
            background: var(--secondary);
            color: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            flex-shrink: 0;
        }
        .send-btn:hover:not(:disabled) { background: var(--accent); transform: scale(1.05); }
        .send-btn:active:not(:disabled) { transform: scale(0.95); }
        .send-btn:disabled { background: #374248; cursor: not-allowed; }
        .send-btn svg { width: 24px; height: 24px; margin-left: 2px; }
        
        .chat-placeholder {
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--text-secondary);
            text-align: center;
            padding: 40px;
        }
        .chat-placeholder svg {
            width: 120px;
            height: 120px;
            margin-bottom: 24px;
            opacity: 0.2;
        }
        .chat-placeholder h3 {
            font-size: 32px;
            font-weight: 300;
            margin-bottom: 16px;
            color: var(--text-secondary);
        }
        .chat-placeholder p { font-size: 14px; max-width: 400px; line-height: 1.6; }
        
        .empty-list {
            text-align: center;
            padding: 60px 20px;
            color: var(--text-secondary);
        }
        
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #374248; border-radius: 3px; }
        
        @media (max-width: 899px) {
            .message { max-width: 92%; font-size: 15.5px; }
            .chat-avatar { width: 48px; height: 48px; font-size: 20px; }
            .chat-name { font-size: 15px; }
            .action-btn { padding: 8px 16px; font-size: 13px; }
        }
        
        @supports (-webkit-touch-callout: none) {
            input, textarea { font-size: 16px; }
        }
    </style>
</head>
<body>
    <div id="debugPanel"></div>
    
    <div id="loading">
        <div class="spinner"></div>
        <p>Conectando ao painel...</p>
    </div>

    <div id="app">
        <aside class="sidebar" id="sidebar">
            <div class="header">
                <h1>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20.52 3.45A11.83 11.83 0 0 0 12 0 12 12 0 0 0 0 12a12 12 0 0 0 1.74 6.15L0 24l6.33-1.5A12 12 0 0 0 12 24a12 12 0 0 0 12-12 12 12 0 0 0-3.48-8.55zM12 22a9.89 9.89 0 0 1-5-1.35l-.36-.22-3.76.89.89-3.66-.23-.37A10 10 0 0 1 12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10zm5.4-7.4c-.3-.15-1.77-.87-2.05-1-.27-.1-.47-.15-.67.15s-.77 1-.95 1.2-.35.23-.65.08a8.2 8.2 0 0 1-2.4-1.5 9 9 0 0 1-1.67-2.08c-.17-.3 0-.47.13-.62s.3-.35.45-.53a2 2 0 0 0 .3-.5.55.55 0 0 0 0-.52c-.08-.15-.67-1.6-.92-2.2s-.48-.5-.67-.51h-.57a1.1 1.1 0 0 0-.8.37c-.28.3-1 1-1 2.43s1.03 2.82 1.17 3s1.35 2.06 3.27 2.89 1.9.85 2.25.89a2 2 0 0 0 1.53-.71 1.6 1.6 0 0 0 .36-1.03c0-.15-.12-.27-.4-.42z"/>
                    </svg>
                    WhatsApp Pro
                </h1>
                <div class="header-actions">
                    <span class="connection-badge" id="connectionBadge">Iniciando...</span>
                    <button class="icon-btn" onclick="app.toggleDebug()" title="Debug">🐛</button>
                </div>
            </div>
            
            <div class="search-container">
                <div class="search-box">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#8696a0">
                        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                    </svg>
                    <input type="text" id="searchInput" placeholder="Pesquisar..." oninput="app.search(this.value)">
                </div>
            </div>
            
            <div class="chat-list" id="chatList">
                <div class="empty-list">
                    <p>Carregando...</p>
                </div>
            </div>
        </aside>

        <main class="chat-area" id="chatArea">
            <div class="chat-placeholder" id="chatPlaceholder">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                <h3>WhatsApp Web</h3>
                <p>Selecione uma conversa para começar</p>
            </div>

            <div id="activeChat" style="display: none; flex-direction: column; height: 100%;">
                <div class="chat-header">
                    <div class="chat-header-info">
                        <button class="back-btn" onclick="app.closeChat()">←</button>
                        <div class="chat-avatar" id="chatAvatar">👤</div>
                        <div class="chat-title">
                            <h3 id="chatName">-</h3>
                            <p id="chatStatus">-</p>
                        </div>
                    </div>
                    <div class="chat-actions" id="chatActions"></div>
                </div>

                <div class="intervention-banner" id="interventionBanner">
                    <span>⚡</span>
                    <span>Você assumiu o controle - Robô desativado</span>
                </div>

                <div class="messages-container" id="messagesContainer"></div>

                <div class="input-container">
                    <div class="input-wrapper">
                        <input type="text" id="messageInput" placeholder="Digite uma mensagem..." 
                               onkeypress="if(event.key==='Enter') app.sendMessage()" disabled>
                    </div>
                    <button class="send-btn" id="sendBtn" onclick="app.sendMessage()" disabled>
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </button>
                </div>
            </div>
        </main>
    </div>

    <script>
        // ==========================================
        // CONFIGURAÇÃO - VERIFIQUE ESTA URL
        // ==========================================
        const CONFIG = {
            // IMPORTANTE: Altere para sua URL real se necessário
            WEBHOOK_URL: window.location.origin + '/api/webhook',
            
            // Intervalos de polling
            POLL_INTERVAL: 3000,      // 3 segundos para lista
            CHAT_POLL_INTERVAL: 1500, // 1.5 segundos para mensagens
            
            // Debug
            DEBUG: false
        };

        // ==========================================
        // APLICAÇÃO
        // ==========================================
        class WhatsAppPanel {
            constructor() {
                this.chats = new Map();
                this.currentPhone = null;
                this.debugMode = false;
                
                this.init();
            }

            init() {
                console.log('[Painel] Iniciando...');
                console.log('[Painel] Webhook URL:', CONFIG.WEBHOOK_URL);
                
                // Esconder loading
                setTimeout(() => {
                    document.getElementById('loading').classList.add('fade-out');
                }, 500);
                
                // Iniciar polling imediatamente
                this.fetchConversations();
                setInterval(() => this.fetchConversations(), CONFIG.POLL_INTERVAL);
                
                // Polling de mensagens
                setInterval(() => {
                    if (this.currentPhone) {
                        this.fetchMessages(this.currentPhone);
                    }
                }, CONFIG.CHAT_POLL_INTERVAL);
            }

            log(msg, type = 'info') {
                console.log(`[Painel] ${msg}`);
                if (this.debugMode) {
                    const panel = document.getElementById('debugPanel');
                    const time = new Date().toLocaleTimeString();
                    const color = type === 'error' ? '#ff6b6b' : (type === 'success' ? '#4caf50' : 'white');
                    panel.innerHTML += `<div style="color: ${color};">[${time}] ${msg}</div>`;
                    panel.scrollTop = panel.scrollHeight;
                }
            }

            toggleDebug() {
                this.debugMode = !this.debugMode;
                document.getElementById('debugPanel').classList.toggle('show', this.debugMode);
                this.log('Debug: ' + (this.debugMode ? 'ON' : 'OFF'));
            }

            // ==========================================
            // BUSCAR CONVERSAS
            // ==========================================
            async fetchConversations() {
                try {
                    this.updateStatus('online');
                    
                    // Usar action=list (formato do seu webhook RC Reforma)
                    const url = `${CONFIG.WEBHOOK_URL}?action=list&_t=${Date.now()}`;
                    this.log('Buscando: ' + url);
                    
                    const response = await fetch(url);
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    
                    const data = await response.json();
                    this.log('Resposta: ' + JSON.stringify(data).substring(0, 200), 'success');
                    
                    // Seu webhook retorna { conversas: [...] }
                    const conversas = data.conversas || data;
                    
                    if (!Array.isArray(conversas)) {
                        throw new Error('Resposta não é array: ' + typeof conversas);
                    }
                    
                    this.log(`Recebidas ${conversas.length} conversas`);
                    
                    // Atualizar mapa
                    conversas.forEach(conv => {
                        const phone = conv.telefone;
                        const existing = this.chats.get(phone);
                        
                        if (!existing) {
                            // Nova conversa
                            this.chats.set(phone, {
                                ...conv,
                                messages: []
                            });
                            this.log('Nova: ' + phone);
                        } else {
                            // Atualizar existente
                            existing.nome = conv.nome || existing.nome;
                            existing.emIntervencao = conv.emIntervencao;
                            existing.etapa = conv.etapa;
                            existing.ultimaAtividade = conv.ultimaAtividade;
                            existing.ultima = conv.ultima || existing.ultima;
                        }
                    });
                    
                    this.renderList();
                    
                } catch (error) {
                    this.log('ERRO: ' + error.message, 'error');
                    this.updateStatus('offline');
                    console.error(error);
                }
            }

            // ==========================================
            // BUSCAR MENSAGENS
            // ==========================================
            async fetchMessages(phone) {
                try {
                    const url = `${CONFIG.WEBHOOK_URL}?action=messages&phone=${encodeURIComponent(phone)}&_t=${Date.now()}`;
                    
                    const response = await fetch(url);
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    
                    const data = await response.json();
                    
                    // Seu webhook retorna { mensagens: [...] }
                    const mensagens = data.mensagens || data;
                    
                    if (!Array.isArray(mensagens)) {
                        this.log('mensagens não é array: ' + typeof mensagens, 'error');
                        return;
                    }
                    
                    this.log(`${mensagens.length} mensagens para ${phone}`);
                    
                    const chat = this.chats.get(phone);
                    if (!chat) return;
                    
                    // Sempre atualizar mensagens
                    chat.messages = mensagens;
                    
                    // Se é o chat atual, renderizar
                    if (this.currentPhone === phone) {
                        this.renderMessages(mensagens);
                    }
                    
                    // Atualizar preview
                    if (mensagens.length > 0) {
                        const last = mensagens[mensagens.length - 1];
                        chat.ultima = last.mensagem || last.texto || last.content || 'Nova mensagem';
                        this.renderList();
                    }
                    
                } catch (error) {
                    this.log('Erro mensagens: ' + error.message, 'error');
                }
            }

            // ==========================================
            // RENDERIZAR LISTA
            // ==========================================
            renderList() {
                const container = document.getElementById('chatList');
                const searchTerm = (document.getElementById('searchInput')?.value || '').toLowerCase();
                
                const chats = Array.from(this.chats.values())
                    .filter(c => !searchTerm || 
                        (c.nome?.toLowerCase().includes(searchTerm)) || 
                        c.telefone.includes(searchTerm))
                    .sort((a, b) => {
                        if (a.emIntervencao && !b.emIntervencao) return -1;
                        if (!a.emIntervencao && b.emIntervencao) return 1;
                        return new Date(b.ultimaAtividade || 0) - new Date(a.ultimaAtividade || 0);
                    });

                if (chats.length === 0) {
                    container.innerHTML = '<div class="empty-list"><p>Aguardando conversas...</p></div>';
                    return;
                }

                container.innerHTML = chats.map(c => {
                    const isActive = c.telefone === this.currentPhone;
                    const time = this.formatTime(c.ultimaAtividade);
                    
                    return `
                        <div class="chat-item ${isActive ? 'active' : ''}" 
                             onclick="app.selectChat('${c.telefone}')"
                             data-phone="${c.telefone}">
                            <div class="chat-avatar">${this.getInitials(c.nome)}</div>
                            <div class="chat-info">
                                <div class="chat-header-row">
                                    <span class="chat-name">${c.nome || c.telefone}</span>
                                    <span class="chat-time">${time}</span>
                                </div>
                                <div class="chat-preview">
                                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;">
                                        ${this.escapeHtml(c.ultima || 'Sem mensagens')}
                                    </span>
                                    <span class="status-indicator ${c.emIntervencao ? 'human' : 'bot'}">
                                        ${c.emIntervencao ? '🔴 VOCÊ' : '🤖 BOT'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            // ==========================================
            // SELECIONAR CHAT
            // ==========================================
            selectChat(phone) {
                this.log('Selecionando: ' + phone);
                this.currentPhone = phone;
                const chat = this.chats.get(phone);
                
                if (!chat) {
                    this.log('Chat não encontrado!', 'error');
                    return;
                }

                // UI
                document.getElementById('sidebar').classList.add('hidden-mobile');
                document.getElementById('chatArea').classList.add('active', 'has-chat');
                document.getElementById('chatPlaceholder').style.display = 'none';
                document.getElementById('activeChat').style.display = 'flex';
                
                // Header
                document.getElementById('chatName').textContent = chat.nome || phone;
                document.getElementById('chatAvatar').textContent = this.getInitials(chat.nome);
                
                this.updateUI(chat);
                
                // Renderizar mensagens imediatamente
                if (chat.messages && chat.messages.length > 0) {
                    this.renderMessages(chat.messages);
                } else {
                    document.getElementById('messagesContainer').innerHTML = '';
                }
                
                // Buscar mensagens atualizadas
                this.fetchMessages(phone);
                
                // Re-renderizar lista para marcar ativo
                this.renderList();
            }

            closeChat() {
                this.currentPhone = null;
                document.getElementById('sidebar').classList.remove('hidden-mobile');
                document.getElementById('chatArea').classList.remove('active', 'has-chat');
                document.getElementById('chatPlaceholder').style.display = 'flex';
                document.getElementById('activeChat').style.display = 'none';
                this.renderList();
            }

            updateUI(chat) {
                const banner = document.getElementById('interventionBanner');
                const input = document.getElementById('messageInput');
                const sendBtn = document.getElementById('sendBtn');
                const actions = document.getElementById('chatActions');
                const status = document.getElementById('chatStatus');
                
                if (chat.emIntervencao) {
                    banner.classList.add('active');
                    input.disabled = false;
                    sendBtn.disabled = false;
                    input.placeholder = 'Digite uma mensagem...';
                    input.focus();
                    actions.innerHTML = `<button class="action-btn release" onclick="app.release('${chat.telefone}')">🤖 Liberar Robô</button>`;
                    status.textContent = 'Você está no controle';
                } else {
                    banner.classList.remove('active');
                    input.disabled = true;
                    sendBtn.disabled = true;
                    input.placeholder = 'Assuma o controle para responder';
                    actions.innerHTML = `<button class="action-btn intervene" onclick="app.intervene('${chat.telefone}')">🚨 Assumir Controle</button>`;
                    status.textContent = 'Robô ativo';
                }
            }

            // ==========================================
            // RENDERIZAR MENSAGENS
            // ==========================================
            renderMessages(messages) {
                const container = document.getElementById('messagesContainer');
                
                if (!messages || messages.length === 0) {
                    container.innerHTML = '<div style="text-align:center;color:#8696a0;padding:40px;">Nenhuma mensagem</div>';
                    return;
                }

                let lastDate = null;
                let html = '';
                
                messages.forEach((msg, index) => {
                    const msgDate = new Date(msg.data || msg.timestamp || Date.now()).toDateString();
                    
                    if (msgDate !== lastDate) {
                        html += `<div class="date-separator">${this.formatDate(msg.data || msg.timestamp)}</div>`;
                        lastDate = msgDate;
                    }
                    
                    // Determinar tipo
                    const tipo = msg.tipo || msg.from || 'cliente';
                    let type = 'incoming';
                    
                    if (tipo === 'bot' || tipo === 'robo') type = 'outgoing';
                    else if (tipo === 'humano' || tipo === 'me') type = 'outgoing';
                    else if (tipo === 'system' || tipo === 'sistema') type = 'system';
                    
                    const content = this.escapeHtml(msg.mensagem || msg.texto || msg.content || msg.message || '');
                    const time = this.formatTime(msg.data || msg.timestamp);
                    const sender = msg.nome || (type === 'outgoing' ? 'Você' : 'Cliente');
                    
                    html += `
                        <div class="message ${type}">
                            <div class="message-content">${content}</div>
                            <div class="message-meta">${sender} • ${time}</div>
                        </div>
                    `;
                });
                
                container.innerHTML = html;
                this.scrollToBottom();
            }

            // ==========================================
            // AÇÕES
            // ==========================================
            async intervene(phone) {
                const btn = document.querySelector('.action-btn');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '⏳...';
                }
                
                try {
                    const response = await fetch(`${CONFIG.WEBHOOK_URL}?action=intervene`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone: phone })
                    });
                    
                    const result = await response.json();
                    this.log('Intervenção: ' + JSON.stringify(result));
                    
                    // Atualizar local
                    const chat = this.chats.get(phone);
                    if (chat) {
                        chat.emIntervencao = true;
                        this.updateUI(chat);
                        this.renderList();
                    }
                    
                } catch (error) {
                    this.log('Erro intervene: ' + error.message, 'error');
                    alert('Erro ao assumir controle');
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = '🚨 Assumir Controle';
                    }
                }
            }

            async release(phone) {
                const btn = document.querySelector('.action-btn');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '⏳...';
                }
                
                try {
                    const response = await fetch(`${CONFIG.WEBHOOK_URL}?action=release`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone: phone })
                    });
                    
                    const result = await response.json();
                    this.log('Release: ' + JSON.stringify(result));
                    
                    // Atualizar local
                    const chat = this.chats.get(phone);
                    if (chat) {
                        chat.emIntervencao = false;
                        this.updateUI(chat);
                        this.renderList();
                    }
                    
                } catch (error) {
                    this.log('Erro release: ' + error.message, 'error');
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = '🤖 Liberar Robô';
                    }
                }
            }

            async sendMessage() {
                if (!this.currentPhone) return;
                
                const input = document.getElementById('messageInput');
                const text = input.value.trim();
                if (!text) return;
                
                const chat = this.chats.get(this.currentPhone);
                if (!chat || !chat.emIntervencao) {
                    alert('Assuma o controle primeiro!');
                    return;
                }
                
                input.value = '';
                
                try {
                    const response = await fetch(`${CONFIG.WEBHOOK_URL}?action=send`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            phone: this.currentPhone,
                            message: text
                        })
                    });
                    
                    const result = await response.json();
                    this.log('Enviado: ' + JSON.stringify(result));
                    
                    // Recarregar mensagens após 300ms
                    setTimeout(() => this.fetchMessages(this.currentPhone), 300);
                    
                } catch (error) {
                    this.log('Erro enviar: ' + error.message, 'error');
                    alert('Erro ao enviar mensagem');
                    input.value = text;
                }
            }

            search(term) {
                this.renderList();
            }

            scrollToBottom() {
                const container = document.getElementById('messagesContainer');
                container.scrollTop = container.scrollHeight;
            }

            updateStatus(status) {
                const badge = document.getElementById('connectionBadge');
                badge.className = 'connection-badge ' + (status === 'online' ? '' : 'offline');
                badge.textContent = status === 'online' ? '🟢 Online' : '🔴 Offline';
            }

            getInitials(name) {
                if (!name) return '👤';
                return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
            }

            formatTime(date) {
                if (!date) return '';
                const d = new Date(date);
                return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            }

            formatDate(date) {
                if (!date) return '';
                const d = new Date(date);
                const today = new Date();
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                
                if (d.toDateString() === today.toDateString()) return 'Hoje';
                if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
                return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
            }

            escapeHtml(text) {
                if (!text) return '';
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }
        }

        // Inicializar
        const app = new WhatsAppPanel();
    </script>
</body>
</html>
