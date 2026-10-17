const express = require('express');
const whatsappService = require('../../whatsappService');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { getConversations, saveConversations } = require('../services/storageService');

function createWhatsAppRouter(io) {
  const router = express.Router();

  router.get('/status', requireAuth, (req, res) => {
    const company = req.query.company || null;
    res.json(whatsappService.getStatus(company));
  });

  router.post('/config', requireAuth, requireAdmin, (req, res) => {
    whatsappService.updateConfig(req.body);
    res.json({ success: true, status: whatsappService.getStatus() });
  });

  router.post('/restart', requireAuth, requireAdmin, async (req, res) => {
    const company = req.query.company || req.body?.company || 'agro';
    await whatsappService.startIntegrated(company);
    res.json({ success: true, company });
  });

  router.post('/logout', requireAuth, requireAdmin, async (req, res) => {
    const company = req.query.company || req.body?.company || 'agro';
    await whatsappService.logout(company);
    res.json({ success: true, company });
  });

  /**
   * POST /api/whatsapp/sync-chats
   * Sincronización manual: compara las conversaciones del panel con los JIDs
   * conocidos por Baileys y elimina las que ya no existen en WhatsApp.
   *
   * Lógica de seguridad: si knownJids está vacío (ej: Baileys recién reconectó
   * y aún no ha recibido el listado), NO elimina nada para evitar falsos positivos.
   */
  router.post('/sync-chats', requireAuth, requireAdmin, (req, res) => {
    try {
      const knownJids = whatsappService.getKnownJids();
      const conversations = getConversations();

      // Separar conversaciones WA de las de Meta (no tocar Instagram/FB)
      const waConvs = conversations.filter(c =>
        c.jid && (c.jid.includes('@s.whatsapp.net') || c.jid.includes('@lid'))
      );
      const nonWaConvs = conversations.filter(c =>
        !c.jid || (!c.jid.includes('@s.whatsapp.net') && !c.jid.includes('@lid'))
      );

      if (knownJids.size === 0) {
        // Baileys aún no ha cargado los chats — no hacer nada
        return res.json({
          success: false,
          message: 'WhatsApp aún está cargando la lista de chats. Espera unos segundos y vuelve a intentarlo.',
          removed: 0,
          total: conversations.length
        });
      }

      // Filtrar conversaciones WA que siguen existiendo en WhatsApp
      const remainingWa = waConvs.filter(c => knownJids.has(c.jid));
      const removedCount = waConvs.length - remainingWa.length;
      const removedNames = waConvs
        .filter(c => !knownJids.has(c.jid))
        .map(c => c.name || c.jid);

      if (removedCount > 0) {
        const updated = [...remainingWa, ...nonWaConvs];
        saveConversations(updated);
        if (io) io.emit('conversations_updated', updated);
        console.log(`[Sync] 🗑️ Eliminadas ${removedCount} conversaciones huérfanas:`, removedNames);
      }

      res.json({
        success: true,
        removed: removedCount,
        removedNames,
        remaining: remainingWa.length + nonWaConvs.length,
        total: conversations.length,
        knownJids: knownJids.size
      });
    } catch (err) {
      console.error('[Sync] Error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createWhatsAppRouter;
