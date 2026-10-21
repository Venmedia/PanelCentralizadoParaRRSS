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
    const now = new Date().toLocaleString('es-VE', {
      timeZone: 'America/Caracas',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

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
      const displayText = text || mediaLabel || '';
      const suffixedText = `${displayText} (Enviado desde el teléfono físico)`;

      // Deduplicación inteligente: descartar si es un eco del bot programado o del operador en el panel
      const recentMatches = conv.messages.slice(-5).some(m =>
        (m.sender === 'operator' || m.sender === 'scheduled') &&
        (
          m.text === displayText ||
          m.text === suffixedText ||
          (m.text && displayText && m.text.trim() === displayText.trim()) ||
          (m.attachment && (m.attachment === displayText || m.attachment === mediaLabel))
        )
      );

      if (recentMatches) {
        // Es un eco del mensaje ya enviado por el bot automático o el panel: ignorar para no duplicar
        console.log(`[WhatsApp] 🔄 Eco de bot/operador detectado y descartado para "${conv.name}": "${displayText.substring(0, 50)}..."`);
        return;
      }

      // El asesor/admin respondió genuinamente desde el teléfono físico: apagar PIDE ASESOR y pausar bot
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
      const config = loadBotConfig();
      const schedStatus = evaluateSchedule(config.schedule, config);

      console.log(`[Bot WhatsApp] 📩 Mensaje entrante de "${conv.name}" (${remoteJid}): "${text}" | Horario VE: ${schedStatus.serverTime} | shouldAutoReply: ${schedStatus.shouldAutoReply}`);

      if (!schedStatus.shouldAutoReply) {
        // Dentro del horario laboral: atención humana directa, no auto-responder
        console.log(`[Bot WhatsApp] ⏸️ Dentro de horario laboral (${schedStatus.workStart} - ${schedStatus.workEnd} VE). Bot en pausa, atención humana asignada.`);
        saveConversations(conversations);
        io.emit('conversations_updated', conversations);
        return;
      }

      // Fuera del horario laboral: procesar mensaje con botEngine
      const clean = text.toLowerCase().trim();
      const isAskingAdvisor = clean === '3' || clean.includes('asesor') || clean.includes('humano');

      const botResult = processIncomingMessage(text);

      if (botResult) {
        let replyText = botResult.reply;
        let attachment = botResult.attachment || null;

        if (botResult.pauseBot || isAskingAdvisor) {
          conv.waitingAdvisor = true;
          conv.botActive = false;
        } else {
          conv.botActive = true;
        }

        if (replyText) {
          conv.messages.push({
            sender: 'scheduled',
            text: replyText,
            attachment,
            time: now
          });
          console.log(`[Bot WhatsApp] 🤖 Respondiendo automáticamente a ${remoteJid}: "${replyText.substring(0, 60)}..."`);
          await whatsappService.sendText(remoteJid, replyText, conv.channel || conv.company);

          if (botResult.attachmentUrl) {
            try {
              console.log(`[Bot WhatsApp] 📄 Enviando documento adjunto a ${remoteJid}: ${botResult.attachmentUrl}`);
              await whatsappService.sendPdf(remoteJid, botResult.attachmentUrl, attachment, conv.channel || conv.company);
            } catch (e) {
              console.error('[Bot WhatsApp] ❌ Error enviando documento:', e.message);
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
