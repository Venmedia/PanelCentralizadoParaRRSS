const express = require('express');
const whatsappService = require('../../whatsappService');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { getConversations, saveConversations } = require('../services/storageService');

function createWhatsAppRouter(io) {
  const router = express.Router();

  router.get('/status', (req, res) => {
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
   * Sincronización manual: verifica la salud de los sockets de WhatsApp (Agropower y Tractopower),
   * asegura que ambos canales estén activos y retorna el desglose exacto de conversaciones.
   */
  router.post('/sync-chats', requireAuth, (req, res) => {
    try {
      const company = req.query.company || req.body?.company || null;
      const agroStatus = whatsappService.getStatus('agro');
      const tractoStatus = whatsappService.getStatus('tracto');

      // Si alguna línea está desconectada pero tiene credenciales, intentar reanudarla
      if (agroStatus.status === 'disconnected') {
        whatsappService.startIntegrated('agro').catch(() => {});
      }
      if (tractoStatus.status === 'disconnected') {
        whatsappService.startIntegrated('tracto').catch(() => {});
      }

      const conversations = getConversations();
      const waAgro = conversations.filter(c => c.channel === 'wa_agro' || (c.company && c.company.toLowerCase().includes('agro'))).length;
      const waTracto = conversations.filter(c => c.channel === 'wa_tracto' || (c.company && c.company.toLowerCase().includes('tracto'))).length;

      res.json({
        success: true,
        agro: { status: agroStatus.status, count: waAgro, user: agroStatus.user },
        tracto: { status: tractoStatus.status, count: waTracto, user: tractoStatus.user },
        totalConversations: conversations.length
      });
    } catch (err) {
      console.error('[Sync] Error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createWhatsAppRouter;
