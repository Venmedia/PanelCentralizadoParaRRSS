/**
 * @file botEngine.js
 * @description Motor de Respuestas Automáticas para WhatsApp y Canales Sociales.
 * Soporta configuración y respuestas independientes para Agropower y Tractopower.
 */

const fs = require('fs');
const path = require('path');
const { getAutoReplyMessage } = require('./src/services/scheduleService');

const configPath = path.join(__dirname, 'botConfig.json');

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error cargando botConfig.json:', err);
    return null;
  }
}

function normalize(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Obtiene el alcance de configuración según la empresa ('agropower' o 'tractopower')
 */
function getCompanyScope(config, company = 'agropower') {
  if (!config) return { key: 'agropower', categories: {}, customOptions: [], greeting: '', welcomeMessage: '' };
  const compKey = String(company || '').toLowerCase().includes('tracto') ? 'tractopower' : 'agropower';
  const compObj = config.companies?.[compKey];

  return {
    key: compKey,
    categories: compObj?.categories || (compKey === 'agropower' ? config.categories : {}) || {},
    customOptions: compObj?.customOptions || (compKey === 'agropower' ? config.customOptions : []) || [],
    greeting: compObj?.greeting || (compKey === 'agropower' ? config.greeting : ''),
    welcomeMessage: compObj?.welcomeMessage || (compKey === 'agropower' ? config.schedule?.welcomeMessage : '')
  };
}

/**
 * Extrae todas las opciones del botConfig.json para una empresa dada aplanando categories → items
 * Retorna un array de { key, title, reply, attachment, attachmentUrl, pauseBot, keywords }
 */
function flattenOptions(config, company = 'agropower') {
  const options = [];
  const scope = getCompanyScope(config, company);
  if (!scope.categories || typeof scope.categories !== 'object') return options;

  for (const [catKey, cat] of Object.entries(scope.categories)) {
    if (!cat || typeof cat !== 'object' || !cat.items || typeof cat.items !== 'object') continue;
    for (const [itemKey, item] of Object.entries(cat.items)) {
      if (!item || typeof item !== 'object') continue;
      options.push({
        key: itemKey,
        title: item.title || '',
        reply: item.reply || '',
        attachment: item.attachment || null,
        attachmentUrl: item.attachmentUrl || item.attachment || null,
        pauseBot: item.waitingAdvisor || item.pauseBot || false,
        keywords: item.keywords || []
      });
    }
  }

  // Opciones personalizadas creadas para esta empresa
  if (Array.isArray(scope.customOptions)) {
    for (const opt of scope.customOptions) {
      options.push({
        key: opt.id || opt.key || ('custom_' + options.length),
        title: opt.title || opt.label || '',
        reply: opt.reply || '',
        attachment: opt.attachment || null,
        attachmentUrl: opt.attachmentUrl || null,
        pauseBot: opt.pauseBot || false,
        keywords: opt.keywords || []
      });
    }
  }

  return options;
}

/**
 * Mapeo de palabras/frases naturales a keys de opciones del botConfig
 */
const NATURAL_KEYWORDS = {
  'cat_modelos':    ['catalogo', 'modelos', 'ficha tecnica', 'fichas tecnicas', 'pdf', '1'],
  'repuestos':      ['repuesto', 'repuestos', 'pieza', 'piezas', 'consumible', 'consumibles'],
  'garantia':       ['garantia', 'garantias'],
  'precios':        ['precio', 'precios', 'costo', 'costos', 'cotizar', 'cotizacion', '2', 'payloader', 'retroexcavadora', 'montacargas', 'jumbo', 'jumbos', 'tractor', 'tractores'],
  'financiamiento': ['financiamiento', 'financiar', 'credito', 'cuotas', 'plazo', 'inicial'],
  'compras_prog':   ['compra programada', 'compras programadas', 'pedido', 'reserva', 'reservar'],
  'asesor':         ['asesor', 'asesora', 'hablar', 'persona', 'humano', 'agente', 'ayuda', '3']
};

/**
 * Procesa el mensaje entrante del cliente y determina la respuesta automática según la empresa.
 */
function processIncomingMessage(incomingText, company = 'agropower') {
  if (!incomingText || typeof incomingText !== 'string') return null;
  const config = loadConfig();
  if (!config) return null;

  const clean = normalize(incomingText);
  if (!clean) return null;

  const targetComp = String(company || '').toLowerCase().includes('tracto') ? 'tractopower' : 'agropower';
  const options = flattenOptions(config, targetComp);

  if (options.length === 0) {
    return {
      matchedKey: 'greeting',
      title: 'Menú Principal',
      reply: getAutoReplyMessage(config, targetComp),
      attachment: null,
      pauseBot: false,
      isMenu: true
    };
  }

  // 1. Buscar match directo por key del item (ej: "cat_modelos", "repuestos")
  for (const opt of options) {
    if (clean === normalize(opt.key)) {
      return {
        matchedKey: opt.key,
        title: opt.title,
        reply: opt.reply,
        attachment: opt.attachment,
        attachmentUrl: opt.attachmentUrl,
        pauseBot: opt.pauseBot,
        isMenu: false
      };
    }
  }

  // 2. Buscar match por keywords configuradas en el item
  for (const opt of options) {
    if (opt.keywords && opt.keywords.length > 0) {
      if (opt.keywords.some(kw => clean.includes(normalize(kw)))) {
        return {
          matchedKey: opt.key,
          title: opt.title,
          reply: opt.reply,
          attachment: opt.attachment,
          attachmentUrl: opt.attachmentUrl,
          pauseBot: opt.pauseBot,
          isMenu: false
        };
      }
    }
  }

  // 3. Buscar match por NATURAL_KEYWORDS (mapeo inteligente de palabras naturales)
  for (const [itemKey, keywords] of Object.entries(NATURAL_KEYWORDS)) {
    if (keywords.some(kw => clean === kw || clean.includes(kw))) {
      const matchedOpt = options.find(o => o.key === itemKey);
      if (matchedOpt) {
        return {
          matchedKey: matchedOpt.key,
          title: matchedOpt.title,
          reply: matchedOpt.reply,
          attachment: matchedOpt.attachment,
          attachmentUrl: matchedOpt.attachmentUrl,
          pauseBot: matchedOpt.pauseBot,
          isMenu: false
        };
      }
    }
  }

  // 4. Buscar match parcial por título del item
  for (const opt of options) {
    const normalTitle = normalize(opt.title);
    if (normalTitle && clean.includes(normalTitle)) {
      return {
        matchedKey: opt.key,
        title: opt.title,
        reply: opt.reply,
        attachment: opt.attachment,
        attachmentUrl: opt.attachmentUrl,
        pauseBot: opt.pauseBot,
        isMenu: false
      };
    }
  }

  // 5. Si no coincide con nada → Menú de Bienvenida según la empresa
  return {
    matchedKey: 'greeting',
    title: 'Menú Principal',
    reply: getAutoReplyMessage(config, targetComp),
    attachment: null,
    pauseBot: false,
    isMenu: true
  };
}

module.exports = {
  processIncomingMessage,
  loadConfig,
  getCompanyScope,
  flattenOptions
};
