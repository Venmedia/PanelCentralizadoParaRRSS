const express = require('express');
const fs = require('fs');
const path = require('path');
const whatsappService = require('../../whatsappService');
const { requireAuth } = require('../middleware/authMiddleware');
const {
  loadBotConfig,
  getConversations,
  saveConversations,
  normalizeChannel,
  getCompanyFromChannel,
  getTodayISO,
  isAdminUser,
  loadUsers
} = require('../services/storageService');
const analyticsService = require('../services/analyticsService');
const { evaluateSchedule } = require('../services/scheduleService');
const { updateAdvisorSessionActivity, getSessionFromRequest } = require('../services/sessionService');
const { getMetaConversationsAsArray, parseTimestampToMs } = require('../services/metaApiService');
const exportService = require('../services/exportService');

const getNowVE = () => new Date().toLocaleString('es-VE', {
  timeZone: 'America/Caracas',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

function createConversationRouter(io) {
  const router = express.Router();

  // Obtener todas las conversaciones activas (WhatsApp, Instagram, TikTok, Facebook Messenger)
  // ordenadas estrictamente por fecha de la más nueva a la más vieja
  // Cache ligera en memoria por 1.5s para peticiones ultra-frecuentes / concurrentes
  let cachedConvs = null;
  let cachedTime = 0;

  router.get('/conversations', requireAuth, (req, res) => {
    const now = Date.now();
    if (cachedConvs && (now - cachedTime < 1500) && !req.query.fresh) {
      return res.json(cachedConvs);
    }

    const waConvs = getConversations();
    let metaConvs = [];
    try {
      metaConvs = getMetaConversationsAsArray();
    } catch (e) {
      console.warn('[Conversations] Error obteniendo conversaciones de Meta:', e.message);
    }
    const combined = [...waConvs, ...metaConvs];
    for (let i = 0; i < combined.length; i++) {
      const c = combined[i];
      if (typeof c._ts !== 'number') {
        c._ts = parseTimestampToMs(c.time, c);
      }
    }
    combined.sort((a, b) => (b._ts || 0) - (a._ts || 0));

    cachedConvs = combined;
    cachedTime = now;
    res.json(combined);
  });

  // Enviar mensaje desde el panel al cliente
  router.post('/messages/send', requireAuth, async (req, res) => {
    const { conversationId, text, attachment, fileData, fileName, fileType } = req.body;
    const conversations = getConversations();
    const conv = conversations.find(c => c.id === Number(conversationId));
    if (!conv) return res.status(404).json({ error: 'No encontrado' });

    const now = getNowVE();
    const todayISO = getTodayISO();
    conv.channel = normalizeChannel(conv.channel);
    conv.company = getCompanyFromChannel(conv.channel);

    const activeUser = req.authUser;
    const userIsAdmin = isAdminUser(activeUser);
    
    let advisorDisplayName = 'Asesor';
    if (activeUser.username === 'Jesuse' || activeUser.firstName?.toLowerCase().includes('jesus')) {
      advisorDisplayName = 'Asesor Jesus';
    } else if (activeUser.username === 'rcazorla' || activeUser.firstName?.toLowerCase().includes('ricardo')) {
      advisorDisplayName = 'Asesor Ricardo';
    } else if (userIsAdmin || activeUser.username === 'admin') {
      advisorDisplayName = 'Administrador';
    } else {
      advisorDisplayName = `Asesor ${activeUser.firstName || activeUser.username}`.trim();
    }
    const fullName = `${activeUser.firstName || ''} ${activeUser.lastName || ''}`.trim() || activeUser.username;

    conv.waitingAdvisor = false;
    conv.botActive = false;
    conv.isRead = true;
    conv.unreadCount = 0;
    conv.time = now;
    conv.attendedBy = activeUser.username;
    conv.attendedByName = advisorDisplayName;

    let mediaUrl = null;
    let mediaType = null;
    let mediaLabel = null;
    let localFilePath = null;

    if (fileData && fileName) {
      try {
        const mediaDir = path.join(__dirname, '..', '..', 'public', 'media', 'whatsapp');
        if (!fs.existsSync(mediaDir)) {
          fs.mkdirSync(mediaDir, { recursive: true });
        }
        const base64Content = fileData.includes(';base64,') ? fileData.split(';base64,')[1] : fileData;
        const fileBuffer = Buffer.from(base64Content, 'base64');
        const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const uniqueFileName = `${Date.now()}_${cleanName}`;
        const targetPath = path.join(mediaDir, uniqueFileName);
        fs.writeFileSync(targetPath, fileBuffer);

        localFilePath = targetPath;
        mediaUrl = `/media/whatsapp/${uniqueFileName}`;

        const mime = fileType || 'application/octet-stream';
        if (mime.startsWith('image/')) {
          mediaType = 'image';
          mediaLabel = `📷 Imagen (${fileName})`;
        } else if (mime.startsWith('video/')) {
          mediaType = 'video';
          mediaLabel = `🎥 Video (${fileName})`;
        } else if (mime.startsWith('audio/')) {
          mediaType = 'audio';
          mediaLabel = `🎤 Audio (${fileName})`;
        } else {
          mediaType = 'document';
          mediaLabel = `📄 Documento — ${fileName}`;
        }
      } catch (err) {
        console.error('[Error guardando archivo adjunto del asesor]:', err);
      }
    }

    const messageObj = {
      sender: 'operator',
      origin: 'panel',
      operatorName: advisorDisplayName,
      operatorUser: activeUser.username,
      text: text || '',
      attachment: attachment || null,
      time: now
    };

    if (mediaType && mediaUrl) {
      messageObj.mediaType = mediaType;
      messageObj.mediaUrl = mediaUrl;
      messageObj.mediaLabel = mediaLabel;
    }

    conv.messages.push(messageObj);

    if (req.authSession?.sessionId) {
      updateAdvisorSessionActivity(activeUser.id, req.authSession.sessionId, false);
    }

    // Registrar client_attended (solo si no se ha atendido hoy esta conversación por este usuario)
    const alreadyAttended = analyticsService.hasAttendedToday(activeUser.id, conv.id, activeUser.username);
    if (!alreadyAttended) {
      analyticsService.recordEvent({
        date: todayISO,
        time: now,
        userId: activeUser.id,
        username: activeUser.username,
        userFullName: fullName,
        type: 'client_attended',
        company: conv.company,
        channel: conv.channel,
        conversationId: conv.id,
        clientName: conv.name
      });
    }

    // Registrar message_sent (siempre que el usuario hable con el cliente)
    analyticsService.recordEvent({
      date: todayISO,
      time: now,
      userId: activeUser.id,
      username: activeUser.username,
      userFullName: fullName,
      type: 'message_sent',
      company: conv.company,
      channel: conv.channel,
      conversationId: conv.id,
      clientName: conv.name
    });

    if (conv.channel === 'wa_agro' || conv.channel === 'wa_tracto' || conv.channel === 'wa1') {
      const cleanPhone = String(conv.phone || '').replace(/\D/g, '');
      let targetJid;
      if (conv.jid && conv.jid.includes('@g.us')) {
        // Mensajes grupales
        targetJid = conv.jid;
      } else if (cleanPhone && cleanPhone.length >= 10 && cleanPhone.length <= 13) {
        // Enviar SIEMPRE al número telefónico real del cliente (@s.whatsapp.net)
        // Esto garantiza entrega al móvil y sincronización bidireccional en WhatsApp Web
        targetJid = `${cleanPhone}@s.whatsapp.net`;
      } else if (conv.jid && !conv.jid.endsWith('@lid')) {
        targetJid = conv.jid;
      } else {
        targetJid = conv.jid || (cleanPhone.length > 13 ? `${cleanPhone}@lid` : `${cleanPhone}@s.whatsapp.net`);
      }

      console.log(`[Panel Send - ${fullName}] Enviando a ${conv.name} (${targetJid}) vía ${conv.channel || conv.company}: "${text || ''}" ${mediaUrl ? `[Archivo: ${mediaUrl}]` : ''}`);
      let sendResult = null;
      if (localFilePath) {
        sendResult = await whatsappService.sendMedia(targetJid, localFilePath, text, fileType, conv.channel || conv.company);
      } else if (attachment) {
        sendResult = await whatsappService.sendPdf(targetJid, attachment, text, conv.channel || conv.company);
      } else {
        sendResult = await whatsappService.sendText(targetJid, text, conv.channel || conv.company);
      }

      if (sendResult === null) {
        console.warn(`[WhatsApp Send] ⚠️ No se pudo entregar a ${targetJid} en ${conv.channel || conv.company}. Verifica que la sesión de WhatsApp esté conectada.`);
      } else if (sendResult?.key?.id) {
        messageObj.messageId = sendResult.key.id;
      }
    }

    saveConversations(conversations);
    io.emit('conversations_updated', conversations);
    io.emit('analytics_updated');
    res.json({ success: true, conversation: conv });
  });

  // Pausar o reactivar respuestas automáticas (bot) en una conversación
  router.post('/conversations/toggle-bot', requireAuth, (req, res) => {
    const { conversationId } = req.body;
    const conversations = getConversations();
    const conv = conversations.find(c => c.id === Number(conversationId));
    if (conv) {
      conv.botActive = conv.botActive === false ? true : false;
      if (conv.botActive) conv.waitingAdvisor = false;
      saveConversations(conversations);
      io.emit('conversations_updated', conversations);
      return res.json({ success: true, botActive: conv.botActive });
    }
    res.status(404).json({ error: 'No encontrado' });
  });

  // Apagar flag "PIDE ASESOR" (marcar como atendido)
  router.post('/conversations/dismiss-waiting', requireAuth, (req, res) => {
    const { conversationId } = req.body;
    const conversations = getConversations();
    const conv = conversations.find(c => c.id === Number(conversationId) || c.id === String(conversationId));
    if (conv) {
      conv.waitingAdvisor = false;
      conv.botActive = false;
      conv.isRead = true;
      conv.unreadCount = 0;
      if (req.authUser) {
        conv.attendedBy = req.authUser.username;
        conv.attendedByName = `${req.authUser.firstName} ${req.authUser.lastName}`;
      }
      saveConversations(conversations);
      io.emit('conversations_updated', conversations);
      return res.json({ success: true, conversation: conv });
    }

    // Verificar si es un chat de Meta (Instagram / Facebook)
    try {
      const fs = require('fs');
      const { PATHS } = require('../config/constants');
      if (fs.existsSync(PATHS.META_CONVERSATIONS_FILE)) {
        const metaStore = JSON.parse(fs.readFileSync(PATHS.META_CONVERSATIONS_FILE, 'utf8'));
        let foundConv = null;
        for (const [k, c] of Object.entries(metaStore.chats || {})) {
          if (String(c.id) === String(conversationId) || k === String(conversationId)) {
            c.waitingAdvisor = false;
            c.botActive = false;
            c.isRead = true;
            c.unreadCount = 0;
            if (req.authUser) {
              c.attendedBy = req.authUser.username;
              c.attendedByName = `${req.authUser.firstName} ${req.authUser.lastName}`;
            }
            foundConv = c;
            break;
          }
        }
        if (foundConv) {
          fs.writeFileSync(PATHS.META_CONVERSATIONS_FILE, JSON.stringify(metaStore, null, 2), 'utf8');
          if (io) {
            io.emit('meta_conversations_updated', getMetaConversationsAsArray());
          }
          return res.json({ success: true, conversation: foundConv });
        }
      }
    } catch (e) {}

    res.status(404).json({ error: 'No encontrado' });
  });

  // Asignar asesor a una conversación (WhatsApp o Meta)
  router.post('/conversations/assign-advisor', requireAuth, (req, res) => {
    const { conversationId, advisorUsername } = req.body || {};
    const users = loadUsers();
    const advisor = advisorUsername ? users.find(u => u.username === advisorUsername) : null;

    const todayISO = getTodayISO();
    const now = getNowVE();
    const conversations = getConversations();
    const reqId = String(conversationId);
    let conv = conversations.find(c => String(c.id) === reqId);

    if (conv) {
      if (advisor) {
        let advisorDisplayName = 'Asesor';
        if (advisor.username === 'Jesuse' || advisor.firstName?.toLowerCase().includes('jesus')) {
          advisorDisplayName = 'Asesor Jesus';
        } else if (advisor.username === 'rcazorla' || advisor.firstName?.toLowerCase().includes('ricardo')) {
          advisorDisplayName = 'Asesor Ricardo';
        } else if (advisor.role === 'admin' || advisor.username === 'admin') {
          advisorDisplayName = 'Administrador';
        } else {
          advisorDisplayName = `Asesor ${advisor.firstName || advisor.username}`.trim();
        }

        conv.attendedBy = advisor.username;
        conv.attendedByName = advisorDisplayName;
        conv.waitingAdvisor = false;

        const comp = conv.company || getCompanyFromChannel(conv.channel);
        const alreadyAttended = analyticsService.hasAttendedToday(advisor.id, conv.id, advisor.username);
        if (!alreadyAttended) {
          analyticsService.recordEvent({
            date: todayISO,
            time: now,
            userId: advisor.id,
            username: advisor.username,
            userFullName: advisorDisplayName,
            type: 'client_attended',
            company: comp,
            channel: conv.channel || 'wa_agro',
            conversationId: conv.id,
            clientName: conv.name
          });
        }
      } else {
        conv.attendedBy = null;
        conv.attendedByName = null;
      }
      saveConversations(conversations);
      io.emit('conversations_updated', conversations);
      io.emit('analytics_updated');
      return res.json({ success: true, conversation: conv });
    }

    // Buscar en Meta (Instagram / Facebook)
    try {
      const fs = require('fs');
      const { PATHS } = require('../config/constants');
      if (fs.existsSync(PATHS.META_CONVERSATIONS_FILE)) {
        const metaStore = JSON.parse(fs.readFileSync(PATHS.META_CONVERSATIONS_FILE, 'utf8'));
        let found = null;
        for (const [k, c] of Object.entries(metaStore.chats || {})) {
          if (String(c.id) === reqId || k === reqId) {
            found = c;
            break;
          }
        }
        if (found) {
          if (advisor) {
            let advisorDisplayName = 'Asesor';
            if (advisor.username === 'Jesuse' || advisor.firstName?.toLowerCase().includes('jesus')) {
              advisorDisplayName = 'Asesor Jesus';
            } else if (advisor.username === 'rcazorla' || advisor.firstName?.toLowerCase().includes('ricardo')) {
              advisorDisplayName = 'Asesor Ricardo';
            } else if (advisor.role === 'admin' || advisor.username === 'admin') {
              advisorDisplayName = 'Administrador';
            } else {
              advisorDisplayName = `Asesor ${advisor.firstName || advisor.username}`.trim();
            }

            found.attendedBy = advisor.username;
            found.attendedByName = advisorDisplayName;
            found.waitingAdvisor = false;

            const comp = found.channelKey?.includes('tracto') ? 'Tractopower' : 'Agropower';
            const alreadyAttended = analyticsService.hasAttendedToday(advisor.id, found.id, advisor.username);
            if (!alreadyAttended) {
              analyticsService.recordEvent({
                date: todayISO,
                time: analyticsService.getNowTime(),
                userId: advisor.id,
                username: advisor.username,
                userFullName: advisorDisplayName,
                type: 'client_attended',
                company: comp,
                channel: found.channelKey || 'ig_agro',
                conversationId: found.id,
                clientName: found.name
              });
            }
          } else {
            found.attendedBy = null;
            found.attendedByName = null;
          }
          fs.writeFileSync(PATHS.META_CONVERSATIONS_FILE, JSON.stringify(metaStore, null, 2), 'utf8');
          if (io) {
            io.emit('meta_conversations_updated', getMetaConversationsAsArray());
            io.emit('analytics_updated');
          }
          return res.json({ success: true, conversation: found });
        }
      }
    } catch (e) {
      console.error('[AssignAdvisor] Error:', e);
    }

    return res.status(404).json({ error: 'Conversación no encontrada' });
  });

  // Marcar conversación como LEÍDA (apagar badge sin leer y poner contador a 0)
  router.post('/conversations/read/:id', (req, res) => {
    const session = typeof getSessionFromRequest === 'function' ? getSessionFromRequest(req) : null;
    const users = loadUsers();
    const authUser = session ? users.find(u => u.id === Number(session.userId)) : (req.authUser || null);
    const id = req.params.id;
    let handled = false;

    // 1. Buscar en conversations.json (WhatsApp y TikTok)
    const conversations = getConversations();
    const conv = conversations.find(c => String(c.id) === String(id));
    if (conv) {
      conv.isRead = true;
      conv.unreadCount = 0;
      conv.waitingAdvisor = false;
      conv.lastReadAt = getNowVE();
      if (authUser) {
        conv.lastReadBy = authUser.username;
      }
      saveConversations(conversations);
      handled = true;
      if (io) {
        io.emit('conversation_read', { id: conv.id, username: authUser?.username, channel: conv.channel });
        io.emit('conversations_updated', conversations);
      }
      return res.json({ success: true, id: conv.id, handled: true });
    }

    // 2. Buscar en metaConversations.json (Instagram y Facebook Messenger)
    try {
      const { PATHS } = require('../config/constants');
      if (fs.existsSync(PATHS.META_CONVERSATIONS_FILE)) {
        const metaStore = JSON.parse(fs.readFileSync(PATHS.META_CONVERSATIONS_FILE, 'utf8'));
        let found = false;
        let foundChat = null;
        for (const [k, c] of Object.entries(metaStore.chats || {})) {
          if (String(c.id) === String(id) || k === String(id)) {
            c.isRead = true;
            c.unreadCount = 0;
            c.waitingAdvisor = false;
            c.lastReadAt = getNowVE();
            if (authUser) {
              c.lastReadBy = authUser.username;
            }
            found = true;
            foundChat = c;
            break;
          }
        }
        if (found) {
          fs.writeFileSync(PATHS.META_CONVERSATIONS_FILE, JSON.stringify(metaStore, null, 2), 'utf8');
          handled = true;
          if (io) {
            io.emit('conversation_read', { id, username: authUser?.username, channel: foundChat?.channel });
            const metaConvs = getMetaConversationsAsArray();
            io.emit('meta_conversations_updated', metaConvs);
          }
          return res.json({ success: true, id, handled: true });
        }
      }
    } catch (e) {
      console.error('[Conversations] Error marcando chat Meta como leído:', e);
    }

    res.json({ success: true, id, handled: false });
  });

  // Marcar o desmarcar "Cerrar Venta / Venta Cerrada" en una conversación
  router.post('/conversations/close-sale', requireAuth, (req, res) => {
    const { conversationId } = req.body;
    const conversations = getConversations();
    const conv = conversations.find(c => c.id === Number(conversationId));
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    const activeUser = req.authUser;
    const userIsAdmin = isAdminUser(activeUser);
    const fullName = `${activeUser.firstName} ${activeUser.lastName}`;
    const now = getNowVE();
    const todayISO = getTodayISO();

    conv.channel = normalizeChannel(conv.channel);
    conv.company = getCompanyFromChannel(conv.channel);
    conv.saleClosed = !conv.saleClosed;

    if (conv.saleClosed) {
      conv.saleClosedBy = activeUser.username;
      conv.saleClosedByName = fullName;
      conv.saleClosedAt = `${todayISO} ${now}`;
      conv.attendedBy = activeUser.username;
      conv.attendedByName = fullName;

      if (!userIsAdmin) {
        updateAdvisorSessionActivity(activeUser.id, req.authSession?.sessionId, false);

        // Registrar client_attended si no existe
        const alreadyAttended = analyticsService.hasAttendedToday(activeUser.id, conv.id);
        if (!alreadyAttended) {
          analyticsService.recordEvent({
            date: todayISO,
            time: now,
            userId: activeUser.id,
            username: activeUser.username,
            userFullName: fullName,
            type: 'client_attended',
            company: conv.company,
            channel: conv.channel,
            conversationId: conv.id,
            clientName: conv.name
          });
        }

        // Registrar sale_closed
        analyticsService.recordEvent({
          date: todayISO,
          time: now,
          userId: activeUser.id,
          username: activeUser.username,
          userFullName: fullName,
          type: 'sale_closed',
          company: conv.company,
          channel: conv.channel,
          conversationId: conv.id,
          clientName: conv.name
        });

        console.log(
          `[Venta Cerrada 🏆] ${fullName} cerró venta con ${conv.name} en canal ${conv.channel}`
        );
      }
    } else {
      conv.saleClosedBy = null;
      conv.saleClosedByName = null;
      conv.saleClosedAt = null;
      // Al desmarcar venta, eliminar el evento sale_closed de hoy para esta conversación
      // (No eliminamos de archivos históricos, solo del día actual)
      const todayEvents = analyticsService.getTodayEvents();
      const filtered = todayEvents.filter(
        ev => !(ev.type === 'sale_closed' && Number(ev.conversationId) === Number(conv.id))
      );
      if (filtered.length !== todayEvents.length) {
        // Reescribir el archivo del día sin esos eventos
        const analyticsServiceInternal = require('../services/analyticsService');
        const fs = require('fs');
        const path = require('path');
        const { PATHS } = require('../config/constants');
        const dayFile = path.join(PATHS.ROOT_DIR, 'data', 'analytics', `${todayISO}.json`);
        if (fs.existsSync(dayFile)) {
          const data = JSON.parse(fs.readFileSync(dayFile, 'utf8'));
          data.events = (data.events || []).filter(
            ev => !(ev.type === 'sale_closed' && Number(ev.conversationId) === Number(conv.id))
          );
          fs.writeFileSync(dayFile, JSON.stringify(data, null, 2));
        }
      }
      // También limpiar legacy
      try {
        const { loadAnalytics, saveAnalytics } = require('../services/storageService');
        const legacyAnalytics = loadAnalytics();
        legacyAnalytics.events = legacyAnalytics.events.filter(
          ev => !(ev.type === 'sale_closed' && Number(ev.conversationId) === Number(conv.id))
        );
        saveAnalytics(legacyAnalytics);
      } catch (e) {}
    }

    saveConversations(conversations);
    io.emit('conversations_updated', conversations);
    io.emit('analytics_updated');

    return res.json({ success: true, saleClosed: conv.saleClosed, conversation: conv });
  });

  // Eliminar conversación del panel y sincronizar con WhatsApp (solo admin)
  router.delete('/conversations/:id', requireAuth, async (req, res) => {
    try {
      const activeUser = req.authUser;
      if (!isAdminUser(activeUser)) {
        return res.status(403).json({ error: 'Solo el administrador puede eliminar conversaciones' });
      }

      const reqId = req.params.id;
      const conversations = getConversations();
      const numId = Number(reqId);
      const idx = conversations.findIndex(c => c.id === numId || String(c.id) === String(reqId));

      if (idx !== -1) {
        const removed = conversations[idx];

        // Sincronizar eliminación en WhatsApp del móvil si es chat de WhatsApp
        let syncedPhone = false;
        if (removed.jid || removed.phone) {
          try {
            syncedPhone = await whatsappService.deleteChat(removed.jid, removed.phone, removed.messages, removed.channel || removed.company);
          } catch (waErr) {
            console.warn(`[Panel] Error al sincronizar borrado en WhatsApp:`, waErr.message);
          }
        }

        conversations.splice(idx, 1);
        saveConversations(conversations);
        io.emit('conversations_updated', conversations);

        console.log(`[Panel] 🗑️ Conversación de WhatsApp eliminada por admin: "${removed.name}" (id=${reqId}, syncWhatsApp=${syncedPhone})`);
        return res.json({ success: true, removed: removed.name, syncedPhone });
      }

      // Si no está en conversations.json, verificar si es una conversación de Meta (Instagram / Messenger)
      const { deleteMetaConversation, getMetaConversationsAsArray } = require('../services/metaApiService');
      if (typeof deleteMetaConversation === 'function') {
        const deletedMeta = deleteMetaConversation(reqId);
        if (deletedMeta) {
          if (io) {
            io.emit('meta_conversations_updated', getMetaConversationsAsArray());
          }
          console.log(`[Panel] 🗑️ Conversación de Meta eliminada por admin: "${deletedMeta.name || reqId}"`);
          return res.json({ success: true, removed: deletedMeta.name || reqId, syncedPhone: false });
        }
      }

      return res.status(404).json({ error: 'Conversación no encontrada' });
    } catch (err) {
      console.error('[Panel] Error eliminando conversación:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Exportación Exhaustiva de Conversaciones y Mensajes (Bidireccional) ───
  router.get('/conversations/export', requireAuth, (req, res) => {
    try {
      const format = (req.query.format || 'csv').toLowerCase();
      if (format === 'json') {
        const jsonData = exportService.generateJsonExport();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="export_conversaciones_${Date.now()}.json"`);
        return res.json(jsonData);
      }

      const csvData = exportService.generateCsvExport();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="export_conversaciones_${Date.now()}.csv"`);
      return res.send(csvData);
    } catch (err) {
      console.error('[Export Route] Error exportando conversaciones:', err);
      res.status(500).json({ error: 'Error al generar la exportación', details: err.message });
    }
  });

  router.post('/conversations/generate-export', requireAuth, (req, res) => {
    try {
      const result = exportService.saveStaticExports();
      res.json({
        success: true,
        stats: result.stats,
        downloadUrls: {
          csv: '/exports/conversaciones_exhaustivas_bidireccionales.csv',
          json: '/exports/conversaciones_exhaustivas_bidireccionales.json'
        }
      });
    } catch (err) {
      console.error('[Generate Export Route] Error:', err);
      res.status(500).json({ error: 'Error generando archivos de exportación', details: err.message });
    }
  });

  return router;
}

module.exports = createConversationRouter;
