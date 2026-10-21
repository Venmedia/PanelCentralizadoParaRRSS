/* =========================================================================
   MÓDULO 10: MOTOR FERDIUM (Service Dock, Badges, Workspaces, Split View & Ctrl+K)
   Inspirado en https://github.com/ferdium/ferdium-app
   ========================================================================= */

let ferdiumSplitActive = false;
let splitChatId = null;

const FERDIUM_DOCK_ITEMS = [
  { key: 'wa_agro', company: 'agropower', icon: 'fa-brands fa-whatsapp text-emerald-400', short: 'WA', title: 'WhatsApp Agropower' },
  { key: 'ig_agro', company: 'agropower', icon: 'fa-brands fa-instagram text-pink-400', short: 'IG', title: 'Instagram Agropower (@agropower_venezuela)' },
  { key: 'tk_agro', company: 'agropower', icon: 'fa-brands fa-tiktok text-cyan-400', short: 'TK', title: 'TikTok Agropower (@agropower_venezuela)' },
  { key: 'fb_agro', company: 'agropower', icon: 'fa-brands fa-facebook-messenger text-blue-400', short: 'FB', title: 'Messenger Agropower' },
  { key: 'wa_tracto', company: 'tractopower', icon: 'fa-brands fa-whatsapp text-emerald-400', short: 'WA', title: 'WhatsApp Tractopower' },
  { key: 'ig_tracto', company: 'tractopower', icon: 'fa-brands fa-instagram text-fuchsia-400', short: 'IG', title: 'Instagram Tractopower (@Tractopower_venezuela)' },
  { key: 'tk_tracto', company: 'tractopower', icon: 'fa-brands fa-tiktok text-teal-400', short: 'TK', title: 'TikTok Tractopower (@tractopowervenezuela)' },
  { key: 'fb_tracto', company: 'tractopower', icon: 'fa-brands fa-facebook-messenger text-indigo-400', short: 'FB', title: 'Messenger Tractopower' }
];

/**
 * Calcula los badges de mensajes nuevos sin leer por canal.
 * Solo muestra número cuando hay mensajes nuevos reales sin leer.
 * Si todos los mensajes ya fueron leídos, no muestra ningún número.
 */
function getFerdiumChannelBadgeCounts(channelKey) {
  if (!Array.isArray(conversations)) return { unread: 0 };
  let unread = 0;

  conversations.forEach(c => {
    const ch = c.channel === 'wa1' ? 'wa_agro' : c.channel;
    if (ch === channelKey) {
      // Si el chat está actualmente seleccionado y visible en pantalla, se considera leído
      const isCurrentlyActive = String(c.id) === String(activeChatId);
      if (isCurrentlyActive) {
        c.isRead = true;
        c.unreadCount = 0;
        return;
      }

      // Conteo de mensajes nuevos
      if (c.unreadCount && c.unreadCount > 0) {
        unread += c.unreadCount;
      } else if (!c.isRead) {
        const lastMsg = c.messages?.[c.messages.length - 1];
        // Solo cuenta como nuevo si el último mensaje es del cliente sin responder
        if (c.waitingAdvisor || (lastMsg && lastMsg.sender === 'client')) {
          unread++;
        }
      }
    }
  });

  return { unread };
}

/**
 * Renderiza la barra lateral izquierda de servicios y Workspaces al estilo Ferdium
 */
