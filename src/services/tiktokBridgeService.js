/**
 * @file tiktokBridgeService.js
 * @description Puente Headless en Segundo Plano con Playwright para TikTok Web.
 *
 * Características:
 * 1. Levanta Chromium en modo persistente (con carpeta de perfil propia por canal: tk_agro y tk_tracto).
 * 2. Genera y captura el código QR oficial de https://www.tiktok.com/login/qrcode para enviarlo al panel.
 * 3. Detecta la confirmación del escaneo en la app móvil y guarda la sesión automáticamente.
 * 4. Navega a https://www.tiktok.com/messages y extrae mensajes entrantes hacia la base de datos centralizada
 *    (conversations.json) emitiendo eventos en tiempo real para que aparezcan en la bandeja "Todos".
 * 5. Permite responder mensajes directamente desde la interfaz de OMNIPANEL interactuando con la sesión abierta.
 */

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config/constants');
const storageService = require('./storageService');
const { linkQrChannel } = require('./channelVaultService');

let playwrightChromium = null;
try {
  const playwright = require('playwright');
  playwrightChromium = playwright.chromium;
} catch (e) {
  console.warn('[TikTokBridge] Playwright no está disponible aún localmente:', e.message);
}

const TIKTOK_BASE_SESSIONS_DIR = path.join(PATHS.ROOT_DIR, 'data', 'tiktok_sessions');
if (!fs.existsSync(TIKTOK_BASE_SESSIONS_DIR)) {
  fs.mkdirSync(TIKTOK_BASE_SESSIONS_DIR, { recursive: true });
}

// Registro en memoria de sesiones activas
const sessions = {
  tk_agro: {
    channelKey: 'tk_agro',
    company: 'agropower',
    accountHandle: '@agropower_venezuela',
    context: null,
    page: null,
    qrBase64: null,
    status: 'disconnected', // 'disconnected' | 'launching' | 'qr_ready' | 'connected'
    lastError: null,
    isListening: false
  },
  tk_tracto: {
    channelKey: 'tk_tracto',
    company: 'tractopower',
    accountHandle: '@tractopowervenezuela',
    context: null,
    page: null,
    qrBase64: null,
    status: 'disconnected',
    lastError: null,
    isListening: false
  }
};

/**
 * Obtiene el directorio de perfil aislado para el canal
 */
function getUserDataDir(channelKey) {
  const dir = path.join(TIKTOK_BASE_SESSIONS_DIR, channelKey);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Inicializa o recupera el contexto de Playwright para un canal
 */
async function getOrCreateContext(channelKey) {
  if (!playwrightChromium) {
    try {
      const playwright = require('playwright');
      playwrightChromium = playwright.chromium;
    } catch (e) {
      throw new Error('Playwright no está instalado o no se puede cargar en el entorno.');
    }
  }

  const sess = sessions[channelKey];
  if (!sess) throw new Error(`Canal TikTok no válido: ${channelKey}`);

  if (sess.context && sess.page && !sess.page.isClosed()) {
    return { context: sess.context, page: sess.page };
  }

  const userDataDir = getUserDataDir(channelKey);

  console.log(`[TikTokBridge] 🚀 Levantando instancia Chromium para ${channelKey} en ${userDataDir}...`);

  const context = await playwrightChromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--window-size=1280,800'
    ],
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    ignoreDefaultArgs: ['--enable-automation']
  });

  // Inyectar script anti-detección
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  sess.context = context;
  sess.page = page;

  return { context, page };
}

/**
 * Solicita o regenera el código QR oficial de TikTok en el servidor
 */
