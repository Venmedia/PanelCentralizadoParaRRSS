const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
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
    this.mediaFolder = path.join(__dirname, 'public', 'media', 'whatsapp');
    this.engineMode = 'integrated'; // 'integrated' o 'evolution'
    this.evolutionConfig = {
      url: 'http://localhost:8080',
      apiKey: 'omnipanel_secret_key',
      instance: 'whatsapp_principal'
    };

    // Sesiones duales independientes para Agropower y Tractopower
    this.sessions = {
      agro: {
        company: 'agro',
        companyName: 'Agropower',
        channelKey: 'wa_agro',
        authFolder: path.join(__dirname, 'auth_info_baileys'),
        sock: null,
        qrCodeBase64: null,
        connectionStatus: 'disconnected', // 'disconnected', 'connecting', 'qr_ready', 'connected'
        userProfile: null,
        knownJids: new Set()
      },
      tracto: {
        company: 'tracto',
        companyName: 'Tractopower',
        channelKey: 'wa_tracto',
        authFolder: path.join(__dirname, 'auth_info_baileys_tracto'),
        sock: null,
        qrCodeBase64: null,
        connectionStatus: 'disconnected',
        userProfile: null,
        knownJids: new Set()
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

  init(io, onMessageCallback, onChatDeleteCallback) {
    this.io = io;
    this.onMessageCallback = onMessageCallback;
    this.onChatDeleteCallback = onChatDeleteCallback || null;

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
  }

  /**
   * Detecta el tipo de media en un mensaje de Baileys y extrae la info relevante
   */
  detectMediaType(message) {
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
  async downloadAndSaveMedia(msg, mediaInfo) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
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
          const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
          console.log(`[WhatsApp ${session.companyName}] Conexión cerrada. ¿Reconectar?:`, shouldReconnect);
          session.connectionStatus = 'disconnected';
          session.userProfile = null;
          this.broadcastStatus(company);

          if (shouldReconnect) {
            setTimeout(() => this.startIntegrated(company), 3000);
          }
        } else if (connection === 'open') {
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
        if (!m.messages || m.messages.length === 0) return;
        const msg = m.messages[0];
        if (!msg.message) return;

        const remoteJid = msg.key.remoteJid || '';
        if (
          remoteJid.includes('@g.us') ||
          remoteJid === 'status@broadcast' ||
          remoteJid.includes('@broadcast') ||
          remoteJid.includes('@newsletter')
        ) {
          return;
        }

        const fromMe = msg.key.fromMe;
        const rawMessage = msg.message;
        let text =
          rawMessage.conversation ||
          rawMessage.extendedTextMessage?.text ||
          rawMessage.imageMessage?.caption ||
          rawMessage.videoMessage?.caption ||
          rawMessage.documentMessage?.caption ||
          '';

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

          if (mediaInfo.type === 'image' || mediaInfo.type === 'audio' || mediaInfo.type === 'video' || mediaInfo.type === 'document') {
            mediaUrl = await this.downloadAndSaveMedia(msg, mediaInfo);
          }

          if (!text) {
            text = mediaLabel;
          }
        }

        if (!text && !mediaInfo) return;

        session.knownJids.add(remoteJid);

        const senderPn =
          msg.key.senderPn ||
          msg.key.remoteJidAlt ||
          (msg.key.participant && msg.key.participant.includes('@s.whatsapp.net') ? msg.key.participant : null) ||
          null;

        const realPhone = this.resolveRealPhoneFromJid(remoteJid, senderPn, session.company);

        if (this.onMessageCallback) {
          this.onMessageCallback({
            company: session.company,
            channelKey: session.channelKey,
            remoteJid,
            realPhone,
            fromMe,
            text: text || mediaLabel || '',
            pushName: msg.pushName || '',
            messageId: msg.key.id,
            mediaType: mediaInfo?.type || null,
            mediaUrl: mediaUrl,
            mediaLabel: mediaLabel,
            mediaMimetype: mediaInfo?.mimetype || null,
            mediaDuration: mediaInfo?.seconds || null,
            mediaFileName: mediaInfo?.fileName || null
          });
        }
      });

      // ─── Registro de chats activos ───
      session.sock.ev.on('chats.set', ({ chats }) => {
        if (Array.isArray(chats)) {
          chats.forEach(chat => {
            if (chat.id && !chat.id.includes('@g.us') && !chat.id.includes('@broadcast')) {
              session.knownJids.add(chat.id);
            }
          });
          console.log(`[WhatsApp ${session.companyName}] 📋 Chats cargados en knownJids: ${session.knownJids.size}`);
        }
      });

      session.sock.ev.on('chats.upsert', (chats) => {
        if (Array.isArray(chats)) {
          chats.forEach(chat => {
            if (chat.id && !chat.id.includes('@g.us') && !chat.id.includes('@broadcast')) {
              session.knownJids.add(chat.id);
            }
          });
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
   * Resuelve la sesión adecuada según el canal o empresa solicitada
   */
  getSocketForCompany(targetCompany = null) {
    const comp = String(targetCompany || '').toLowerCase();
    if (comp.includes('tracto')) {
      if (this.sessions.tracto.connectionStatus === 'connected') return this.sessions.tracto;
    }
    if (comp.includes('agro')) {
      if (this.sessions.agro.connectionStatus === 'connected') return this.sessions.agro;
    }
    // Fallback inteligente: si solo una línea está conectada, despachar por esa
    if (this.sessions.agro.connectionStatus === 'connected') return this.sessions.agro;
    if (this.sessions.tracto.connectionStatus === 'connected') return this.sessions.tracto;
    return this.sessions.agro;
  }

  async sendText(remoteJid, text, targetCompany = null) {
    if (this.engineMode === 'integrated') {
      const session = this.getSocketForCompany(targetCompany);
      if (session && session.sock && session.connectionStatus === 'connected') {
        let jid = remoteJid;
        if (!jid.includes('@')) {
          jid = jid.length > 13 ? `${jid}@lid` : `${jid}@s.whatsapp.net`;
        }
        console.log(`[WhatsApp ${session.companyName}] 📤 Enviando mensaje a ${jid}: "${text}"`);
        try {
          const result = await session.sock.sendMessage(jid, { text });
          console.log(`[WhatsApp ${session.companyName}] ✅ Mensaje entregado con éxito a ${jid} (ID: ${result?.key?.id})`);
          return result;
        } catch (err) {
          console.error(`[WhatsApp ${session.companyName}] ❌ Error enviando texto a ${jid}:`, err.message);
          return null;
        }
      } else {
        console.warn(`[WhatsApp] No hay sesión conectada para enviar texto a ${remoteJid}`);
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

  async sendPdf(remoteJid, filePath, caption, targetCompany = null) {
    if (this.engineMode === 'integrated') {
      const session = this.getSocketForCompany(targetCompany);
      if (session && session.sock && session.connectionStatus === 'connected') {
        let jid = remoteJid;
        if (!jid.includes('@')) {
          jid = jid.length > 13 ? `${jid}@lid` : `${jid}@s.whatsapp.net`;
        }
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
            console.log(`[WhatsApp ${session.companyName}] ✅ PDF entregado con éxito a ${jid}`);
            return result;
          } catch (err) {
            console.error(`[WhatsApp ${session.companyName}] ❌ Error enviando PDF a ${jid}:`, err.message);
            return null;
          }
        } else {
          console.error(`[WhatsApp] ❌ Archivo PDF no encontrado en ruta: ${fullPath}`);
        }
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
      if (session.sock) {
        await session.sock.logout();
      }
      if (fs.existsSync(session.authFolder)) {
        fs.rmSync(session.authFolder, { recursive: true, force: true });
      }
      session.connectionStatus = 'disconnected';
      session.userProfile = null;
      session.qrCodeBase64 = null;
      this.broadcastStatus(company);
      if (company === 'agro') {
        setTimeout(() => this.startIntegrated('agro'), 2000);
      }
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
