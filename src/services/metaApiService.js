/**
 * @file metaApiService.js
 * @description Servicio de integración con Meta Graph API v22.0
 * Maneja OAuth, envío/recepción de mensajes para Instagram DMs y Facebook Messenger.
 * 
 * v3.4 — Soporte DUAL de Meta App: configuración independiente por empresa.
 * Cada empresa (agro / tracto) tiene su propio App ID, App Secret, Verify Token,
 * flujo OAuth y archivo de tokens, permitiendo conectar cuentas de Meta completamente
 * separadas para Agropower y Tractopower.
 */

const fs = require('fs');
const { PATHS } = require('../config/constants');

const GRAPH_API_BASE = 'https://graph.facebook.com/v22.0';
const REDIRECT_URI = 'https://powerpanel.ddns.net/api/channels/meta/callback';

// ======================== UTILIDADES DE EMPRESA ========================

/**
 * Determina la empresa ('agro' o 'tracto') a partir de un channelKey
 * @param {string} channelKey - Ej: 'ig_agro', 'fb_tracto'
 * @returns {'agro'|'tracto'}
 */
function companyFromChannelKey(channelKey) {
    if (!channelKey) return 'agro';
    const key = String(channelKey).toLowerCase();
    if (key.includes('tracto')) return 'tracto';
    return 'agro';
}

/**
 * Retorna las rutas de archivos para la empresa dada
 * @param {'agro'|'tracto'} company
 */
function getCompanyPaths(company) {
    if (company === 'tracto') {
        return {
            configFile: PATHS.META_CONFIG_TRACTO_FILE,
            tokensFile: PATHS.META_TOKENS_TRACTO_FILE
        };
    }
    return {
        configFile: PATHS.META_CONFIG_AGRO_FILE,
        tokensFile: PATHS.META_TOKENS_AGRO_FILE
    };
}

// ======================== CONFIGURACIÓN ========================

/**
 * Carga la configuración de la Meta App para una empresa específica.
 * @param {'agro'|'tracto'} [company='agro']
 */
function loadMetaConfig(company = 'agro') {
    const { configFile } = getCompanyPaths(company);
    try {
        if (fs.existsSync(configFile)) {
            return JSON.parse(fs.readFileSync(configFile, 'utf8'));
        }
        // Fallback: intentar leer el archivo legacy metaConfig.json (solo para agro)
        if (company === 'agro' && fs.existsSync(PATHS.META_CONFIG_FILE)) {
            const legacy = JSON.parse(fs.readFileSync(PATHS.META_CONFIG_FILE, 'utf8'));
            // Si el legacy no tiene la key "agro" anidada, usarlo directamente
            if (!legacy.agro) return legacy;
        }
    } catch (e) {
        console.error(`[MetaAPI] Error cargando config Meta (${company}):`, e.message);
    }
    return {
        appId: '',
        appSecret: '',
        verifyToken: `omnipanel_meta_verify_${company}_2026`
    };
}

/**
 * Guarda la configuración de la Meta App para una empresa específica.
 * @param {Object} config - { appId, appSecret, verifyToken }
 * @param {'agro'|'tracto'} [company='agro']
 */
function saveMetaConfig(config, company = 'agro') {
    const { configFile } = getCompanyPaths(company);
    try {
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
        console.log(`[MetaAPI] ✅ Configuración Meta App guardada (${company}).`);
    } catch (e) {
        console.error(`[MetaAPI] Error guardando config Meta (${company}):`, e.message);
    }
}

/**
 * Obtiene el verify token para validación de webhooks de una empresa.
 * El webhook de Meta es único (una sola URL), por lo que se acepta cualquiera de los dos tokens.
 */
function getVerifyToken(company = 'agro') {
    const config = loadMetaConfig(company);
    return config.verifyToken || `omnipanel_meta_verify_${company}_2026`;
}

/**
 * Verifica si el token del webhook recibido coincide con el de alguna empresa.
 * Retorna la empresa que coincide o null.
 */
