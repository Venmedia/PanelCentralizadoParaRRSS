const express = require('express');
const crypto = require('crypto');
const { SECURITY_CONFIG } = require('../config/constants');
const { getClientIp, loginRateMap } = require('../middleware/securityMiddleware');
const { requireAuth } = require('../middleware/authMiddleware');
const {
  loadUsers,
  saveUsers,
  loadAnalytics,
  saveAnalytics,
  getTodayISO,
  formatDurationMs,
  isAdminUser
} = require('../services/storageService');
const {
  activeSessions,
  safeComparePasswords,
  getSessionFromRequest,
  updateAdvisorSessionActivity
} = require('../services/sessionService');

function createAuthRouter(io) {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const ip = getClientIp(req);
    const now = Date.now();

    const rawUsername = req.body?.username;
    const rawPassword = req.body?.password;

    if (typeof rawUsername !== 'string' || typeof rawPassword !== 'string') {
      return res.status(400).json({ error: 'Formato de credenciales inválido.' });
    }

    const cleanUsername = rawUsername.trim();
    if (!cleanUsername || !rawPassword || cleanUsername.length > 50 || rawPassword.length > 100) {
      return res.status(400).json({ error: 'Ingresa un usuario y contraseña válidos.' });
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(cleanUsername)) {
      return res.status(400).json({
        error: 'El nombre de usuario contiene caracteres no permitidos por seguridad.'
      });
    }

    const rateKey = `${ip}`;
    let attemptRecord = loginRateMap.get(rateKey);
    if (attemptRecord && now - attemptRecord.firstAttempt > SECURITY_CONFIG.LOGIN_WINDOW_MS) {
      loginRateMap.delete(rateKey);
      attemptRecord = null;
    }

    if (attemptRecord && attemptRecord.count >= SECURITY_CONFIG.LOGIN_MAX_ATTEMPTS) {
      const retryAfterSeconds = Math.ceil(
        (SECURITY_CONFIG.LOGIN_WINDOW_MS - (now - attemptRecord.firstAttempt)) / 1000
      );
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Acceso bloqueado temporalmente por seguridad (${retryAfterSeconds}s restantes).`,
        retryAfterSeconds,
        locked: true
      });
    }

    const users = loadUsers();
    const matchedUser = users.find(
      u => u.username.toLowerCase() === cleanUsername.toLowerCase()
    );

    const isPasswordValid = matchedUser
      ? safeComparePasswords(rawPassword, matchedUser.password)
      : safeComparePasswords(rawPassword, 'dummy_secret_for_constant_time');

    if (!matchedUser || !isPasswordValid) {
      if (!attemptRecord) {
        attemptRecord = { firstAttempt: now, count: 0 };
      }
      attemptRecord.count++;
      loginRateMap.set(rateKey, attemptRecord);
      const remaining = Math.max(0, SECURITY_CONFIG.LOGIN_MAX_ATTEMPTS - attemptRecord.count);
      console.warn(
        `[Seguridad 🔒] Intento de login fallido para "${cleanUsername}" desde IP ${ip}. Intentos restantes: ${remaining}`
      );
      return res.status(401).json({
        error:
          remaining > 0
            ? `Usuario o contraseña incorrectos. Intentos restantes antes de bloqueo: ${remaining}.`
            : 'Has superado el límite de intentos. Tu acceso ha sido bloqueado por 15 minutos.',
        remainingAttempts: remaining
      });
    }

    loginRateMap.delete(rateKey);

    const token = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const sessionId = `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const nowStr = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
    const todayISO = getTodayISO();
    const userIsAdmin = isAdminUser(matchedUser);

    activeSessions.set(token, {
      sessionId,
      userId: matchedUser.id,
      username: matchedUser.username,
      role: matchedUser.role,
      isAdmin: userIsAdmin,
      loginTimestamp: now,
      lastSeenAt: now,
      csrfToken,
      ip
    });

    // REGLA DE ESTADÍSTICAS: Solo se registran estadísticas cuando ingresa un ASESOR (NO el admin)
    if (!userIsAdmin) {
      users.forEach(u => {
        if (u.id === matchedUser.id) {
          u.online = true;
          u.lastLogin = `Hoy, ${nowStr}`;
          u.lastActive = `En línea (${nowStr})`;
          if (!Array.isArray(u.connectionHistory)) u.connectionHistory = [];
          u.connectionHistory.unshift({
            sessionId,
            date: todayISO,
            loginTime: nowStr,
            loginTimestamp: now,
            lastSeen: 'En línea ahora',
            duration: 'En curso (1m)'
          });
          if (u.connectionHistory.length > 30) {
            u.connectionHistory = u.connectionHistory.slice(0, 30);
          }
        }
      });
      saveUsers(users);

      const analytics = loadAnalytics();
      analytics.events.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        date: todayISO,
        time: nowStr,
        userId: matchedUser.id,
        username: matchedUser.username,
        userFullName: `${matchedUser.firstName} ${matchedUser.lastName}`,
        type: 'user_login',
        sessionId
      });
      saveAnalytics(analytics);

      io.emit('users_updated', users);
      io.emit('analytics_updated');
      console.log(
        `[Login Asesor 📊] ${matchedUser.firstName} ${matchedUser.lastName} (@${matchedUser.username}) inició sesión. Comenzando registro de estadísticas.`
      );
    } else {
      console.log(
        `[Login Admin 🛡️] Administrador (@${matchedUser.username}) inició sesión (Exento de estadísticas).`
      );
    }

    res.setHeader(
      'Set-Cookie',
      `omnipanel_sid=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`
    );

    return res.json({
      success: true,
      token,
      csrfToken,
      user: {
        id: matchedUser.id,
        firstName: matchedUser.firstName,
        lastName: matchedUser.lastName,
        email: matchedUser.email,
        username: matchedUser.username,
        role: matchedUser.role,
        isAdmin: userIsAdmin,
        loginTime: nowStr,
        loginTimestamp: now
      }
    });
  });

  router.get('/me', requireAuth, (req, res) => {
    const u = req.authUser;
    const s = req.authSession;
    if (!isAdminUser(u)) {
      updateAdvisorSessionActivity(u.id, s.sessionId, false);
    }
    return res.json({
      authenticated: true,
      csrfToken: s.csrfToken,
      user: {
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        username: u.username,
        role: u.role,
        isAdmin: isAdminUser(u),
        loginTimestamp: s.loginTimestamp
      }
    });
  });

  router.post('/heartbeat', requireAuth, (req, res) => {
    const u = req.authUser;
    const s = req.authSession;
    if (!isAdminUser(u)) {
      updateAdvisorSessionActivity(u.id, s.sessionId, false);
      io.emit('analytics_updated');
    }
    return res.json({
      success: true,
      elapsedDuration: formatDurationMs(Date.now() - s.loginTimestamp)
    });
  });

  router.post('/logout', (req, res) => {
    const session = getSessionFromRequest(req);
    if (session) {
      if (!session.isAdmin) {
        updateAdvisorSessionActivity(session.userId, session.sessionId, true);
        io.emit('users_updated', loadUsers());
        io.emit('analytics_updated');
      }
      activeSessions.delete(session.token);
    }
    res.setHeader(
      'Set-Cookie',
      'omnipanel_sid=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0'
    );
    return res.json({ success: true });
  });

  return router;
}

module.exports = createAuthRouter;