function renderFerdiumServiceDock() {
  const dock = document.getElementById('ferdiumServiceDock');
  if (!dock) return;

  const isAll = currentFilter === 'all';
  const isAgroWs = currentFilter === 'company_agro';
  const isTractoWs = currentFilter === 'company_tracto';

  const workspaceButtons = `
    <div class="flex flex-col items-center gap-1.5 pb-2 border-b border-slate-800 w-full px-1.5">
      <button
        onclick="filterChannel('all')"
        class="w-9 h-8 rounded-xl flex items-center justify-center text-xs font-extrabold transition ${
          isAll
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
            : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-white border border-slate-800'
        }"
        title="Workspace: Todo el Consorcio (8 Canales)"
      >
        🌐
      </button>
      <button
        onclick="filterChannel('company_agro')"
        class="w-9 h-8 rounded-xl flex items-center justify-center text-xs font-extrabold transition ${
          isAgroWs
            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
            : 'bg-slate-900 text-emerald-400 hover:bg-slate-800 border border-emerald-900/60'
        }"
        title="Workspace: Agropower"
      >
        🌿
      </button>
      <button
        onclick="filterChannel('company_tracto')"
        class="w-9 h-8 rounded-xl flex items-center justify-center text-xs font-extrabold transition ${
          isTractoWs
            ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/30'
            : 'bg-slate-900 text-amber-400 hover:bg-slate-800 border border-amber-900/60'
        }"
        title="Workspace: Tractopower"
      >
        🚜
      </button>
    </div>
  `;

  const visibleItems = FERDIUM_DOCK_ITEMS.filter(item => {
    if (isAgroWs) return item.company === 'agropower';
    if (isTractoWs) return item.company === 'tractopower';
    return true;
  });

  const servicesHtml = visibleItems
    .map((item, idx) => {
      const vaultCh = channelsVaultState?.channels?.[item.key];
      const connected = Boolean(vaultCh?.connected);
      const hibernated = Boolean(vaultCh?.hibernated);
      const isSelected = currentFilter === item.key;
      const badges = getFerdiumChannelBadgeCounts(item.key);

      // Separador entre Agropower y Tractopower cuando se ven ambos
      const divider =
        !isAgroWs && !isTractoWs && idx === 4
          ? '<div class="w-7 border-t border-slate-800 my-0.5"></div>'
          : '';

      const statusDotClass = connected
        ? hibernated
          ? 'bg-amber-400'
          : 'bg-emerald-400'
        : 'bg-slate-600';

      // Solo mostrar badge si hay mensajes nuevos sin leer; de lo contrario no mostrar nada
      const unreadBadgeHtml =
        badges.unread > 0
          ? `<span class="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-600 text-white text-[9px] font-extrabold flex items-center justify-center shadow">
               ${badges.unread}
             </span>`
          : '';

      const borderCompanyClass =
        item.company === 'agropower' ? 'border-emerald-800/50' : 'border-amber-800/50';

      return `
        ${divider}
        <button
          onclick="filterChannel('${item.key}')"
          ondblclick="openFerdiumServiceWindow('${item.key}')"
          class="relative w-9 h-9 rounded-xl flex items-center justify-center transition border ${
            isSelected
              ? 'bg-blue-600/30 border-blue-400 scale-105 shadow'
              : `bg-slate-900 hover:bg-slate-800 ${borderCompanyClass}`
          } ${hibernated ? 'opacity-50' : ''}"
          title="${item.title} (${connected ? (hibernated ? 'Hibernado' : 'Sesión Activa') : 'Sin iniciar sesión'}) — Clic: Filtrar | Doble Clic: Abrir App"
        >
          <i class="${item.icon} text-sm"></i>
          ${unreadBadgeHtml}
          <span class="absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-950 ${statusDotClass}"></span>
        </button>
      `;
    })
    .join('');

  dock.innerHTML = `
    ${workspaceButtons}
    <div class="flex-1 flex flex-col items-center gap-1.5 overflow-y-auto py-1 w-full">
      ${servicesHtml}
    </div>
    <button
      onclick="openFerdiumQuickSwitcher()"
      class="w-9 h-8 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-blue-400 flex items-center justify-center text-xs transition"
      title="Salto Rápido Ferdium (Ctrl + K)"
    >
      <i class="fa-solid fa-bolt"></i>
    </button>
  `;
}

/* =========================================================================
   VISTA DIVIDIDA MULTI-CHAT ESTILO FERDIUM (SPLIT VIEW)
   ========================================================================= */