function resolveCompanyFromVerifyToken(token) {
    const agro = loadMetaConfig('agro');
    const tracto = loadMetaConfig('tracto');
    if (token && token === agro.verifyToken) return 'agro';
    if (token && token === tracto.verifyToken) return 'tracto';
    // Fallback: aceptar si coincide con alguno
    return null;
}

// ======================== TOKEN MANAGEMENT ========================

/**
 * Carga los tokens de páginas y cuentas de Instagram para una empresa.
 * @param {'agro'|'tracto'} [company='agro']
 * @returns {{ pages: Object[], igAccounts: Object[], userToken: string, updatedAt: string }}
 */
function loadMetaTokens(company = 'agro') {
    const { tokensFile } = getCompanyPaths(company);
    try {
        if (fs.existsSync(tokensFile)) {
            return JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
        }
        // Fallback legacy
        if (company === 'agro' && fs.existsSync(PATHS.META_TOKENS_FILE)) {
            return JSON.parse(fs.readFileSync(PATHS.META_TOKENS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error(`[MetaAPI] Error cargando tokens Meta (${company}):`, e.message);
    }
    return { pages: [], igAccounts: [], userToken: null, updatedAt: null };
}

/**
 * Guarda tokens de páginas e Instagram de forma segura para una empresa.
 * @param {Object} data
 * @param {'agro'|'tracto'} [company='agro']
 */
function saveMetaTokens(data, company = 'agro') {
    const { tokensFile } = getCompanyPaths(company);
    try {
        data.updatedAt = new Date().toISOString();
        fs.writeFileSync(tokensFile, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[MetaAPI] ✅ Tokens Meta guardados (${company}).`);
    } catch (e) {
        console.error(`[MetaAPI] Error guardando tokens Meta (${company}):`, e.message);
    }
}

/**
 * Obtiene el Page Access Token para una página específica (busca en ambas empresas)
 */
function getPageToken(pageId) {
    for (const company of ['agro', 'tracto']) {
        const tokens = loadMetaTokens(company);
        const page = tokens.pages.find(p => p.id === pageId);
        if (page) return page.accessToken;
    }
    return null;
}

/**
 * Obtiene el token para una cuenta de Instagram (usa el page token de la página vinculada)
 */
function getInstagramToken(igAccountId) {
    for (const company of ['agro', 'tracto']) {
        const tokens = loadMetaTokens(company);
        const ig = tokens.igAccounts.find(a => a.igBusinessId === igAccountId);
        if (ig && ig.pageId) {
            return getPageToken(ig.pageId);
        }
    }
    return null;
}

/**
 * Busca el channelKey del panel según el pageId o igBusinessId que recibió el mensaje.
 * Busca en ambas empresas.
 */
function resolveChannelKeyFromRecipient(recipientId, platform) {
    for (const company of ['agro', 'tracto']) {
        const tokens = loadMetaTokens(company);
        
        if (platform === 'instagram') {
            const ig = tokens.igAccounts.find(a => a.igBusinessId === recipientId);
            if (ig) return ig.channelKey || null;
            const page = tokens.pages.find(p => p.id === recipientId);
            if (page) {
                const igForPage = tokens.igAccounts.find(a => a.pageId === page.id);
                if (igForPage) return igForPage.channelKey;
            }
        }
        
        if (platform === 'facebook') {
            const page = tokens.pages.find(p => p.id === recipientId);
            if (page) return page.channelKey || null;
        }
    }

    return null;
}

/**
 * Obtiene el token correcto para responder según channelKey.
 * Determina la empresa a partir del channelKey.
 */
function getTokenForChannel(channelKey) {
    const company = companyFromChannelKey(channelKey);
    const tokens = loadMetaTokens(company);
    
    // Instagram channels
    if (channelKey.startsWith('ig_')) {
        const ig = tokens.igAccounts.find(a => a.channelKey === channelKey);
        if (ig) return getPageToken(ig.pageId);
    }
    
    // Facebook channels
    if (channelKey.startsWith('fb_')) {
        const page = tokens.pages.find(p => p.channelKey === channelKey);
        if (page) return page.accessToken;
    }
    
    return null;
}

// ======================== OAUTH FLOW ========================

/**
 * Genera la URL de OAuth de Facebook para vincular páginas e Instagram.
 * Usa la configuración de la empresa correspondiente al channelKey.
 * @param {string} channelKey - Ej: 'ig_agro', 'fb_tracto'
 */
function getOAuthUrl(channelKey) {
    const company = companyFromChannelKey(channelKey);
    const config = loadMetaConfig(company);

    if (!config.appId) {
        throw new Error(`No hay Meta App configurada para ${company === 'agro' ? 'Agropower' : 'Tractopower'}. Ve a Configuración → Meta App y guarda el App ID.`);
    }

    const permissions = [
        'pages_messaging',
        'pages_manage_metadata',
        'pages_show_list',
        'pages_read_engagement',
        'instagram_basic',
        'instagram_manage_messages'
    ].join(',');

    // Incluir company en el state para saber cuál app usar en el callback
    const state = Buffer.from(JSON.stringify({ channelKey, company, ts: Date.now() })).toString('base64url');

    return `https://www.facebook.com/v22.0/dialog/oauth?client_id=${config.appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${permissions}&state=${state}&response_type=code`;
}

/**
 * Intercambia el código de autorización por un token de acceso de usuario.
 * @param {string} code - Código de autorización de OAuth
 * @param {'agro'|'tracto'} company - Empresa para usar las credenciales correctas
 */
async function exchangeCodeForTokens(code, company = 'agro') {
    const config = loadMetaConfig(company);
    const url = `${GRAPH_API_BASE}/oauth/access_token?client_id=${config.appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${config.appSecret}&code=${code}`;

    console.log(`[MetaAPI] Intercambiando código por token (${company})...`);
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
        console.error(`[MetaAPI] ❌ Error en exchange (${company}):`, data.error.message);
        throw new Error(`Meta OAuth Error: ${data.error.message}`);
    }

    console.log(`[MetaAPI] ✅ Token de usuario obtenido (${company}, corta vida).`);
    return data.access_token;
}

/**
 * Extiende un token de corta vida a uno de larga vida (60 días).
 * @param {string} shortToken
 * @param {'agro'|'tracto'} company
 */
async function getLongLivedToken(shortToken, company = 'agro') {
    const config = loadMetaConfig(company);
    const url = `${GRAPH_API_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${config.appId}&client_secret=${config.appSecret}&fb_exchange_token=${shortToken}`;

    console.log(`[MetaAPI] Extendiendo token a larga vida (${company})...`);
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
        console.error(`[MetaAPI] ❌ Error extendiendo token (${company}):`, data.error.message);
        throw new Error(`Error extendiendo token: ${data.error.message}`);
    }

    console.log(`[MetaAPI] ✅ Token de larga vida obtenido (${company}, 60 días).`);
    return data.access_token;
}

/**
 * Descubre las páginas de Facebook y cuentas de Instagram vinculadas.
 * @param {string} userToken - Token de usuario de larga vida
 * @returns {{ pages: Array, igAccounts: Array }}
 */
async function discoverPagesAndInstagram(userToken) {
    console.log('[MetaAPI] Descubriendo páginas de Facebook e Instagram...');
    
    const pagesUrl = `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token,category,instagram_business_account&access_token=${userToken}`;
    const pagesRes = await fetch(pagesUrl);
    const pagesData = await pagesRes.json();

    if (pagesData.error) {
        console.error('[MetaAPI] ❌ Error listando páginas:', pagesData.error.message);
        throw new Error(`Error listando páginas: ${pagesData.error.message}`);
    }

    const pages = [];
    const igAccounts = [];

    for (const page of (pagesData.data || [])) {
        console.log(`[MetaAPI] 📄 Página encontrada: "${page.name}" (ID: ${page.id})`);
        
        pages.push({
            id: page.id,
            name: page.name,
            category: page.category || '',
            accessToken: page.access_token,
            channelKey: null
        });

        if (page.instagram_business_account) {
            const igId = page.instagram_business_account.id;
            try {
                const igUrl = `${GRAPH_API_BASE}/${igId}?fields=id,username,name,profile_picture_url&access_token=${page.access_token}`;
                const igRes = await fetch(igUrl);
                const igData = await igRes.json();

                if (!igData.error) {
                    console.log(`[MetaAPI] 📸 Instagram encontrado: @${igData.username} (ID: ${igId})`);
                    igAccounts.push({
                        igBusinessId: igId,
                        username: igData.username || '',
                        name: igData.name || '',
                        profilePic: igData.profile_picture_url || '',
                        pageId: page.id,
                        pageName: page.name,
                        channelKey: null
                    });
                }
            } catch (e) {
                console.error(`[MetaAPI] Error obteniendo datos de IG ${igId}:`, e.message);
            }
        }
    }

    console.log(`[MetaAPI] ✅ Descubierto: ${pages.length} página(s), ${igAccounts.length} cuenta(s) de Instagram.`);
    return { pages, igAccounts };
}

/**
 * Asigna automáticamente channelKeys a las páginas e IG accounts encontradas
 * según la empresa a la que pertenece el flujo OAuth.
 * @param {Array} pages
 * @param {Array} igAccounts
 * @param {'agro'|'tracto'} company - Empresa que inició el OAuth
 */
function autoAssignChannelKeys(pages, igAccounts, company = 'agro') {
    const igKey = company === 'tracto' ? 'ig_tracto' : 'ig_agro';
    const fbKey = company === 'tracto' ? 'fb_tracto' : 'fb_agro';

    for (const ig of igAccounts) {
        ig.channelKey = igKey;
    }

    for (const page of pages) {
        page.channelKey = fbKey;
    }

    return { pages, igAccounts };
}

// ======================== ENVÍO DE MENSAJES ========================

/**
 * Envía un mensaje por Facebook Messenger
 */
async function sendFacebookMessage(pageAccessToken, recipientId, messageText) {
    const url = `${GRAPH_API_BASE}/me/messages`;
    
    console.log(`[MetaAPI] 📤 Enviando mensaje por FB Messenger a ${recipientId.slice(0, 8)}...`);
    
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${pageAccessToken}`
        },
        body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: messageText },
            messaging_type: 'RESPONSE'
        })
    });

    const data = await res.json();
    if (data.error) {
        console.error('[MetaAPI] ❌ Error enviando mensaje FB:', data.error.message);
        throw new Error(`Error enviando mensaje: ${data.error.message}`);
    }

    console.log('[MetaAPI] ✅ Mensaje FB enviado correctamente.');
    return data;
}

/**
 * Envía un mensaje por Instagram DM (usa la misma API de mensajería con page token)
 */
async function sendInstagramMessage(pageAccessToken, igScopedUserId, messageText) {
    const url = `${GRAPH_API_BASE}/me/messages`;

    console.log(`[MetaAPI] 📤 Enviando DM de Instagram a ${igScopedUserId.slice(0, 8)}...`);

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${pageAccessToken}`
        },
        body: JSON.stringify({
            recipient: { id: igScopedUserId },
            message: { text: messageText },
            messaging_type: 'RESPONSE'
        })
    });

    const data = await res.json();
    if (data.error) {
        console.error('[MetaAPI] ❌ Error enviando DM IG:', data.error.message);
        throw new Error(`Error enviando DM Instagram: ${data.error.message}`);
    }

    console.log('[MetaAPI] ✅ DM Instagram enviado correctamente.');
    return data;
}