async function requestTikTokQr(channelKey, io) {
  const sess = sessions[channelKey];
  if (!sess) throw new Error(`Canal no soportado: ${channelKey}`);

  sess.status = 'launching';
  sess.qrBase64 = null;
  sess.lastError = null;

  try {
    const { page } = await getOrCreateContext(channelKey);

    console.log(`[TikTokBridge] 📱 Navegando a https://www.tiktok.com/login/qrcode para ${channelKey}...`);
    await page.goto('https://www.tiktok.com/login/qrcode', {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    });

    // Verificar si ya está logueado
    const currentUrl = page.url();
    if (!currentUrl.includes('/login')) {
      console.log(`[TikTokBridge] 🟢 ${channelKey} ya tiene sesión activa. Redirigiendo a /messages...`);
      sess.status = 'connected';
      linkQrChannel(channelKey, { accountHandle: sess.accountHandle });
      if (io) {
        io.emit('channels_auth_updated', { channelKey, connected: true });
        io.emit('tiktok_status_update', { channelKey, status: 'connected' });
      }
      setupMessageListener(channelKey, io);
      return { success: true, status: 'already_connected' };
    }

    // Extraer directamente el dataURL del elemento <img> con data:image/png;base64,...
    let qrDataUrl = null;
    try {
      qrDataUrl = await page.evaluate(async () => {
        for (let i = 0; i < 25; i++) {
          const img = document.querySelector('img[src*="data:image"]');
          if (img && img.src && img.src.length > 500) {
            return img.src;
          }
          await new Promise(r => setTimeout(r, 300));
        }
        return null;
      });
    } catch (e) {}

    if (qrDataUrl) {
      console.log(`[TikTokBridge] 📸 QR oficial extraído directamente del elemento <img> (${qrDataUrl.slice(0, 35)}...)`);
      sess.qrBase64 = qrDataUrl;
    } else {
      // Respaldo por screenshot si no se encontró el elemento directo
      const qrBuffer = await page.screenshot({
        type: 'png',
        clip: { x: 390, y: 150, width: 500, height: 500 }
      });
      sess.qrBase64 = `data:image/png;base64,${qrBuffer.toString('base64')}`;
    }

    sess.status = 'qr_ready';

    if (io) {
      io.emit('tiktok_status_update', {
        channelKey,
        status: 'qr_ready',
        qrBase64: sess.qrBase64
      });
    }

    // Iniciar monitoreo en segundo plano de la confirmación del QR
    monitorQrScan(channelKey, io);

    return {
      success: true,
      status: 'qr_ready',
      qrBase64: sess.qrBase64
    };
  } catch (err) {
    console.error(`[TikTokBridge] ❌ Error generando QR para ${channelKey}:`, err);
    sess.status = 'disconnected';
    sess.lastError = err.message;
    throw err;
  }
}

/**
 * Monitorea si el usuario escanea el código QR y confirma en su teléfono
 */
async function monitorQrScan(channelKey, io) {
  const sess = sessions[channelKey];
  if (!sess || !sess.page) return;

  const page = sess.page;
  let attempts = 0;
  const maxAttempts = 60; // 60 * 2.5s = 150 segundos (2.5 minutos de ventana de escaneo)

  const interval = setInterval(async () => {
    attempts++;
    try {
      if (page.isClosed()) {
        clearInterval(interval);
        return;
      }

      const url = page.url();
      const cookies = await page.context().cookies();
      const hasSessionId = cookies.some(c => c.name === 'sessionid' || c.name === 'sessionid_ss');

      // Si la URL ya no es login o existen cookies de sesión válidas
      if (!url.includes('/login') || hasSessionId) {
        clearInterval(interval);
        console.log(`[TikTokBridge] 🥳 ¡Escaneo confirmado exitosamente para ${channelKey}!`);
        sess.status = 'connected';
        sess.qrBase64 = null;

        // Registrar en bóveda
        linkQrChannel(channelKey, { accountHandle: sess.accountHandle });

        if (io) {
          io.emit('channels_auth_updated', { channelKey, connected: true });
          io.emit('tiktok_status_update', {
            channelKey,
            status: 'connected',
            message: 'TikTok autenticado con éxito por QR.'
          });
        }

        // Navegar a la bandeja de mensajes e iniciar escucha activa
        await page.goto('https://www.tiktok.com/messages', {
          waitUntil: 'domcontentloaded',
          timeout: 40000
        });

        setupMessageListener(channelKey, io);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        if (sess.status === 'qr_ready') {
          sess.status = 'disconnected';
          sess.qrBase64 = null;
          console.log(`[TikTokBridge] ⏱️ Tiempo de espera del QR expirado para ${channelKey}.`);
          if (io) {
            io.emit('tiktok_status_update', {
              channelKey,
              status: 'disconnected',
              message: 'El código QR expiró. Vuelve a tocar Actualizar QR.'
            });
          }
        }
      }
    } catch (e) {
      console.warn(`[TikTokBridge] Error en monitoreo QR para ${channelKey}:`, e.message);
    }
  }, 2500);
}

