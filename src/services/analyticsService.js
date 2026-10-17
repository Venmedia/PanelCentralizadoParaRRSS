/**
 * =========================================================================
 * SERVICIO DE ANALÍTICAS v3.2 — Almacenamiento por día, retención 90 días
 * =========================================================================
 * 
 * Estructura de archivos:
 *   data/analytics/YYYY-MM-DD.json  (un archivo por día)
 *   Cada archivo: { events: [...], lastUpdated: "ISO" }
 * 
 * Funcionalidades:
 *   - Registrar eventos (client_attended, sale_closed, message_sent)
 *   - Consultar por rango de fechas
 *   - Consultar por semana específica (ISO week)
 *   - Auto-purga de datos > 90 días
 *   - Migración automática desde analytics.json antiguo
 */

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config/constants');

// Directorio de datos de analíticas particionados por día
const ANALYTICS_DIR = path.join(PATHS.ROOT_DIR, 'data', 'analytics');
const LEGACY_ANALYTICS_FILE = PATHS.ANALYTICS_FILE; // analytics.json antiguo
const MAX_RETENTION_DAYS = 90;

// ─── Zona horaria fija: Venezuela (America/Caracas = UTC-4) ────────────
const TIMEZONE = 'America/Caracas';

// Asegurar que exista el directorio
function ensureAnalyticsDir() {
  if (!fs.existsSync(ANALYTICS_DIR)) {
    fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
  }
}

// ─── Utilidades de fecha (siempre en hora Venezuela) ───────────────────

/**
 * Obtiene un objeto Date ajustado a la hora de Venezuela
 */
function getVenezuelaDate(d) {
  const dateObj = d || new Date();
  // Convertir a string en zona Venezuela y re-parsear
  const parts = dateObj.toLocaleString('en-US', { timeZone: TIMEZONE }).split(/[/,: ]+/);
  // parts: [month, day, year, hours, minutes, seconds, AM/PM]
  const month = parseInt(parts[0]);
  const day = parseInt(parts[1]);
  const year = parseInt(parts[2]);
  let hours = parseInt(parts[3]);
  const minutes = parseInt(parts[4]);
  const seconds = parseInt(parts[5]);
  const ampm = parts[6];
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  return { year, month, day, hours, minutes, seconds };
}

function getTodayISO() {
  const v = getVenezuelaDate();
  return `${v.year}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`;
}

function formatDateISO(d) {
  const v = getVenezuelaDate(d);
  return `${v.year}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`;
}

function getNowTime() {
  const v = getVenezuelaDate();
  return `${String(v.hours).padStart(2, '0')}:${String(v.minutes).padStart(2, '0')}`;
}

/**
 * Obtiene el número de semana ISO y año de una fecha
 */
function getISOWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getFullYear(), week: weekNo };
}

/**
 * Obtiene las fechas de inicio (lunes) y fin (domingo) de una semana ISO
 */
function getWeekDateRange(year, week) {
  // Enero 4 siempre está en la semana 1
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // 1=lun...7=dom
  const mondayOfWeek1 = new Date(jan4);
  mondayOfWeek1.setDate(jan4.getDate() - dayOfWeek + 1);
  
  const startDate = new Date(mondayOfWeek1);
  startDate.setDate(mondayOfWeek1.getDate() + (week - 1) * 7);
  
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  
  return {
    from: formatDateISO(startDate),
    to: formatDateISO(endDate)
  };
}

/**
 * Genera array de fechas entre from y to (inclusive)
 */
