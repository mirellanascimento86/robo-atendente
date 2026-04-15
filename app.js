// Configuração - SUBSTITUA COM SEUS DADOS DO SUPABASE
const SUPABASE_URL = 'https://seu-projeto.supabase.co';
const SUPABASE_KEY = 'sua-chave-publica';
const WEBHOOK_URL = '/api/webhook';

class WhatsAppPanel {
    constructor() {
        this.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        this.currentChat = null;
        this.chats = new Map();
        this.messages = new Map();
        this.subscriptions = new Map();
        this.isOnline = navigator.onLine;
        this.syncQueue = [];
        this.searchTerm = '';
        
        this.init();
    }
    
    async init() {
        // Registrar Service Worker
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('/sw.js');
            } catch (e) {
                console.log('SW registration failed:', e);
            }
        }
        
        // Monitorar conexão
        window.addEventListener('online', () => this.setOnline(true));
        window.addEventListener('offline', () => this.setOnline(false));
        
        // Carregar dados iniciais
        await this.loadChats();
        this.setupRealtime();
        
        // Esconder loading
        setTimeout(() => {
            document.getElementById('loading').classList.add('hide');
        }, 500);
        
        // Verificar URL params para chat específico
        const urlParams = new URLSearchParams(window.location.search);
        const phone = urlParams.get('phone');
        if (phone) this.openChat(phone);
    }
    
    setOnline(status) {
        this.isOnline = status;
        const el = document.getElementById('connectionStatus');
        el.textContent = status ? 'Online' : 'Sem conexão - Modo offline';
        el.className = 'connection-status show ' + (status ? 'online' : '');
        setTimeout(() => el.classList.remove('show'), 3000);
    }
    
    // Carregar conversas do Supabase
    async loadChats() {
        const { data, error } = await this.supabase
            .from('conversations')
            .select('*')
            .order('last_message_at', { ascending: false });
            
        if (error) {
            console.error('Erro ao carregar conversas:', error);
            // Tentar carregar do cache local
            const cached = localStorage.getItem('cached_chats');
            if (cached) {
                data = JSON.parse(cached);
            }
            return;
        }
        
        // Atualizar cache
        localStorage.setItem('cached_chats', JSON.stringify(data));
        
        data.forEach(chat => {
            this.chats.set(chat.phone, chat);
        });
        
        this.renderChatList();
    }
    
    // Setup Supabase Real-Time
    setupRealtime() {
        // Subscribe para novas mensagens
        this.supabase
            .channel('messages')
            .on('postgres_changes', 
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => {
                    this.handleNewMessage(payload.new);
                }
            )
            .subscribe();
            
        // Subscribe para mudanças em conversas
        this.supabase
            .channel('conversations')
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'conversations' },
                (payload) => {
                    this.chats.set(payload.new.phone, payload.new);
                    this.renderChatList();
                    if (this.currentChat === payload.new.phone) {
                        this.updateChatHeader(payload.new);
                    }
                }
            )
            .subscribe();
    }
    
    handleNewMessage(msg) {
        // Adicionar à lista de mensagens
        if (!this.messages.has(msg.conversation_id)) {
            this.messages.set(msg.conversation_id, []);
        }
        this.messages.get(msg.conversation_id).push(msg);
        
        // Atualizar preview na lista
        const chat = this.chats.get(msg.conversation_id);
        if (chat) {
            chat.last_message = msg.content;
            chat.last_message_at = msg.created_at;
            chat.unread = msg.sender_type === 'client' && msg.conversation_id !== this.currentChat;
            this.renderChatList();
        }
        
        // Se é o chat atual, renderizar
        if (msg.conversation_id === this.currentChat) {
            this.renderMessage(msg);
            this.scrollToBottom();
            
            // Marcar como lida
            this.markAsRead(msg.conversation_id);
        } else {
            // Notificação
            this.showNotification(chat, msg);
        }
    }
    
    renderChatList() {
        const container = document.getElementById('chatList');
        const chats = Array.from(this.chats.values())
            .filter(c => !this.searchTerm || 
                c.name?.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                c.phone.includes(this.searchTerm))
            .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
        
        if (chats.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>${this.searchTerm ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'}</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = chats.map(chat => {
            const isActive = chat.phone === this.currentChat;
            const time = this.formatTime(chat.last_message_at);
            const preview = chat.typing ? 
                '<span class="chat-preview typing">digitando...</span>' : 
                `<span class="chat-preview">${this.escapeHtml(chat.last_message || 'Nenhuma mensagem')}</span>`;
            
            return `
                <div class="chat-item ${isActive ? 'active' : ''} ${chat.unread ? 'unread' : ''}" 
                     onclick="app.openChat('${chat.phone}')"
                     data-phone="${chat.phone}">
                    <div class="chat-avatar">${this.getAvatar(chat.name)}</div>
                    <div class="chat-info">
                        <div class="chat-header-row">
                            <span class="chat-name">${chat.name || chat.phone}</span>
                            <span class="chat-time">${time}</span>
                        </div>
                        <div style="display: flex; align-items: center;">
                            ${preview}
                            <span class="status-badge ${chat.intervention ? 'human' : 'bot'}">
                                ${chat.intervention ? '🔴 VOCÊ' : '🤖 BOT'}
                            </span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    async openChat(phone) {
        this.currentChat = phone;
        const chat = this.chats.get(phone);
        
        // Atualizar UI
        document.getElementById('emptyChat').style.display = 'none';
        document.getElementById('activeChat').style.display = 'flex';
        document.getElementById('app').classList.add('chat-open');
        
        // Atualizar header
        document.getElementById('chatName').textContent = chat.name || phone;
        document.getElementById('chatAvatar').textContent = this.getAvatar(chat.name);
        this.updateChatHeader(chat);
        
        // Carregar mensagens
        await this.loadMessages(phone);
        
        // Marcar como lida
        if (chat.unread) {
            this.markAsRead(phone);
        }
        
        // Focar input
        setTimeout(() => document.getElementById('messageInput').focus(), 300);
        
        // Setup subscription para esta conversa específica
        this.subscribeToChat(phone);
    }
    
    closeChat() {
        this.currentChat = null;
        document.getElementById('app').classList.remove('chat-open');
        setTimeout(() => {
            document.getElementById('emptyChat').style.display = 'flex';
            document.getElementById('activeChat').style.display = 'none';
        }, 300);
    }
    
    updateChatHeader(chat) {
        const status = chat.intervention ? 
            'Você está respondendo' : 
            (chat.online ? 'Online' : 'Robô ativo');
        document.getElementById('chatStatus').textContent = status;
        
        const banner = document.getElementById('interventionBanner');
        banner.classList.toggle('active', chat.intervention);
        
        const actions = document.getElementById('chatActions');
        if (chat.intervention) {
            actions.innerHTML = `
                <button class="intervention-btn release" onclick="app.releaseControl('${chat.phone}')">
                    🤖 Liberar Robô
                </button>
            `;
            document.getElementById('messageInput').disabled = false;
            document.getElementById('sendBtn').disabled = false;
        } else {
            actions.innerHTML = `
                <button class="intervention-btn take" onclick="app.takeControl('${chat.phone}')">
                    🚨 Assumir Controle
                </button>
            `;
            document.getElementById('messageInput').disabled = true;
            document.getElementById('sendBtn').disabled = true;
            document.getElementById('messageInput').placeholder = 'Clique em "Assumir Controle" para responder';
        }
    }
    
    async loadMessages(phone) {
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Carregando...</div>';
        
        const { data, error } = await this.supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', phone)
            .order('created_at', { ascending: true })
            .limit(100);
            
        if (error) {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: red;">Erro ao carregar mensagens</div>';
            return;
        }
        
        this.messages.set(phone, data);
        
        // Agrupar por data
        let lastDate = null;
        container.innerHTML = data.map(msg => {
            const msgDate = new Date(msg.created_at).toDateString();
            let html = '';
            
            if (msgDate !== lastDate) {
                html += `<div class="date-separator">${this.formatDate(msg.created_at)}</div>`;
                lastDate = msgDate;
            }
            
            html += this.renderMessageHTML(msg);
            return html;
        }).join('');
        
        this.scrollToBottom();
    }
    
    renderMessageHTML(msg) {
        const isOutgoing = msg.sender_type === 'human' || msg.sender_type === 'bot';
        const type = msg.sender_type === 'system' ? 'system' : (isOutgoing ? 'outgoing' : 'incoming');
        const time = this.formatTime(msg.created_at);
        
        return `
            <div class="message ${type}" data-id="${msg.id}">
                ${this.escapeHtml(msg.content)}
                <div class="message-meta">
                    ${time}
                    ${isOutgoing ? `
                        <span class="message-status">
                            ${msg.read ? '✓✓' : '✓'}
                        </span>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    renderMessage(msg) {
        const container = document.getElementById('messagesContainer');
        const lastMsg = container.lastElementChild;
        const msgDate = new Date(msg.created_at).toDateString();
        const lastDate = lastMsg ? new Date(lastMsg.dataset?.time).toDateString() : null;
        
        // Adicionar separador de data se necessário
        if (msgDate !== lastDate) {
            const separator = document.createElement('div');
            separator.className = 'date-separator';
            separator.textContent = this.formatDate(msg.created_at);
            container.appendChild(separator);
        }
        
        const div = document.createElement('div');
        div.innerHTML = this.renderMessageHTML(msg);
        container.appendChild(div.firstElementChild);
    }
    
    async sendMessage() {
        const input = document.getElementById('messageInput');
        const content = input.value.trim();
        if (!content || !this.currentChat) return;
        
        const chat = this.chats.get(this.currentChat);
        if (!chat.intervention) {
            alert('Assuma o controle primeiro!');
            return;
        }
        
        input.value = '';
        
        // Otimistic UI
        const tempMsg = {
            id: 'temp-' + Date.now(),
            content,
            sender_type: 'human',
            created_at: new Date().toISOString(),
            conversation_id: this.currentChat
        };
        this.renderMessage(tempMsg);
        this.scrollToBottom();
        
        try {
            // Enviar para API
            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'send',
                    phone: this.currentChat,
                    message: content
                })
            });
            
            if (!response.ok) throw new Error('Falha ao enviar');
            
            // Inserir no Supabase (será atualizado pelo realtime)
            await this.supabase.from('messages').insert({
                conversation_id: this.currentChat,
                content,
                sender_type: 'human',
                created_at: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Erro ao enviar:', error);
            // Adicionar à fila de sincronização
            this.syncQueue.push({ type: 'send', phone: this.currentChat, content });
            localStorage.setItem('sync_queue', JSON.stringify(this.syncQueue));
            alert('Mensagem salva. Será enviada quando reconectar.');
        }
    }
    
    async takeControl(phone) {
        const btn = document.querySelector('.intervention-btn');
        btn.disabled = true;
        btn.textContent = '⏳...';
        
        try {
            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'intervene', phone })
            });
            
            await this.supabase
                .from('conversations')
                .update({ intervention: true, intervened_by: 'user', updated_at: new Date().toISOString() })
                .eq('phone', phone);
                
        } catch (error) {
            alert('Erro ao assumir controle');
            console.error(error);
        }
    }
    
    async releaseControl(phone) {
        const btn = document.querySelector('.intervention-btn');
        btn.disabled = true;
        btn.textContent = '⏳...';
        
        try {
            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'release', phone })
            });
            
            await this.supabase
                .from('conversations')
                .update({ intervention: false, updated_at: new Date().toISOString() })
                .eq('phone', phone);
                
        } catch (error) {
            alert('Erro ao liberar controle');
            console.error(error);
        }
    }
    
    async markAsRead(phone) {
        await this.supabase
            .from('conversations')
            .update({ unread: false })
            .eq('phone', phone);
            
        const chat = this.chats.get(phone);
        if (chat) {
            chat.unread = false;
            this.renderChatList();
        }
    }
    
    subscribeToChat(phone) {
        // Cancelar subscription anterior
        if (this.currentSubscription) {
            this.currentSubscription.unsubscribe();
        }
        
        // Subscribe para typing indicators
        this.currentSubscription = this.supabase
            .channel(`typing:${phone}`)
            .on('broadcast', { event: 'typing' }, (payload) => {
                document.getElementById('typingIndicator').classList.toggle('active', payload.payload.typing);
            })
            .subscribe();
    }
    
    search(term) {
        this.searchTerm = term;
        this.renderChatList();
    }
    
    refresh() {
        this.loadChats();
    }
    
    scrollToBottom() {
        const container = document.getElementById('messagesContainer');
        container.scrollTop = container.scrollHeight;
    }
    
    showNotification(chat, msg) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(chat.name || chat.phone, {
                body: msg.content,
                icon: '/icon-192.png'
            });
        }
    }
    
    // Helpers
    formatTime(date) {
        if (!date) return '';
        const d = new Date(date);
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    
    formatDate(date) {
        const d = new Date(date);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (d.toDateString() === today.toDateString()) return 'Hoje';
        if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
        return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    
    getAvatar(name) {
        if (!name) return '👤';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Inicializar
const app = new WhatsAppPanel();

// Solicitar permissão para notificações
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}
