const fs = require('fs');
const path = require('path');

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
 * Extrae todas las opciones del botConfig.json aplanando categories → items
 * Retorna un array de { key, title, reply, attachment, attachmentUrl, pauseBot, keywords }
 */
function flattenOptions(config) {
  const options = [];
  if (!config || !config.categories || typeof config.categories !== 'object') return options;

  // Mapeo de categorías a números del menú para matching por número
  // Categoría 1 items → opciones 1.1, 1.2, 1.3 (o por nombre clave)
  for (const [catKey, cat] of Object.entries(config.categories)) {
    if (!cat || typeof cat !== 'object' || !cat.items || typeof cat.items !== 'object') continue;
    for (const [itemKey, item] of Object.entries(cat.items)) {
      if (!item || typeof item !== 'object') continue;
      options.push({
        key: itemKey,
        title: item.title || '',
        reply: item.reply || '',
        attachment: item.attachment || null,
        attachmentUrl: item.attachmentUrl || null,
        pauseBot: item.waitingAdvisor || item.pauseBot || false,
        keywords: item.keywords || []
      });
    }
  }

  // También incluir customOptions si existen
  if (Array.isArray(config.customOptions)) {
    for (const opt of config.customOptions) {
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
  'cat_modelos':    ['catalogo', 'modelos', 'ficha tecnica', 'pdf', '1'],
  'repuestos':      ['repuesto', 'repuestos', 'pieza', 'piezas'],
  'garantia':       ['garantia', 'garantias'],
  'precios':        ['precio', 'precios', 'costo', 'costos', 'cotizar', 'cotizacion', '2'],
  'financiamiento': ['financiamiento', 'financiar', 'credito', 'cuotas', 'plazo'],
  'compras_prog':   ['compra programada', 'compras programadas', 'pedido', 'reserva', 'reservar'],
  'asesor':         ['asesor', 'asesora', 'hablar', 'persona', 'humano', 'agente', 'ayuda', '3']
};

/**
 * Procesa el mensaje entrante del cliente y determina la respuesta automática.
 * Compatible con la estructura real de botConfig.json (categories → items).
 */
function processIncomingMessage(incomingText) {
  if (!incomingText || typeof incomingText !== 'string') return null;
  const config = loadConfig();
  if (!config) return null;

  const clean = normalize(incomingText);
  if (!clean) return null;
  const options = flattenOptions(config);

  if (options.length === 0) {
    // Si no hay opciones configuradas, enviar solo el greeting
    return {
      matchedKey: 'greeting',
      title: 'Menú Principal',
      reply: config.greeting || config.schedule?.welcomeMessage || '',
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

  // 5. Si no coincide con nada → Enviar Menú de Bienvenida
  return {
    matchedKey: 'greeting',
    title: 'Menú Principal',
    reply: config.greeting || config.schedule?.welcomeMessage || '',
    attachment: null,
    pauseBot: false,
    isMenu: true
  };
}

module.exports = {
  processIncomingMessage,
  loadConfig
};
