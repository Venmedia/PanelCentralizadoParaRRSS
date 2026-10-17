const whatsappService = require('../../whatsappService');
const {
  loadBotConfig,
  getConversations,
  saveConversations,
  normalizeChannel,
  getCompanyFromChannel,
  resolveRealPhoneFromBaileys,
  formatWhatsAppPhone
} = require('./storageService');
const { evaluateSchedule } = require('./scheduleService');
const { processIncomingMessage } = require('../../botEngine');

function initWhatsAppHandler(io) {
  // ─── Callback: mensaje entrante (texto + multimedia) ───
  const onMessageCallback = async ({
    company = 'agro',
    channelKey = 'wa_agro',
    remoteJid,
    realPhone,
    fromMe,
    text,
    pushName,
    messageId,
    mediaType,
    mediaUrl,
    mediaLabel,
    mediaMimetype,
    mediaDuration,
    mediaFileName
  }) => {
    // Ignorar si no hay texto ni media
    if (!text && !mediaType) return;

    if (
      !remoteJid ||
      remoteJid === 'status@broadcast' ||
      remoteJid.includes('@broadcast') ||
      remoteJid.includes('@g.us')
    ) {
      return;
    }

    const conversations = getConversations();
    const resolvedPhone = resolveRealPhoneFromBaileys(remoteJid, realPhone);
    const formattedPhone = formatWhatsAppPhone(resolvedPhone);
    const now = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });

    let conv = conversations.find(
      c => c.jid === remoteJid || (resolvedPhone && c.phone === resolvedPhone)
    );

    const detectedChannel = channelKey || (company === 'tracto' ? 'wa_tracto' : 'wa_agro');
    const detectedCompany = company === 'tracto' ? 'Tractopower' : 'Agropower';

    if (!conv) {
      const displayName = (pushName || '').trim() || formattedPhone;
      const initials = displayName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'WA';
      conv = {
        id: Date.now(),
        name: displayName,
        phone: resolvedPhone,
        formattedPhone,
        jid: remoteJid,
        initials,
        company: detectedCompany,
        channel: detectedChannel,
        botActive: true,
        waitingAdvisor: false,
        time: now,
        messages: []
      };
      conversations.unshift(conv);
    } else {
      conv.jid = remoteJid;
      if (resolvedPhone) {
        conv.phone = resolvedPhone;
        conv.formattedPhone = formattedPhone;
      }
      if (!fromMe && pushName && pushName.trim() && conv.name.startsWith('+')) {
        conv.name = pushName.trim();
      }
      if (channelKey) {
        conv.channel = channelKey;
        conv.company = detectedCompany;
      } else {
        conv.channel = normalizeChannel(conv.channel);
        conv.company = getCompanyFromChannel(conv.channel);
      }
    }

    // ─── Mensajes enviados desde el teléfono físico (fromMe) ───
    if (fromMe) {
      const lastMsg = conv.messages[conv.messages.length - 1];
      const displayText = text || mediaLabel || '';
      const suffixedText = `${displayText} (Enviado desde el teléfono físico)`;

      // Deduplicación
      if (
        lastMsg &&
        lastMsg.sender === 'operator' &&
        (lastMsg.text === displayText || lastMsg.text === suffixedText)
      ) {
        return;
      }

      // El asesor/admin respondió desde el teléfono físico: apagar PIDE ASESOR y pausar bot
      conv.waitingAdvisor = false;
      conv.botActive = false;
      conv.attendedBy = 'Teléfono Móvil';

      const msgObj = {
        sender: 'operator',
        text: suffixedText,
        time: now
      };
      if (mediaType) {
        msgObj.mediaType = mediaType;
        msgObj.mediaUrl = mediaUrl || null;
        msgObj.mediaLabel = mediaLabel || null;
      }

      conv.messages.push(msgObj);
      saveConversations(conversations);
      io.emit('conversations_updated', conversations);
      return;
    }

    // ─── Mensaje del cliente ───
    conv.time = now;

    const clientMsg = {
      sender: 'client',
      text: text || mediaLabel || '',
      time: now
    };
    if (mediaType) {
      clientMsg.mediaType = mediaType;
      clientMsg.mediaUrl = mediaUrl || null;
      clientMsg.mediaLabel = mediaLabel || null;
    }
    conv.messages.push(clientMsg);

    // ─── Bot: solo responder si hay texto real (no solo media sin texto) ───
    const hasRealText = text && text !== mediaLabel;

    if (hasRealText) {
      // Si el bot está pausado porque un asesor humano tomó el chat
      if (conv.botActive === false) {
        const clean = text.toLowerCase().trim();
        // Solo reactivar flag si el cliente vuelve a pedir asesor explícitamente
        if (clean === '3' || clean.includes('asesor') || clean.includes('humano')) {
          conv.waitingAdvisor = true;
        }
        saveConversations(conversations);
        io.emit('conversations_updated', conversations);
        return;
      }

      const config = loadBotConfig();
      const schedStatus = evaluateSchedule(config.schedule, config);

      if (!schedStatus.shouldAutoReply) {
        // Dentro del horario laboral: notificar al asesor, no auto-responder
        saveConversations(conversations);
        io.emit('conversations_updated', conversations);
        return;
      }

      // Fuera del horario laboral: usar botEngine
      const botResult = processIncomingMessage(text);

      if (botResult) {
        let replyText = botResult.reply;
        let attachment = botResult.attachment || null;

        if (botResult.pauseBot) {
          conv.waitingAdvisor = true;
        }

        if (replyText) {
          conv.messages.push({
            sender: 'scheduled',
            text: replyText,
            attachment,
            time: now
          });
          await whatsappService.sendText(remoteJid, replyText, conv.channel || conv.company);

          if (botResult.attachmentUrl) {
            try {
              await whatsappService.sendPdf(remoteJid, botResult.attachmentUrl, attachment, conv.channel || conv.company);
            } catch (e) {
              console.error('[Bot] Error enviando documento:', e.message);
            }
          }
        }
      }
    }

    saveConversations(conversations);
    io.emit('conversations_updated', conversations);
  };

  // ─── Callback: chat eliminado desde el móvil ───
  const onChatDeleteCallback = (deletedChatIds) => {
    if (!Array.isArray(deletedChatIds) || deletedChatIds.length === 0) return;

    const conversations = getConversations();
    let changed = false;

    deletedChatIds.forEach(deletedId => {
      const cleanTargetDigits = String(deletedId || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      const resolvedTarget = resolveRealPhoneFromBaileys(deletedId);

      const idx = conversations.findIndex(c => {
        if (c.jid === deletedId) return true;
        if (resolvedTarget && (c.phone === resolvedTarget || c.jid === resolvedTarget)) return true;
        const cleanConvDigits = String(c.phone || c.jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
        if (cleanTargetDigits && cleanConvDigits && cleanTargetDigits === cleanConvDigits) return true;
        return false;
      });

      if (idx !== -1) {
        const removed = conversations[idx];
        console.log(`[WhatsApp] 🗑️ Chat eliminado desde el móvil, removiendo del panel: "${removed.name}" (${deletedId})`);
        conversations.splice(idx, 1);
        changed = true;
      }
    });

    if (changed) {
      saveConversations(conversations);
      io.emit('conversations_updated', conversations);
    }
  };

  whatsappService.init(io, onMessageCallback, onChatDeleteCallback);
}

module.exports = {
  initWhatsAppHandler
};
