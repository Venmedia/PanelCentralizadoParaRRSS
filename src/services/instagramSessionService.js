/**
 * @file instagramSessionService.js
 * @description Servicio de conexión directa con Instagram vía sesión móvil (instagram-private-api).
 * Permite leer la bandeja de entrada completa (direct inbox), sincronizar conversaciones históricas
 * y enviar mensajes directamente a los hilos de Direct sin depender de permisos de Meta App Review.
 */

const fs = require('fs');
const path = require('path');
const { IgApiClient, IgLoginTwoFactorRequiredError, IgCheckpointError } = require('instagram-private-api');
const { PATHS } = require('../config/constants');
const { loadMetaConversations, saveMetaConversations, getMetaConversationsAsArray } = require('./metaApiService');

const SESSION_FILE = path.join(PATHS.ROOT_DIR || '/opt/omnipanel-consorcio', 'data', 'ig_session_agro.json');
const CONFIG_FILE = path.join(PATHS.ROOT_DIR || '/opt/omnipanel-consorcio', 'data', 'ig_credentials_agro.json');

let ig = null;
let currentSocketIo = null;
let syncInterval = null;
let isSyncing = false;

/**
 * Inicializa la instancia del cliente Instagram
 */
function getClient(username = 'agropower_venezuela') {
    if (!ig) {
        ig = new IgApiClient();
        ig.state.generateDevice(username);
    }
    return ig;
}

/**
 * Guarda la sesión serializada en disco
 */
async function saveSession() {
    try {
        if (!ig) return;
        const serialized = await ig.state.serialize();
        delete serialized.constants;
        const dir = path.dirname(SESSION_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SESSION_FILE, JSON.stringify(serialized, null, 2), 'utf8');
        console.log('[IG-Session] 💾 Sesión guardada en disco.');
    } catch (e) {
        console.error('[IG-Session] Error guardando sesión:', e.message);
    }
}

/**
 * Intenta restaurar la sesión desde el archivo
 */
async function loadSession(username = 'agropower_venezuela') {
    try {
        if (!fs.existsSync(SESSION_FILE)) return false;
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
        const client = getClient(username);
        await client.state.deserialize(data);
        console.log('[IG-Session] 🔄 Sesión restaurada desde disco.');
        return true;
    } catch (e) {
        console.warn('[IG-Session] No se pudo restaurar la sesión previa:', e.message);
        return false;
    }
}

/**
 * Formatea un timestamp a hora de Caracas (America/Caracas, UTC-4)
 */
