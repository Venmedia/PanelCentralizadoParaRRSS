/**
 * =========================================================================
 * RUTAS DE ANALÍTICAS v3.2 — Soporte de rango de fechas, semanas, comparación
 * =========================================================================
 * 
 * Endpoints:
 *   GET /api/analytics/summary          — Resumen actual (semana en curso) - retrocompatible
 *   GET /api/analytics/summary?from=&to= — Resumen por rango de fechas
 *   GET /api/analytics/daily/:date       — Estadísticas de un día específico
 *   GET /api/analytics/weekly/:year/:week — Estadísticas de una semana ISO
 *   GET /api/analytics/weeks             — Lista de semanas disponibles
 *   GET /api/analytics/days              — Lista de días disponibles
 *   GET /api/analytics/compare           — Comparación de usuarios en rango
 */

const express = require('express');
const { CHANNEL_KEYS, CHANNEL_LABELS } = require('../config/constants');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const {
  loadUsers,
  normalizeChannel,
  getCompanyFromChannel,
  isAdminUser
} = require('../services/storageService');
const analyticsService = require('../services/analyticsService');

function createAnalyticsRouter() {
  const router = express.Router();

  // ─── Helper: Computar estadísticas a partir de eventos filtrados ─────
  function computeStats(events, dateForToday) {
    const allUsers = loadUsers();
    const trackedUsers = allUsers.filter(u => !isAdminUser(u));
    const adminIds = new Set(allUsers.filter(u => isAdminUser(u)).map(u => Number(u.id)));
    const todayISO = dateForToday || analyticsService.getTodayISO();

    // Filtrar eventos de admin
    const filteredEvents = events.filter(
      e => !adminIds.has(Number(e.userId)) && String(e.username || '').toLowerCase() !== 'admin'
    );

    // Inicializar resúmenes de canales
    const channelsSummary = {};
    CHANNEL_KEYS.forEach(ch => {
      channelsSummary[ch] = {
        key: ch,
        company: getCompanyFromChannel(ch),
        label: CHANNEL_LABELS[ch],
        dailyAttended: 0,
        weeklyAttended: 0,
        dailySales: 0,
        weeklySales: 0,
        messagesSent: 0
      };
    });

    // Inicializar resúmenes de empresas
    const companiesSummary = {
      agropower: {
        key: 'agropower', name: 'Agropower',
        dailyAttended: 0, weeklyAttended: 0, dailySales: 0, weeklySales: 0
      },
      tractopower: {
        key: 'tractopower', name: 'Tractopower',
        dailyAttended: 0, weeklyAttended: 0, dailySales: 0, weeklySales: 0
      }
    };

    // Estadísticas por usuario
    const userStats = trackedUsers.map(u => {
      const uEvents = filteredEvents.filter(
        e => Number(e.userId) === Number(u.id) || e.username === u.username
      );
      const byChannel = {};
      const salesByChannel = {};
      CHANNEL_KEYS.forEach(k => { byChannel[k] = 0; salesByChannel[k] = 0; });

      let dailyAttended = 0, weeklyAttended = 0;
      let dailySales = 0, weeklySales = 0;
      let messagesSent = 0;

      uEvents.forEach(ev => {
        const normCh = normalizeChannel(ev.channel);
        const ch = CHANNEL_KEYS.includes(normCh) ? normCh : 'wa_agro';
        if (ev.type === 'client_attended') {
          weeklyAttended++;
          byChannel[ch] = (byChannel[ch] || 0) + 1;
          if (ev.date === todayISO) dailyAttended++;
        } else if (ev.type === 'sale_closed') {
          weeklySales++;
          salesByChannel[ch] = (salesByChannel[ch] || 0) + 1;
          if (ev.date === todayISO) dailySales++;
        } else if (ev.type === 'message_sent') {
          messagesSent++;
        }
      });

      const conversionRate = weeklyAttended > 0 ? Math.round((weeklySales / weeklyAttended) * 100) : 0;

      let topUserChannel = 'wa_agro';
      let maxChCount = 0;
      CHANNEL_KEYS.forEach(k => {
        if (byChannel[k] > maxChCount) {
          maxChCount = byChannel[k];
          topUserChannel = k;
        }
      });

      return {
        ...u,
        fullName: `${u.firstName} ${u.lastName}`,
        dailyAttended, weeklyAttended,
        dailySales, weeklySales,
        messagesSent, conversionRate,
        byChannel, salesByChannel,
        topChannelLabel: maxChCount > 0 ? CHANNEL_LABELS[topUserChannel] : 'Sin actividad aún'
      };
    });

    // Agregar estadísticas de canales y empresas
    filteredEvents.forEach(ev => {
      if (!ev.channel) return;
      const normCh = normalizeChannel(ev.channel);
      const ch = CHANNEL_KEYS.includes(normCh) ? normCh : 'wa_agro';
      const comp = getCompanyFromChannel(ch);

      if (ev.type === 'client_attended') {
        channelsSummary[ch].weeklyAttended++;
        companiesSummary[comp].weeklyAttended++;
        if (ev.date === todayISO) {
          channelsSummary[ch].dailyAttended++;
          companiesSummary[comp].dailyAttended++;
        }
      } else if (ev.type === 'sale_closed') {
        channelsSummary[ch].weeklySales++;
        companiesSummary[comp].weeklySales++;
        if (ev.date === todayISO) {
          channelsSummary[ch].dailySales++;
          companiesSummary[comp].dailySales++;
        }
      } else if (ev.type === 'message_sent') {
        channelsSummary[ch].messagesSent++;
      }
    });

    // Determinar canal más movido y con más cierres
    let busiestChannel = { label: 'Sin actividad aún', weeklyAttended: 0, dailyAttended: 0 };
    let topSalesChannel = { label: 'Sin cierres aún', weeklySales: 0, dailySales: 0 };
    CHANNEL_KEYS.forEach(k => {
      if (channelsSummary[k].weeklyAttended > busiestChannel.weeklyAttended) {
        busiestChannel = channelsSummary[k];
      }
      if (channelsSummary[k].weeklySales > topSalesChannel.weeklySales) {
        topSalesChannel = channelsSummary[k];
      }
    });

    // Lista de ventas cerradas (orden cronológico inverso)
    const closedSalesList = filteredEvents
      .filter(e => e.type === 'sale_closed')
      .map(e => ({
        ...e,
        channel: normalizeChannel(e.channel),
        company: getCompanyFromChannel(e.channel)
      }))
      .slice()
      .reverse();

    // Estadísticas diarias desglosadas (para gráficos de tendencia)
    const dailyBreakdown = {};
    filteredEvents.forEach(ev => {
      if (!ev.date) return;
      if (!dailyBreakdown[ev.date]) {
        dailyBreakdown[ev.date] = { date: ev.date, attended: 0, sales: 0, messages: 0 };
      }
      if (ev.type === 'client_attended') dailyBreakdown[ev.date].attended++;
      else if (ev.type === 'sale_closed') dailyBreakdown[ev.date].sales++;
      else if (ev.type === 'message_sent') dailyBreakdown[ev.date].messages++;
    });

    return {
      todayISO,
      users: userStats,
      channels: channelsSummary,
      companies: companiesSummary,
      busiestChannel,
      topSalesChannel,
      closedSalesList,
      dailyBreakdown: Object.values(dailyBreakdown).sort((a, b) => a.date.localeCompare(b.date)),
      totalWeeklyAttended: userStats.reduce((acc, u) => acc + u.weeklyAttended, 0),
      totalDailyAttended: userStats.reduce((acc, u) => acc + u.dailyAttended, 0),
      totalWeeklySales: userStats.reduce((acc, u) => acc + u.weeklySales, 0),
      totalDailySales: userStats.reduce((acc, u) => acc + u.dailySales, 0),
      totalMessages: userStats.reduce((acc, u) => acc + u.messagesSent, 0),
      totalEvents: filteredEvents.length
    };
  }

  // ─── GET /summary — Resumen (retrocompatible, acepta ?from=&to=) ────

  router.get('/summary', requireAuth, requireAdmin, (req, res) => {
    try {
      let events;
      let dateLabel;

      if (req.query.from && req.query.to) {
        // Rango personalizado
        events = analyticsService.getEventsForDateRange(req.query.from, req.query.to);
        dateLabel = `${req.query.from} al ${req.query.to}`;
      } else if (req.query.date) {
        // Día específico
        events = analyticsService.getEventsForDateRange(req.query.date, req.query.date);
        dateLabel = req.query.date;
      } else {
        // Semana actual (comportamiento por defecto / retrocompatible)
        events = analyticsService.getCurrentWeekEvents();
        const weekStart = analyticsService.getCurrentWeekStart();
        const today = analyticsService.getTodayISO();
        dateLabel = `Semana actual (${weekStart} al ${today})`;
      }

      const todayForComparison = req.query.date || analyticsService.getTodayISO();
      const stats = computeStats(events, todayForComparison);
      stats.dateLabel = dateLabel;
      stats.rangeFrom = req.query.from || analyticsService.getCurrentWeekStart();
      stats.rangeTo = req.query.to || analyticsService.getTodayISO();

      res.json(stats);
    } catch (err) {
      console.error('[Analytics] Error en /summary:', err);
      res.status(500).json({ error: 'Error al generar estadísticas' });
    }
  });

  // ─── GET /daily/:date — Estadísticas de un día específico ────────────

  router.get('/daily/:date', requireAuth, requireAdmin, (req, res) => {
    try {
      const dateISO = req.params.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
        return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
      }
      const events = analyticsService.getEventsForDateRange(dateISO, dateISO);
      const stats = computeStats(events, dateISO);
      stats.dateLabel = dateISO;
      stats.rangeFrom = dateISO;
      stats.rangeTo = dateISO;
      res.json(stats);
    } catch (err) {
      console.error('[Analytics] Error en /daily:', err);
      res.status(500).json({ error: 'Error al generar estadísticas diarias' });
    }
  });

  // ─── GET /weekly/:year/:week — Estadísticas de una semana ISO ────────

  router.get('/weekly/:year/:week', requireAuth, requireAdmin, (req, res) => {
    try {
      const year = parseInt(req.params.year);
      const week = parseInt(req.params.week);
      if (isNaN(year) || isNaN(week) || week < 1 || week > 53) {
        return res.status(400).json({ error: 'Año o semana inválidos' });
      }
      const range = analyticsService.getWeekDateRange(year, week);
      const events = analyticsService.getEventsForDateRange(range.from, range.to);
      const stats = computeStats(events, range.to);
      stats.dateLabel = `Semana ${week} de ${year} (${range.from} al ${range.to})`;
      stats.rangeFrom = range.from;
      stats.rangeTo = range.to;
      stats.weekInfo = { year, week, ...range };
      res.json(stats);
    } catch (err) {
      console.error('[Analytics] Error en /weekly:', err);
      res.status(500).json({ error: 'Error al generar informe semanal' });
    }
  });

  // ─── GET /weeks — Lista de semanas disponibles ───────────────────────

  router.get('/weeks', requireAuth, requireAdmin, (req, res) => {
    try {
      const weeks = analyticsService.getAvailableWeeks();
      // También incluir la semana actual aunque no tenga datos
      const { year, week } = analyticsService.getISOWeek(analyticsService.getTodayISO());
      const currentWeekKey = `${year}-W${String(week).padStart(2, '0')}`;
      const currentRange = analyticsService.getWeekDateRange(year, week);
      const hasCurrentWeek = weeks.some(w => w.key === currentWeekKey);
      
      if (!hasCurrentWeek) {
        weeks.unshift({
          key: currentWeekKey,
          year, week,
          from: currentRange.from,
          to: currentRange.to,
          label: `Semana ${week} (${currentRange.from} al ${currentRange.to}) — Actual`,
          isCurrent: true
        });
      } else {
        const cw = weeks.find(w => w.key === currentWeekKey);
        if (cw) cw.isCurrent = true;
      }

      res.json({ weeks, currentWeek: currentWeekKey });
    } catch (err) {
      console.error('[Analytics] Error en /weeks:', err);
      res.status(500).json({ error: 'Error al listar semanas' });
    }
  });

  // ─── GET /days — Lista de días disponibles ───────────────────────────

  router.get('/days', requireAuth, requireAdmin, (req, res) => {
    try {
      const days = analyticsService.getAvailableDays();
      res.json({ days, today: analyticsService.getTodayISO() });
    } catch (err) {
      console.error('[Analytics] Error en /days:', err);
      res.status(500).json({ error: 'Error al listar días' });
    }
  });

  // ─── GET /compare — Comparación de usuarios en rango ─────────────────

  router.get('/compare', requireAuth, requireAdmin, (req, res) => {
    try {
      const { from, to, users: userIds } = req.query;
      if (!from || !to) {
        return res.status(400).json({ error: 'Se requieren parámetros from y to' });
      }

      const events = analyticsService.getEventsForDateRange(from, to);
      const stats = computeStats(events, to);

      // Si se especificaron usuarios, filtrar solo esos
      if (userIds) {
        const idList = userIds.split(',').map(id => id.trim());
        stats.users = stats.users.filter(u => 
          idList.includes(String(u.id)) || idList.includes(u.username)
        );
      }

      // Agregar ranking
      const ranked = [...stats.users].sort((a, b) => {
        // Primero por ventas, luego por atendidos, luego por mensajes
        if (b.weeklySales !== a.weeklySales) return b.weeklySales - a.weeklySales;
        if (b.weeklyAttended !== a.weeklyAttended) return b.weeklyAttended - a.weeklyAttended;
        return b.messagesSent - a.messagesSent;
      });
      ranked.forEach((u, i) => { u.rank = i + 1; });

      stats.rankedUsers = ranked;
      stats.dateLabel = `Comparación: ${from} al ${to}`;
      stats.rangeFrom = from;
      stats.rangeTo = to;

      res.json(stats);
    } catch (err) {
      console.error('[Analytics] Error en /compare:', err);
      res.status(500).json({ error: 'Error al comparar usuarios' });
    }
  });

  return router;
}

module.exports = createAnalyticsRouter;
