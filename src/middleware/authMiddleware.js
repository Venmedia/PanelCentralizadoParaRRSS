const { loadUsers, isAdminUser } = require('../services/storageService');
const { activeSessions, getSessionFromRequest } = require('../services/sessionService');

// Middleware: Requiere sesión autenticada
function requireAuth(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Sesión no válida o expirada. Por favor inicia sesión.' });
  }
  const users = loadUsers();
  const user = users.find(u => u.id === Number(session.userId));
  if (!user) {
    activeSessions.delete(session.token);
    return res.status(401).json({ error: 'Usuario no encontrado. Inicia sesión nuevamente.' });
  }
  req.authSession = session;
  req.authUser = user;
  next();
}

// Middleware: Exclusivo para el Usuario Principal (Admin)
function requireAdmin(req, res, next) {
  if (!req.authUser || !isAdminUser(req.authUser)) {
    return res.status(403).json({
      error: 'Acceso denegado: Esta configuración está disponible únicamente para el usuario Administrador.'
    });
  }
  next();
}

module.exports = {
  requireAuth,
  requireAdmin
};