function toggleFerdiumSplitView() {
  ferdiumSplitActive = !ferdiumSplitActive;
  const pane = document.getElementById('ferdiumSplitPane');
  const btn = document.getElementById('btnToggleFerdiumSplit');
  if (!pane) return;

  if (ferdiumSplitActive) {
    pane.classList.remove('hidden');
    if (btn) {
      btn.className =
        'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400 px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 shadow transition';
    }
    if (!splitChatId && Array.isArray(conversations) && conversations.length > 0) {
      const other = conversations.find(c => c.id !== activeChatId) || conversations[0];
      splitChatId = other.id;
    }
    renderSplitConversationView();
  } else {
    pane.classList.add('hidden');
    if (btn) {
      btn.className =
        'bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-700/50 px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition';
    }
  }
}

function selectSplitConversation(id) {
  splitChatId = Number(id) || id;
  renderSplitConversationView();
}

function renderSplitConversationView() {
  if (!ferdiumSplitActive || !Array.isArray(conversations)) return;
  const selectEl = document.getElementById('splitChatSelect');
  const vp = document.getElementById('splitMessagesViewport');
  if (!selectEl || !vp) return;

  selectEl.innerHTML = conversations
    .map(c => {
      const meta = channelMeta[c.channel] || channelMeta['wa_agro'];
      const phoneTxt = typeof getDisplayPhoneForChat === 'function' ? getDisplayPhoneForChat(c) : '';
      const selected = String(c.id) === String(splitChatId) ? 'selected' : '';
      return `<option value="${c.id}" ${selected}>${c.name} ${phoneTxt ? '(' + phoneTxt + ')' : ''} • ${meta.companyName}</option>`;
    })
    .join('');

  const conv = conversations.find(c => String(c.id) === String(splitChatId)) || conversations[0];
  if (!conv) {
    vp.innerHTML = '<div class="text-slate-500 text-center py-6">Sin conversación seleccionada</div>';
    return;
  }

  splitChatId = conv.id;
  const splitPhone = typeof getDisplayPhoneForChat === 'function' ? getDisplayPhoneForChat(conv) : '';
  vp.innerHTML = '';

  conv.messages.forEach(m => {
    const div = document.createElement('div');
    const htmlText = m.text
      .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    if (m.sender === 'client') {
      const timeStr = typeof formatConversationTimestamp === 'function' ? formatConversationTimestamp(m.time) : m.time;
      div.className = 'flex flex-col items-start max-w-[88%]';
      div.innerHTML = `
        <span class="text-[9px] text-slate-400 mb-0.5">${conv.name} ${splitPhone ? '<strong class="text-emerald-400 font-mono">(' + splitPhone + ')</strong>' : ''} • ${timeStr}</span>
        <div class="bg-slate-800 border border-slate-700 text-slate-100 rounded-xl rounded-tl-none p-2 text-[11px] leading-relaxed">
          ${htmlText}
        </div>
      `;
    } else {
      const isScheduled = m.sender === 'scheduled';
      const timeStr = typeof formatConversationTimestamp === 'function' ? formatConversationTimestamp(m.time) : m.time;
      div.className = 'flex flex-col items-end max-w-[88%] ml-auto';
      div.innerHTML = `
        <span class="text-[9px] ${isScheduled ? 'text-emerald-400' : 'text-indigo-400'} mb-0.5">
          ${isScheduled ? '⚡ Programado' : `👤 ${m.operatorName || 'Asesor'}`} • ${timeStr}
        </span>
        <div class="${isScheduled ? 'bg-emerald-950/70 border border-emerald-700/60' : 'bg-indigo-600'} text-slate-100 rounded-xl rounded-tr-none p-2 text-[11px] leading-relaxed">
          ${htmlText}
        </div>
      `;
    }
    vp.appendChild(div);
  });

  vp.scrollTop = vp.scrollHeight;
}

async function sendSplitOperatorMessage() {
  const inp = document.getElementById('splitOperatorInput');
  if (!inp || !splitChatId) return;
  const val = inp.value.trim();
  if (!val) return;

  const splitConv = conversations.find(c => c.id === splitChatId);
  if (splitConv) {
    splitConv.waitingAdvisor = false;
    splitConv.botActive = false;
    renderChatList();
  }

  await fetch('/api/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: splitChatId,
      text: val,
      userId: currentUserId
    })
  });
  inp.value = '';
}

