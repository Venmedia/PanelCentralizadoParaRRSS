/**
 * @file channelAuthRoutes.js
 * @description Endpoints REST para Iniciar Sesión en cada Red Social (Instagram, TikTok, Facebook Messenger)
 * y WhatsApp (Baileys + Evolution API), guardando las contraseñas, el token generado y la partición aislada
 * estilo Ferdium (`persist:<channelKey>`) en la bóveda cifrada del panel.
 * 
 * v3.0: Incluye flujo OAuth de Meta Graph API para Instagram DMs y Facebook Messenger,
 * envío de mensajes via Meta API, y panel de configuración de Meta App.
 */

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const {
    FERDIUM_RECIPES,
    getPublicChannelsState,
    loginSocialChannel,
    linkQrChannel,
    connectWhatsAppChannel,
    toggleChannelHibernation,
    disconnectChannel
} = require('../services/channelVaultService');
const {
    requestTikTokQr,
    sendTikTokMessage,
    getTikTokSessionStatus
} = require('../services/tiktokBridgeService');
const {
    loadMetaConfig,
    saveMetaConfig,
    getOAuthUrl,
    exchangeCodeForTokens,
    getLongLivedToken,
    discoverPagesAndInstagram,
    autoAssignChannelKeys,
    loadMetaTokens,
    saveMetaTokens,
    subscribePageToWebhooks,
    sendFacebookMessage,
    sendInstagramMessage,
    getTokenForChannel,
    addMessageToMetaConversation,
    getMetaConversationsAsArray,
    companyFromChannelKey,
    syncInstagramRecentConversations
} = require('../services/metaApiService');

