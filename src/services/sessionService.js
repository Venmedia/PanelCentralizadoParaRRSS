const crypto = require('crypto');
const { SECURITY_CONFIG } = require('../config/constants');
const {
  loadUsers,
  saveUsers,
  formatDurationMs,
  isAdminUser
} = require('./storageService');

const activeSessions = new Map(); // token -> { sessionId, userId, username, role, isAdmin, loginTimestamp, lastSeenAt, csrfToken, ip }

function safeComparePasswords(inputPwd, storedPwd) {
  const a = crypto.createHash('sha256').update(String(inputPwd || '')).digest();
  const b = crypto.createHash('sha256').update(String(storedPwd || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function getSessionFromRequest(req) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies['omnipanel_sid'] || null;
  }
  if (!token || typeof token !== 'string' || token.length < 32) return null;

  const session = activeSessions.get(token);
  if (!session) return null;

  if (Date.now() - session.lastSeenAt > SECURITY_CONFIG.SESSION_TTL_MS) {
    activeSessions.delete(token);
    return null;
  }
  session.lastSeenAt = Date.now();
  return { token, ...session };
}

function updateAdvisorSessionActivity(userId, sessionId, isLoggingOut = false) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === Number(userId));
  if (idx === -1) return;
  const u = users[idx];
  if (isAdminUser(u)) return; // El admin está exento de estadísticas y tiempos de sesión

  const nowStr = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
  u.online = !isLoggingOut;
  u.lastActive = isLoggingOut ? `Hoy, ${nowStr}` : `En línea (${nowStr})`;

  if (!Array.isArray(u.connectionHistory)) u.connectionHistory = [];
  const histEntry =
    (sessionId && u.connectionHistory.find(h => h.sessionId === sessionId)) ||
    u.connectionHistory[0];

  if (histEntry) {
    const elapsedMs = histEntry.loginTimestamp ? Date.now() - histEntry.loginTimestamp : 60000;
    const durationText = formatDurationMs(elapsedMs);
    histEntry.lastSeen = isLoggingOut ? nowStr : `En línea (${nowStr})`;
    histEntry.duration = isLoggingOut ? durationText : `En curso (${durationText})`;
  }

  saveUsers(users);
}

module.exports = {
  activeSessions,
  safeComparePasswords,
  parseCookies,
  getSessionFromRequest,
  updateAdvisorSessionActivity
};
