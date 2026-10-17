const express = require('express');
const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config/constants');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { loadBotConfig, saveBotConfig } = require('../services/storageService');
const { evaluateSchedule } = require('../services/scheduleService');

function createConfigRouter(io) {
  const router = express.Router();

  // Obtener configuración de bienvenida, plantillas, empresas y horario
  router.get('/templates', requireAuth, (req, res) => {
    const config = loadBotConfig();
    const scheduleStatus = evaluateSchedule(config.schedule, config);
    res.json({ ...config, scheduleStatus });
  });

  // Guardar configuración (EXCLUSIVO PARA ADMIN)
  router.post('/templates', requireAuth, requireAdmin, (req, res) => {
    const current = loadBotConfig();
    const body = req.body || {};

    if (body.schedule) {
      current.schedule = {
        ...(current.schedule || {}),
        ...body.schedule
      };
    }

    if (typeof body.greeting === 'string' && body.greeting.trim() !== '') {
      current.greeting = body.greeting;
    }

    if (Array.isArray(body.customCategories)) {
      current.customCategories = body.customCategories;
    }

    if (Array.isArray(body.customOptions)) {
      current.customOptions = body.customOptions;
    }

    if (body.companies) {
      current.companies = {
        ...(current.companies || {}),
        ...body.companies
      };
    }

    if (body.testWhatsappChannel) {
      current.testWhatsappChannel = body.testWhatsappChannel;
    }

    if (body.categories) {
      current.categories = body.categories;
    }

    saveBotConfig(current);
    const scheduleStatus = evaluateSchedule(current.schedule, current);
    io.emit('config_updated', { ...current, scheduleStatus });
    res.json({ success: true, config: current, scheduleStatus });
  });

  // Consultar estado del archivo PDF del catálogo
  router.get('/catalog-pdf', requireAuth, (req, res) => {
    const config = loadBotConfig();
    const fileName = config.categories?.catalogo_tecnico?.items?.cat_modelos?.attachment || '';
    if (!fileName) {
      return res.json({ exists: false, fileName: '', sizeBytes: 0, url: '' });
    }
    const fullPath = path.join(PATHS.MEDIA_DIR, path.basename(fileName));
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      return res.json({
        exists: true,
        fileName: path.basename(fileName),
        sizeBytes: stats.size,
        updatedAt: stats.mtime,
        url: `/media/${encodeURIComponent(path.basename(fileName))}`
      });
    }
    return res.json({ exists: false, fileName: path.basename(fileName), sizeBytes: 0, url: '' });
  });

  // Subir o sustituir el PDF del catálogo desde la PC (EXCLUSIVO PARA ADMIN)
  router.post('/catalog-pdf', requireAuth, requireAdmin, (req, res) => {
    try {
      const { fileName, fileBase64 } = req.body || {};
      if (!fileName || !fileBase64) {
        return res.status(400).json({ error: 'Falta el nombre o contenido del archivo PDF' });
      }

      let safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!safeName.toLowerCase().endsWith('.pdf')) {
        safeName += '.pdf';
      }

      const base64Data = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
      const buffer = Buffer.from(base64Data, 'base64');

      // Verificar firma mágica %PDF- para evitar subida de ejecutables o scripts disfrazados
      const headerStr = buffer.subarray(0, 5).toString('ascii');
      if (headerStr !== '%PDF-') {
        return res.status(400).json({
          error: 'Archivo rechazado por seguridad: El contenido no es un documento PDF válido.'
        });
      }

      const config = loadBotConfig();
      const oldFile = config.categories?.catalogo_tecnico?.items?.cat_modelos?.attachment;
      if (oldFile && oldFile !== safeName) {
        const oldPath = path.join(PATHS.MEDIA_DIR, path.basename(oldFile));
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch (e) {}
        }
      }

      const targetPath = path.join(PATHS.MEDIA_DIR, safeName);
      fs.writeFileSync(targetPath, buffer);

      if (!config.categories) config.categories = {};
      if (!config.categories.catalogo_tecnico) {
        config.categories.catalogo_tecnico = { title: 'Catálogo y Descripción Técnica', items: {} };
      }
      if (!config.categories.catalogo_tecnico.items) config.categories.catalogo_tecnico.items = {};
      if (!config.categories.catalogo_tecnico.items.cat_modelos) {
        config.categories.catalogo_tecnico.items.cat_modelos = {
          title: 'Catálogo de modelos',
          reply:
            '📄 *Catálogo Oficial de Modelos:* Te adjuntamos en este mensaje nuestro catálogo completo en PDF con todas las fichas técnicas y modelos disponibles.'
        };
      }
      config.categories.catalogo_tecnico.items.cat_modelos.attachment = safeName;
      saveBotConfig(config);

      const scheduleStatus = evaluateSchedule(config.schedule, config);
      io.emit('config_updated', { ...config, scheduleStatus });

      return res.json({
        success: true,
        exists: true,
        fileName: safeName,
        sizeBytes: buffer.length,
        url: `/media/${encodeURIComponent(safeName)}`
      });
    } catch (err) {
      console.error('[Catálogo PDF Error]:', err);
      return res.status(500).json({ error: 'Error al guardar el PDF en el servidor' });
    }
  });

  // Eliminar el PDF del catálogo del servidor (EXCLUSIVO PARA ADMIN)
  router.delete('/catalog-pdf', requireAuth, requireAdmin, (req, res) => {
    try {
      const config = loadBotConfig();
      const currentFile = config.categories?.catalogo_tecnico?.items?.cat_modelos?.attachment;

      if (currentFile) {
        const fullPath = path.join(PATHS.MEDIA_DIR, path.basename(currentFile));
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }

      if (config.categories?.catalogo_tecnico?.items?.cat_modelos) {
        config.categories.catalogo_tecnico.items.cat_modelos.attachment = '';
        saveBotConfig(config);
      }

      const scheduleStatus = evaluateSchedule(config.schedule, config);
      io.emit('config_updated', { ...config, scheduleStatus });

      return res.json({ success: true, exists: false, fileName: '' });
    } catch (err) {
      console.error('[Catálogo PDF Delete Error]:', err);
      return res.status(500).json({ error: 'Error al eliminar el PDF del servidor' });
    }
  });

  return router;
}

module.exports = createConfigRouter;
