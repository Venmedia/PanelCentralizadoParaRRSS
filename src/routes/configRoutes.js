/**
 * @file configRoutes.js
 * @description Rutas para configuración de plantillas, menú de bienvenida, horario y catálogos PDF.
 * Soporta configuración y archivos independientes para Agropower y Tractopower.
 */

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
    const company = req.query.company || 'agropower';
    const scheduleStatus = evaluateSchedule(config.schedule, config, company);
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

    if (body.testWhatsappChannel) {
      current.testWhatsappChannel = body.testWhatsappChannel;
    }

    if (!current.companies) current.companies = {};

    // 1. Guardar Agropower
    if (body.companies?.agropower) {
      current.companies.agropower = {
        ...(current.companies.agropower || {}),
        ...body.companies.agropower
      };
      if (body.companies.agropower.categories) {
        current.companies.agropower.categories = body.companies.agropower.categories;
      }
    }

    // 2. Guardar Tractopower
    if (body.companies?.tractopower) {
      current.companies.tractopower = {
        ...(current.companies.tractopower || {}),
        ...body.companies.tractopower
      };
      if (body.companies.tractopower.categories) {
        current.companies.tractopower.categories = body.companies.tractopower.categories;
      }
    }

    // 3. Si viene una sola empresa indicada en body.targetCompany
    if (body.targetCompany === 'tractopower' && body.categories) {
      if (!current.companies.tractopower) current.companies.tractopower = {};
      current.companies.tractopower.categories = body.categories;
      if (body.greeting) current.companies.tractopower.greeting = body.greeting;
      if (body.welcomeMessage) current.companies.tractopower.welcomeMessage = body.welcomeMessage;
    } else if (body.targetCompany === 'agropower' && body.categories) {
      if (!current.companies.agropower) current.companies.agropower = {};
      current.companies.agropower.categories = body.categories;
      if (body.greeting) current.companies.agropower.greeting = body.greeting;
      if (body.welcomeMessage) current.companies.agropower.welcomeMessage = body.welcomeMessage;
    }

    // Sincronizar raíz con agropower para máxima compatibilidad
    if (current.companies.agropower?.categories) {
      current.categories = current.companies.agropower.categories;
      current.greeting = current.companies.agropower.greeting || current.greeting;
      current.customCategories = current.companies.agropower.customCategories || [];
      current.customOptions = current.companies.agropower.customOptions || [];
    }

    saveBotConfig(current);
    const scheduleStatus = evaluateSchedule(current.schedule, current);
    io.emit('config_updated', { ...current, scheduleStatus });
    res.json({ success: true, config: current, scheduleStatus });
  });

  // Consultar estado del archivo PDF del catálogo (según empresa)
  router.get('/catalog-pdf', requireAuth, (req, res) => {
    const config = loadBotConfig();
    const company = String(req.query.company || 'agropower').toLowerCase().includes('tracto') ? 'tractopower' : 'agropower';

    let fileName = '';
    if (company === 'tractopower') {
      fileName = config.companies?.tractopower?.categories?.catalogo_tecnico?.items?.cat_modelos?.attachment || 'catalogo_tractopower.pdf';
    } else {
      fileName = config.companies?.agropower?.categories?.catalogo_tecnico?.items?.cat_modelos?.attachment || config.categories?.catalogo_tecnico?.items?.cat_modelos?.attachment || '1792614914044_5atuoj.pdf';
    }

    if (!fileName) {
      return res.json({ exists: false, fileName: '', sizeBytes: 0, url: '', company });
    }
    const fullPath = path.join(PATHS.MEDIA_DIR, path.basename(fileName));
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      return res.json({
        exists: true,
        fileName: path.basename(fileName),
        sizeBytes: stats.size,
        updatedAt: stats.mtime,
        url: `/media/${encodeURIComponent(path.basename(fileName))}`,
        company
      });
    }
    return res.json({ exists: false, fileName: path.basename(fileName), sizeBytes: 0, url: '', company });
  });

  // Subir o sustituir el PDF del catálogo desde la PC (EXCLUSIVO PARA ADMIN)
  router.post('/catalog-pdf', requireAuth, requireAdmin, (req, res) => {
    try {
      const { fileName, fileBase64, company } = req.body || {};
      if (!fileName || !fileBase64) {
        return res.status(400).json({ error: 'Falta el nombre o contenido del archivo PDF' });
      }

      const targetCompany = String(company || 'agropower').toLowerCase().includes('tracto') ? 'tractopower' : 'agropower';

      let safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!safeName.toLowerCase().endsWith('.pdf')) {
        safeName += '.pdf';
      }

      const base64Data = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
      const buffer = Buffer.from(base64Data, 'base64');

      // Verificar firma mágica %PDF-
      const headerStr = buffer.subarray(0, 5).toString('ascii');
      if (headerStr !== '%PDF-') {
        return res.status(400).json({
          error: 'Archivo rechazado por seguridad: El contenido no es un documento PDF válido.'
        });
      }

      const config = loadBotConfig();
      if (!config.companies) config.companies = {};
      if (!config.companies[targetCompany]) config.companies[targetCompany] = {};
      if (!config.companies[targetCompany].categories) config.companies[targetCompany].categories = {};
      if (!config.companies[targetCompany].categories.catalogo_tecnico) {
        config.companies[targetCompany].categories.catalogo_tecnico = { title: 'Catálogo y Descripción Técnica', items: {} };
      }
      if (!config.companies[targetCompany].categories.catalogo_tecnico.items) {
        config.companies[targetCompany].categories.catalogo_tecnico.items = {};
      }

      const currentItem = config.companies[targetCompany].categories.catalogo_tecnico.items.cat_modelos || {};
      const oldFile = currentItem.attachment;
      if (oldFile && oldFile !== safeName && oldFile !== 'catalogo_tractopower.pdf' && oldFile !== '1792614914044_5atuoj.pdf') {
        const oldPath = path.join(PATHS.MEDIA_DIR, path.basename(oldFile));
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch (e) {}
        }
      }

      const targetPath = path.join(PATHS.MEDIA_DIR, safeName);
      fs.writeFileSync(targetPath, buffer);

      if (!currentItem.title) currentItem.title = 'Catálogo de modelos';
      if (!currentItem.reply) {
        currentItem.reply = targetCompany === 'tractopower'
          ? '📄 *Catálogo Oficial de Maquinaria Pesada Tractopower:* Te adjuntamos en este mensaje nuestro catálogo completo en PDF con todas las fichas técnicas y modelos disponibles (Payloaders, Retroexcavadoras, Montacargas y Jumbos).'
          : '📄 *Catálogo Oficial de Modelos:* Te adjuntamos en este mensaje nuestro catálogo completo en PDF con todas las fichas técnicas y modelos disponibles.';
      }
      currentItem.attachment = safeName;
      config.companies[targetCompany].categories.catalogo_tecnico.items.cat_modelos = currentItem;

      if (targetCompany === 'agropower') {
        if (!config.categories) config.categories = {};
        if (!config.categories.catalogo_tecnico) config.categories.catalogo_tecnico = { title: 'Catálogo y Descripción Técnica', items: {} };
        if (!config.categories.catalogo_tecnico.items) config.categories.catalogo_tecnico.items = {};
        config.categories.catalogo_tecnico.items.cat_modelos = currentItem;
      }

      saveBotConfig(config);

      const scheduleStatus = evaluateSchedule(config.schedule, config);
      io.emit('config_updated', { ...config, scheduleStatus });

      return res.json({
        success: true,
        exists: true,
        fileName: safeName,
        sizeBytes: buffer.length,
        url: `/media/${encodeURIComponent(safeName)}`,
        company: targetCompany
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
      const targetCompany = String(req.query.company || req.body?.company || 'agropower').toLowerCase().includes('tracto') ? 'tractopower' : 'agropower';

      const currentFile = config.companies?.[targetCompany]?.categories?.catalogo_tecnico?.items?.cat_modelos?.attachment ||
        (targetCompany === 'agropower' ? config.categories?.catalogo_tecnico?.items?.cat_modelos?.attachment : '');

      if (currentFile && currentFile !== 'catalogo_tractopower.pdf' && currentFile !== '1792614914044_5atuoj.pdf') {
        const fullPath = path.join(PATHS.MEDIA_DIR, path.basename(currentFile));
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }

      if (config.companies?.[targetCompany]?.categories?.catalogo_tecnico?.items?.cat_modelos) {
        config.companies[targetCompany].categories.catalogo_tecnico.items.cat_modelos.attachment = '';
      }
      if (targetCompany === 'agropower' && config.categories?.catalogo_tecnico?.items?.cat_modelos) {
        config.categories.catalogo_tecnico.items.cat_modelos.attachment = '';
      }

      saveBotConfig(config);

      const scheduleStatus = evaluateSchedule(config.schedule, config);
      io.emit('config_updated', { ...config, scheduleStatus });

      return res.json({ success: true, exists: false, fileName: '', company: targetCompany });
    } catch (err) {
      console.error('[Catálogo PDF Delete Error]:', err);
      return res.status(500).json({ error: 'Error al eliminar el PDF del servidor' });
    }
  });

  return router;
}

module.exports = createConfigRouter;
