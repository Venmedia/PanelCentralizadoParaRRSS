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
    deviceOrigin = 'mobile',
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

    const detectedChannel = channelKey || (company === 'tracto' ? 'wa_tracto' : 'wa_agro');
    const detectedCompany = company === 'tracto' ? 'Tractopower' : 'Agropower';
    const isTracto = (detectedChannel === 'wa_tracto' || detectedCompany === 'Tractopower');
    const defaultCompanyName = isTracto ? 'TractoPower' : 'Agropower';
    const defaultInitials = isTracto ? 'TR' : 'AG';

    const standardJid = (resolvedPhone && resolvedPhone.length >= 10 && resolvedPhone.length <= 13)
      ? `${resolvedPhone}@s.whatsapp.net`
      : remoteJid;

    // Búsqueda estricta por canal y empresa: Agropower y Tractopower NUNCA deben mezclarse
    let conv = conversations.find(c => {
      const cComp = String(c.company || '').toLowerCase();
      const targetComp = detectedCompany.toLowerCase();
      const matchesCompany = (cComp === targetComp) || (c.channel === detectedChannel);
      if (!matchesCompany) return false;

      if (c.jid && (c.jid === remoteJid || c.jid === standardJid)) return true;
      if (c.lid && (c.lid === remoteJid || c.lid === standardJid)) return true;
      if (resolvedPhone && c.phone && c.phone === resolvedPhone) return true;
      return false;
    });

    if (!conv) {
      let clientName = '';
      if (!fromMe && pushName && pushName.trim()) {
        const cleanPush = pushName.trim();
        if (cleanPush !== 'Agropower' && cleanPush !== 'Tractopower' && !cleanPush.startsWith('+')) {
          clientName = cleanPush;
        }
      }
      const displayName = clientName || defaultCompanyName;
      const initials = clientName
        ? clientName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase()
        : defaultInitials;

      conv = {
        id: Date.now(),
        name: displayName,
        phone: resolvedPhone,
        formattedPhone,
        jid: standardJid,
        lid: remoteJid && remoteJid.endsWith('@lid') ? remoteJid : null,
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
      if (remoteJid && remoteJid.endsWith('@lid')) {
        conv.lid = remoteJid;
      }
      if (resolvedPhone && resolvedPhone.length >= 10 && resolvedPhone.length <= 13) {
        conv.jid = `${resolvedPhone}@s.whatsapp.net`;
        conv.phone = resolvedPhone;
        conv.formattedPhone = formattedPhone;
      } else if (!conv.jid || conv.jid.endsWith('@lid')) {
        conv.jid = remoteJid;
      }
      if (!fromMe && pushName && pushName.trim()) {
        const cleanPush = pushName.trim();
        if (cleanPush !== 'Agropower' && cleanPush !== 'Tractopower' && !cleanPush.startsWith('+')) {
          conv.name = cleanPush;
          conv.initials = cleanPush.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || defaultInitials;
        }
      } else if (isTracto && (conv.name === 'Agropower' || conv.name.startsWith('+') || !conv.name)) {
        conv.name = 'TractoPower';
        conv.initials = 'TR';
      }
      // Garantizar que la conversación mantenga su canal y empresa correspondientes
      conv.channel = detectedChannel;
      conv.company = detectedCompany;
    }

    // ─── Mensajes enviados desde fuera del panel (WhatsApp Web o Teléfono Móvil) ───
    if (fromMe) {
      const displayText = text || mediaLabel || '';
      const suffixedText = `${displayText} (Enviado desde el teléfono físico)`;

      // Deduplicación inteligente: descartar si es un eco del bot programado o del operador en el panel
      const recentMatches = conv.messages.slice(-5).some(m => {
        if (m.sender !== 'operator' && m.sender !== 'scheduled') return false;

        // 1. Coincidencia por ID exacto de mensaje
        if (messageId && m.messageId && m.messageId === messageId) return true;

        // 2. Coincidencia por texto idéntico
        if (
          (m.text && displayText && (m.text === displayText || m.text === suffixedText || m.text.trim() === displayText.trim())) ||
          (m.attachment && (m.attachment === displayText || m.attachment === mediaLabel))
        ) {
          if (messageId && !m.messageId) m.messageId = messageId;
          return true;
        }

        // 3. Coincidencia por multimedia/archivo reciente enviado desde el panel
        if (mediaType && m.mediaType === mediaType && (m.origin === 'panel' || m.sender === 'operator')) {
          if (messageId && !m.messageId) m.messageId = messageId;
          return true;
        }

        return false;
      });

      if (recentMatches) {
        // Es un eco del mensaje ya enviado por el bot automático o el panel: ignorar para no duplicar
        console.log(`[WhatsApp] 🔄 Eco de bot/operador detectado y descartado para "${conv.name}": "${displayText.substring(0, 50)}..."`);
        return;
      }

      // El asesor/admin respondió genuinamente desde el exterior del panel:
      // Puede ser desde WhatsApp Web (computadora) o desde el teléfono físico (móvil)
      conv.waitingAdvisor = false;
      conv.botActive = false;
      conv.isRead = true;
      conv.unreadCount = 0;

      const isFromWeb = (deviceOrigin === 'web');
      conv.attendedBy = isFromWeb ? 'WhatsApp Web' : 'Teléfono Móvil';
      conv.attendedByName = isFromWeb ? '💻 Web' : '📱 Móvil';

      const msgObj = {
        sender: 'operator',
        origin: isFromWeb ? 'web' : 'mobile',
        operatorName: isFromWeb ? '💻 Web' : '📱 Móvil',
        operatorUser: isFromWeb ? 'web' : 'mobile',
        text: displayText,
        messageId: messageId || null,
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
    // Deduplicación para cliente: evitar duplicar si ya se registró ese messageId
    if (messageId && conv.messages.some(m => m.messageId === messageId)) {
      return;
    }

    conv.time = now;
    conv.isRead = false;
    conv.unreadCount = 1;
    conv.waitingAdvisor = true;

    const clientMsg = {
      sender: 'client',
      text: text || mediaLabel || '',
      time: now,
      messageId: messageId || null
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
      const targetCompany = (conv.channel === 'wa_tracto' || (conv.company && conv.company.toLowerCase().includes('tracto'))) ? 'tractopower' : 'agropower';
      const config = loadBotConfig();
      const schedStatus = evaluateSchedule(config.schedule, config, targetCompany);

      console.log(`[Bot WhatsApp - ${targetCompany}] 📩 Mensaje entrante de "${conv.name}" (${remoteJid}): "${text}" | Horario VE: ${schedStatus.serverTime} | shouldAutoReply: ${schedStatus.shouldAutoReply}`);

      if (!schedStatus.shouldAutoReply) {
        // Dentro del horario laboral: atención humana directa, no auto-responder
        console.log(`[Bot WhatsApp - ${targetCompany}] ⏸️ Dentro de horario laboral (${schedStatus.workStart} - ${schedStatus.workEnd} VE). Bot en pausa, atención humana asignada.`);
        saveConversations(conversations);
        io.emit('conversations_updated', conversations);
        return;
      }

      // Fuera del horario laboral: procesar mensaje con botEngine
      const clean = text.toLowerCase().trim();
      const isAskingAdvisor = clean === '3' || clean.includes('asesor') || clean.includes('humano');

      const botResult = processIncomingMessage(text, targetCompany);

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
          console.log(`[Bot WhatsApp - ${targetCompany}] 🤖 Respondiendo automáticamente a ${remoteJid}: "${replyText.substring(0, 60)}..."`);
          await whatsappService.sendText(remoteJid, replyText, conv.channel || conv.company);

          const attachFile = botResult.attachment || botResult.attachmentUrl;
          if (attachFile) {
            try {
              console.log(`[Bot WhatsApp - ${targetCompany}] 📄 Enviando documento adjunto a ${remoteJid}: ${attachFile}`);
              await whatsappService.sendPdf(remoteJid, attachFile, replyText, conv.channel || conv.company);
            } catch (e) {
              console.error(`[Bot WhatsApp - ${targetCompany}] ❌ Error enviando documento:`, e.message);
            }
          }
        }
      }
    }

    saveConversations(conversations);
    io.emit('conversations_updated', conversations);
  };

  // ─── Callback: chat eliminado desde el móvil ───
  const onChatDeleteCallback = (deletedChatIds, company = null) => {
    if (!Array.isArray(deletedChatIds) || deletedChatIds.length === 0) return;

    const conversations = getConversations();
    let changed = false;

    deletedChatIds.forEach(deletedId => {
      const cleanTargetDigits = String(deletedId || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      const resolvedTarget = resolveRealPhoneFromBaileys(deletedId);

      const idx = conversations.findIndex(c => {
        if (company) {
          const cComp = String(c.company || '').toLowerCase();
          const targetComp = String(company).toLowerCase();
          const matches = (cComp === targetComp) || 
                          (targetComp.includes('agro') && c.channel === 'wa_agro') || 
                          (targetComp.includes('tracto') && c.channel === 'wa_tracto');
          if (!matches) return false;
        }
        if (c.jid === deletedId) return true;
        if (resolvedTarget && (c.phone === resolvedTarget || c.jid === resolvedTarget)) return true;
        const cleanConvDigits = String(c.phone || c.jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
        if (cleanTargetDigits && cleanConvDigits && cleanTargetDigits === cleanConvDigits) return true;
        return false;
      });

      if (idx !== -1) {
        const removed = conversations[idx];
        console.log(`[WhatsApp] 🗑️ Chat eliminado desde el móvil, removiendo del panel: "${removed.name}" (${deletedId}) [${removed.channel}]`);
        conversations.splice(idx, 1);
        changed = true;
      }
    });

    if (changed) {
      saveConversations(conversations);
      io.emit('conversations_updated', conversations);
    }
  };

    // ─── Callback: sincronización de historial desde el móvil (History Sync / chats.set) ───
  const onHistorySyncCallback = async ({
    company = 'agro',
    channelKey = 'wa_agro',
    chats = [],
    contacts = [],
    contactsMap = null,
    messages = [],
    isLatest = false
  }) => {
    if ((!chats || chats.length === 0) && (!messages || messages.length === 0)) return;

    const conversations = getConversations();
    const detectedCompany = company === 'tracto' ? 'Tractopower' : 'Agropower';
    const detectedChannel = channelKey || (company === 'tracto' ? 'wa_tracto' : 'wa_agro');

    const contactNames = new Map();
    if (contactsMap && typeof contactsMap.forEach === 'function') {
      contactsMap.forEach((v, k) => {
        if (v) contactNames.set(k, v);
      });
    }
    (contacts || []).forEach(ct => {
      if (ct.id) {
        const name = (ct.name || ct.notify || ct.verifiedName || '').trim();
        if (name) contactNames.set(ct.id, name);
      }
    });

    const messagesByJid = new Map();
    (messages || []).forEach(m => {
      const jid = m.key?.remoteJid;
      if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') return;
      if (!messagesByJid.has(jid)) messagesByJid.set(jid, []);
      messagesByJid.get(jid).push(m);
    });

    let changed = false;

    const allJids = new Set();
    (chats || []).forEach(c => c.id && allJids.add(c.id));
    for (const jid of messagesByJid.keys()) {
      allJids.add(jid);
    }

    for (const rawJid of allJids) {
      if (!rawJid || rawJid.includes('@g.us') || rawJid.includes('@broadcast') || rawJid.includes('@newsletter') || rawJid === 'status@broadcast') {
        continue;
      }

      const chatObj = (chats || []).find(c => c.id === rawJid) || {};
      const chatMsgs = messagesByJid.get(rawJid) || [];

      // Ordenar mensajes cronológicamente
      chatMsgs.sort((a, b) => {
        const ta = a.messageTimestamp ? (typeof a.messageTimestamp === 'object' ? (a.messageTimestamp.low || 0) : Number(a.messageTimestamp)) : 0;
        const tb = b.messageTimestamp ? (typeof b.messageTimestamp === 'object' ? (b.messageTimestamp.low || 0) : Number(b.messageTimestamp)) : 0;
        return ta - tb;
      });

      let realPhone = '';
      if (chatObj.pnJid) {
        realPhone = String(chatObj.pnJid).split('@')[0].split(':')[0].replace(/\D/g, '');
      }
      if (!realPhone) {
        realPhone = whatsappService.resolveRealPhoneFromJid(rawJid, null, company);
      }
      const formattedPhone = formatWhatsAppPhone(realPhone);

      const isTracto = (detectedChannel === 'wa_tracto' || company === 'tracto' || detectedCompany === 'Tractopower');
      const defaultCompanyName = isTracto ? 'TractoPower' : 'Agropower';
      const defaultInitials = isTracto ? 'TR' : 'AG';

      // Búsqueda estricta por canal y empresa: Agropower y Tractopower NUNCA deben mezclarse
      let conv = conversations.find(c => {
        const cComp = String(c.company || '').toLowerCase();
        const targetComp = detectedCompany.toLowerCase();
        const matchesCompany = (cComp === targetComp) || (c.channel === detectedChannel);
        if (!matchesCompany) return false;
        return c.jid === rawJid || (realPhone && c.phone === realPhone);
      });

      let contactName = contactNames.get(rawJid) || chatObj.displayName || chatObj.name || chatObj.username || '';
      if (!contactName && realPhone) {
        contactName = contactNames.get(`${realPhone}@s.whatsapp.net`) || '';
      }
      if (!contactName) {
        const clientMsgWithPush = chatMsgs.find(m => !m.key?.fromMe && m.pushName);
        if (clientMsgWithPush) contactName = clientMsgWithPush.pushName;
      }

      if (contactName === 'Agropower' && isTracto) {
        contactName = '';
      }
      if (contactName === 'Tractopower' && !isTracto) {
        contactName = '';
      }

      const displayName = contactName || defaultCompanyName;
      const initials = contactName
        ? contactName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase()
        : defaultInitials;

      let tsMs = Date.now();
      if (chatObj.conversationTimestamp) {
        const raw = typeof chatObj.conversationTimestamp === 'object' && chatObj.conversationTimestamp !== null
          ? (chatObj.conversationTimestamp.low || Number(chatObj.conversationTimestamp))
          : Number(chatObj.conversationTimestamp);
        if (!isNaN(raw) && raw > 0) {
          tsMs = raw > 1e11 ? raw : raw * 1000;
        }
      } else if (chatMsgs.length > 0) {
        const lastM = chatMsgs[chatMsgs.length - 1];
        const mTs = lastM.messageTimestamp;
        if (mTs) {
          const rawM = typeof mTs === 'object' && mTs !== null ? (mTs.low || Number(mTs)) : Number(mTs);
          if (!isNaN(rawM) && rawM > 0) {
            tsMs = rawM > 1e11 ? rawM : rawM * 1000;
          }
        }
      }

      const formattedTime = new Date(tsMs).toLocaleString('es-VE', {
        timeZone: 'America/Caracas',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });

      const isChatUnread = Boolean(chatObj.unreadCount && chatObj.unreadCount > 0);
      if (!conv) {
        conv = {
          id: tsMs + Math.floor(Math.random() * 1000),
          name: displayName,
          phone: realPhone,
          formattedPhone,
          jid: rawJid,
          initials,
          company: detectedCompany,
          channel: detectedChannel,
          botActive: true,
          waitingAdvisor: false,
          time: formattedTime,
          isRead: !isChatUnread,
          unreadCount: isChatUnread ? 1 : 0,
          messages: []
        };
        conversations.push(conv);
        changed = true;
      } else {
        if (contactName && (conv.name.startsWith('+') || conv.name === 'Contacto WhatsApp' || !conv.name)) {
          conv.name = contactName;
          changed = true;
        }
        if (!conv.jid) {
          conv.jid = rawJid;
          changed = true;
        }
        if (realPhone && !conv.phone) {
          conv.phone = realPhone;
          conv.formattedPhone = formattedPhone;
          changed = true;
        }
        if (!conv.channel) {
          conv.channel = detectedChannel;
          conv.company = detectedCompany;
          changed = true;
        }
        if (isChatUnread) {
          conv.isRead = false;
          conv.unreadCount = 1;
          changed = true;
        }
      }

      for (const m of chatMsgs) {
        const fromMe = m.key?.fromMe;
        let rawMessage = m.message;
        if (!rawMessage) continue;

        // Desempaquetar mensajes efímeros o de visualización única
        if (rawMessage.ephemeralMessage?.message) rawMessage = rawMessage.ephemeralMessage.message;
        if (rawMessage.viewOnceMessage?.message) rawMessage = rawMessage.viewOnceMessage.message;
        if (rawMessage.viewOnceMessageV2?.message) rawMessage = rawMessage.viewOnceMessageV2.message;
        if (rawMessage.documentWithCaptionMessage?.message) rawMessage = rawMessage.documentWithCaptionMessage.message;

        let text =
          rawMessage.conversation ||
          rawMessage.extendedTextMessage?.text ||
          rawMessage.imageMessage?.caption ||
          rawMessage.videoMessage?.caption ||
          rawMessage.documentMessage?.caption ||
          '';

        const mediaInfo = whatsappService.detectMediaType(rawMessage);
        if (!text && mediaInfo) text = mediaInfo.label;
        if (!text) continue;

        const rawMts = m.messageTimestamp;
        const mTs = rawMts
          ? (typeof rawMts === 'object' && rawMts !== null
              ? (rawMts.low ? (rawMts.low > 1e11 ? rawMts.low : rawMts.low * 1000) : Date.now())
              : (Number(rawMts) > 1e11 ? Number(rawMts) : Number(rawMts) * 1000))
          : tsMs;

        const msgTime = new Date(mTs).toLocaleString('es-VE', {
          timeZone: 'America/Caracas',
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });

        const alreadyExists = conv.messages.some(existing => {
          if (m.key?.id && existing.messageId && existing.messageId === m.key.id) return true;
          return (
            existing.sender === (fromMe ? 'operator' : 'client') &&
            existing.text === text &&
            existing.time === msgTime
          );
        });
        if (!alreadyExists) {
          conv.messages.push({
            sender: fromMe ? 'operator' : 'client',
            origin: fromMe ? 'mobile' : undefined,
            operatorName: fromMe ? '📱 Móvil' : undefined,
            operatorUser: fromMe ? 'mobile' : undefined,
            text: text,
            time: msgTime,
            messageId: m.key?.id || null,
            mediaType: mediaInfo?.type || null,
            mediaLabel: mediaInfo?.label || null
          });
          changed = true;
        }
      }

      // Si se agregaron mensajes, actualizar conv.time con la hora del mensaje más reciente
      if (conv.messages && conv.messages.length > 0) {
        const lastMsg = conv.messages[conv.messages.length - 1];
        if (lastMsg && lastMsg.time) {
          conv.time = lastMsg.time;
        }
      }
    }

    if (changed) {
      saveConversations(conversations);
      io.emit('conversations_updated', conversations);
      console.log(`[WhatsApp ${detectedCompany}] 📥 Historial sincronizado con éxito. Total conversaciones: ${conversations.length}`);
    }
  };

  whatsappService.init(io, onMessageCallback, onChatDeleteCallback, onHistorySyncCallback);
}

module.exports = {
  initWhatsAppHandler
};