// ======================== WEBHOOK PROCESSING ========================

/**
 * Procesa una entrada de webhook de Meta y devuelve mensajes normalizados
 * @param {Object} entry - Un elemento del array body.entry
 */
function processWebhookEntry(entry) {
    const messages = [];
    const events = (entry.messaging || []).concat(entry.standby || []);

    for (const event of events) {
        if (!event.message) continue;

        messages.push({
            platform: 'facebook',
            senderId: event.sender?.id || '',
            recipientId: event.recipient?.id || '',
            text: event.message?.text || '',
            timestamp: event.timestamp || Date.now(),
            messageId: event.message?.mid || `fb_${Date.now()}`,
            isEcho: Boolean(event.message?.is_echo),
            attachments: event.message?.attachments || []
        });
    }

    return messages;
}

/**
 * Procesa el body completo del webhook y devuelve todos los mensajes normalizados
 */
function processWebhookBody(body) {
    const allMessages = [];
    const objectType = body.object;

    if (!body.entry || !Array.isArray(body.entry)) return allMessages;

    for (const entry of body.entry) {
        const entryMessages = processWebhookEntry(entry);

        for (const msg of entryMessages) {
            if (objectType === 'instagram') {
                msg.platform = 'instagram';
            } else {
                msg.platform = 'facebook';
            }
            allMessages.push(msg);
        }
    }

    return allMessages;
}

