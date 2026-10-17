/* =========================================================================
   MÓDULO 1: ESTADO GLOBAL Y METADATOS DE CANALES (public/js/state.js)
   ========================================================================= */

let socket = null;
try {
  socket = io();
} catch (e) {}

let authToken = sessionStorage.getItem('omnipanel_token') || '';
let csrfToken = sessionStorage.getItem('omnipanel_csrf') || '';
let authenticatedUser = null;
let sessionTimerInterval = null;
let heartbeatInterval = null;
let lockoutTimerInterval = null;

let currentFilter = 'all';
let activeChatId = 1;
let conversations = [];
let currentUserId = 1;
let usersList = [];
let latestAnalytics = null;
let customProgrammedCategories = [];
let customProgrammedOptions = [];

const DEFAULT_GREETING_TEXT = `👋 *¡Hola! Bienvenido a nuestra central de atención.*
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

const channelMeta = {
  // AGROPOWER (4 canales)
  wa_agro: {
    company: 'agropower',
    companyName: '🌿 Agropower',
    companyBadgeClass: 'bg-emerald-950 text-emerald-300 border-emerald-700',
    label: 'WA Agropower (En prueba)',
    shortLabel: 'WA (Prueba)',
    account: 'Pendiente / En prueba',
    badgeClass: 'bg-emerald-950 text-emerald-400 border-emerald-800',
    icon: 'fa-whatsapp text-emerald-400'
  },
  ig_agro: {
    company: 'agropower',
    companyName: '🌿 Agropower',
    companyBadgeClass: 'bg-emerald-950 text-emerald-300 border-emerald-700',
    label: 'IG @agropower_venezuela',
    shortLabel: '@agropower_venezuela',
    account: 'agropower_venezuela',
    badgeClass: 'bg-pink-950 text-pink-400 border-pink-800',
    icon: 'fa-instagram text-pink-400'
  },
  tk_agro: {
    company: 'agropower',
    companyName: '🌿 Agropower',
    companyBadgeClass: 'bg-emerald-950 text-emerald-300 border-emerald-700',
    label: 'TK @agropower_venezuela',
    shortLabel: '@agropower_venezuela',
    account: 'agropower_venezuela',
    badgeClass: 'bg-cyan-950 text-cyan-400 border-cyan-800',
    icon: 'fa-tiktok text-cyan-400'
  },
  fb_agro: {
    company: 'agropower',
    companyName: '🌿 Agropower',
    companyBadgeClass: 'bg-emerald-950 text-emerald-300 border-emerald-700',
    label: 'FB Messenger (Pendiente)',
    shortLabel: 'FB Messenger',
    account: 'Pendiente por configurar',
    badgeClass: 'bg-blue-950 text-blue-400 border-blue-800',
    icon: 'fa-facebook-messenger text-blue-400'
  },

  // TRACTOPOWER (4 canales)
  wa_tracto: {
    company: 'tractopower',
    companyName: '🚜 Tractopower',
    companyBadgeClass: 'bg-amber-950 text-amber-300 border-amber-700',
    label: 'WA Tractopower (En prueba)',
    shortLabel: 'WA (Prueba)',
    account: 'Pendiente / En prueba',
    badgeClass: 'bg-emerald-950 text-emerald-400 border-emerald-800',
    icon: 'fa-whatsapp text-emerald-400'
  },
  ig_tracto: {
    company: 'tractopower',
    companyName: '🚜 Tractopower',
    companyBadgeClass: 'bg-amber-950 text-amber-300 border-amber-700',
    label: 'IG @Tractopower_venezuela',
    shortLabel: '@Tractopower_venezuela',
    account: 'Tractopower_venezuela',
    badgeClass: 'bg-fuchsia-950 text-fuchsia-400 border-fuchsia-800',
    icon: 'fa-instagram text-fuchsia-400'
  },
  tk_tracto: {
    company: 'tractopower',
    companyName: '🚜 Tractopower',
    companyBadgeClass: 'bg-amber-950 text-amber-300 border-amber-700',
    label: 'TK @tractopowervenezuela',
    shortLabel: '@tractopowervenezuela',
    account: 'tractopowervenezuela',
    badgeClass: 'bg-teal-950 text-teal-400 border-teal-800',
    icon: 'fa-tiktok text-teal-400'
  },
  fb_tracto: {
    company: 'tractopower',
    companyName: '🚜 Tractopower',
    companyBadgeClass: 'bg-amber-950 text-amber-300 border-amber-700',
    label: 'FB Messenger (Pendiente)',
    shortLabel: 'FB Messenger',
    account: 'Pendiente por configurar',
    badgeClass: 'bg-indigo-950 text-indigo-400 border-indigo-800',
    icon: 'fa-facebook-messenger text-indigo-400'
  }
};

// Alias de retrocompatibilidad
channelMeta.wa1 = channelMeta.wa_agro;
channelMeta.ig1 = channelMeta.ig_agro;
channelMeta.tk1 = channelMeta.tk_agro;
channelMeta.ig2 = channelMeta.ig_tracto;
channelMeta.tk2 = channelMeta.tk_tracto;
