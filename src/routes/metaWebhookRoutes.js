/**
 * @file metaWebhookRoutes.js
 * @description Endpoints de Webhook de Meta para recibir mensajes en tiempo real
 * de Facebook Messenger e Instagram DMs. Meta envía POST requests a estos endpoints
 * cada vez que llega un mensaje nuevo.
 */

const express = require('express');
const {
    getVerifyToken,
    processWebhookBody,
    resolveChannelKeyFromRecipient,
    getTokenForChannel,
    getSenderProfile,
    getOrCreateMetaConversation,
    addMessageToMetaConversation,
    getMetaConversationsAsArray,
    syncInstagramRecentConversations
} = require('../services/metaApiService');

module.exports = function createMetaWebhookRoutes(io) {
    const router = express.Router();

    /**
     * GET /api/meta/webhook - Verificación del Webhook por parte de Meta
     * Meta envía una petición GET con hub.mode, hub.verify_token y hub.challenge
     * Si el verify_token coincide, devolvemos hub.challenge para confirmar propiedad
     */
    router.get('/webhook', (req, res) => {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        console.log(`[MetaWebhook] 🔍 Verificación recibida: mode=${mode}, token=${token ? '[PRESENT]' : '[MISSING]'}`);

        if (mode === 'subscribe' && token === getVerifyToken()) {
            console.log('[MetaWebhook] ✅ Webhook verificado correctamente por Meta.');
            return res.status(200).send(challenge);
        }

        console.log('[MetaWebhook] ❌ Verificación fallida. Token no coincide.');
        return res.status(403).json({ error: 'Verificación fallida. Token inválido.' });
    });

    /**
     * POST /api/meta/webhook - Recepción de mensajes entrantes de Meta
     * Procesa mensajes de Facebook Messenger e Instagram DMs
     * SIEMPRE retorna 200 (requisito de Meta para no reintentar)
     */
    router.post('/webhook', async (req, res) => {
        // Meta requiere respuesta 200 inmediata
        res.status(200).json({ status: 'EVENT_RECEIVED' });

        try {
            const body = req.body;
            if (!body || !body.object) return;

            console.log(`[MetaWebhook] 📨 Evento recibido: object=${body.object}, entries=${body.entry?.length || 0}`);

            const messages = processWebhookBody(body);

            for (const msg of messages) {
                // Procesar ecos (mensajes enviados por el operador desde el móvil o desde el panel)
                if (msg.isEcho) {
                    console.log(`[MetaWebhook] ↩️ Echo recibido (${msg.platform}): ${msg.messageId}`);

                    // En un echo, el remitente (msg.senderId) es la empresa (Page o IG Business)
                    // y el destinatario (msg.recipientId) es el cliente
                    const customerId = msg.recipientId;
                    const companyAccountId = msg.senderId;
                    const channelKey = resolveChannelKeyFromRecipient(companyAccountId, msg.platform);
                    const chatId = `${msg.platform === 'instagram' ? 'ig' : 'fb'}:${customerId}`;

                    // Obtener o crear conversación con el cliente
                    const { conversation } = getOrCreateMetaConversation(
                        customerId,
                        msg.platform,
                        channelKey,
                        `Usuario ${msg.platform}`
                    );

                    // Si el mensaje ya existe (por ejemplo, enviado desde el panel web), no duplicarlo
                    const alreadyExists = conversation.messages && conversation.messages.some(m => m.messageId === msg.messageId);
                    if (alreadyExists) {
                        console.log(`[MetaWebhook] ℹ️ Echo ya existente en el panel (${msg.messageId}). Omitiendo duplicado.`);
                        continue;
                    }

                    // Construir texto del mensaje
                    let messageText = msg.text || '';
                    if (msg.attachments && msg.attachments.length > 0) {
                        const attachInfo = msg.attachments.map(a => `[${a.type}: ${a.payload?.url || 'archivo'}]`).join(' ');
                        messageText = messageText ? `${messageText} ${attachInfo}` : attachInfo;
                    }

                    // Agregar mensaje como enviado por el operador (móvil)
                    const updatedConv = addMessageToMetaConversation(chatId, {
                        sender: 'operator',
                        text: messageText,
                        platform: msg.platform,
                        messageId: msg.messageId,
                        operatorName: 'Móvil / Instagram App'
                    });

                    // Emitir al frontend en tiempo real vía Socket.io
                    if (io && updatedConv) {
                        io.emit('meta_message_received', {
                            conversation: updatedConv,
                            message: {
                                sender: 'operator',
                                text: messageText,
                                platform: msg.platform,
                                messageId: msg.messageId,
                                operatorName: 'Móvil / Instagram App'
                            },
                            platform: msg.platform,
                            channelKey
                        });

                        const allMetaConvs = getMetaConversationsAsArray();
                        io.emit('meta_conversations_updated', allMetaConvs);
                    }

                    console.log(`[MetaWebhook] 📱 Sincronizado mensaje desde el móvil en conversación: ${chatId}`);
                    continue;
                }

                // Ignorar mensajes sin texto (attachments puros por ahora)
                if (!msg.text && (!msg.attachments || msg.attachments.length === 0)) continue;

                const channelKey = resolveChannelKeyFromRecipient(msg.recipientId, msg.platform);
                console.log(`[MetaWebhook] 📩 Mensaje ${msg.platform} de ${msg.senderId.slice(0, 8)}... → canal: ${channelKey || 'desconocido'}`);

                // Obtener perfil del remitente
                let senderName = `Usuario ${msg.platform}`;
                const pageToken = getTokenForChannel(channelKey);
                if (pageToken) {
                    try {
                        const profile = await getSenderProfile(pageToken, msg.senderId, msg.platform);
                        senderName = profile.username || profile.name || senderName;
                    } catch (e) {
                        // Continuar sin perfil
                    }
                }

                // Crear o actualizar conversación
                const { chatId, conversation } = getOrCreateMetaConversation(
                    msg.senderId,
                    msg.platform,
                    channelKey,
                    senderName
                );

                // Construir texto del mensaje (incluir info de attachments si hay)
                let messageText = msg.text || '';
                if (msg.attachments && msg.attachments.length > 0) {
                    const attachInfo = msg.attachments.map(a => `[${a.type}: ${a.payload?.url || 'archivo'}]`).join(' ');
                    messageText = messageText ? `${messageText} ${attachInfo}` : attachInfo;
                }

                // Agregar mensaje a la conversación
                const updatedConv = addMessageToMetaConversation(chatId, {
                    sender: 'client',
                    text: messageText,
                    platform: msg.platform,
                    messageId: msg.messageId
                });

                // Emitir al frontend vía Socket.io
                if (io && updatedConv) {
                    io.emit('meta_message_received', {
                        conversation: updatedConv,
                        message: {
                            sender: 'client',
                            text: messageText,
                            platform: msg.platform,
                            messageId: msg.messageId,
                            senderName: updatedConv.name || senderName
                        },
                        platform: msg.platform,
                        channelKey
                    });

                    // También emitir actualización general de conversaciones (para compatibilidad)
                    const allMetaConvs = getMetaConversationsAsArray();
                    io.emit('meta_conversations_updated', allMetaConvs);
                }

                console.log(`[MetaWebhook] ✅ Mensaje procesado y emitido: ${chatId} (${senderName})`);
            }
        } catch (e) {
            console.error('[MetaWebhook] ❌ Error procesando evento:', e.message);
        }
    });

    /**
     * GET /api/meta/conversations - Obtiene todas las conversaciones de Meta como array
     * (compatible con el formato del frontend)
     */
    router.get('/conversations', (req, res) => {
        try {
            const convs = getMetaConversationsAsArray();
            res.json(convs);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * POST /api/meta/sync - Sincroniza activamente conversaciones e historial reciente de Instagram
     */
    router.post('/sync', async (req, res) => {
        try {
            console.log('[MetaWebhook] 🔄 Solicitud de sincronización activa de Instagram...');
            const result = await syncInstagramRecentConversations(io);
            res.json({ success: true, ...result });
        } catch (e) {
            console.error('[MetaWebhook] ❌ Error en sincronización activa:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * GET /api/meta/sync - Alias GET para sincronización rápida
     */
    router.get('/sync', async (req, res) => {
        try {
            const result = await syncInstagramRecentConversations(io);
            res.json({ success: true, ...result });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};