// ======================== PERFIL DEL REMITENTE ========================

/**
 * Obtiene el perfil del remitente (nombre, foto) desde Meta
 */
async function getSenderProfile(pageToken, senderId, platform) {
    try {
        let url;
        if (platform === 'instagram') {
            url = `${GRAPH_API_BASE}/${senderId}?fields=name,username,profile_pic&access_token=${pageToken}`;
        } else {
            url = `${GRAPH_API_BASE}/${senderId}?fields=first_name,last_name,profile_pic&access_token=${pageToken}`;
        }

        const res = await fetch(url);
        const data = await res.json();

        if (data.error) {
            console.log(`[MetaAPI] No se pudo obtener perfil de ${senderId.slice(0, 8)}:`, data.error.message);
            return { name: `Usuario ${platform}`, profilePic: null };
        }

        if (platform === 'instagram') {
            return {
                name: data.username || data.name || `IG User`,
                profilePic: data.profile_pic || null
            };
        }

        return {
            name: `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'FB User',
            profilePic: data.profile_pic || null
        };
    } catch (e) {
        console.log(`[MetaAPI] Error obteniendo perfil de ${senderId.slice(0, 8)}:`, e.message);
        return { name: `Usuario ${platform}`, profilePic: null };
    }
}

// ======================== SUSCRIPCIÓN DE WEBHOOKS ========================

/**
 * Suscribe una página a los webhooks de mensajería
 */
async function subscribePageToWebhooks(pageId, pageAccessToken) {
    try {
        const url = `${GRAPH_API_BASE}/${pageId}/subscribed_apps`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${pageAccessToken}`
            },
            body: JSON.stringify({
                subscribed_fields: ['messages', 'messaging_postbacks', 'messaging_optins', 'message_echoes', 'message_reactions', 'standby']
            })
        });

        const data = await res.json();
        if (data.success) {
            console.log(`[MetaAPI] ✅ Página ${pageId} suscrita a webhooks de mensajería.`);
        } else {
            console.error(`[MetaAPI] ❌ Error suscribiendo página ${pageId}:`, JSON.stringify(data));
        }
        return data;
    } catch (e) {
        console.error(`[MetaAPI] Error en suscripción de webhook para ${pageId}:`, e.message);
        return { success: false, error: e.message };
    }
}