function getDateRange(fromISO, toISO) {
  const dates = [];
  const start = new Date(fromISO + 'T12:00:00');
  const end = new Date(toISO + 'T12:00:00');
  const current = new Date(start);
  while (current <= end) {
    dates.push(formatDateISO(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/**
 * Obtiene el inicio de la semana actual (lunes)
 */
function getCurrentWeekStart() {
  const now = new Date();
  const day = now.getDay() || 7; // 1=lun...7=dom
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  return formatDateISO(monday);
}

// ─── Lectura/Escritura de archivos diarios ─────────────────────────────

function getDayFilePath(dateISO) {
  return path.join(ANALYTICS_DIR, `${dateISO}.json`);
}

function loadDayEvents(dateISO) {
  const filePath = getDayFilePath(dateISO);
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data.events || [];
  } catch (e) {
    return [];
  }
}

function saveDayEvents(dateISO, events) {
  ensureAnalyticsDir();
  const filePath = getDayFilePath(dateISO);
  const data = {
    events,
    lastUpdated: new Date().toISOString()
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ─── Registro de eventos ───────────────────────────────────────────────

/**
 * Registra un evento en el archivo del día correspondiente.
 * Si no se pasa fecha, usa hoy.
 */
function recordEvent(event) {
  const dateISO = event.date || getTodayISO();
  event.date = dateISO;
  event.time = event.time || getNowTime();
  event.id = event.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  event.timestamp = event.timestamp || new Date().toISOString();

  const events = loadDayEvents(dateISO);
  events.push(event);
  saveDayEvents(dateISO, events);

  // También mantener compatibilidad con analytics.json legacy (para que no falle nada)
  try {
    const legacyData = loadLegacyAnalytics();
    legacyData.events.push(event);
    saveLegacyAnalytics(legacyData);
  } catch (e) {
    // No es crítico si falla
  }

  return event;
}

// ─── Consultas ─────────────────────────────────────────────────────────

/**
 * Obtiene todos los eventos para un rango de fechas
 */
function getEventsForDateRange(fromISO, toISO) {
  const dates = getDateRange(fromISO, toISO);
  let allEvents = [];
  dates.forEach(dateISO => {
    const dayEvents = loadDayEvents(dateISO);
    allEvents = allEvents.concat(dayEvents);
  });
  return allEvents;
}

/**
 * Obtiene eventos de la semana actual (lunes a hoy)
 */
function getCurrentWeekEvents() {
  const weekStart = getCurrentWeekStart();
  const today = getTodayISO();
  return getEventsForDateRange(weekStart, today);
}

/**
 * Obtiene eventos de una semana ISO específica
 */
function getWeekEvents(year, week) {
  const range = getWeekDateRange(year, week);
  return getEventsForDateRange(range.from, range.to);
}

/**
 * Obtiene eventos de hoy
 */
function getTodayEvents() {
  return loadDayEvents(getTodayISO());
}

/**
 * Lista las semanas disponibles con datos (para el selector del frontend)
 */
function getAvailableWeeks() {
  ensureAnalyticsDir();
  const files = fs.readdirSync(ANALYTICS_DIR).filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.json$/));
  const weeksMap = {};
  
  files.forEach(f => {
    const dateISO = f.replace('.json', '');
    const { year, week } = getISOWeek(dateISO);
    const key = `${year}-W${String(week).padStart(2, '0')}`;
    if (!weeksMap[key]) {
      const range = getWeekDateRange(year, week);
      weeksMap[key] = {
        key,
        year,
        week,
        from: range.from,
        to: range.to,
        label: `Semana ${week} (${range.from} al ${range.to})`
      };
    }
  });
  
  return Object.values(weeksMap).sort((a, b) => b.key.localeCompare(a.key));
}

/**
 * Lista los días disponibles con datos
 */
function getAvailableDays() {
  ensureAnalyticsDir();
  const files = fs.readdirSync(ANALYTICS_DIR).filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.json$/));
  return files.map(f => f.replace('.json', '')).sort().reverse();
}

// ─── Purga de datos antiguos ───────────────────────────────────────────

/**
 * Elimina archivos de analíticas con más de MAX_RETENTION_DAYS días
 */
function purgeOldData() {
  ensureAnalyticsDir();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - MAX_RETENTION_DAYS);
  const cutoffISO = formatDateISO(cutoffDate);
  
  const files = fs.readdirSync(ANALYTICS_DIR).filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.json$/));
  let purgedCount = 0;
  
  files.forEach(f => {
    const dateISO = f.replace('.json', '');
    if (dateISO < cutoffISO) {
      try {
        fs.unlinkSync(path.join(ANALYTICS_DIR, f));
        purgedCount++;
      } catch (e) {
        // Ignorar errores de eliminación
      }
    }
  });
  
  // También limpiar el archivo legacy para que no crezca indefinidamente
  if (purgedCount > 0) {
    try {
      const legacyData = loadLegacyAnalytics();
      legacyData.events = (legacyData.events || []).filter(e => e.date >= cutoffISO);
      saveLegacyAnalytics(legacyData);
    } catch (e) {}
  }
  
  return purgedCount;
}

