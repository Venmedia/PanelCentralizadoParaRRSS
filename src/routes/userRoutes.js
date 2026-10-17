const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { loadUsers, saveUsers, getTodayISO } = require('../services/storageService');

function createUserRouter(io) {
  const router = express.Router();

  // Obtener lista de todos los usuarios (EXCLUSIVO PARA ADMIN)
  router.get('/', requireAuth, requireAdmin, (req, res) => {
    res.json(loadUsers());
  });

  // Crear nuevo usuario administrable o admin (EXCLUSIVO PARA ADMIN)
  router.post('/', requireAuth, requireAdmin, (req, res) => {
    const { firstName, lastName, email, username, password, role } = req.body || {};
    if (!firstName || !lastName || !username || !password) {
      return res.status(400).json({ error: 'Nombre, apellido, usuario y clave son obligatorios' });
    }
    const cleanUser = String(username).trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(cleanUser)) {
      return res.status(400).json({
        error: 'El nombre de usuario solo puede contener letras, números, puntos, guiones y guiones bajos.'
      });
    }

    const users = loadUsers();
    if (users.some(u => u.username.toLowerCase() === cleanUser.toLowerCase())) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya existe' });
    }

    const nowStr = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
    const todayISO = getTodayISO();
    const newUser = {
      id: Date.now(),
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: String(email || '').trim(),
      username: cleanUser,
      password: String(password).trim(),
      role: role === 'admin' ? 'admin' : 'operator',
      createdAt: `${todayISO} ${nowStr}`,
      online: false,
      lastLogin: 'Sin iniciar sesión',
      lastActive: 'Sin actividad',
      connectionHistory: []
    };

    users.push(newUser);
    saveUsers(users);
    io.emit('users_updated', users);
    io.emit('analytics_updated');
    res.json({ success: true, user: newUser, users });
  });

  // Modificar datos o clave de un usuario existente (EXCLUSIVO PARA ADMIN)
  router.put('/:id', requireAuth, requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    const { firstName, lastName, email, username, password, role } = req.body || {};
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (username) {
      const cleanUser = String(username).trim();
      if (!/^[a-zA-Z0-9._-]+$/.test(cleanUser)) {
        return res.status(400).json({ error: 'Nombre de usuario inválido' });
      }
      if (users.some(u => u.id !== userId && u.username.toLowerCase() === cleanUser.toLowerCase())) {
        return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso por otro usuario' });
      }
      users[idx].username = cleanUser;
    }

    if (firstName !== undefined) users[idx].firstName = String(firstName).trim();
    if (lastName !== undefined) users[idx].lastName = String(lastName).trim();
    if (email !== undefined) users[idx].email = String(email).trim();
    if (password !== undefined && String(password).trim() !== '') {
      users[idx].password = String(password).trim();
    }
    if (role !== undefined && userId !== 1) {
      users[idx].role = role === 'admin' ? 'admin' : 'operator';
    }

    saveUsers(users);
    io.emit('users_updated', users);
    io.emit('analytics_updated');
    res.json({ success: true, user: users[idx], users });
  });

  // Eliminar un usuario administrable (EXCLUSIVO PARA ADMIN)
  router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (userId === 1) {
      return res.status(400).json({ error: 'No se puede eliminar al Administrador Principal' });
    }
    let users = loadUsers();
    users = users.filter(u => u.id !== userId);
    saveUsers(users);
    io.emit('users_updated', users);
    io.emit('analytics_updated');
    res.json({ success: true, users });
  });

  return router;
}

module.exports = createUserRouter;