async function sendSplitPreprogrammed(key) {
  if (!splitChatId) return;
  const prevActive = activeChatId;
  activeChatId = splitChatId;
  await sendPreprogrammed(key);
  activeChatId = prevActive;
}

/* =========================================================================
   QUICK SWITCHER ESTILO FERDIUM (Ctrl + K)
   ========================================================================= */

function openFerdiumQuickSwitcher() {
  if (!authenticatedUser) return;
  const modal = document.getElementById('ferdiumQuickSwitcherModal');
  const inp = document.getElementById('ferdiumQuickSearchInput');
  if (!modal) return;
  modal.classList.remove('hidden');
  if (inp) {
    inp.value = '';
    setTimeout(() => inp.focus(), 50);
  }
  renderFerdiumQuickSwitcherResults();
}

function closeFerdiumQuickSwitcher() {
  document.getElementById('ferdiumQuickSwitcherModal')?.classList.add('hidden');
}

function renderFerdiumQuickSwitcherResults() {
  const list = document.getElementById('ferdiumQuickSwitcherList');
  const query = (document.getElementById('ferdiumQuickSearchInput')?.value || '').toLowerCase().trim();
  if (!list) return;

  const items = [];

  // 1. Workspaces
  items.push(
    {
      type: 'Workspace',
      icon: 'fa-solid fa-globe text-blue-400',
      label: 'Workspace: Todo el Consorcio (8 Canales)',
      sub: 'Ver todas las conversaciones de Agropower y Tractopower',
      action: () => {
        switchView('inbox');
        filterChannel('all');
        closeFerdiumQuickSwitcher();
      }
    },
    {
      type: 'Workspace',
      icon: 'fa-solid fa-leaf text-emerald-400',
      label: 'Workspace: 🌿 Agropower',
      sub: 'Filtrar canales y chats de Agropower',
      action: () => {
        switchView('inbox');
        filterChannel('company_agro');
        closeFerdiumQuickSwitcher();
      }
    },
    {
      type: 'Workspace',
      icon: 'fa-solid fa-tractor text-amber-400',
      label: 'Workspace: 🚜 Tractopower',
      sub: 'Filtrar canales y chats de Tractopower',
      action: () => {
        switchView('inbox');
        filterChannel('company_tracto');
        closeFerdiumQuickSwitcher();
      }
    }
  );

  // 2. Conversaciones activas
  if (Array.isArray(conversations)) {
    conversations.forEach(c => {
      const meta = channelMeta[c.channel] || channelMeta['wa_agro'];
      const phoneTxt = typeof getDisplayPhoneForChat === 'function' ? getDisplayPhoneForChat(c) : '';
      items.push({
        type: 'Cliente',
        icon: `fa-brands ${meta.icon}`,
        label: `${c.name} ${phoneTxt ? '• ' + phoneTxt : ''}`,
        sub: `${meta.companyName} • Canal: ${meta.label}`,
        action: () => {
          switchView('inbox');
          selectConversation(c.id);
          closeFerdiumQuickSwitcher();
        }
      });
    });
  }

  // 3. Canales y Vista Dividida
  items.push({
    type: 'Vista',
    icon: 'fa-solid fa-table-columns text-indigo-400',
    label: 'Alternar Vista Dividida Multi-Chat (Split View)',
    sub: 'Atender 2 conversaciones en paralelo al estilo Ferdium',
    action: () => {
      switchView('inbox');
      toggleFerdiumSplitView();
      closeFerdiumQuickSwitcher();
    }
  });

  // TikTok Quick Open
  items.push(
    {
      type: 'TikTok',
      icon: 'fa-brands fa-tiktok text-cyan-400',
      label: 'Abrir TikTok Agropower (@agropower_venezuela)',
      sub: 'Ventana web directa a la bandeja de mensajes de TikTok',
      action: () => {
        if (typeof openTikTokWindow === 'function') openTikTokWindow('tk_agro');
        closeFerdiumQuickSwitcher();
      }
    },
    {
      type: 'TikTok',
      icon: 'fa-brands fa-tiktok text-teal-400',
      label: 'Abrir TikTok Tractopower (@tractopowervenezuela)',
      sub: 'Ventana web directa a la bandeja de mensajes de TikTok',
      action: () => {
        if (typeof openTikTokWindow === 'function') openTikTokWindow('tk_tracto');
        closeFerdiumQuickSwitcher();
      }
    }
  );

  const filtered = items.filter(
    it =>
      !query ||
      it.label.toLowerCase().includes(query) ||
      it.sub.toLowerCase().includes(query) ||
      it.type.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    list.innerHTML = '<div class="text-slate-500 text-center py-4">No se encontraron resultados.</div>';
    return;
  }

  list.innerHTML = '';
  filtered.slice(0, 12).forEach(it => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.onclick = it.action;
    btn.className =
      'w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800 flex items-center justify-between gap-2 transition';
    btn.innerHTML = `
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0">
          <i class="${it.icon}"></i>
        </div>
        <div class="min-w-0">
          <div class="font-bold text-white text-xs truncate">${it.label}</div>
          <div class="text-[10px] text-slate-400 truncate">${it.sub}</div>
        </div>
      </div>
      <span class="text-[9px] px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 font-bold shrink-0">
        ${it.type}
      </span>
    `;
    list.appendChild(btn);
  });
}