function formatCaracasTime(timestampMs) {
    try {
        const d = new Date(timestampMs);
        return d.toLocaleString('es-VE', {
            timeZone: 'America/Caracas',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch (e) {
        return new Date(timestampMs).toISOString();
    }
}

/**
 * Inicia sesión en Instagram con manejo de 2FA y checkpoints
 */
async function login(username, password, twoFactorCode = null) {
    const client = getClient(username);

    // Intentar restaurar sesión guardada primero
    const restored = await loadSession(username);
    if (restored) {
        try {
            // Validar si la sesión sigue activa
            const user = await client.user.info(client.state.cookieUserId);
            console.log(`[IG-Session] ✅ Sesión activa validada para @${user.username} (${user.full_name})`);
            startAutoSync();
            return { success: true, status: 'active', user };
        } catch (err) {
            console.log('[IG-Session] ⚠️ Sesión guardada expiró o inválida, se requiere re-login.');
        }
    }

    if (!password) {
        return { success: false, status: 'missing_password', error: 'Se requiere la contraseña de Instagram' };
    }

    try {
        console.log(`[IG-Session] 🔐 Iniciando sesión para @${username}...`);
        await client.simulate.preLoginFlow();
        const user = await client.account.login(username, password);
        console.log(`[IG-Session] ✅ Login exitoso para @${user.username}!`);
        await saveSession();
        startAutoSync();
        return { success: true, status: 'logged_in', user };
    } catch (err) {
        if (err instanceof IgLoginTwoFactorRequiredError) {
            console.log('[IG-Session] 📱 Se requiere código 2FA (SMS o Authenticator App)');
            if (twoFactorCode) {
                try {
                    const twoFactorIdentifier = err.response.body.two_factor_info.two_factor_identifier;
                    const res = await client.account.twoFactorLogin({
                        username,
                        verificationCode: twoFactorCode,
                        twoFactorIdentifier,
                        verificationMethod: '1' // 1: SMS / app
                    });
                    console.log(`[IG-Session] ✅ 2FA exitoso para @${res.username}!`);
                    await saveSession();
                    startAutoSync();
                    return { success: true, status: 'logged_in', user: res };
                } catch (twoFactorErr) {
                    return { success: false, status: 'invalid_2fa', error: twoFactorErr.message };
                }
            }
            return {
                success: false,
                status: '2fa_required',
                twoFactorInfo: err.response.body.two_factor_info,
                message: 'Se requiere código de verificación 2FA'
            };
        } else if (err instanceof IgCheckpointError) {
            console.log('[IG-Session] 🛑 Instagram solicitó Checkpoint (Challenge). Iniciando resolución...');
            await client.challenge.auto(true);
            return {
                success: false,
                status: 'checkpoint_required',
                message: 'Instagram solicitó verificar la cuenta. Revisa la app de Instagram en tu móvil y pulsa "Fui yo" o introduce el código enviado por SMS/email.'
            };
        }

        console.error('[IG-Session] ❌ Error en login:', err.message);
        return { success: false, status: 'error', error: err.message };
    }
}

/**
 * Sincroniza los hilos de Direct y actualiza el almacén de OmniPanel
 */
async function syncDirectInbox(maxPages = 3) {
    if (isSyncing) {
        console.log('[IG-Session] ⏳ Sincronización ya en curso, omitiendo ejecución simultánea.');
        return { success: true, skipped: true };
    }

    const client = getClient();
    if (!client.state.cookieUserId) {
        const restored = await loadSession();
        if (!restored) {
            return { success: false, error: 'No hay sesión de Instagram activa' };
        }
    }

    isSyncing = true;
    console.log('[IG-Session] 📥 Iniciando sincronización de bandeja de entrada Direct...');

    try {
        const myUserId = client.state.cookieUserId;
        const inboxFeed = client.feed.directInbox();
        const store = loadMetaConversations();
        let totalThreads = 0;
        let newOrUpdatedThreads = 0;
        let pageCount = 0;

        do {
            const threads = await inboxFeed.items();
            totalThreads += threads.length;
            pageCount++;

            for (const thread of threads) {
                const threadId = thread.thread_id;
                const otherUsers = (thread.users || []).filter(u => String(u.pk) !== String(myUserId));
                const contactUser = otherUsers[0] || (thread.users && thread.users[0]) || {};
                const contactName = thread.thread_title || contactUser.full_name || contactUser.username || 'Cliente Instagram';
                const senderId = contactUser.pk ? String(contactUser.pk) : threadId;

                const chatId = `ig:${senderId}`;

                if (!store.chats[chatId]) {
                    store.chats[chatId] = {
                        id: chatId,
                        name: contactName,
                        initials: contactName.substring(0, 2).toUpperCase(),
                        platform: 'instagram',
                        channelKey: 'ig_agro',
                        channel: 'ig_agro',
                        company: 'Agropower',
                        senderId: senderId,
                        threadId: threadId,
                        profilePic: contactUser.profile_pic_url || null,
                        messages: []
                    };
                } else {
                    store.chats[chatId].threadId = threadId;
                    if (contactUser.profile_pic_url) store.chats[chatId].profilePic = contactUser.profile_pic_url;
                    if (contactName && store.chats[chatId].name !== contactName) store.chats[chatId].name = contactName;
                }

                const currentChat = store.chats[chatId];
                const existingMsgIds = new Set((currentChat.messages || []).map(m => m.messageId));

                // thread.items viene del más nuevo al más viejo
                const rawItems = Array.isArray(thread.items) ? [...thread.items].reverse() : [];

                let addedCount = 0;
                for (const item of rawItems) {
                    const msgId = item.item_id || `${threadId}_${item.timestamp}`;
                    if (existingMsgIds.has(msgId)) continue;

                    let text = '';
                    if (item.text) {
                        text = item.text;
                    } else if (item.item_type === 'media' || item.media) {
                        text = '[Foto / Video]';
                    } else if (item.item_type === 'voice_media') {
                        text = '[Mensaje de voz]';
                    } else if (item.item_type === 'animated_media' || item.item_type === 'raven_media') {
                        text = '[Multimedia / Sticker]';
                    } else if (item.item_type === 'link') {
                        text = item.link?.text || '[Enlace]';
                    } else {
                        text = `[${item.item_type || 'Mensaje'}]`;
                    }

                    // Timestamp en microsegundos o milisegundos
                    let tsMs = Number(item.timestamp);
                    if (tsMs < 1000000000000) {
                        tsMs = tsMs * 1000;
                    } else if (tsMs > 1000000000000000) {
                        tsMs = Math.floor(tsMs / 1000);
                    }

                    const isFromMe = String(item.user_id) === String(myUserId);

                    currentChat.messages.push({
                        sender: isFromMe ? 'operator' : 'client',
                        text: text,
                        time: formatCaracasTime(tsMs),
                        platform: 'instagram',
                        messageId: msgId,
                        timestamp: tsMs
                    });
                    existingMsgIds.add(msgId);
                    addedCount++;
                }

                if (addedCount > 0) {
                    // Ordenar cronológicamente dentro de la conversación
                    currentChat.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                    const last = currentChat.messages[currentChat.messages.length - 1];
                    currentChat.time = last.time;
                    currentChat.timestamp = last.timestamp;
                    newOrUpdatedThreads++;
                }
            }

            // Si hay más páginas y no hemos superado el límite
            if (!inboxFeed.isMoreAvailable() || pageCount >= maxPages) {
                break;
            }
        } while (inboxFeed.isMoreAvailable());

        saveMetaConversations(store);

        // Notificar al frontend vía Socket.IO
        if (currentSocketIo) {
            const allMetaConvs = getMetaConversationsAsArray();
            currentSocketIo.emit('meta_conversations_updated', allMetaConvs);
            try {
                const { getConversations } = require('./storageService');
                const waConvs = getConversations();
                currentSocketIo.emit('conversations_updated', [...waConvs, ...allMetaConvs]);
            } catch (e) {}
        }

        console.log(`[IG-Session] 🔄 Sincronización finalizada: ${totalThreads} hilos escaneados, ${newOrUpdatedThreads} hilos con mensajes actualizados.`);
        return { success: true, totalThreads, newOrUpdatedThreads };
    } catch (e) {
        console.error('[IG-Session] Error durante sincronización:', e.message);
        return { success: false, error: e.message };
    } finally {
        isSyncing = false;
    }
}

/**
 * Envía un mensaje a un hilo o usuario de Instagram
 */
async function sendMessage(targetId, text) {
    const client = getClient();
    if (!client.state.cookieUserId) {
        const restored = await loadSession();
        if (!restored) throw new Error('No hay sesión de Instagram activa');
    }

    const store = loadMetaConversations();
    let threadId = targetId;

    // Si viene como chatId 'ig:12345', buscar si tenemos el threadId mapeado
    if (String(targetId).startsWith('ig:')) {
        const chat = store.chats[targetId];
        if (chat && chat.threadId) {
            threadId = chat.threadId;
        } else {
            // Intentar buscar por userId
            const cleanId = targetId.replace('ig:', '');
            threadId = cleanId;
        }
    }

    console.log(`[IG-Session] 📤 Enviando DM a ${threadId}: "${text.slice(0, 30)}..."`);

    let res;
    try {
        // Intentar broadcastText directamente al threadId
        const threadEntity = client.entity.directThread(threadId);
        res = await threadEntity.broadcastText(text);
    } catch (err) {
        // Si falló, intentar por recipient users array
        const threadEntity = client.entity.directThread([threadId]);
        res = await threadEntity.broadcastText(text);
    }

    // Registrar en almacén local
    const now = Date.now();
    const caracasTime = formatCaracasTime(now);
    const chatId = String(targetId).startsWith('ig:') ? targetId : `ig:${targetId}`;

    if (store.chats[chatId]) {
        store.chats[chatId].messages.push({
            sender: 'operator',
            text: text,
            time: caracasTime,
            platform: 'instagram',
            messageId: res.item_id || `sent_${now}`,
            timestamp: now
        });
        store.chats[chatId].time = caracasTime;
        store.chats[chatId].timestamp = now;
        saveMetaConversations(store);

        if (currentSocketIo) {
            const allMetaConvs = getMetaConversationsAsArray();
            currentSocketIo.emit('meta_conversations_updated', allMetaConvs);
        }
    }

    return { success: true, itemId: res.item_id };
}

/**
 * Inicia ciclo de sincronización automática periódica (cada 30s)
 */
function startAutoSync(intervalMs = 30000) {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
        syncDirectInbox(2).catch(e => {
            console.error('[IG-Session] Error en auto-sync periódico:', e.message);
        });
    }, intervalMs);
    console.log(`[IG-Session] ⏱️ Auto-sync periódico activado (cada ${intervalMs / 1000}s).`);
}

/**
 * Permite inyectar Socket.IO para notificaciones en vivo
 */
function setSocketIo(io) {
    currentSocketIo = io;
}

module.exports = {
    login,
    loadSession,
    syncDirectInbox,
    sendMessage,
    startAutoSync,
    setSocketIo,
    formatCaracasTime
};
