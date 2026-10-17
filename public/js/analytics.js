/* =========================================================================
   MÓDULO 7: ESTADÍSTICAS v3.2 — Historial 3 meses, rango de fechas,
   selector de semana, tendencia diaria (public/js/analytics.js)
   ========================================================================= */

// Estado global de filtros
let analyticsCurrentFilter = 'week';
let analyticsCustomFrom = '';
let analyticsCustomTo = '';
let analyticsAvailableWeeks = [];

// ─── Carga principal con soporte de rango de fechas ────────────────────

async function loadAnalyticsSummary(from, to) {
  try {
    let url = '/api/analytics/summary';
    if (from && to) {
      url += `?from=${from}&to=${to}`;
    } else if (from) {
      url += `?date=${from}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    latestAnalytics = data;
    renderAnalyticsDashboard(data);

    // Actualizar etiqueta del período
    const labelEl = document.getElementById('analyticsDateLabel');
    if (labelEl && data.dateLabel) labelEl.innerText = data.dateLabel;
    const eventsEl = document.getElementById('analyticsTotalEvents');
    if (eventsEl) eventsEl.innerText = `${data.totalEvents || 0} eventos registrados`;

  } catch (e) {
    console.error('[Analytics] Error cargando resumen:', e);
  }
}

// ─── Cargar lista de semanas disponibles ───────────────────────────────

async function loadAvailableWeeks() {
  try {
    const res = await fetch('/api/analytics/weeks');
    const data = await res.json();
    analyticsAvailableWeeks = data.weeks || [];

    // Llenar selector principal
    const sel = document.getElementById('analyticsWeekSelector');
    if (sel) {
      sel.innerHTML = '<option value="">— Seleccionar semana —</option>';
      analyticsAvailableWeeks.forEach(w => {
        const opt = document.createElement('option');
        opt.value = `${w.year}/${w.week}`;
        opt.textContent = w.label + (w.isCurrent ? ' ★' : '');
        if (w.isCurrent) opt.selected = false;
        sel.appendChild(opt);
      });
    }

    // Llenar selector del modal del informe
    const reportSel = document.getElementById('reportWeekSelector');
    if (reportSel) {
      reportSel.innerHTML = '<option value="">— Semana actual —</option>';
      analyticsAvailableWeeks.forEach(w => {
        const opt = document.createElement('option');
        opt.value = `${w.year}/${w.week}`;
        opt.textContent = w.label + (w.isCurrent ? ' ★' : '');
        reportSel.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('[Analytics] Error cargando semanas:', e);
  }
}

// ─── Filtros rápidos ───────────────────────────────────────────────────

function setAnalyticsQuickFilter(filter) {
  analyticsCurrentFilter = filter;
  const today = new Date();
  let from, to;

  switch (filter) {
    case 'today': {
      const d = formatLocalDate(today);
      from = d; to = d;
      break;
    }
    case 'week': {
      // Lunes de esta semana hasta hoy
      const day = today.getDay() || 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - day + 1);
      from = formatLocalDate(monday);
      to = formatLocalDate(today);
      break;
    }
    case 'lastweek': {
      const day = today.getDay() || 7;
      const thisMonday = new Date(today);
      thisMonday.setDate(today.getDate() - day + 1);
      const lastSunday = new Date(thisMonday);
      lastSunday.setDate(thisMonday.getDate() - 1);
      const lastMonday = new Date(lastSunday);
      lastMonday.setDate(lastSunday.getDate() - 6);
      from = formatLocalDate(lastMonday);
      to = formatLocalDate(lastSunday);
      break;
    }
    case 'month': {
      from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
      to = formatLocalDate(today);
      break;
    }
    case 'lastmonth': {
      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
      from = formatLocalDate(lastMonth);
      to = formatLocalDate(lastDay);
      break;
    }
    case '3months': {
      const threeMonthsAgo = new Date(today);
      threeMonthsAgo.setMonth(today.getMonth() - 3);
      from = formatLocalDate(threeMonthsAgo);
      to = formatLocalDate(today);
      break;
    }
    default:
      // Semana actual por defecto
      from = null; to = null;
  }

  // Actualizar botones activos
  document.querySelectorAll('.analytics-filter-btn').forEach(btn => {
    if (btn.dataset.filter === filter) {
      btn.className = btn.className
        .replace('bg-slate-950 border-slate-700 text-slate-300', '')
        .replace('hover:border-blue-500 hover:text-blue-300', '')
        + ' bg-blue-600 border-blue-500 text-white';
    } else {
      btn.className = btn.className
        .replace('bg-blue-600 border-blue-500 text-white', '')
        + ' bg-slate-950 border-slate-700 text-slate-300 hover:border-blue-500 hover:text-blue-300';
    }
    // Limpiar clases duplicadas
    btn.className = btn.className.replace(/\s+/g, ' ').trim();
  });

  // Actualizar inputs de fecha
  const fromInput = document.getElementById('analyticsDateFrom');
  const toInput = document.getElementById('analyticsDateTo');
  if (fromInput && from) fromInput.value = from;
  if (toInput && to) toInput.value = to;

  // Limpiar selector de semana
  const weekSel = document.getElementById('analyticsWeekSelector');
  if (weekSel) weekSel.value = '';

  loadAnalyticsSummary(from, to);
}

function onAnalyticsWeekSelect(val) {
  if (!val) return;
  const [year, week] = val.split('/');
  // Limpiar filtros rápidos activos
  document.querySelectorAll('.analytics-filter-btn').forEach(btn => {
    btn.className = btn.className
      .replace('bg-blue-600 border-blue-500 text-white', '')
      + ' bg-slate-950 border-slate-700 text-slate-300 hover:border-blue-500 hover:text-blue-300';
    btn.className = btn.className.replace(/\s+/g, ' ').trim();
  });
  analyticsCurrentFilter = 'custom_week';

  // Cargar la semana vía /weekly endpoint
  fetch(`/api/analytics/weekly/${year}/${week}`)
    .then(r => r.json())
    .then(data => {
      latestAnalytics = data;
      renderAnalyticsDashboard(data);
      const labelEl = document.getElementById('analyticsDateLabel');
      if (labelEl && data.dateLabel) labelEl.innerText = data.dateLabel;
      const eventsEl = document.getElementById('analyticsTotalEvents');
      if (eventsEl) eventsEl.innerText = `${data.totalEvents || 0} eventos registrados`;
      // Actualizar inputs
      const fromInput = document.getElementById('analyticsDateFrom');
      const toInput = document.getElementById('analyticsDateTo');
      if (fromInput && data.rangeFrom) fromInput.value = data.rangeFrom;
      if (toInput && data.rangeTo) toInput.value = data.rangeTo;
    })
    .catch(e => console.error('[Analytics] Error cargando semana:', e));
}

function applyCustomDateRange() {
  const from = document.getElementById('analyticsDateFrom')?.value;
  const to = document.getElementById('analyticsDateTo')?.value;
  if (!from || !to) return;
  if (from > to) {
    alert('La fecha "Desde" no puede ser mayor que "Hasta"');
    return;
  }
  analyticsCurrentFilter = 'custom';
  // Limpiar filtros rápidos activos
  document.querySelectorAll('.analytics-filter-btn').forEach(btn => {
    btn.className = btn.className
      .replace('bg-blue-600 border-blue-500 text-white', '')
      + ' bg-slate-950 border-slate-700 text-slate-300 hover:border-blue-500 hover:text-blue-300';
    btn.className = btn.className.replace(/\s+/g, ' ').trim();
  });
  // Limpiar selector de semana
  const weekSel = document.getElementById('analyticsWeekSelector');
  if (weekSel) weekSel.value = '';

  loadAnalyticsSummary(from, to);
}

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Renderizado principal del dashboard ───────────────────────────────

function renderAnalyticsDashboard(data) {
  if (!data) return;

  // 1. KPIs Superiores
  const elWAtt = document.getElementById('kpiWeeklyAttended');
  if (elWAtt) elWAtt.innerText = data.totalWeeklyAttended || 0;
  const elDAtt = document.getElementById('kpiDailyAttended');
  if (elDAtt) elDAtt.innerText = data.totalDailyAttended || 0;
  const elWSales = document.getElementById('kpiWeeklySales');
  if (elWSales) elWSales.innerText = data.totalWeeklySales || 0;
  const elDSales = document.getElementById('kpiDailySales');
  if (elDSales) elDSales.innerText = data.totalDailySales || 0;

  const globalConv =
    data.totalWeeklyAttended > 0
      ? Math.round((data.totalWeeklySales / data.totalWeeklyAttended) * 100)
      : 0;
  const elConv = document.getElementById('kpiConversionRate');
  if (elConv) elConv.innerText = `${globalConv}%`;

  if (data.busiestChannel) {
    document.getElementById('kpiBusiestChannel').innerText = data.busiestChannel.label;
    document.getElementById('kpiBusiestChannelSub').innerText = `${data.busiestChannel.weeklyAttended} clientes atendidos en período`;
  }
  if (data.topSalesChannel) {
    document.getElementById('kpiTopSalesChannel').innerText = data.topSalesChannel.label;
    document.getElementById('kpiTopSalesChannelSub').innerText = `${data.topSalesChannel.weeklySales} ventas cerradas en período`;
  }

  // Banner de Totales por Empresa
  const compBanner = document.getElementById('statsCompaniesBanner');
  if (compBanner && data.companies) {
    const ag = data.companies.agropower || { weeklyAttended: 0, weeklySales: 0 };
    const tr = data.companies.tractopower || { weeklyAttended: 0, weeklySales: 0 };
    compBanner.innerHTML = `
      <span class="px-2.5 py-1 rounded-lg bg-emerald-950/90 border border-emerald-700 text-emerald-300 font-bold">
        🌿 Agropower: ${ag.weeklyAttended} atendidos • 🏆 ${ag.weeklySales} ventas
      </span>
      <span class="px-2.5 py-1 rounded-lg bg-amber-950/90 border border-amber-700 text-amber-300 font-bold">
        🚜 Tractopower: ${tr.weeklyAttended} atendidos • 🏆 ${tr.weeklySales} ventas
      </span>
    `;
  }

  // 2. Tendencia Diaria (gráfico de barras)
  renderDailyTrend(data.dailyBreakdown || []);

  // 3. Tarjetas de los 8 Canales
  const chGrid = document.getElementById('statsChannelsGrid');
  if (chGrid && data.channels) {
    chGrid.innerHTML = '';
    const order = [
      'wa_agro', 'ig_agro', 'tk_agro', 'fb_agro',
      'wa_tracto', 'ig_tracto', 'tk_tracto', 'fb_tracto'
    ];
    const maxAtt = Math.max(1, ...order.map(k => data.channels[k]?.weeklyAttended || 0));

    order.forEach(k => {
      const ch = data.channels[k];
      if (!ch) return;
      const meta = channelMeta[k] || channelMeta['wa_agro'];
      const pct = Math.round((ch.weeklyAttended / maxAtt) * 100);
      const isBusiest =
        data.busiestChannel && data.busiestChannel.key === k && ch.weeklyAttended > 0;

      const card = document.createElement('div');
      card.className = `bg-slate-950 border ${
        isBusiest ? 'border-amber-500/70' : 'border-slate-800'
      } rounded-xl p-3 space-y-2`;
      card.innerHTML = `
        <div class="flex items-center justify-between gap-1">
          <span class="text-[9px] px-1.5 py-0.2 rounded border ${meta.companyBadgeClass} font-bold">${meta.companyName}</span>
          ${
            isBusiest
              ? '<span class="text-[8px] px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-extrabold">🔥 MÁS MOVIDO</span>'
              : ''
          }
        </div>
        <div class="text-xs font-bold text-white flex items-center gap-1.5 truncate">
          <i class="fa-brands ${meta.icon}"></i>
          <span class="truncate">${meta.label}</span>
        </div>
        <div class="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
          <div class="bg-blue-500 h-full rounded-full" style="width: ${pct}%"></div>
        </div>
        <div class="flex items-center justify-between text-[11px] pt-1">
          <span class="text-slate-400">Atendidos: <strong class="text-white">${ch.weeklyAttended}</strong> <span class="text-[9px] text-blue-400">(Hoy: ${ch.dailyAttended})</span></span>
          <span class="text-emerald-400 font-bold">🏆 ${ch.weeklySales} ventas</span>
        </div>
      `;
      chGrid.appendChild(card);
    });
  }

  // 4. Tabla de Rendimiento por Usuario en los 8 Canales
  const uBody = document.getElementById('statsUsersTableBody');
  if (uBody && data.users) {
    uBody.innerHTML = '';
    data.users.forEach(u => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-800/40 transition';
      tr.innerHTML = `
        <td class="p-2.5">
          <div class="font-bold text-white flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full ${u.online ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}"></span>
            <span>${u.fullName}</span>
            <span class="text-[9px] px-1.5 py-0.2 rounded ${
              u.role === 'admin'
                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                : 'bg-blue-950 text-blue-300 border border-blue-800'
            }">${u.role === 'admin' ? 'Admin' : 'Asesor'}</span>
          </div>
          <div class="text-[10px] text-slate-400 font-mono">${u.username} • ${u.email || ''}</div>
        </td>
        <td class="p-2.5 text-[11px]">
          <div class="text-slate-200 font-semibold"><i class="fa-regular fa-clock text-amber-400 mr-1"></i>${u.lastLogin || '—'}</div>
          <div class="text-[10px] text-slate-400">Últ. acción: ${u.lastActive || '—'}</div>
        </td>
        <td class="p-2 text-center">
          <span class="px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 font-bold">${u.dailyAttended}</span>
        </td>
        <td class="p-2 text-center font-semibold text-emerald-300 border-l border-slate-800/60">${u.byChannel?.wa_agro || 0}</td>
        <td class="p-2 text-center font-semibold text-pink-300">${u.byChannel?.ig_agro || 0}</td>
        <td class="p-2 text-center font-semibold text-cyan-300">${u.byChannel?.tk_agro || 0}</td>
        <td class="p-2 text-center font-semibold text-blue-300 border-r border-slate-800/60">${u.byChannel?.fb_agro || 0}</td>
        <td class="p-2 text-center font-semibold text-emerald-300">${u.byChannel?.wa_tracto || 0}</td>
        <td class="p-2 text-center font-semibold text-fuchsia-300">${u.byChannel?.ig_tracto || 0}</td>
        <td class="p-2 text-center font-semibold text-teal-300">${u.byChannel?.tk_tracto || 0}</td>
        <td class="p-2 text-center font-semibold text-indigo-300 border-r border-slate-800/60">${u.byChannel?.fb_tracto || 0}</td>
        <td class="p-2 text-center font-extrabold text-white">${u.weeklyAttended}</td>
        <td class="p-2 text-center text-slate-300">${u.messagesSent}</td>
        <td class="p-2.5 text-center">
          <span class="px-2.5 py-1 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-700 font-extrabold">
            🏆 ${u.weeklySales} (${u.conversionRate}%)
          </span>
        </td>
      `;
      uBody.appendChild(tr);
    });
  }

  // 5. Historial de Conexiones
  const connBox = document.getElementById('statsConnectionLogs');
  if (connBox && data.users) {
    connBox.innerHTML = '';
    data.users.forEach(u => {
      const hist = Array.isArray(u.connectionHistory) ? u.connectionHistory : [];
      hist.slice(0, 4).forEach(h => {
        const div = document.createElement('div');
        div.className =
          'bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between text-xs';
        div.innerHTML = `
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center font-bold text-[10px] text-amber-400">
              <i class="fa-solid fa-key"></i>
            </div>
            <div>
              <div class="font-bold text-white">${u.fullName} <span class="text-[10px] font-mono text-slate-400">(${u.username})</span></div>
              <div class="text-[10px] text-slate-400">Fecha: ${h.date} • Entrada: <strong class="text-emerald-400">${h.loginTime}</strong></div>
            </div>
          </div>
          <div class="text-right">
            <div class="text-[10px] font-semibold text-slate-200">${h.lastSeen}</div>
            <div class="text-[9px] text-slate-500">${h.duration || ''}</div>
          </div>
        `;
        connBox.appendChild(div);
      });
    });
  }

  // 6. Registro de Ventas Cerradas
  const salesBox = document.getElementById('statsClosedSalesList');
  if (salesBox && data.closedSalesList) {
    salesBox.innerHTML = '';
    if (data.closedSalesList.length === 0) {
      salesBox.innerHTML =
        '<div class="text-center text-slate-500 py-6">Aún no hay ventas marcadas como cerradas en este período.</div>';
    } else {
      data.closedSalesList.forEach(s => {
        const meta = channelMeta[s.channel] || channelMeta['wa_agro'];
        const div = document.createElement('div');
        div.className =
          'bg-slate-950 border border-emerald-800/50 rounded-xl p-2.5 flex items-center justify-between text-xs';
        div.innerHTML = `
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
              🏆
            </div>
            <div>
              <div class="font-bold text-white">Cliente: ${s.clientName}</div>
              <div class="text-[10px] text-emerald-400 font-semibold">Cerrada por: ${s.userFullName} (${s.username})</div>
            </div>
          </div>
          <div class="text-right">
            <div class="flex items-center justify-end gap-1">
              <span class="text-[8px] px-1.5 py-0.2 rounded border ${meta.companyBadgeClass} font-bold">${meta.companyName}</span>
              <span class="text-[9px] px-1.5 py-0.5 rounded border ${meta.badgeClass} font-bold">${meta.label}</span>
            </div>
            <div class="text-[9px] text-slate-400 mt-0.5">${s.date} • ${s.time}</div>
          </div>
        `;
        salesBox.appendChild(div);
      });
    }
  }
}

// ─── Gráfico de tendencia diaria ───────────────────────────────────────

function renderDailyTrend(dailyBreakdown) {
  const container = document.getElementById('statsDailyTrend');
  if (!container) return;
  container.innerHTML = '';

  if (!dailyBreakdown || dailyBreakdown.length === 0) {
    container.innerHTML = '<div class="text-center text-slate-500 py-8 w-full">Sin datos de tendencia para este período</div>';
    return;
  }

  const maxVal = Math.max(1, ...dailyBreakdown.map(d => d.attended));
  const barWidth = Math.max(20, Math.min(60, Math.floor(container.clientWidth / dailyBreakdown.length) - 4));

  dailyBreakdown.forEach(day => {
    const heightPct = Math.round((day.attended / maxVal) * 100);
    const salesPct = day.attended > 0 ? Math.round((day.sales / day.attended) * 100) : 0;
    const dateShort = day.date.slice(5); // MM-DD

    const col = document.createElement('div');
    col.className = 'flex flex-col items-center gap-1 flex-shrink-0';
    col.style.width = `${barWidth}px`;
    col.title = `${day.date}\nAtendidos: ${day.attended}\nVentas: ${day.sales}\nMensajes: ${day.messages}`;

    col.innerHTML = `
      <div class="text-[9px] font-bold text-white">${day.attended}</div>
      <div class="w-full bg-slate-800 rounded-t-sm overflow-hidden relative" style="height: ${Math.max(4, heightPct)}px">
        <div class="absolute bottom-0 w-full bg-blue-500/80 rounded-t-sm" style="height: 100%"></div>
        ${day.sales > 0 ? `<div class="absolute bottom-0 w-full bg-emerald-500 rounded-t-sm" style="height: ${salesPct}%"></div>` : ''}
      </div>
      <div class="text-[8px] text-slate-500 font-mono">${dateShort}</div>
      ${day.sales > 0 ? `<div class="text-[8px] text-emerald-400 font-bold">🏆${day.sales}</div>` : ''}
    `;
    container.appendChild(col);
  });
}

// ─── Modal del informe semanal con selector de semana ──────────────────

function openWeeklyReportModal() {
  loadAvailableWeeks();
  if (!latestAnalytics) {
    loadAnalyticsSummary().then(() => renderWeeklyReportModal());
  } else {
    renderWeeklyReportModal();
  }
  document.getElementById('weeklyReportModal').classList.remove('hidden');
}

function closeWeeklyReportModal() {
  document.getElementById('weeklyReportModal').classList.add('hidden');
}

function loadWeeklyReportForWeek(val) {
  if (!val) {
    // Semana actual
    renderWeeklyReportModal();
    return;
  }
  const [year, week] = val.split('/');
  fetch(`/api/analytics/weekly/${year}/${week}`)
    .then(r => r.json())
    .then(data => {
      latestAnalytics = data;
      renderWeeklyReportModal();
      const subtitle = document.getElementById('weeklyReportSubtitle');
      if (subtitle && data.dateLabel) subtitle.innerText = data.dateLabel;
    })
    .catch(e => console.error('[Analytics] Error cargando informe semanal:', e));
}

function renderWeeklyReportModal() {
  const data = latestAnalytics;
  if (!data) return;
  const container = document.getElementById('weeklyReportContent');
  const topAdvisor = [...(data.users || [])].sort((a, b) => b.weeklySales - a.weeklySales)[0];
  const ag = data.companies?.agropower || { weeklyAttended: 0, weeklySales: 0 };
  const tr = data.companies?.tractopower || { weeklyAttended: 0, weeklySales: 0 };

  const subtitle = document.getElementById('weeklyReportSubtitle');
  if (subtitle && data.dateLabel) subtitle.innerText = data.dateLabel;

  let usersRows = '';
  (data.users || []).forEach(u => {
    usersRows += `
      <tr class="border-b border-slate-800">
        <td class="p-2 font-bold text-white">${u.fullName} (${u.username})</td>
        <td class="p-2 text-center">${u.dailyAttended}</td>
        <td class="p-2 text-center">${u.byChannel?.wa_agro || 0}</td>
        <td class="p-2 text-center">${u.byChannel?.ig_agro || 0}</td>
        <td class="p-2 text-center">${u.byChannel?.tk_agro || 0}</td>
        <td class="p-2 text-center">${u.byChannel?.fb_agro || 0}</td>
        <td class="p-2 text-center">${u.byChannel?.wa_tracto || 0}</td>
        <td class="p-2 text-center">${u.byChannel?.ig_tracto || 0}</td>
        <td class="p-2 text-center">${u.byChannel?.tk_tracto || 0}</td>
        <td class="p-2 text-center">${u.byChannel?.fb_tracto || 0}</td>
        <td class="p-2 text-center font-bold text-blue-300">${u.weeklyAttended}</td>
        <td class="p-2 text-center font-extrabold text-emerald-400">🏆 ${u.weeklySales} (${u.conversionRate}%)</td>
        <td class="p-2 text-slate-300">${u.lastLogin || '—'}</td>
      </tr>
    `;
  });

  container.innerHTML = `
    <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
      <div>
        <div class="text-[10px] text-slate-400 uppercase font-bold">Total Clientes Período</div>
        <div class="text-xl font-extrabold text-white mt-0.5">${data.totalWeeklyAttended} clientes</div>
        <div class="text-[10px] text-slate-400 mt-0.5">🌿 Agro: ${ag.weeklyAttended} • 🚜 Tracto: ${tr.weeklyAttended}</div>
      </div>
      <div>
        <div class="text-[10px] text-slate-400 uppercase font-bold">Total Ventas Cerradas</div>
        <div class="text-xl font-extrabold text-emerald-400 mt-0.5">🏆 ${data.totalWeeklySales} cierres</div>
        <div class="text-[10px] text-emerald-300 mt-0.5">🌿 Agro: ${ag.weeklySales} • 🚜 Tracto: ${tr.weeklySales}</div>
      </div>
      <div>
        <div class="text-[10px] text-slate-400 uppercase font-bold">Canal Más Movido</div>
        <div class="text-xs font-extrabold text-amber-400 mt-1">${data.busiestChannel?.label || 'Sin datos'} (${data.busiestChannel?.weeklyAttended || 0} atenciones)</div>
      </div>
      <div>
        <div class="text-[10px] text-slate-400 uppercase font-bold">Asesor con Más Ventas</div>
        <div class="text-xs font-extrabold text-purple-300 mt-1">${topAdvisor ? `${topAdvisor.fullName} (${topAdvisor.weeklySales} ventas)` : '—'}</div>
      </div>
    </div>

    <div class="space-y-2">
      <h4 class="font-bold text-white text-xs uppercase tracking-wider text-blue-400">1. Desglose por Usuario en las 2 Empresas (Agropower & Tractopower - 8 Canales)</h4>
      <div class="overflow-x-auto border border-slate-800 rounded-xl">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-slate-950 text-[9px] uppercase text-slate-400 border-b border-slate-800">
              <th class="p-2">Usuario</th>
              <th class="p-2 text-center">Hoy</th>
              <th class="p-2 text-center text-emerald-400">🌿 WA</th>
              <th class="p-2 text-center text-pink-400">🌿 IG</th>
              <th class="p-2 text-center text-cyan-400">🌿 TK</th>
              <th class="p-2 text-center text-blue-400">🌿 FB</th>
              <th class="p-2 text-center text-emerald-300">🚜 WA</th>
              <th class="p-2 text-center text-fuchsia-400">🚜 IG</th>
              <th class="p-2 text-center text-teal-400">🚜 TK</th>
              <th class="p-2 text-center text-indigo-400">🚜 FB</th>
              <th class="p-2 text-center">Total Período</th>
              <th class="p-2 text-center">Ventas Cerradas</th>
              <th class="p-2">Últ. Conexión</th>
            </tr>
          </thead>
          <tbody>${usersRows}</tbody>
        </table>
      </div>
    </div>

    <div class="space-y-2">
      <h4 class="font-bold text-white text-xs uppercase tracking-wider text-emerald-400">2. Detalle de Ventas Cerradas en el Período</h4>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
        ${(data.closedSalesList || [])
          .map(s => {
            const meta = channelMeta[s.channel] || channelMeta['wa_agro'];
            return `
              <div class="bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between">
                <div>
                  <div class="font-bold text-white">🏆 Cliente: ${s.clientName}</div>
                  <div class="text-[10px] text-emerald-400">Cerró venta: ${s.userFullName}</div>
                </div>
                <div class="text-right text-[10px] text-slate-400">
                  <div class="font-bold text-slate-200">${meta.companyName} • ${meta.label}</div>
                  <div>${s.date} • ${s.time}</div>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

// ─── Inicialización al cargar la sección de estadísticas ───────────────

function initAnalyticsSection() {
  loadAvailableWeeks();
  loadAnalyticsSummary();
}