// Atajo global de teclado Ctrl+K y Escape al estilo Ferdium
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const modal = document.getElementById('ferdiumQuickSwitcherModal');
    if (modal && !modal.classList.contains('hidden')) {
      closeFerdiumQuickSwitcher();
    } else {
      openFerdiumQuickSwitcher();
    }
  } else if (e.key === 'Escape') {
    closeFerdiumQuickSwitcher();
  }
});

/* =========================================================================
   TIKTOK: GESTIÓN MEJORADA DE VENTANAS EMBEBIDAS CON TRACKING
   TikTok no tiene API de mensajería, se usa acceso web directo gestionado.
   ========================================================================= */

/** Registro de ventanas TikTok abiertas para tracking y reutilización */
const tiktokWindows = {};

/**
 * Abre o re-enfoca la ventana de TikTok Messages para un canal específico.
 * Si ya hay una ventana abierta, la trae al frente en vez de abrir una nueva.
 */
function openTikTokWindow(channelKey) {
  const ch = channelsVaultState?.channels?.[channelKey];
  const targetUrl = ch?.serviceURL || 'https://www.tiktok.com/messages';
  const windowName = `tiktok_${channelKey}`;

  // Verificar si ya hay una ventana abierta y no está cerrada
  if (tiktokWindows[channelKey] && !tiktokWindows[channelKey].closed) {
    tiktokWindows[channelKey].focus();
    updateTikTokStatusBar();
    return;
  }

  // Abrir nueva ventana
  const width = 1100;
  const height = 750;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2));

  tiktokWindows[channelKey] = window.open(
    targetUrl,
    windowName,
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no`
  );

  console.log(`[TikTok] 🎵 Ventana abierta para ${channelKey}: ${targetUrl}`);
  updateTikTokStatusBar();

  // Monitorear cierre de la ventana
  const checkInterval = setInterval(() => {
    if (!tiktokWindows[channelKey] || tiktokWindows[channelKey].closed) {
      clearInterval(checkInterval);
      delete tiktokWindows[channelKey];
      updateTikTokStatusBar();
      console.log(`[TikTok] Ventana ${channelKey} cerrada.`);
    }
  }, 2000);
}

/**
 * Verifica si una ventana TikTok está abierta para un canal
 */
function isTikTokWindowOpen(channelKey) {
  return tiktokWindows[channelKey] && !tiktokWindows[channelKey].closed;
}

/**
 * Abre la ventana activa de TikTok para el canal filtrado o el por defecto
 */
function openActiveTikTokChannelWindow() {
  const channelKey = (currentFilter === 'tk_agro' || currentFilter === 'tk_tracto') ? currentFilter : 'tk_agro';
  openTikTokWindow(channelKey);
}

/**
 * Actualiza el Espacio de Trabajo TikTok en la bandeja cuando se filtra por TK
 */
function updateTikTokStatusBar() {
  const pane = document.getElementById('tiktokWorkspacePane');
  const isTkFilter = currentFilter === 'tk_agro' || currentFilter === 'tk_tracto';

  if (!pane) return;

  if (!isTkFilter) {
    pane.classList.add('hidden');
    pane.classList.remove('flex');
    return;
  }

  pane.classList.remove('hidden');
  pane.classList.add('flex');

  const channelKey = currentFilter;
  const ch = channelsVaultState?.channels?.[channelKey];
  const isOpen = isTikTokWindowOpen(channelKey);
  const isAgro = channelKey === 'tk_agro';
  const defaultAccount = isAgro ? '@agropower_venezuela' : '@tractopowervenezuela';
  const account = ch?.loggedAccount || ch?.defaultReferenceAccount || defaultAccount;
  const connected = Boolean(ch?.connected);

  const titleEl = document.getElementById('tkPaneTitle');
  if (titleEl) {
    titleEl.textContent = ch?.name || (isAgro ? 'TikTok Agropower' : 'TikTok Tractopower');
  }

  const companyBadgeEl = document.getElementById('tkPaneCompanyBadge');
  if (companyBadgeEl) {
    companyBadgeEl.textContent = isAgro ? '🌿 Agropower' : '🚜 Tractopower';
    companyBadgeEl.className = isAgro
      ? 'text-[10px] px-2 py-0.5 rounded font-extrabold bg-emerald-950 text-emerald-300 border border-emerald-700'
      : 'text-[10px] px-2 py-0.5 rounded font-extrabold bg-amber-950 text-amber-300 border border-amber-700';
  }

  const handleEl = document.getElementById('tkPaneHandle');
  if (handleEl) {
    handleEl.textContent = '@' + String(account).replace(/^@/, '');
  }

  const statusBadgeEl = document.getElementById('tkPaneStatusBadge');
  if (statusBadgeEl) {
    if (connected) {
      statusBadgeEl.textContent = '🟢 Conectado por QR (Método A)';
      statusBadgeEl.className =
        'text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-950 text-emerald-300 border border-emerald-700';
    } else {
      statusBadgeEl.textContent = '⚪ Sin vincular por QR';
      statusBadgeEl.className =
        'text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-900 text-slate-400 border border-slate-700';
    }
  }

  const partitionEl = document.getElementById('tkPanePartition');
  if (partitionEl) {
    partitionEl.textContent = ch?.partition || `persist:${channelKey}`;
  }

  const dotEl = document.getElementById('tkWindowDot');
  const alertTextEl = document.getElementById('tkWindowStateText');
  const btnTextEl = document.getElementById('btnTkOpenWindowText');
  const btnEl = document.getElementById('btnTkOpenWindow');

  if (isOpen) {
    if (dotEl) dotEl.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0';
    if (alertTextEl) {
      alertTextEl.innerHTML = 'Ventana aislada: <strong class="text-emerald-300">Abierta y Activa</strong>';
    }
    if (btnTextEl) btnTextEl.textContent = 'Enfocar Bandeja TikTok';
    if (btnEl) {
      btnEl.className =
        'px-4 py-2.5 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 flex items-center gap-2 transition';
    }
  } else {
    if (dotEl) dotEl.className = 'w-2.5 h-2.5 rounded-full bg-slate-500 shrink-0';
    if (alertTextEl) {
      alertTextEl.innerHTML = 'Ventana aislada: <strong class="text-slate-400">Cerrada</strong>';
    }
    if (btnTextEl) btnTextEl.textContent = 'Abrir Bandeja TikTok';
    if (btnEl) {
      btnEl.className =
        'px-4 py-2.5 rounded-xl text-xs font-extrabold bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/30 flex items-center gap-2 transition';
    }
  }
}

/**
 * Renderiza la barra de TikTok Quick Access en la bandeja
 * (se llama desde renderChatList y filterChannel)
 */
function renderTikTokQuickAccessIfNeeded() {
  updateTikTokStatusBar();
}
