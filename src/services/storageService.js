const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config/constants');

// Asegurar que exista el directorio de archivos multimedia (PDF)
if (!fs.existsSync(PATHS.MEDIA_DIR)) {
  fs.mkdirSync(PATHS.MEDIA_DIR, { recursive: true });
}

/**
 * Resuelve el número de teléfono real de WhatsApp a partir de un JID o LID usando los mapeos de Baileys
 */
function resolveRealPhoneFromBaileys(jidOrPhone, fallbackPhone = '') {
  try {
    const candidates = [jidOrPhone, fallbackPhone].filter(Boolean);
    for (const candidate of candidates) {
      const rawId = String(candidate).split('@')[0].split(':')[0].replace(/\D/g, '');
      if (!rawId) continue;

      const reverseMapPath = path.join(PATHS.ROOT_DIR, 'auth_info_baileys', `lid-mapping-${rawId}_reverse.json`);
      if (fs.existsSync(reverseMapPath)) {
        const mapped = JSON.parse(fs.readFileSync(reverseMapPath, 'utf8'));
        if (mapped && typeof mapped === 'string') {
          return mapped.replace(/\D/g, '');
        }
      }
    }

    const cleanFallback = String(fallbackPhone || jidOrPhone || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    return cleanFallback;
  } catch (e) {
    return String(fallbackPhone || jidOrPhone || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  }
}

/**
 * Formatea un número de WhatsApp para mostrarlo de forma legible en el panel (Ej: +58 412-9703262)
 */
function formatWhatsAppPhone(phoneStr) {
  const digits = String(phoneStr || '').replace(/\D/g, '');
  if (!digits) return 'Sin número';
  // Formato Venezuela: 58 + 3 dígitos operadora (412, 414, 424, 416, 426, 422) + 7 dígitos
  if (digits.length === 12 && digits.startsWith('58')) {
    return `+58 ${digits.slice(2, 5)}-${digits.slice(5)}`;
  }
  return `+${digits}`;
}

function loadBotConfig() {
  try {
    return JSON.parse(fs.readFileSync(PATHS.BOT_CONFIG_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveBotConfig(newConfig) {
  fs.writeFileSync(PATHS.BOT_CONFIG_FILE, JSON.stringify(newConfig, null, 2));
}

function sanitizeAndResolveConversations(rawList) {
  if (!Array.isArray(rawList)) return { list: [], changed: false };
  let changed = false;
  const filtered = [];

  for (const c of rawList) {
    // Excluir entradas accidentales de estados de WhatsApp (status@broadcast)
    if (c.jid === 'status@broadcast' || c.phone === 'status') {
      changed = true;
      continue;
    }

    const resolvedPhone = resolveRealPhoneFromBaileys(c.jid, c.phone);
    if (resolvedPhone && resolvedPhone !== c.phone) {
      c.phone = resolvedPhone;
      changed = true;
    }

    const formatted = formatWhatsAppPhone(c.phone);
    if (c.formattedPhone !== formatted) {
      c.formattedPhone = formatted;
      changed = true;
    }

    filtered.push(c);
  }

  return { list: filtered, changed };
}

function loadConversationsFromDisk() {
  if (!fs.existsSync(PATHS.CONVERSATIONS_FILE)) {
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(PATHS.CONVERSATIONS_FILE, 'utf8'));
    const { list, changed } = sanitizeAndResolveConversations(raw);
    if (changed) {
      fs.writeFileSync(PATHS.CONVERSATIONS_FILE, JSON.stringify(list, null, 2));
    }
    return list;
  } catch (e) {
    return [];
  }
}

// Estado en memoria sincronizado con conversations.json
let conversations = loadConversationsFromDisk();

function getConversations() {
  const { list, changed } = sanitizeAndResolveConversations(conversations);
  conversations = list;
  if (changed) {
    fs.writeFileSync(PATHS.CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2));
  }
  return conversations;
}

function saveConversations(data) {
  if (Array.isArray(data)) {
    const { list } = sanitizeAndResolveConversations(data);
    conversations = list;
  }
  fs.writeFileSync(PATHS.CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2));
}

function loadUsers() {
  if (!fs.existsSync(PATHS.USERS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(PATHS.USERS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveUsers(data) {
  fs.writeFileSync(PATHS.USERS_FILE, JSON.stringify(data, null, 2));
}

function loadAnalytics() {
  if (!fs.existsSync(PATHS.ANALYTICS_FILE)) return { events: [] };
  try {
    return JSON.parse(fs.readFileSync(PATHS.ANALYTICS_FILE, 'utf8'));
  } catch (e) {
    return { events: [] };
  }
}

function saveAnalytics(data) {
  fs.writeFileSync(PATHS.ANALYTICS_FILE, JSON.stringify(data, null, 2));
}

function normalizeChannel(ch) {
  const map = {
    wa1: 'wa_agro',
    ig1: 'ig_agro',
    tk1: 'tk_agro',
    ig2: 'ig_tracto',
    tk2: 'tk_tracto'
  };
  return map[ch] || ch || 'wa_agro';
}

function getCompanyFromChannel(ch) {
  const norm = normalizeChannel(ch);
  return norm.endsWith('_tracto') ? 'tractopower' : 'agropower';
}

function getTodayISO() {
  // Siempre usar hora de Venezuela (America/Caracas = UTC-4)
  const parts = new Date().toLocaleString('en-US', { timeZone: 'America/Caracas' }).split(/[/,: ]+/);
  const year = parseInt(parts[2]);
  const month = String(parseInt(parts[0])).padStart(2, '0');
  const day = String(parseInt(parts[1])).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDurationMs(ms) {
  const totalMinutes = Math.max(1, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function isAdminUser(user) {
  if (!user) return false;
  return user.role === 'admin' || String(user.username || '').toLowerCase() === 'admin';
}

module.exports = {
  loadBotConfig,
  saveBotConfig,
  getConversations,
  saveConversations,
  loadUsers,
  saveUsers,
  loadAnalytics,
  saveAnalytics,
  normalizeChannel,
  getCompanyFromChannel,
  getTodayISO,
  formatDurationMs,
  isAdminUser,
  resolveRealPhoneFromBaileys,
  formatWhatsAppPhone
};