module.exports = function createChannelAuthRoutes(io, whatsappService) {
    const router = express.Router();

    // ==================== ENDPOINTS EXISTENTES (v2.6) ====================

    // 1. Obtener estado de sesiones y particiones Ferdium de los 8 canales (sin exponer contraseñas ni tokens en texto plano)
    router.get('/auth-state', requireAuth, (req, res) => {
        try {
            const waStatus = whatsappService ? whatsappService.getStatus() : null;
            res.json(getPublicChannelsState(waStatus));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/status', requireAuth, (req, res) => {
        try {
            const waStatus = whatsappService ? whatsappService.getStatus() : null;
            res.json(getPublicChannelsState(waStatus));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/recipes', requireAuth, (req, res) => {
        res.json({ recipes: FERDIUM_RECIPES });
    });

    // 2. Iniciar sesión en una red social (Instagram, TikTok, Facebook) y guardar usuario, clave y token en bóveda + partición Ferdium
    router.post('/connect-oauth', requireAuth, requireAdmin, (req, res) => {
        try {
            const { channelKey, username, password } = req.body || {};
            if (!channelKey) {
                return res.status(400).json({ error: 'Falta el identificador del canal (channelKey).' });
            }

            const sanitizedChannel = loginSocialChannel(channelKey, {
                username,
                password,
                clientIp: req.ip,
                userAgent: req.headers['user-agent']
            });

            const waStatus = whatsappService ? whatsappService.getStatus() : null;
            const fullState = getPublicChannelsState(waStatus);
            if (io) {
                io.emit('channels_auth_updated', fullState);
            }

            res.json({
                success: true,
                message: `Sesión iniciada con "${sanitizedChannel.loggedAccount}" (${sanitizedChannel.partition}). Token y credenciales guardados en la bóveda segura.`,
                channel: sanitizedChannel
            });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // 2b. Vincular canal mediante Código QR oficial (Método A - TikTok / Webview)
    router.post('/connect-qr', requireAuth, requireAdmin, (req, res) => {
        try {
            const { channelKey, accountHandle } = req.body || {};
            if (!channelKey) {
                return res.status(400).json({ error: 'Falta el identificador del canal (channelKey).' });
            }

            const sanitizedChannel = linkQrChannel(channelKey, {
                accountHandle,
                clientIp: req.ip,
                userAgent: req.headers['user-agent']
            });

            const waStatus = whatsappService ? whatsappService.getStatus() : null;
            const fullState = getPublicChannelsState(waStatus);
            if (io) {
                io.emit('channels_auth_updated', fullState);
            }

            res.json({
                success: true,
                message: `Canal ${sanitizedChannel.name} (${sanitizedChannel.company}) vinculado exitosamente mediante Código QR.`,
                channel: sanitizedChannel
            });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // 2c. Solicitar o regenerar código QR oficial de TikTok generado en servidor (Puppeteer/Playwright Bridge)
    router.post('/tiktok/request-qr', requireAuth, requireAdmin, async (req, res) => {
        try {
            const { channelKey } = req.body || {};
            if (!channelKey || (channelKey !== 'tk_agro' && channelKey !== 'tk_tracto')) {
                return res.status(400).json({ error: 'Canal TikTok inválido. Usa tk_agro o tk_tracto.' });
            }

            const result = await requestTikTokQr(channelKey, io);
            res.json(result);
        } catch (err) {
            console.error('[TikTokRoutes] Error solicitando QR:', err);
            res.status(500).json({ error: err.message || 'Error al generar código QR de TikTok' });
        }
    });

    // 2d. Consultar estado de la sesión de TikTok y QR en memoria
    router.get('/tiktok/status/:key', requireAuth, (req, res) => {
        try {
            const channelKey = req.params.key;
            res.json(getTikTokSessionStatus(channelKey));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 2e. Enviar mensaje por TikTok interactuando con la sesión en segundo plano
    router.post('/tiktok/send-message', requireAuth, async (req, res) => {
        try {
            const { channelKey, recipientUsername, text } = req.body || {};
            if (!channelKey || !recipientUsername || !text) {
                return res.status(400).json({ error: 'Faltan campos obligatorios: channelKey, recipientUsername, text.' });
            }

            const result = await sendTikTokMessage(channelKey, recipientUsername, text, io);
            res.json(result);
        } catch (err) {
            console.error('[TikTokRoutes] Error enviando mensaje TikTok:', err);
            res.status(500).json({ error: err.message || 'Error enviando mensaje por TikTok' });
        }
    });

    // 3. Conectar WhatsApp (Baileys QR o Evolution API)
    router.post('/connect-whatsapp', requireAuth, requireAdmin, (req, res) => {
        try {
            const {
                channelKey,
                connectionMode,
                instanceName,
                evolutionUrl,
                evolutionApiKey
            } = req.body || {};

            if (!channelKey) {
                return res.status(400).json({ error: 'Falta el identificador del canal WhatsApp (channelKey).' });
            }

            const waStatus = whatsappService ? whatsappService.getStatus() : null;
            const sanitizedChannel = connectWhatsAppChannel(channelKey, {
                connectionMode,
                instanceName,
                evolutionUrl,
                evolutionApiKey
            }, waStatus);

            const fullState = getPublicChannelsState(waStatus);
            if (io) {
                io.emit('channels_auth_updated', fullState);
            }

            res.json({
                success: true,
                message: `Configuración de WhatsApp (${sanitizedChannel.company}) guardada de forma segura.`,
                channel: sanitizedChannel
            });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // 4. Hibernar o Reactivar un canal logueado (Inspirado en Service Hibernation de Ferdium)
    router.post('/toggle-hibernation', requireAuth, requireAdmin, (req, res) => {
        try {
            const { channelKey } = req.body || {};
            if (!channelKey) {
                return res.status(400).json({ error: 'Falta el identificador del canal (channelKey).' });
            }

            const sanitizedChannel = toggleChannelHibernation(channelKey);
            const waStatus = whatsappService ? whatsappService.getStatus() : null;
            const fullState = getPublicChannelsState(waStatus);
            if (io) {
                io.emit('channels_auth_updated', fullState);
            }

            res.json({
                success: true,
                message: sanitizedChannel.hibernated
                    ? `Canal ${sanitizedChannel.name} (${sanitizedChannel.company}) puesto en hibernación.`
                    : `Canal ${sanitizedChannel.name} (${sanitizedChannel.company}) reactivado.`,
                channel: sanitizedChannel
            });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // 5. Cerrar sesión de un canal y borrar sus credenciales de la bóveda
    router.post('/disconnect', requireAuth, requireAdmin, (req, res) => {
        try {
            const { channelKey } = req.body || {};
            if (!channelKey) {
                return res.status(400).json({ error: 'Falta el identificador del canal (channelKey).' });
            }

            const sanitizedChannel = disconnectChannel(channelKey);
            const waStatus = whatsappService ? whatsappService.getStatus() : null;
            const fullState = getPublicChannelsState(waStatus);
            if (io) {
                io.emit('channels_auth_updated', fullState);
            }

            res.json({
                success: true,
                message: `Sesión cerrada para ${sanitizedChannel.name} (${sanitizedChannel.company}).`,
                channel: sanitizedChannel
            });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // ==================== NUEVOS ENDPOINTS META GRAPH API (v3.0) ====================

    /**
     * 6. Obtener configuración actual de Meta App (sin exponer secretos completos)
     */
    router.get('/meta/config', requireAuth, requireAdmin, (req, res) => {
        try {
            const company = req.query.company === 'tracto' ? 'tracto' : 'agro';
            const config = loadMetaConfig(company);
            res.json({
                company,
                appId: config.appId || '',
                appSecretSet: Boolean(config.appSecret),
                verifyToken: config.verifyToken || `omnipanel_meta_verify_${company}_2026`,
                webhookUrl: 'https://powerpanel.ddns.net/api/meta/webhook'
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * 7. Guardar configuración de Meta App (App ID, App Secret, Verify Token)
     */
    router.post('/meta/save-config', requireAuth, requireAdmin, (req, res) => {
        try {
            const { appId, appSecret, verifyToken, company: companyRaw } = req.body || {};
            const company = companyRaw === 'tracto' ? 'tracto' : 'agro';

            if (!appId || !appSecret) {
                return res.status(400).json({ error: 'Debes ingresar el App ID y el App Secret de tu Meta App.' });
            }

            const defaultVerify = `omnipanel_meta_verify_${company}_2026`;
            saveMetaConfig({
                appId: String(appId).trim(),
                appSecret: String(appSecret).trim(),
                verifyToken: String(verifyToken || defaultVerify).trim()
            }, company);

            const companyLabel = company === 'tracto' ? 'Tractopower' : 'Agropower';
            console.log(`[MetaAuth] ✅ Configuración Meta App guardada (${companyLabel}): App ID ${String(appId).trim().slice(0, 8)}...`);

            res.json({
                success: true,
                company,
                message: `Configuración de Meta App para ${companyLabel} guardada. Ahora puedes vincular las cuentas.`
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * 8. Obtener URL de OAuth de Meta (llamado por el frontend con Bearer token)
     */
    router.get('/meta/oauth-url/:channelKey', requireAuth, requireAdmin, (req, res) => {
        try {
            const { channelKey } = req.params;
            const oauthUrl = getOAuthUrl(channelKey);
            console.log(`[MetaAuth] 🔗 Generada URL de OAuth para canal: ${channelKey}`);
            res.json({ success: true, url: oauthUrl });
        } catch (e) {
            console.error('[MetaAuth] Error generando OAuth URL:', e.message);
            res.status(400).json({ error: e.message });
        }
    });

    /**
     * 8b. Iniciar flujo OAuth de Meta - Redirige al usuario a Facebook para autorizar
     * Soporta token en query param si se accede por enlace directo del navegador
     */
    router.get('/meta/oauth/:channelKey', (req, res, next) => {
        if (req.query.token && !req.headers['authorization']) {
            req.headers['authorization'] = `Bearer ${req.query.token}`;
        }
        next();
    }, requireAuth, requireAdmin, (req, res) => {
        try {
            const { channelKey } = req.params;
            const oauthUrl = getOAuthUrl(channelKey);
            console.log(`[MetaAuth] 🔗 Redirigiendo a OAuth de Meta para canal: ${channelKey}`);
            res.redirect(oauthUrl);
        } catch (e) {
            console.error('[MetaAuth] Error iniciando OAuth:', e.message);
            res.redirect(`/?meta_auth=error&message=${encodeURIComponent(e.message)}`);
        }
    });

    /**
     * 9. Callback de OAuth de Meta - Recibe el código y obtiene tokens
     * NO requiere autenticación (es un redirect de Facebook)
     */
    router.get('/meta/callback', async (req, res) => {
        try {
            const { code, state, error: oauthError, error_description } = req.query;

            if (oauthError) {
                console.error(`[MetaAuth] ❌ OAuth denegado: ${oauthError} - ${error_description}`);
                return res.redirect(`/?meta_auth=error&message=${encodeURIComponent(error_description || oauthError)}`);
            }

            if (!code) {
                return res.redirect('/?meta_auth=error&message=No+se+recibió+código+de+autorización');
            }

            // Decodificar state para saber qué canal y empresa inició el flujo
            let channelKey = 'ig_agro';
            let company = 'agro';
            try {
                const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
                channelKey = stateData.channelKey || channelKey;
                company = stateData.company || companyFromChannelKey(channelKey);
            } catch (e) { /* usar default */ }

            const companyLabel = company === 'tracto' ? 'Tractopower' : 'Agropower';
            console.log(`[MetaAuth] 📝 Callback OAuth recibido para canal: ${channelKey} (${companyLabel})`);

            // Paso 1: Intercambiar código por token de corta vida (usando credenciales de la empresa)
            const shortToken = await exchangeCodeForTokens(code, company);

            // Paso 2: Extender a token de larga vida (60 días)
            const longToken = await getLongLivedToken(shortToken, company);

            // Paso 3: Descubrir páginas e Instagram vinculados
            let { pages, igAccounts } = await discoverPagesAndInstagram(longToken);

            // Paso 4: Asignar channelKeys automáticamente según empresa
            const assigned = autoAssignChannelKeys(pages, igAccounts, company);
            pages = assigned.pages;
            igAccounts = assigned.igAccounts;

            // Paso 5: Guardar tokens en el archivo de la empresa correspondiente
            saveMetaTokens({
                userToken: longToken,
                pages,
                igAccounts
            }, company);

            // Paso 6: Suscribir cada página a webhooks
            for (const page of pages) {
                await subscribePageToWebhooks(page.id, page.accessToken);
            }

            // Paso 7: Marcar canales como conectados en la bóveda
            for (const ig of igAccounts) {
                if (ig.channelKey) {
                    try {
                        loginSocialChannel(ig.channelKey, {
                            username: `@${ig.username}`,
                            password: `meta_oauth_${ig.igBusinessId}`,
                            clientIp: req.ip,
                            userAgent: req.headers['user-agent']
                        });
                        console.log(`[MetaAuth] ✅ Canal ${ig.channelKey} marcado como conectado: @${ig.username}`);
                    } catch (e) {
                        console.error(`[MetaAuth] Error marcando ${ig.channelKey}:`, e.message);
                    }
                }
            }

            for (const page of pages) {
                if (page.channelKey) {
                    try {
                        loginSocialChannel(page.channelKey, {
                            username: page.name,
                            password: `meta_oauth_${page.id}`,
                            clientIp: req.ip,
                            userAgent: req.headers['user-agent']
                        });
                        console.log(`[MetaAuth] ✅ Canal ${page.channelKey} marcado como conectado: ${page.name}`);
                    } catch (e) {
                        console.error(`[MetaAuth] Error marcando ${page.channelKey}:`, e.message);
                    }
                }
            }

            // Emitir actualización al frontend
            if (io) {
                const waStatus = whatsappService ? whatsappService.getStatus() : null;
                const fullState = getPublicChannelsState(waStatus);
                io.emit('channels_auth_updated', fullState);
            }

            const summary = `${pages.length} página(s) y ${igAccounts.length} cuenta(s) de Instagram vinculadas para ${companyLabel}`;
            console.log(`[MetaAuth] 🎉 OAuth completado: ${summary}`);

            res.redirect(`/?meta_auth=success&message=${encodeURIComponent(summary)}`);
        } catch (e) {
            console.error('[MetaAuth] ❌ Error en callback OAuth:', e.message);
            res.redirect(`/?meta_auth=error&message=${encodeURIComponent(e.message)}`);
        }
    });

    /**
     * 10. Obtener estado de tokens de Meta (páginas e IG conectados)
     */
    router.get('/meta/tokens-status', requireAuth, requireAdmin, (req, res) => {
        try {
            // Retorna el estado de ambas empresas
            const buildStatus = (company) => {
                const tokens = loadMetaTokens(company);
                return {
                    hasUserToken: Boolean(tokens.userToken),
                    pages: (tokens.pages || []).map(p => ({
                        id: p.id,
                        name: p.name,
                        channelKey: p.channelKey,
                        hasToken: Boolean(p.accessToken)
                    })),
                    igAccounts: (tokens.igAccounts || []).map(ig => {
                        const parentPage = (tokens.pages || []).find(p => p.id === ig.pageId) || (tokens.pages && tokens.pages[0]);
                        const hasPageToken = Boolean(parentPage && parentPage.accessToken);
                        return {
                            igBusinessId: ig.igBusinessId,
                            username: ig.username,
                            name: ig.name || parentPage?.name || 'Agropower',
                            pageName: ig.pageName || ig.name || parentPage?.name || 'Página de Facebook',
                            pageId: ig.pageId || parentPage?.id,
                            channelKey: ig.channelKey,
                            hasToken: hasPageToken,
                            connected: Boolean(hasPageToken && ig.igBusinessId)
                        };
                    }),
                    updatedAt: tokens.updatedAt
                };
            };

            res.json({
                agro: buildStatus('agro'),
                tracto: buildStatus('tracto')
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * 11. Enviar mensaje vía Meta API (Instagram DM o Facebook Messenger)
     */
    router.post('/meta/send-message', requireAuth, (req, res) => {
        (async () => {
            try {
                const { channelKey, recipientId, text } = req.body || {};
                if (!channelKey || !recipientId || !text) {
                    return res.status(400).json({ error: 'Faltan parámetros: channelKey, recipientId y text son obligatorios.' });
                }

                const pageToken = getTokenForChannel(channelKey);
                if (!pageToken) {
                    return res.status(400).json({ error: `No hay token disponible para el canal ${channelKey}. Vincula tu cuenta primero.` });
                }

                let result;
                const platform = channelKey.startsWith('ig_') ? 'instagram' : 'facebook';

                if (platform === 'instagram') {
                    result = await sendInstagramMessage(pageToken, recipientId, text);
                } else {
                    result = await sendFacebookMessage(pageToken, recipientId, text);
                }

                // Guardar el mensaje enviado en la conversación
                const chatId = `${platform === 'instagram' ? 'ig' : 'fb'}:${recipientId}`;
                const operatorName = req.user?.username || req.user?.name || 'Asesor';
                const updatedConv = addMessageToMetaConversation(chatId, {
                    sender: 'operator',
                    text,
                    platform,
                    messageId: result.message_id || `sent_${Date.now()}`,
                    operatorName
                });

                // Emitir actualización
                if (io) {
                    if (updatedConv) {
                        io.emit('meta_message_received', {
                            conversation: updatedConv,
                            message: {
                                sender: 'operator',
                                text,
                                platform,
                                messageId: result.message_id || `sent_${Date.now()}`,
                                operatorName
                            },
                            platform,
                            channelKey
                        });
                    }
                    const allMetaConvs = getMetaConversationsAsArray();
                    io.emit('meta_conversations_updated', allMetaConvs);
                }

                res.json({
                    success: true,
                    message: `Mensaje enviado por ${platform === 'instagram' ? 'Instagram' : 'Facebook Messenger'}.`,
                    messageId: result.message_id
                });
            } catch (e) {
                console.error('[MetaAuth] Error enviando mensaje Meta:', e.message);
                res.status(500).json({ error: e.message });
            }
        })();
    });

    /**
     * 11b. Sincronizar activamente Instagram vía Meta API
     */
    router.post('/meta/sync', requireAuth, async (req, res) => {
        try {
            console.log('[ChannelAuthRoutes] 🔄 Solicitud de sincronización activa de Instagram recibida...');
            const result = await syncInstagramRecentConversations(io);
            res.json({ success: true, ...result });
        } catch (e) {
            console.error('[ChannelAuthRoutes] Error en sincronización Meta:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * 12. Asignar manualmente un channelKey a una página o cuenta IG descubierta
     */
    router.post('/meta/assign-channel', requireAuth, requireAdmin, (req, res) => {
        try {
            const { type, id, channelKey } = req.body || {};
            if (!type || !id || !channelKey) {
                return res.status(400).json({ error: 'Faltan parámetros: type (page|ig), id y channelKey.' });
            }

            const tokens = loadMetaTokens();

            if (type === 'page') {
                const page = tokens.pages.find(p => p.id === id);
                if (!page) return res.status(404).json({ error: `Página ${id} no encontrada.` });
                page.channelKey = channelKey;
            } else if (type === 'ig') {
                const ig = tokens.igAccounts.find(a => a.igBusinessId === id);
                if (!ig) return res.status(404).json({ error: `Cuenta IG ${id} no encontrada.` });
                ig.channelKey = channelKey;
            }

            saveMetaTokens(tokens);
            res.json({ success: true, message: `Canal ${channelKey} asignado correctamente.` });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};
