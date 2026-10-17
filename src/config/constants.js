const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

const PATHS = {
  ROOT_DIR,
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  MEDIA_DIR: path.join(ROOT_DIR, 'public', 'media'),
  BOT_CONFIG_FILE: path.join(ROOT_DIR, 'botConfig.json'),
  CONVERSATIONS_FILE: path.join(ROOT_DIR, 'conversations.json'),
  USERS_FILE: path.join(ROOT_DIR, 'users.json'),
  ANALYTICS_FILE: path.join(ROOT_DIR, 'analytics.json'),
  CHANNEL_VAULT_FILE: path.join(ROOT_DIR, 'channelVault.json'),
  META_TOKENS_FILE: path.join(ROOT_DIR, 'metaTokens.json'),
  META_CONVERSATIONS_FILE: path.join(ROOT_DIR, 'metaConversations.json'),
  META_CONFIG_FILE: path.join(ROOT_DIR, 'metaConfig.json'),
  // Dual Meta App — archivos independientes por empresa
  META_CONFIG_AGRO_FILE: path.join(ROOT_DIR, 'metaConfig_agro.json'),
  META_CONFIG_TRACTO_FILE: path.join(ROOT_DIR, 'metaConfig_tracto.json'),
  META_TOKENS_AGRO_FILE: path.join(ROOT_DIR, 'metaTokens_agro.json'),
  META_TOKENS_TRACTO_FILE: path.join(ROOT_DIR, 'metaTokens_tracto.json')
};

const SECURITY_CONFIG = {
  API_WINDOW_MS: 60 * 1000,          // 1 minuto
  API_MAX_REQ: 180,                  // Máx 180 peticiones/min por IP
  LOGIN_WINDOW_MS: 15 * 60 * 1000,   // 15 minutos de bloqueo tras superar intentos
  LOGIN_MAX_ATTEMPTS: 5,             // Máx 5 intentos fallidos de login
  SESSION_TTL_MS: 12 * 60 * 60 * 1000 // 12 horas de duración de sesión activa
};

const CHANNEL_KEYS = [
  'wa_agro', 'ig_agro', 'tk_agro', 'fb_agro',
  'wa_tracto', 'ig_tracto', 'tk_tracto', 'fb_tracto'
];

const CHANNEL_LABELS = {
  wa_agro: 'Agropower • WhatsApp',
  ig_agro: 'Agropower • IG @agropower_venezuela',
  tk_agro: 'Agropower • TK @agropower_venezuela',
  fb_agro: 'Agropower • Facebook Messenger',
  wa_tracto: 'Tractopower • WhatsApp',
  ig_tracto: 'Tractopower • IG @Tractopower_venezuela',
  tk_tracto: 'Tractopower • TK @tractopowervenezuela',
  fb_tracto: 'Tractopower • Facebook Messenger'
};

const DEFAULT_GREETING_MENU = `👋 *¡Hola! Bienvenido a nuestra central de atención.*
Selecciona qué información deseas recibir:

📘 *1. CATÁLOGO Y DESC. TÉCNICA*
 • Catálogo de modelos (PDF)
 • Repuestos
 • Garantía

💵 *2. COSTOS Y FINANCIAMIENTO*
 • Precio de los modelos
 • Sistema de financiamiento
 • Compras programadas

🧑‍💼 *3. HABLAR CON UN ASESOR*`;

const DEFAULT_OUT_OF_HOURS_MESSAGE =
  'Feliz dia estimado cliente, gracias por contactarnos, en un momento un asesor se pondra en contacto con usted para brindarle toda la informacion que desea, gracias por su paciencia, Su consulta es muy importante para nosotros.';

module.exports = {
  PATHS,
  SECURITY_CONFIG,
  CHANNEL_KEYS,
  CHANNEL_LABELS,
  DEFAULT_GREETING_MENU,
  DEFAULT_OUT_OF_HOURS_MESSAGE
};