/**
 * Configura la escucha activa de mensajes en tiktok.com/messages (Intercepción de Red + DOM)
 */
async function setupMessageListener(channelKey, io) {
  const sess = sessions[channelKey];
  if (!sess || !sess.page || sess.isListening) return;

  sess.isListening = true;
  const page = sess.page;

  console.log(`[TikTokBridge] 🎧 Configurando escucha de mensajes entrantes para ${channelKey}...`);

  // Asegurar que esté en /messages
  if (!page.url().includes('/messages')) {
    try {
      await page.goto('https://www.tiktok.com/messages', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    } catch (e) {}
  }

  // 1. Intercepción de Respuestas de Red (Network Interception)
  page.on('response', async response => {
    try {
      const url = response.url();
      if (
        url.includes('/conversation/') ||
        url.includes('/message/list') ||
        url.includes('/im/v1/message') ||
        url.includes('/im/chat/')
      ) {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const json = await response.json();
          processTikTokApiMessages(channelKey, json, io);
        }
      }
    } catch (e) {}
  });

  // 2. Escáner de Respaldo por DOM (cada 8 segundos extrae los chats visibles)
  setInterval(async () => {
    try {
      if (page.isClosed() || sess.status !== 'connected') return;
      await scanDomMessages(channelKey, page, io);
    } catch (e) {}
  }, 8000);
}

/**
 * Procesa mensajes obtenidos de las respuestas de API de TikTok
 */
function processTikTokApiMessages(channelKey, data, io) {
  if (!data) return;
  const sess = sessions[channelKey];

  try {
    const rawList = data.messages || data.data?.messages || data.conversation_list || [];
    if (!Array.isArray(rawList)) return;

    for (const item of rawList) {
      const senderName = item.sender_username || item.user_name || item.sec_uid || 'Cliente TikTok';
      const text = item.text || item.content || item.desc || '';
      if (!text) continue;

      const isSelf = Boolean(item.is_self || item.from_user?.is_self);
      integrateIncomingTikTokMessage({
        channelKey,
        senderUsername: senderName,
        text,
        sender: isSelf ? 'operator' : 'client',
        io
      });
    }
  } catch (e) {
    console.warn('[TikTokBridge] Error procesando payload de API:', e.message);
  }
}

/**
 * Escanea el DOM de tiktok.com/messages para extraer conversaciones y mensajes
 */
async function scanDomMessages(channelKey, page, io) {
  try {
    const chatData = await page.evaluate(() => {
      const results = [];
      // Buscar elementos de conversación en el sidebar
      const convElements = document.querySelectorAll(
        'div[data-e2e="chat-item"], div[class*="chat-item"], div[class*="ConversationItem"]'
      );

      convElements.forEach(el => {
        const nameEl = el.querySelector('p, span[class*="name"], h4');
        const lastMsgEl = el.querySelector('p[class*="desc"], span[class*="desc"], p[class*="message"]');
        if (nameEl && lastMsgEl) {
          results.push({
            name: nameEl.textContent.trim(),
            lastMsg: lastMsgEl.textContent.trim()
          });
        }
      });
      return results;
    });

    if (Array.isArray(chatData)) {
      for (const c of chatData) {
        if (!c.name || !c.lastMsg) continue;
        integrateIncomingTikTokMessage({
          channelKey,
          senderUsername: c.name,
          text: c.lastMsg,
          sender: 'client',
          io
        });
      }
    }
  } catch (e) {}
}

/**
 * Inserta o actualiza una conversación de TikTok en el almacén centralizado (conversations.json)
 */