// ─── Migración desde analytics.json antiguo ────────────────────────────

function loadLegacyAnalytics() {
  if (!fs.existsSync(LEGACY_ANALYTICS_FILE)) return { events: [] };
  try {
    return JSON.parse(fs.readFileSync(LEGACY_ANALYTICS_FILE, 'utf8'));
  } catch (e) {
    return { events: [] };
  }
}

function saveLegacyAnalytics(data) {
  fs.writeFileSync(LEGACY_ANALYTICS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Migra eventos del analytics.json antiguo a archivos particionados por día.
 * Solo se ejecuta una vez (verifica si ya se migró).
 */
function migrateFromLegacy() {
  ensureAnalyticsDir();
  const migrationFlagPath = path.join(ANALYTICS_DIR, '.migrated');
  
  if (fs.existsSync(migrationFlagPath)) return false; // Ya migrado
  
  const legacyData = loadLegacyAnalytics();
  const events = legacyData.events || [];
  
  if (events.length === 0) {
    // No hay nada que migrar, pero marcar como migrado
    fs.writeFileSync(migrationFlagPath, new Date().toISOString());
    return false;
  }
  
  // Agrupar por fecha
  const byDate = {};
  events.forEach(ev => {
    const date = ev.date || getTodayISO();
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(ev);
  });
  
  // Guardar cada grupo en su archivo
  Object.entries(byDate).forEach(([dateISO, dayEvents]) => {
    const existing = loadDayEvents(dateISO);
    const merged = existing.concat(dayEvents);
    saveDayEvents(dateISO, merged);
  });
  
  fs.writeFileSync(migrationFlagPath, new Date().toISOString());
  console.log(`[Analytics] Migrados ${events.length} eventos legacy a archivos particionados por día`);
  return true;
}

// ─── Verificar si un evento ya existe (para evitar duplicados de client_attended) ──

/**
 * Verifica si ya existe un evento client_attended para un usuario+conversación en un día
 */
function hasAttendedToday(userId, conversationId) {
  const today = getTodayISO();
  const events = loadDayEvents(today);
  return events.some(e => 
    e.type === 'client_attended' && 
    (Number(e.userId) === Number(userId)) && 
    e.conversationId === conversationId
  );
}

/**
 * Verifica si ya existe un evento client_attended para un usuario+conversación en un rango
 */
function hasAttendedInRange(userId, conversationId, fromISO, toISO) {
  const events = getEventsForDateRange(fromISO, toISO);
  return events.some(e =>
    e.type === 'client_attended' &&
    (Number(e.userId) === Number(userId)) &&
    e.conversationId === conversationId
  );
}

// ─── Inicialización ────────────────────────────────────────────────────

function initialize() {
  ensureAnalyticsDir();
  migrateFromLegacy();
  purgeOldData();
  console.log('[Analytics] Servicio de analíticas v3.2 inicializado');
  
  // Programar purga diaria (cada 24 horas)
  setInterval(() => {
    const purged = purgeOldData();
    if (purged > 0) {
      console.log(`[Analytics] Purga automática: ${purged} archivos eliminados (> ${MAX_RETENTION_DAYS} días)`);
    }
  }, 24 * 60 * 60 * 1000);
}

module.exports = {
  // Inicialización
  initialize,
  
  // Registro
  recordEvent,
  
  // Consultas
  getEventsForDateRange,
  getCurrentWeekEvents,
  getWeekEvents,
  getTodayEvents,
  getAvailableWeeks,
  getAvailableDays,
  
  // Verificaciones
  hasAttendedToday,
  hasAttendedInRange,
  
  // Utilidades
  getTodayISO,
  formatDateISO,
  getNowTime,
  getISOWeek,
  getWeekDateRange,
  getDateRange,
  getCurrentWeekStart,
  
  // Mantenimiento
  purgeOldData,
  migrateFromLegacy
};