// ======================== CONVERSACIONES META ========================

/**
 * Carga las conversaciones de Meta (Instagram + Facebook) desde disco
 */
function loadMetaConversations() {
    try {
        if (fs.existsSync(PATHS.META_CONVERSATIONS_FILE)) {
            const data = JSON.parse(fs.readFileSync(PATHS.META_CONVERSATIONS_FILE, 'utf8'));
            if (!data.chats) data.chats = {};
            if (!data.deletedChats) data.deletedChats = {};
            return data;
        }
    } catch (e) {
        console.error('[MetaAPI] Error cargando metaConversations.json:', e.message);
    }
    return { chats: {}, deletedChats: {} };
}

/**
 * Guarda las conversaciones de Meta
 */
function saveMetaConversations(data) {
    try {
        fs.writeFileSync(PATHS.META_CONVERSATIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('[MetaAPI] Error guardando metaConversations.json:', e.message);
    }
}

/**
 * Obtiene o crea una conversación para un remitente de Meta
 */
function getOrCreateMetaConversation(senderId, platform, channelKey, senderName) {
    const store = loadMetaConversations();
    const chatId = `${platform === 'instagram' ? 'ig' : 'fb'}:${senderId}`;

    if (!store.chats[chatId]) {
        const company = channelKey?.includes('agro') ? 'Agropower' : 'Tractopower';
        const initials = (senderName || 'U').replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'MT';

        store.chats[chatId] = {
            id: chatId,
            name: senderName || `Usuario ${platform}`,
            initials,
            platform,
            channelKey: channelKey || (platform === 'instagram' ? 'ig_agro' : 'fb_agro'),
            channel: channelKey || (platform === 'instagram' ? 'ig_agro' : 'fb_agro'),
            company,
            senderId,
            profilePic: null,
            messages: [],
            time: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            botActive: false,
            waitingAdvisor: false,
            saleClosed: false
        };
        saveMetaConversations(store);
        console.log(`[MetaAPI] 🆕 Nueva conversación ${platform}: ${chatId} (${senderName || 'Desconocido'})`);
    } else {
        // Si la conversación tenía un nombre genérico ("Usuario instagram") y ahora tenemos un nombre real, actualizarlo
        if (senderName && !senderName.startsWith('Usuario ') && store.chats[chatId].name.startsWith('Usuario ')) {
            store.chats[chatId].name = senderName;
            store.chats[chatId].initials = senderName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'MT';
            saveMetaConversations(store);
        }
    }

    return { store, chatId, conversation: store.chats[chatId] };
}

/**
 * Agrega un mensaje a una conversación de Meta
 */
function addMessageToMetaConversation(chatId, message) {
    const store = loadMetaConversations();
    if (!store.chats[chatId]) return null;

    // Protección anti-duplicados por messageId
    if (message.messageId && store.chats[chatId].messages && store.chats[chatId].messages.some(m => m.messageId === message.messageId)) {
        return store.chats[chatId];
    }

    const now = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (message.sender === 'operator') {
        store.chats[chatId].waitingAdvisor = false;
        store.chats[chatId].botActive = false;
    }
    store.chats[chatId].messages.push({
        sender: message.sender || 'client',
        text: message.text || '',
        time: message.time || now,
        platform: message.platform || 'unknown',
        messageId: message.messageId || `msg_${Date.now()}`,
        operatorName: message.operatorName || (message.sender === 'operator' ? 'Asesor' : undefined)
    });
    store.chats[chatId].time = now;

    saveMetaConversations(store);
    return store.chats[chatId];
}

/**
 * Convierte las conversaciones de Meta al formato que espera el frontend
 */
function getMetaConversationsAsArray() {
    const store = loadMetaConversations();
    return Object.values(store.chats || {}).map(chat => ({
        ...chat,
        id: chat.id,
        jid: null,
        phone: null,
        formattedPhone: null
    }));
}

/**
 * Elimina una conversación de Meta del almacén persistente y la registra para evitar
 * que el sincronizador periódico la reimporte automáticamente salvo que el cliente escriba de nuevo.
 */
function deleteMetaConversation(chatId) {
    const store = loadMetaConversations();
    if (!store.deletedChats) store.deletedChats = {};
    if (store.chats && store.chats[chatId]) {
        const removed = store.chats[chatId];
        delete store.chats[chatId];
        store.deletedChats[chatId] = {
            deletedAt: new Date().toISOString(),
            name: removed.name || chatId
        };
        saveMetaConversations(store);
        return removed;
    }
    return null;
}

// ======================== SINCRONIZACIÓN ACTIVA INSTAGRAM ========================

/**
 * Sincroniza conversaciones recientes de Instagram consultando activamente la Graph API de Meta.
 * Recupera mensajes nuevos de clientes o de operadores desde la app móvil oficial de Instagram.
 * @param {Object} [io] - Instancia de Socket.io para emisión en tiempo real
 * @returns {Promise<{ synced: number, newMessages: number, updatedChats: string[] }>}
 */
async function syncInstagramRecentConversations(io) {
    const store = loadMetaConversations();
    if (!store.chats) store.chats = {};
    if (!store.deletedChats) store.deletedChats = {};

    let totalSynced = 0;
    let newMessagesCount = 0;
    const updatedChatIds = [];
    let hasChanges = false;

    for (const company of ['agro', 'tracto']) {
        const tokens = loadMetaTokens(company);
        const userToken = tokens.userToken;
        const pageToken = tokens.pages?.[0]?.accessToken || userToken;

        if (!pageToken || !tokens.igAccounts || tokens.igAccounts.length === 0) {
            continue;
        }

        for (const ig of tokens.igAccounts) {
            const igBusinessId = ig.id || ig.igBusinessId;
            if (!igBusinessId) continue;

            const channelKey = ig.channelKey || (company === 'tracto' ? 'ig_tracto' : 'ig_agro');
            const companyName = company === 'tracto' ? 'Tractopower' : 'Agropower';

            try {
                // Consultar los 20 hilos más recientes
                const url = `${GRAPH_API_BASE}/${igBusinessId}/conversations?fields=id,updated_time,participants,messages.limit(15){id,message,created_time,from}&limit=20&access_token=${pageToken}`;
                const res = await fetch(url);
                const data = await res.json();

                if (data.error) {
                    console.warn(`[MetaSync] Error consultando IG ${igBusinessId} (${company}):`, data.error.message);
                    continue;
                }

                const threads = data.data || [];
                totalSynced += threads.length;

                for (const thread of threads) {
                    const participant = thread.participants?.data?.find(p => p.id !== igBusinessId) || thread.participants?.data?.[0];
                    if (!participant || !participant.id) continue;

                    const customerId = participant.id;
                    const chatId = `ig:${customerId}`;

                    // Protección contra re-importación de chats borrados manualmente
                    if (store.deletedChats[chatId]) {
                        const threadUpdatedMs = new Date(thread.updated_time || 0).getTime();
                        const deletedMs = new Date(store.deletedChats[chatId].deletedAt || 0).getTime();
                        if (threadUpdatedMs <= deletedMs) {
                            continue;
                        }
                        // Actividad nueva posterior al borrado: reactivar chat
                        delete store.deletedChats[chatId];
                    }

                    const customerName = participant.username || participant.name || 'Usuario Instagram';
                    const initials = customerName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'IG';

                    if (!store.chats[chatId]) {
                        store.chats[chatId] = {
                            id: chatId,
                            name: customerName,
                            initials,
                            platform: 'instagram',
                            channelKey,
                            channel: channelKey,
                            company: companyName,
                            senderId: customerId,
                            profilePic: null,
                            messages: [],
                            time: '',
                            botActive: false,
                            waitingAdvisor: false,
                            saleClosed: false
                        };
                        hasChanges = true;
                        updatedChatIds.push(chatId);
                    } else if (store.chats[chatId].name.startsWith('Usuario ') && !customerName.startsWith('Usuario ')) {
                        store.chats[chatId].name = customerName;
                        store.chats[chatId].initials = initials;
                        hasChanges = true;
                    }

                    const convRef = store.chats[chatId];
                    if (!convRef.messages) convRef.messages = [];

                    const remoteMsgs = (thread.messages?.data || []).slice().reverse();
                    let threadNewMsgs = 0;

                    for (const rm of remoteMsgs) {
                        const exists = convRef.messages.some(m => m.messageId === rm.id);
                        if (!exists) {
                            const isOperator = rm.from?.id === igBusinessId;
                            const msgTime = new Date(rm.created_time).toLocaleString('es-VE', {
                                timeZone: 'America/Caracas',
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            });

                            const newMsgObj = {
                                sender: isOperator ? 'operator' : 'client',
                                text: rm.message || '',
                                time: msgTime,
                                platform: 'instagram',
                                messageId: rm.id,
                                operatorName: isOperator ? 'Móvil / Instagram App' : undefined
                            };

                            convRef.messages.push(newMsgObj);
                            threadNewMsgs++;
                            newMessagesCount++;
                            hasChanges = true;

                            if (io) {
                                io.emit('meta_message_received', {
                                    conversation: convRef,
                                    message: newMsgObj,
                                    platform: 'instagram',
                                    channelKey
                                });
                            }
                        }
                    }

                    if (remoteMsgs.length > 0) {
                        const lastRemote = remoteMsgs[remoteMsgs.length - 1];
                        const lastTime = new Date(lastRemote.created_time).toLocaleString('es-VE', {
                            timeZone: 'America/Caracas',
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        if (convRef.time !== lastTime) {
                            convRef.time = lastTime;
                            hasChanges = true;
                        }
                    }

                    if (threadNewMsgs > 0 && !updatedChatIds.includes(chatId)) {
                        updatedChatIds.push(chatId);
                    }
                }
            } catch (err) {
                console.error(`[MetaSync] Error sincronizando Instagram ${igBusinessId}:`, err.message);
            }
        }
    }

    if (hasChanges) {
        saveMetaConversations(store);
        if (io) {
            const allMetaConvs = getMetaConversationsAsArray();
            io.emit('meta_conversations_updated', allMetaConvs);
            try {
                const { getConversations } = require('./storageService');
                const waConvs = getConversations();
                io.emit('conversations_updated', [...waConvs, ...allMetaConvs]);
            } catch (e) {}
        }
        console.log(`[MetaSync] 🔄 Sincronización completada: ${updatedChatIds.length} chats actualizados, ${newMessagesCount} nuevos mensajes.`);
    }

    return {
        synced: totalSynced,
        newMessages: newMessagesCount,
        updatedChats: updatedChatIds
    };
}

let syncIntervalHandle = null;

/**
 * Inicia el cronómetro de sincronización automática periódica para Instagram
 * @param {Object} io - Socket.io
 * @param {number} [intervalMs=45000] - Intervalo en milisegundos (por defecto 45 segundos)
 */
function startInstagramAutoSync(io, intervalMs = 45000) {
    if (syncIntervalHandle) return;
    console.log(`[MetaSync] 🕒 Sincronizador automático de Instagram activo (cada ${Math.round(intervalMs / 1000)}s)`);

    setTimeout(() => {
        syncInstagramRecentConversations(io).catch(e => {
            console.warn('[MetaSync] Error en primera sincronización:', e.message);
        });
    }, 5000);

    syncIntervalHandle = setInterval(() => {
        syncInstagramRecentConversations(io).catch(e => {
            console.warn('[MetaSync] Error en sincronización periódica:', e.message);
        });
    }, intervalMs);
}

module.exports = {
    // Utilidades de empresa
    companyFromChannelKey,
    // Configuración
    loadMetaConfig,
    saveMetaConfig,
    getVerifyToken,
    resolveCompanyFromVerifyToken,
    // Tokens
    loadMetaTokens,
    saveMetaTokens,
    getPageToken,
    getInstagramToken,
    getTokenForChannel,
    resolveChannelKeyFromRecipient,
    // OAuth
    getOAuthUrl,
    exchangeCodeForTokens,
    getLongLivedToken,
    discoverPagesAndInstagram,
    autoAssignChannelKeys,
    // Mensajes
    sendFacebookMessage,
    sendInstagramMessage,
    // Webhook
    processWebhookEntry,
    processWebhookBody,
    // Perfiles
    getSenderProfile,
    // Suscripción
    subscribePageToWebhooks,
    // Conversaciones
    loadMetaConversations,
    saveMetaConversations,
    getOrCreateMetaConversation,
    addMessageToMetaConversation,
    getMetaConversationsAsArray,
    deleteMetaConversation,
    // Sincronización Automática
    syncInstagramRecentConversations,
    startInstagramAutoSync
};