function integrateIncomingTikTokMessage({ channelKey, senderUsername, text, sender = 'client', io }) {
  const sess = sessions[channelKey];
  const company = sess?.company || (channelKey === 'tk_tracto' ? 'tractopower' : 'agropower');
  const cleanUsername = String(senderUsername).replace(/^@/, '').trim();
  const convId = `tk_${channelKey}_${cleanUsername.toLowerCase().replace(/[^a-z0-9_]/g, '')}`;

  const currentList = storageService.getConversations();
  let conv = currentList.find(c => String(c.id) === String(convId));

  const now = new Date();
  const timeFormatted = now.toLocaleString('es-VE', {
    timeZone: 'America/Caracas',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const newMsg = {
    sender,
    text,
    time: timeFormatted
  };

  if (conv) {
    // Evitar duplicar exactamente el último mensaje idéntico
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (lastMsg && lastMsg.text === text && lastMsg.sender === sender) {
      return;
    }
    conv.messages.push(newMsg);
    conv.time = timeFormatted;
    if (sender === 'client') {
      conv.waitingAdvisor = true;
    }
  } else {
    conv = {
      id: convId,
      name: cleanUsername,
      phone: `@${cleanUsername}`,
      formattedPhone: `@${cleanUsername}`,
      initials: (cleanUsername.slice(0, 2) || 'TK').toUpperCase(),
      company,
      channel: channelKey,
      botActive: false,
      waitingAdvisor: sender === 'client',
      time: timeFormatted,
      messages: [newMsg]
    };
    currentList.unshift(conv);
    console.log(`[TikTokBridge] 📥 Nueva conversación TikTok ingresada a la bandeja central: "${cleanUsername}" (${channelKey})`);
  }

  storageService.saveConversations(currentList);

  if (io) {
    io.emit('conversations_updated', currentList);
    io.emit('tiktok_message_received', {
      channelKey,
      conversationId: convId,
      message: newMsg
    });
  }
}

/**
 * Envía una respuesta por TikTok interactuando con la sesión en segundo plano
 */
async function sendTikTokMessage(channelKey, recipientUsername, text, io) {
  const sess = sessions[channelKey];
  if (!sess || !sess.page || sess.status !== 'connected') {
    throw new Error(`La sesión de TikTok para ${channelKey} no está activa. Vincula primero con QR.`);
  }

  const page = sess.page;
  const cleanUsername = String(recipientUsername).replace(/^@/, '').trim();

  console.log(`[TikTokBridge] 📤 Enviando mensaje a @${cleanUsername} vía ${channelKey}: "${text}"...`);

  // Asegurar que la página de mensajes está cargada
  if (!page.url().includes('/messages')) {
    await page.goto('https://www.tiktok.com/messages', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }

  // Buscar y seleccionar el chat del usuario en la lista
  const foundChat = await page.evaluate(username => {
    const items = document.querySelectorAll(
      'div[data-e2e="chat-item"], div[class*="chat-item"], div[class*="ConversationItem"]'
    );
    for (const item of items) {
      if (item.textContent.toLowerCase().includes(username.toLowerCase())) {
        item.click();
        return true;
      }
    }
    return false;
  }, cleanUsername);

  await page.waitForTimeout(1200);

  // Escribir en la caja de mensaje
  const inputSelectors = [
    'div[contenteditable="true"]',
    'textarea',
    'input[data-e2e="message-input"]',
    'div[data-e2e="message-input"]'
  ];

  let wrote = false;
  for (const sel of inputSelectors) {
    try {
      const inputEl = await page.$(sel);
      if (inputEl && (await inputEl.isVisible())) {
        await inputEl.click();
        await page.keyboard.type(text, { delay: 30 });
        await page.keyboard.press('Enter');
        wrote = true;
        break;
      }
    } catch (e) {}
  }

  if (!wrote) {
    throw new Error('No se pudo encontrar la caja de entrada de mensaje de TikTok en el navegador en segundo plano.');
  }

  // Integrar mensaje enviado en conversations.json
  integrateIncomingTikTokMessage({
    channelKey,
    senderUsername: cleanUsername,
    text,
    sender: 'operator',
    io
  });

  return { success: true, message: 'Mensaje enviado por TikTok exitosamente' };
}

/**
 * Retorna el estado actual de la sesión de TikTok
 */
function getTikTokSessionStatus(channelKey) {
  const sess = sessions[channelKey];
  if (!sess) return { status: 'disconnected', isConnected: false };

  return {
    channelKey,
    status: sess.status,
    isConnected: sess.status === 'connected',
    accountHandle: sess.accountHandle,
    qrBase64: sess.qrBase64,
    lastError: sess.lastError
  };
}

module.exports = {
  requestTikTokQr,
  sendTikTokMessage,
  getTikTokSessionStatus,
  integrateIncomingTikTokMessage
};
