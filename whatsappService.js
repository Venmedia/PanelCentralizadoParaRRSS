const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, getDevice } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

class WhatsAppService {
  constructor() {
    this.io = null;
    this.onMessageCallback = null;
    this.onChatDeleteCallback = null;
    this.onHistorySyncCallback = null;
    this.mediaFolder = path.join(__dirname, 'public', 'media', 'whatsapp');
    this.engineMode = 'integrated'; // 'integrated' o 'evolution'
    this.evolutionConfig = {
      url: 'http://localhost:8080',
      apiKey: 'omnipanel_secret_key',
      instance: 'whatsapp_principal'
    };

    // Registro de mensajes enviados desde el panel para deduplicación estricta de ecos
    this.panelSentMessageIds = new Map();

    // Sesiones duales independientes para Agropower y Tractopower
    this.sessions = {
      agro: {
        company: 'agro',
        companyName: 'Agropower',
        channelKey: 'wa_agro',
        authFolder: path.join(__dirname, 'auth_info_baileys'),
        sock: null,
        reconnectTimer: null,
        qrCodeBase64: null,
        connectionStatus: 'disconnected', // 'disconnected', 'connecting', 'qr_ready', 'connected'
        userProfile: null,
        knownJids: new Set(),
        contactsMap: new Map()
      },
      tracto: {
        company: 'tracto',
        companyName: 'Tractopower',
        channelKey: 'wa_tracto',
        authFolder: path.join(__dirname, 'auth_info_baileys_tracto'),
        sock: null,
        reconnectTimer: null,
        qrCodeBase64: null,
        connectionStatus: 'disconnected',
        userProfile: null,
        knownJids: new Set(),
        contactsMap: new Map()
      }
    };

    // Asegurar directorios requeridos
    if (!fs.existsSync(this.mediaFolder)) {
      fs.mkdirSync(this.mediaFolder, { recursive: true });
    }
  }

  // Getters para retrocompatibilidad
  get sock() {
    return this.sessions.agro.sock || this.sessions.tracto.sock;
  }
  get qrCodeBase64() {
    return this.sessions.agro.qrCodeBase64;
  }
  get connectionStatus() {
    return this.sessions.agro.connectionStatus;
  }
  get userProfile() {
    return this.sessions.agro.userProfile;
  }
  get authFolder() {
    return this.sessions.agro.authFolder;
  }
  get knownJids() {
    return this.sessions.agro.knownJids;
  }

  /**
   * Retorna el Set de JIDs conocidos de la empresa indicada
   */
  getKnownJids(company = 'agro') {
    const s = this.sessions[company] || this.sessions.agro;
    return s.knownJids;
  }

