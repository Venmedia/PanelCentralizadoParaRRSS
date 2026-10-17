const express = require('express');
const whatsappService = require('../../whatsappService');
const { requireAuth } = require('../middleware/authMiddleware');
const {
  loadBotConfig,
  getConversations,
  saveConversations,
  normalizeChannel,
  getCompanyFromChannel,
  getTodayISO,
  isAdminUser
} = require('../services/storageService');
const analyticsService = require('../services/analyticsService');
const { evaluateSchedule } = require('../services/scheduleService');
const { updateAdvisorSessionActivity } = require('../services/sessionService');

function createConversationRouter(io) {
  const router = express.Router();

  // Obtener todas las conversaciones activas
  router.get('/conversations', requireAuth, (req, res) => {
    res.json(getConversations());
  });

  // Enviar mensaje desde el panel al cliente
  router.post('/messages/send', requireAuth, async (req, res) => {
    const { conversationId, text, attachment } = req.body;
    const conversations = getConversations();
    const conv = conversations.find(c => c.id === Number(conversationId));
    if (!conv) return res.status(404).json({ error: 'No encontrado' });

    const now = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
    const todayISO = getTodayISO();
    conv.channel = normalizeChannel(conv.channel);
    conv.company = getCompanyFromChannel(conv.channel);

    const activeUser = req.authUser;
    const userIsAdmin = isAdminUser(activeUser);
    const fullName = `${activeUser.firstName} ${activeUser.lastName}`;

    conv.waitingAdvisor = false;
    conv.botActive = false;
    conv.time = now;
    conv.attendedBy = activeUser.username;
    conv.attendedByName = fullName;

    conv.messages.push({
      sender: 'operator',
      operatorName: fullName,
      operatorUser: activeUser.username,
      text: text || '',
      attachment: attachment || null,
      time: now
    });

    if (!userIsAdmin) {
      updateAdvisorSessionActivity(activeUser.id, req.authSession?.sessionId, false);

      // Registrar client_attended (solo si no se ha atendido hoy esta conversación por este usuario)
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

      // Registrar message_sent (siempre)
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
    }

    if (conv.channel === 'wa_agro' || conv.channel === 'wa_tracto' || conv.channel === 'wa1') {
      const targetJid =
        conv.jid ||
        (conv.phone.length > 13
          ? `${conv.phone}@lid`
          : conv.phone.includes('@')
          ? conv.phone
          : `${conv.phone}@s.whatsapp.net`);
      console.log(`[Panel Send - ${fullName}] Enviando a ${conv.name} (${targetJid}): "${text}"`);
      if (attachment) {
        await whatsappService.sendPdf(targetJid, attachment, text, conv.channel || conv.company);
      } else {
        await whatsappService.sendText(targetJid, text, conv.channel || conv.company);
      }
    }

    saveConversations(conversations);
    io.emit('conversations_updated', conversations);
    if (!userIsAdmin) io.emit('analytics_updated');
    res.json({ success: true, conversation: conv });
  });

  // Simulador de cliente desde el panel derecho
  router.post('/messages/simulate', requireAuth, (req, res) => {
    const { conversationId, channel, text } = req.body;
    const conversations = getConversations();
    const conv = conversations.find(c => c.id === Number(conversationId));
    if (!conv) return res.status(404).json({ error: 'No encontrado' });

    const now = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
    if (channel) {
      conv.channel = normalizeChannel(channel);
      conv.company = getCompanyFromChannel(conv.channel);
    }
    conv.time = now;
    conv.messages.push({ sender: 'client', text: text || 'Hola', time: now });

    if (conv.botActive !== false) {
      const config = loadBotConfig();
      const schedStatus = evaluateSchedule(config.schedule, config);
      if (schedStatus.shouldAutoReply && schedStatus.welcomeMessage) {
        conv.messages.push({
          sender: 'scheduled',
          text: schedStatus.welcomeMessage,
          attachment: null,
          time: now
        });
      }
    }

    saveConversations(conversations);
    io.emit('conversations_updated', conversations);
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
      if (req.authUser) {
        conv.attendedBy = req.authUser.username;
        conv.attendedByName = `${req.authUser.firstName} ${req.authUser.lastName}`;
      }
      saveConversations(conversations);
      io.emit('conversations_updated', conversations);
      return res.json({ success: true, conversation: conv });
    }
    res.status(404).json({ error: 'No encontrado' });
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
    const now = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
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

  return router;
}

module.exports = createConversationRouter;