  /**
   * Registra un mensaje como enviado desde el panel para interceptar y descartar su eco
   */
  registerPanelSentMessage(msgId, info = {}) {
    if (!msgId) return;
    this.panelSentMessageIds.set(msgId, {
      timestamp: Date.now(),
      ...info
    });
    // Limpieza de mensajes con más de 15 minutos
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [id, data] of this.panelSentMessageIds.entries()) {
      if (data.timestamp < cutoff) {
        this.panelSentMessageIds.delete(id);
      }
    }
  }

  /**
   * Verifica si un ID de mensaje fue generado por un envío del propio panel
   */
  isPanelSentMessage(msgId) {
    if (!msgId) return false;
    return this.panelSentMessageIds.has(msgId);
  }

  /**
   * Resuelve el número real de WhatsApp incluso cuando Baileys recibe un identificador @lid
   */
  resolveRealPhoneFromJid(remoteJid, senderPn = null, company = 'agro') {
    try {
      if (senderPn && typeof senderPn === 'string') {
        const cleanSender = senderPn.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (cleanSender.length >= 10 && cleanSender.length <= 15) {
          return cleanSender;
        }
      }

      const rawId = String(remoteJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      if (!rawId) return '';

      const s = this.sessions[company] || this.sessions.agro;
      const reverseMapPath = path.join(s.authFolder, `lid-mapping-${rawId}_reverse.json`);
      if (fs.existsSync(reverseMapPath)) {
        const mappedPhone = JSON.parse(fs.readFileSync(reverseMapPath, 'utf8'));
        if (mappedPhone && typeof mappedPhone === 'string') {
          return mappedPhone.replace(/\D/g, '');
        }
      }

      return rawId;
    } catch (e) {
      return String(remoteJid || '').split('@')[0].split(':')[0];
    }
  }

  init(io, onMessageCallback, onChatDeleteCallback, onHistorySyncCallback) {
    this.io = io;
    this.onMessageCallback = onMessageCallback;
    this.onChatDeleteCallback = onChatDeleteCallback || null;
    this.onHistorySyncCallback = onHistorySyncCallback || null;

    // Iniciar Línea 1 (Agropower - sesión principal actual)
    this.startIntegrated('agro');

    // Iniciar Línea 2 (Tractopower) si ya existen credenciales guardadas de escaneo previo
    const tractoCreds = path.join(this.sessions.tracto.authFolder, 'creds.json');
    if (fs.existsSync(tractoCreds)) {
      console.log('[WhatsApp] 🚜 Sesión previa de Tractopower detectada. Reconectando...');
      this.startIntegrated('tracto');
    } else {
      console.log('[WhatsApp] 🚜 Tractopower en reposo (Listo para generar QR cuando el admin lo solicite).');
    }

    // Watchdog activo 24/7 (cada 60 segundos): verifica la salud de los sockets y reanuda conexiones caídas
    if (!this.watchdogInterval) {
      this.watchdogInterval = setInterval(() => {
        ['agro', 'tracto'].forEach(comp => {
          const s = this.sessions[comp];
          if (!s) return;
          const credsFile = path.join(s.authFolder, 'creds.json');
          if (fs.existsSync(credsFile) && s.connectionStatus === 'disconnected' && !s.reconnectTimer) {
            console.log(`[Watchdog WhatsApp ${s.companyName}] 🔄 Socket desconectado detectado. Reanudando conexión automáticamente...`);
            this.startIntegrated(comp).catch(err => {
              console.error(`[Watchdog WhatsApp ${s.companyName}] ❌ Error en reanudación:`, err.message);
            });
          }
        });
      }, 60000);
    }
  }

  /**
   * Desempaqueta mensajes anidados de Baileys (efímeros, viewOnce, documentos con caption, etc.)
   */
  unwrapMessage(rawMessage) {
    if (!rawMessage) return {};
    let current = rawMessage;
    while (
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.documentWithCaptionMessage?.message ||
      current.editedMessage?.message?.protocolMessage?.editedMessage
    ) {
      current =
        current.ephemeralMessage?.message ||
        current.viewOnceMessage?.message ||
        current.viewOnceMessageV2?.message ||
        current.documentWithCaptionMessage?.message ||
        current.editedMessage?.message?.protocolMessage?.editedMessage;
    }
    return current;
  }

  /**
   * Extrae el texto legible de un mensaje de Baileys considerando todos los formatos posibles
   */
  extractMessageText(message) {
    if (!message) return '';
    return (
      message.conversation ||
      message.extendedTextMessage?.text ||
      message.imageMessage?.caption ||
      message.videoMessage?.caption ||
      message.documentMessage?.caption ||
      message.buttonsResponseMessage?.selectedDisplayText ||
      message.buttonsResponseMessage?.selectedButtonId ||
      message.listResponseMessage?.title ||
      message.listResponseMessage?.singleSelectReply?.selectedRowId ||
      message.templateButtonReplyMessage?.selectedDisplayText ||
      message.templateButtonReplyMessage?.selectedId ||
      message.interactiveResponseMessage?.body?.text ||
      message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
      ''
    );
  }

  /**
   * Detecta el tipo de media en un mensaje de Baileys y extrae la info relevante
   */
  detectMediaType(rawMessage) {
    const message = this.unwrapMessage(rawMessage);
    if (!message) return null;

    if (message.imageMessage) {
      return {
        type: 'image',
        mimetype: message.imageMessage.mimetype || 'image/jpeg',
        caption: message.imageMessage.caption || '',
        fileLength: message.imageMessage.fileLength || 0,
        label: '📷 Imagen'
      };
    }
    if (message.videoMessage) {
      return {
        type: 'video',
        mimetype: message.videoMessage.mimetype || 'video/mp4',
        caption: message.videoMessage.caption || '',
        seconds: message.videoMessage.seconds || 0,
        label: '🎬 Video'
      };
    }
    if (message.audioMessage) {
      const isVoiceNote = message.audioMessage.ptt === true;
      return {
        type: 'audio',
        mimetype: message.audioMessage.mimetype || 'audio/ogg',
        seconds: message.audioMessage.seconds || 0,
        isVoiceNote,
        label: isVoiceNote ? '🎤 Nota de voz' : '🎵 Audio'
      };
    }
    if (message.documentMessage) {
      return {
        type: 'document',
        mimetype: message.documentMessage.mimetype || 'application/octet-stream',
        fileName: message.documentMessage.fileName || 'documento',
        caption: message.documentMessage.caption || '',
        label: '📄 Documento'
      };
    }
    if (message.stickerMessage) {
      return {
        type: 'sticker',
        mimetype: message.stickerMessage.mimetype || 'image/webp',
        label: '🎭 Sticker'
      };
    }
    if (message.contactMessage || message.contactsArrayMessage) {
      return {
        type: 'contact',
        label: '👤 Contacto'
      };
    }
    if (message.locationMessage || message.liveLocationMessage) {
      const loc = message.locationMessage || message.liveLocationMessage;
      return {
        type: 'location',
        latitude: loc.degreesLatitude,
        longitude: loc.degreesLongitude,
        label: '📍 Ubicación'
      };
    }

    return null;
  }

  /**
   * Descarga y guarda un archivo multimedia de WhatsApp
   */
  async downloadAndSaveMedia(msg, mediaInfo, unwrappedMessage = null) {
    try {
      const targetMsg = unwrappedMessage ? { key: msg.key, message: unwrappedMessage } : msg;
      const buffer = await downloadMediaMessage(targetMsg, 'buffer', {});
      if (!buffer || buffer.length === 0) return null;

      const ext = this.getExtFromMime(mediaInfo.mimetype);
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = path.join(this.mediaFolder, fileName);
      fs.writeFileSync(filePath, buffer);
      return `/media/whatsapp/${fileName}`;
    } catch (e) {
      console.error('[WhatsApp] Error descargando media:', e.message);
      return null;
    }
  }

  getExtFromMime(mimetype) {
    const map = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
      'video/mp4': 'mp4', 'video/3gpp': '3gp',
      'audio/ogg': 'ogg', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
    };
    return map[mimetype] || 'bin';
  }

  /**
   * Inicia o reinicia la conexión integrada de Baileys para una empresa específica ('agro' o 'tracto')
   */
  async startIntegrated(company = 'agro') {
    if (this.engineMode !== 'integrated') return;
    const session = this.sessions[company] || this.sessions.agro;

    // Limpiar temporizadores pendientes y cerrar sockets existentes para evitar conflictos (440 stream replaced)
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }

    if (session.sock) {
      try {
        session.sock.ev.removeAllListeners();
        session.sock.end();
      } catch (e) {}
      session.sock = null;
    }

    session.connectionStatus = 'connecting';
    this.broadcastStatus(company);

    try {
      if (!fs.existsSync(session.authFolder)) {
        fs.mkdirSync(session.authFolder, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(session.authFolder);

      session.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: true,
        shouldSyncHistoryMessage: () => true,
        browser: [`OmniPanel Consorcio (${session.companyName})`, 'Chrome', '1.0.0']
      });

      session.sock.ev.on('creds.update', saveCreds);

      session.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          session.connectionStatus = 'qr_ready';
          session.qrCodeBase64 = await QRCode.toDataURL(qr);
          console.log(`[WhatsApp ${session.companyName}] 📱 Nuevo Código QR generado y listo para escanear`);
          this.broadcastStatus(company);
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error)?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          const isReplaced = statusCode === DisconnectReason.connectionReplaced;
          const shouldReconnect = !isLoggedOut;

          console.log(`[WhatsApp ${session.companyName}] Conexión cerrada (código: ${statusCode || 'n/a'}). ¿Reconectar?:`, shouldReconnect);
          session.connectionStatus = 'disconnected';
          session.userProfile = null;
          this.broadcastStatus(company);

          if (session.sock) {
            try {
              session.sock.ev.removeAllListeners();
              session.sock.end();
            } catch (e) {}
            session.sock = null;
          }

          if (isLoggedOut) {
            console.log(`[WhatsApp ${session.companyName}] 🚪 Sesión cerrada desde el dispositivo móvil.`);
            return;
          }

          if (shouldReconnect) {
            if (session.reconnectTimer) {
              clearTimeout(session.reconnectTimer);
            }
            // Si fue reemplazado (440), pausa de 15 segundos para evitar bucles continuos
            const delay = isReplaced ? 15000 : 3500;
            console.log(`[WhatsApp ${session.companyName}] ⏳ Reintentando conexión en ${delay / 1000}s...`);
            session.reconnectTimer = setTimeout(() => {
              session.reconnectTimer = null;
              this.startIntegrated(company);
            }, delay);
          }
        } else if (connection === 'open') {
          if (session.reconnectTimer) {
            clearTimeout(session.reconnectTimer);
            session.reconnectTimer = null;
          }
          session.connectionStatus = 'connected';
          session.qrCodeBase64 = null;
          const userJid = session.sock.user?.id || '';
          const phone = userJid.split(':')[0] || userJid.split('@')[0];

          session.userProfile = {
            phone: phone,
            name: session.sock.user?.name || `Línea WhatsApp ${session.companyName}`,
            connectedAt: new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' })
          };
          console.log(`[WhatsApp ${session.companyName}] 🟢 ¡CONECTADO EXITOSAMENTE! Número:`, phone);
          this.broadcastStatus(company);
        }
      });

      // ─── Recepción de mensajes (texto + multimedia) ───
      session.sock.ev.on('messages.upsert', async (m) => {
        if (!m.messages || !Array.isArray(m.messages) || m.messages.length === 0) return;

        for (const msg of m.messages) {
          try {
            if (!msg.message) continue;

            const remoteJid = msg.key?.remoteJid || '';
            if (
              !remoteJid ||
              remoteJid.includes('@g.us') ||
              remoteJid === 'status@broadcast' ||
              remoteJid.includes('@broadcast') ||
              remoteJid.includes('@newsletter')
            ) {
              continue;
            }

            const fromMe = Boolean(msg.key?.fromMe);
            const msgId = msg.key?.id || '';

            // Si es un eco de un mensaje enviado desde el propio panel, descartarlo de inmediato para no duplicar ni alterar el asesor
            if (fromMe && this.isPanelSentMessage(msgId)) {
              console.log(`[WhatsApp ${session.companyName}] 🔄 Eco de mensaje enviado desde el panel (${msgId}). Omitiendo duplicado.`);
              continue;
            }

            // Para mensajes enviados fuera del panel (fromMe: true), detectar si salió de WhatsApp Web o del Teléfono Móvil
            let deviceOrigin = 'mobile';
            if (fromMe) {
              const rawDev = getDevice(msgId);
              if (rawDev === 'web' || rawDev === 'desktop' || String(msgId).startsWith('3EB0') || String(msgId).startsWith('3F')) {
                deviceOrigin = 'web';
              } else if (rawDev === 'android' || rawDev === 'ios') {
                deviceOrigin = 'mobile';
              } else if (msg.key?.participant && /:\d+@/.test(msg.key.participant)) {
                const match = msg.key.participant.match(/:(\d+)@/);
                if (match && parseInt(match[1], 10) > 0) {
                  deviceOrigin = 'web';
                }
              }
            }

            const rawMessage = this.unwrapMessage(msg.message);
            let text = this.extractMessageText(rawMessage);

            const mediaInfo = this.detectMediaType(rawMessage);
            let mediaUrl = null;
            let mediaLabel = null;

            if (mediaInfo) {
              mediaLabel = mediaInfo.label;
              if (mediaInfo.seconds) {
                const mins = Math.floor(mediaInfo.seconds / 60);
                const secs = mediaInfo.seconds % 60;
                mediaLabel += ` (${mins}:${String(secs).padStart(2, '0')})`;
              }
              if (mediaInfo.fileName) {
                mediaLabel += ` — ${mediaInfo.fileName}`;
              }

              if (['image', 'audio', 'video', 'document', 'sticker'].includes(mediaInfo.type)) {
                mediaUrl = await this.downloadAndSaveMedia(msg, mediaInfo, rawMessage);
              }

              if (!text) {
                text = mediaLabel;
              }
            }

            if (!text && !mediaInfo) continue;

            session.knownJids.add(remoteJid);

            const senderPn =
              msg.key?.senderPn ||
              msg.key?.remoteJidAlt ||
              (msg.key?.participant && msg.key.participant.includes('@s.whatsapp.net') ? msg.key.participant : null) ||
              null;

            const realPhone = this.resolveRealPhoneFromJid(remoteJid, senderPn, session.company);

            if (this.onMessageCallback) {
              await this.onMessageCallback({
                company: session.company,
                channelKey: session.channelKey,
                remoteJid,
                realPhone,
                fromMe,
                deviceOrigin,
                text: text || mediaLabel || '',
                pushName: msg.pushName || '',
                messageId: msg.key?.id || '',
                mediaType: mediaInfo?.type || null,
                mediaUrl: mediaUrl,
                mediaLabel: mediaLabel,
                mediaMimetype: mediaInfo?.mimetype || null,
                mediaDuration: mediaInfo?.seconds || null,
                mediaFileName: mediaInfo?.fileName || null
              });
            }
          } catch (itemErr) {
            console.error(`[WhatsApp ${session.companyName}] Error procesando mensaje upsert:`, itemErr.message);
          }
        }
      });

      // ─── Sincronización completa de historial (chats, contactos y mensajes) ───
      session.sock.ev.on('contacts.set', ({ contacts }) => {
        if (Array.isArray(contacts)) {
          contacts.forEach(c => {
            if (c.id) {
              const name = (c.name || c.notify || c.verifiedName || '').trim();
              if (name) session.contactsMap.set(c.id, name);
            }
          });
          console.log(`[WhatsApp ${session.companyName}] 👥 Contactos cargados: ${session.contactsMap.size}`);
        }
      });

      session.sock.ev.on('contacts.upsert', (newContacts) => {
        if (Array.isArray(newContacts)) {
          newContacts.forEach(c => {
            if (c.id) {
              const name = (c.name || c.notify || c.verifiedName || '').trim();
              if (name) session.contactsMap.set(c.id, name);
            }
          });
        }
      });

      session.sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
        console.log(`[WhatsApp ${session.companyName}] 📥 History Sync recibido: ${chats?.length || 0} chats, ${contacts?.length || 0} contactos, ${messages?.length || 0} mensajes`);
        if (Array.isArray(contacts)) {
          contacts.forEach(c => {
            if (c.id) {
              const name = (c.name || c.notify || c.verifiedName || '').trim();
              if (name) session.contactsMap.set(c.id, name);
            }
          });
        }
        if (Array.isArray(chats)) {
          chats.forEach(chat => {
            if (chat.id && !chat.id.includes('@g.us') && !chat.id.includes('@broadcast') && !chat.id.includes('@newsletter')) {
              session.knownJids.add(chat.id);
            }
          });
        }
        if (this.onHistorySyncCallback) {
          try {
            await this.onHistorySyncCallback({
              company: session.company,
              channelKey: session.channelKey,
              chats: chats || [],
              contacts: contacts || [],
              contactsMap: session.contactsMap,
              messages: messages || [],
              isLatest: !!isLatest
            });
          } catch (err) {
            console.error(`[WhatsApp ${session.companyName}] ❌ Error en onHistorySyncCallback:`, err.message);
          }
        }
      });

      // ─── Registro de chats activos ───
      session.sock.ev.on('chats.set', async ({ chats }) => {
        if (Array.isArray(chats)) {
          chats.forEach(chat => {
            if (chat.id && !chat.id.includes('@g.us') && !chat.id.includes('@broadcast') && !chat.id.includes('@newsletter')) {
              session.knownJids.add(chat.id);
            }
          });
          console.log(`[WhatsApp ${session.companyName}] 📋 Chats cargados en knownJids: ${session.knownJids.size}`);
        }
        if (this.onHistorySyncCallback && Array.isArray(chats) && chats.length > 0) {
          try {
            await this.onHistorySyncCallback({
              company: session.company,
              channelKey: session.channelKey,
              chats: chats,
              contacts: [],
              contactsMap: session.contactsMap,
              messages: [],
              isLatest: false
            });
          } catch (err) {}
        }
      });

      session.sock.ev.on('chats.upsert', async (chats) => {
        if (Array.isArray(chats)) {
          chats.forEach(chat => {
            if (chat.id && !chat.id.includes('@g.us') && !chat.id.includes('@broadcast') && !chat.id.includes('@newsletter')) {
              session.knownJids.add(chat.id);
            }
          });
        }
        if (this.onHistorySyncCallback && Array.isArray(chats) && chats.length > 0) {
          try {
            await this.onHistorySyncCallback({
              company: session.company,
              channelKey: session.channelKey,
              chats: chats,
              contacts: [],
              contactsMap: session.contactsMap,
              messages: [],
              isLatest: false
            });
          } catch (err) {}
        }
      });

      // ─── Eliminación de chats desde el móvil ───
      session.sock.ev.on('chats.delete', (deletedChatIds) => {
        console.log(`[WhatsApp ${session.companyName}] 🗑️ Chats eliminados desde el móvil:`, deletedChatIds);
        if (Array.isArray(deletedChatIds)) {
          deletedChatIds.forEach(jid => session.knownJids.delete(jid));
          if (this.onChatDeleteCallback) {
            this.onChatDeleteCallback(deletedChatIds, session.company);
          }
        }
      });

    } catch (err) {
      console.error(`[WhatsApp ${session.companyName} Error]:`, err);
      session.connectionStatus = 'disconnected';
      this.broadcastStatus(company);
    }
  }

  /**
   * Resuelve y formatea el JID destino óptimo para envío.
   * Si recibe un @lid, lo traduce al número de teléfono real (@s.whatsapp.net) mediante el mapeo inverso.
   * Esto garantiza que los mensajes lleguen al teléfono del cliente y se sincronicen en WhatsApp Web.
   */
  formatJidForSending(remoteJid, company = 'agro') {
    if (!remoteJid) return '';
    let jid = String(remoteJid).trim();

    // Grupos de WhatsApp se envían siempre a su JID (@g.us)
    if (jid.includes('@g.us')) return jid;

    // Si ya es un JID con número de teléfono
    if (jid.endsWith('@s.whatsapp.net')) return jid;

    // Si es un identificador de dispositivo @lid, resolver el número telefónico real
    if (jid.endsWith('@lid')) {
      const rawLid = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
      const s = this.sessions[company] || this.sessions.agro;
      const reverseMapPath = path.join(s.authFolder, `lid-mapping-${rawLid}_reverse.json`);
      if (fs.existsSync(reverseMapPath)) {
        try {
          const mappedPhone = JSON.parse(fs.readFileSync(reverseMapPath, 'utf8'));
          if (mappedPhone && typeof mappedPhone === 'string') {
            const clean = mappedPhone.replace(/\D/g, '');
            if (clean.length >= 10 && clean.length <= 15) {
              console.log(`[WhatsApp ${s.companyName}] 🔄 Resuelto LID ${rawLid} -> ${clean}@s.whatsapp.net para entrega garantizada`);
              return `${clean}@s.whatsapp.net`;
            }
          }
        } catch (e) {}
      }

      // Intentar también en la otra sesión
      const otherComp = company === 'agro' ? 'tracto' : 'agro';
      const otherS = this.sessions[otherComp];
      if (otherS) {
        const otherReversePath = path.join(otherS.authFolder, `lid-mapping-${rawLid}_reverse.json`);
        if (fs.existsSync(otherReversePath)) {
          try {
            const mappedPhone = JSON.parse(fs.readFileSync(otherReversePath, 'utf8'));
            if (mappedPhone && typeof mappedPhone === 'string') {
              const clean = mappedPhone.replace(/\D/g, '');
              if (clean.length >= 10 && clean.length <= 15) {
                console.log(`[WhatsApp ${s.companyName}] 🔄 Resuelto LID ${rawLid} (desde ${otherComp}) -> ${clean}@s.whatsapp.net`);
                return `${clean}@s.whatsapp.net`;
              }
            }
          } catch (e) {}
        }
      }

      return jid;
    }

    // Si es un número sin dominio
    const cleanNumber = jid.replace(/\D/g, '');
    if (cleanNumber.length >= 10 && cleanNumber.length <= 13) {
      return `${cleanNumber}@s.whatsapp.net`;
    } else if (cleanNumber.length > 13) {
      return `${cleanNumber}@lid`;
    }
    return `${cleanNumber}@s.whatsapp.net`;
  }

  /**
   * Resuelve la sesión adecuada según el canal o empresa solicitada.
   * Aislamiento estricto: Tractopower NUNCA despacha por Agropower ni viceversa.
   */
  getSocketForCompany(targetCompany = null) {
    const comp = String(targetCompany || '').toLowerCase();
    if (comp.includes('tracto')) {
      return this.sessions.tracto;
    }
    if (comp.includes('agro')) {
      return this.sessions.agro;
    }
    // Si no se especifica empresa: usar la sesión que esté conectada
    if (this.sessions.agro.connectionStatus === 'connected') return this.sessions.agro;
    if (this.sessions.tracto.connectionStatus === 'connected') return this.sessions.tracto;
    return this.sessions.agro;
  }

  async sendText(remoteJid, text, targetCompany = null) {
    if (this.engineMode === 'integrated') {
      const session = this.getSocketForCompany(targetCompany);
      if (session && session.sock && session.connectionStatus === 'connected') {
        const jid = this.formatJidForSending(remoteJid, session.company);
        console.log(`[WhatsApp ${session.companyName}] 📤 Enviando mensaje a ${jid}: "${text}"`);
        try {
          const result = await session.sock.sendMessage(jid, { text });
          if (result?.key?.id) {
            this.registerPanelSentMessage(result.key.id, { jid, company: session.company, text });
          }
          console.log(`[WhatsApp ${session.companyName}] ✅ Mensaje entregado con éxito a ${jid} (ID: ${result?.key?.id})`);
          return result;
        } catch (err) {
          console.error(`[WhatsApp ${session.companyName}] ❌ Error enviando texto a ${jid}:`, err.message);
          return null;
        }
      } else {
        console.warn(`[WhatsApp] ❌ La línea de ${targetCompany || 'WhatsApp'} no está conectada actualmente.`);
        return null;
      }
    } else if (this.engineMode === 'evolution') {
      const cleanPhone = remoteJid.replace(/\D/g, '');
      return await axios.post(
        `${this.evolutionConfig.url}/message/sendText/${this.evolutionConfig.instance}`,
        { number: cleanPhone, text },
        { headers: { apikey: this.evolutionConfig.apiKey } }
      );
    }
    return null;
  }

  guessMimeType(ext) {
    const map = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed'
    };
    return map[ext.toLowerCase()] || 'application/octet-stream';
  }

  async sendMedia(remoteJid, filePath, caption = '', mimetype = null, targetCompany = null) {
    if (this.engineMode === 'integrated') {
      const session = this.getSocketForCompany(targetCompany);
      if (session && session.sock && session.connectionStatus === 'connected') {
        const jid = this.formatJidForSending(remoteJid, session.company);
        console.log(`[WhatsApp ${session.companyName}] 📤 Enviando Archivo/Media a ${jid}: ${filePath}`);
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

        if (fs.existsSync(fullPath)) {
          try {
            const fileBuffer = fs.readFileSync(fullPath);
            const ext = path.extname(fullPath).toLowerCase();
            const fileName = path.basename(fullPath);
            const cleanFileName = fileName.replace(/^\d+_/, '');
            const mime = mimetype || this.guessMimeType(ext);

            let messagePayload = {};
            if (mime.startsWith('image/')) {
              messagePayload = { image: fileBuffer, caption: caption || '' };
            } else if (mime.startsWith('video/')) {
              messagePayload = { video: fileBuffer, caption: caption || '' };
            } else if (mime.startsWith('audio/')) {
              messagePayload = { audio: fileBuffer, mimetype: mime };
            } else {
              messagePayload = {
                document: fileBuffer,
                mimetype: mime,
                fileName: cleanFileName,
                caption: caption || ''
              };
            }

            const result = await session.sock.sendMessage(jid, messagePayload);
            if (result?.key?.id) {
              this.registerPanelSentMessage(result.key.id, { jid, company: session.company, caption, mimetype: mime });
            }
            console.log(`[WhatsApp ${session.companyName}] ✅ Archivo entregado con éxito a ${jid} (ID: ${result?.key?.id})`);
            return result;
          } catch (err) {
            console.error(`[WhatsApp ${session.companyName}] ❌ Error enviando archivo a ${jid}:`, err.message);
            return null;
          }
        } else {
          console.error(`[WhatsApp] ❌ Archivo no encontrado en ruta: ${fullPath}`);
        }
      } else {
        console.warn(`[WhatsApp] ❌ La línea de ${targetCompany || 'WhatsApp'} no está conectada actualmente.`);
      }
    }
    return null;
  }

  async sendPdf(remoteJid, filePath, caption, targetCompany = null) {
    if (this.engineMode === 'integrated') {
      const session = this.getSocketForCompany(targetCompany);
      if (session && session.sock && session.connectionStatus === 'connected') {
        const jid = this.formatJidForSending(remoteJid, session.company);
        console.log(`[WhatsApp ${session.companyName}] 📤 Enviando PDF a ${jid}: ${filePath}`);
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, 'public', 'media', filePath);

        if (fs.existsSync(fullPath)) {
          try {
            const fileBuffer = fs.readFileSync(fullPath);
            const result = await session.sock.sendMessage(jid, {
              document: fileBuffer,
              mimetype: 'application/pdf',
              fileName: path.basename(filePath),
              caption: caption || ''
            });
            if (result?.key?.id) {
              this.registerPanelSentMessage(result.key.id, { jid, company: session.company, caption });
            }
            console.log(`[WhatsApp ${session.companyName}] ✅ PDF entregado con éxito a ${jid}`);
            return result;
          } catch (err) {
            console.error(`[WhatsApp ${session.companyName}] ❌ Error enviando PDF a ${jid}:`, err.message);
            return null;
          }
        } else {
          console.error(`[WhatsApp] ❌ Archivo PDF no encontrado en ruta: ${fullPath}`);
        }
      } else {
        console.warn(`[WhatsApp] ❌ La línea de ${targetCompany || 'WhatsApp'} no está conectada actualmente.`);
      }
    }
    return null;
  }

  /**
   * Elimina un chat en WhatsApp sincronizando bidireccionalmente con el teléfono móvil.
   */
  async deleteChat(jid, phone = null, messages = [], targetCompany = null) {
    if (this.engineMode !== 'integrated') return false;

    const sessionsToTry = [];
    const comp = String(targetCompany || '').toLowerCase();
    if (comp.includes('tracto')) {
      sessionsToTry.push(this.sessions.tracto);
    } else if (comp.includes('agro')) {
      sessionsToTry.push(this.sessions.agro);
    } else {
      sessionsToTry.push(this.sessions.agro, this.sessions.tracto);
    }

    let deletedAny = false;
    const lastMsgTimestamp = Math.floor(Date.now() / 1000);

    for (const session of sessionsToTry) {
      if (!session.sock || session.connectionStatus !== 'connected') continue;

      const targets = new Set();
      if (jid) targets.add(jid);

      const rawPhone = String(phone || jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      if (rawPhone && rawPhone.length >= 10) {
        targets.add(`${rawPhone}@s.whatsapp.net`);
      }

      if (session.sock?.signalRepository?.lidMapping?.getPNForLID && jid && jid.includes('@lid')) {
        try {
          const pn = await session.sock.signalRepository.lidMapping.getPNForLID(jid);
          if (pn) {
            const cleanPn = String(pn).split('@')[0].split(':')[0].replace(/\D/g, '');
            if (cleanPn.length >= 10) {
              targets.add(`${cleanPn}@s.whatsapp.net`);
            }
          }
        } catch (e) {}
      }

      for (const targetJid of targets) {
        try {
          console.log(`[WhatsApp ${session.companyName}] 🗑️ Sincronizando eliminación de chat en teléfono móvil para: ${targetJid}`);
          if (typeof session.sock.chatModify === 'function') {
            // 1. Limpiar/vaciar mensajes del chat en el teléfono físico
            try {
              await session.sock.chatModify(
                {
                  clear: true,
                  lastMessages: { lastMessageTimestamp: lastMsgTimestamp }
                },
                targetJid
              );
              console.log(`[WhatsApp ${session.companyName}] 🧹 Chat vaciado (clear) en móvil para: ${targetJid}`);
            } catch (clearErr) {
              console.warn(`[WhatsApp ${session.companyName}] Aviso al vaciar mensajes en ${targetJid}:`, clearErr.message);
            }

            // 2. Eliminar completamente la conversación del listado en el teléfono físico
            await session.sock.chatModify(
              {
                delete: true,
                lastMessages: { lastMessageTimestamp: lastMsgTimestamp }
              },
              targetJid
            );
            console.log(`[WhatsApp ${session.companyName}] ✅ Chat eliminado exitosamente en WhatsApp móvil: ${targetJid}`);
            session.knownJids.delete(targetJid);
            deletedAny = true;
          }
        } catch (err) {
          console.warn(`[WhatsApp ${session.companyName}] Aviso al eliminar chat en ${targetJid}:`, err.message);
        }
      }
    }

    return deletedAny;
  }

  async logout(company = 'agro') {
    try {
      const session = this.sessions[company] || this.sessions.agro;
      if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
      }
      if (session.sock) {
        try {
          session.sock.ev.removeAllListeners();
          await session.sock.logout();
        } catch (e) {}
        session.sock = null;
      }
      if (fs.existsSync(session.authFolder)) {
        fs.rmSync(session.authFolder, { recursive: true, force: true });
      }
      session.connectionStatus = 'disconnected';
      session.userProfile = null;
      session.qrCodeBase64 = null;
      session.knownJids.clear();
      this.broadcastStatus(company);
      setTimeout(() => this.startIntegrated(company), 2000);
    } catch (e) {
      console.error(`Error logout ${company}:`, e);
    }
  }

  getStatus(company = null) {
    if (company && this.sessions[company]) {
      const s = this.sessions[company];
      return {
        company,
        status: s.connectionStatus,
        qr: s.qrCodeBase64,
        user: s.userProfile,
        engineMode: this.engineMode
      };
    }

    return {
      status: this.sessions.agro.connectionStatus,
      qr: this.sessions.agro.qrCodeBase64,
      user: this.sessions.agro.userProfile,
      engineMode: this.engineMode,
      evolutionConfig: this.evolutionConfig,
      agro: {
        company: 'agro',
        companyName: 'Agropower',
        status: this.sessions.agro.connectionStatus,
        qr: this.sessions.agro.qrCodeBase64,
        user: this.sessions.agro.userProfile
      },
      tracto: {
        company: 'tracto',
        companyName: 'Tractopower',
        status: this.sessions.tracto.connectionStatus,
        qr: this.sessions.tracto.qrCodeBase64,
        user: this.sessions.tracto.userProfile
      }
    };
  }

  broadcastStatus(company = null) {
    if (this.io) {
      const payload = this.getStatus();
      this.io.emit('whatsapp_status_update', payload);
      if (company && this.sessions[company]) {
        this.io.emit(`whatsapp_status_${company}`, this.getStatus(company));
      }
    }
  }

  updateConfig(newConfig) {
    if (newConfig.engineMode) this.engineMode = newConfig.engineMode;
    if (newConfig.evolutionConfig) this.evolutionConfig = { ...this.evolutionConfig, ...newConfig.evolutionConfig };
    this.broadcastStatus();
  }
}

module.exports = new WhatsAppService();
