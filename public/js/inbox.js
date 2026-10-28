/* =========================================================================
   MÓDULO 4: BANDEJA OMNICANAL, CHAT ACTIVO, BOT Y VENTAS (public/js/inbox.js)
   ========================================================================= */

async function loadInitialData() {
  try {
    const res = await fetch('/api/conversations');
    conversations = await res.json();

    // Cargar conversaciones de Meta (Instagram DMs + Facebook Messenger)
    await loadMetaConversationsIntoInbox();

    sortConversationsDesc(conversations);
    renderChatList();
    if (conversations.length > 0) selectConversation(conversations[0].id);
  } catch (e) {
    console.log('Modo local / estático');
  }

  await loadBotSettings();
  await checkCatalogPdfStatus();
  checkWhatsAppStatus();
}

/**
 * Elimina una conversación del panel y de WhatsApp (solo admin).
 * Sincroniza bidireccionalmente con el teléfono móvil.
 */
async function deleteConversation(id, name) {
  if (!confirm(`¿Eliminar la conversación con "${name}"?\n\nEsta acción borrará la conversación tanto en el panel como en el WhatsApp del teléfono móvil.`)) return;

  try {
    const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    const data = await res.json();

    if (res.ok && data.success) {
      // Remover localmente sin esperar el socket
      conversations = conversations.filter(c => String(c.id) !== String(id));
      if (String(activeChatId) === String(id)) {
        activeChatId = conversations.length > 0 ? conversations[0].id : null;
      }
      renderChatList();
      if (activeChatId) {
        const active = conversations.find(c => String(c.id) === String(activeChatId));
        if (active) renderMessages(active);
      } else {
        document.getElementById('messagesViewport').innerHTML = '';
      }
      const syncNote = data.syncedPhone ? ' y del WhatsApp móvil' : '';
      if (typeof showSyncToast === 'function') {
        showSyncToast(`🗑️ "${name}" eliminada del panel${syncNote}`, 'cyan');
      }
    } else {
      alert(data.error || 'Error al eliminar la conversación');
    }
  } catch (e) {
    alert('Error de conexión al eliminar la conversación');
  }
}

/**
 * Carga las conversaciones de Meta (IG + FB) y las mezcla en el array global
 */
async function loadMetaConversationsIntoInbox() {
  try {
    const res = await fetch('/api/meta/conversations');
    if (!res.ok) return;
    const metaConvs = await res.json();
    mergeAllMetaConversations(metaConvs);
  } catch (e) {
    console.log('[Meta] Sin conversaciones de Meta disponibles.');
  }
}

/**
 * Mezcla una sola conversación de Meta actualizada en el array global
 */
function mergeMetaConversation(metaConv) {
  if (!metaConv || !metaConv.id) return;
  const idx = conversations.findIndex(c => String(c.id) === String(metaConv.id));
  if (idx !== -1) {
    conversations[idx] = metaConv;
  } else {
    conversations.push(metaConv);
  }
  sortConversationsDesc(conversations);
  renderChatList();
  if (typeof renderFerdiumServiceDock === 'function') {
    renderFerdiumServiceDock();
  }
  const active = conversations.find(c => String(c.id) === String(activeChatId));
  if (active) {
    renderMessages(active);
  }
}

/**
 * Mezcla todas las conversaciones de Meta en el array global
 */
function mergeAllMetaConversations(metaConvs) {
  if (!Array.isArray(metaConvs)) return;
  for (const mc of metaConvs) {
    if (!mc || !mc.id) continue;
    const idx = conversations.findIndex(c => String(c.id) === String(mc.id));
    if (idx !== -1) {
      conversations[idx] = mc;
    } else {
      conversations.push(mc);
    }
  }
  sortConversationsDesc(conversations);
  renderChatList();
  if (typeof renderFerdiumServiceDock === 'function') {
    renderFerdiumServiceDock();
  }
  const active = conversations.find(c => String(c.id) === String(activeChatId));
  if (active) {
    renderMessages(active);
  }
}

function getDisplayPhoneForChat(c) {
  if (!c) return '';
  if (c.formattedPhone && c.formattedPhone !== 'Sin número') return c.formattedPhone;
  const raw = String(c.phone || c.jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!raw) return '';
  if (raw.length === 12 && raw.startsWith('58')) {
    return `+58 ${raw.slice(2, 5)}-${raw.slice(5)}`;
  }
  return `+${raw}`;
}

/**
 * Formatea la fecha y hora de la conversación respetando siempre el horario oficial de Venezuela.
 * Si ya contiene la fecha completa, la retorna directamente.
 */
function formatConversationTimestamp(rawTime) {
  if (!rawTime) return '';
  const str = String(rawTime).trim();
  // Si ya contiene la fecha completa (tiene '/' o '-'), retornarla directamente
  if (str.includes('/') || (str.includes('-') && str.length > 8)) {
    return str;
  }
  return str;
}

/**
 * Convierte un string de fecha/hora de cualquier canal (WhatsApp, Instagram, TikTok, Facebook)
 * a milisegundos para ordenar estrictamente de más nueva a más vieja.
 * Prioriza el timestamp real de la conversación si está disponible.
 * @param {string} timeStr
 * @param {Object} [conv]
 * @returns {number}
 */
function parseTimestampToMs(timeStr, conv) {
  if (conv && conv.timestamp && typeof conv.timestamp === 'number' && conv.timestamp > 1500000000000) {
    return conv.timestamp;
  }

  if (conv && Array.isArray(conv.messages) && conv.messages.length > 0) {
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (lastMsg && lastMsg.timestamp && typeof lastMsg.timestamp === 'number' && lastMsg.timestamp > 1500000000000) {
      return lastMsg.timestamp;
    }
    if (!timeStr) {
      timeStr = lastMsg ? lastMsg.time : null;
    }
  }

  if (!timeStr) {
    if (conv && typeof conv.id === 'number' && conv.id > 1700000000000) {
      return conv.id;
    }
    return 0;
  }

  const rawStr = String(timeStr).trim();

  // Caso 1: ISO o fecha estándar YYYY-MM-DD
  if (rawStr.includes('-') && rawStr.length >= 10) {
    const direct = new Date(rawStr);
    if (!isNaN(direct.getTime())) return direct.getTime();
  }

  // Normalizar caracteres invisibles / espacios no rompibles
  const cleanStr = rawStr.replace(/[\u00A0\u202F]/g, ' ');

  // Caso 2: Contiene coma "dd/mm/yyyy, hh:mm(:ss) (a. m./p. m.)"
  const parts = cleanStr.split(',');
  if (parts.length >= 2) {
    const datePart = parts[0].trim();
    const timePart = parts[1].trim();
    const dateParts = datePart.split('/');

    if (dateParts.length === 3) {
      const day = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10) - 1;
      const year = parseInt(dateParts[2], 10);

      const timeMatch = timePart.match(/(\d+):(\d+)(?::(\d+))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?/i);
      if (timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        const s = parseInt(timeMatch[3] || '0', 10);
        const ampm = (timeMatch[4] || '').toLowerCase().replace(/[^apm]/g, '');

        if (ampm.startsWith('p') && h < 12) h += 12;
        if (ampm.startsWith('a') && h === 12) h = 0;

        const d = new Date(year, month, day, h, m, s);
        if (!isNaN(d.getTime())) return d.getTime();
      }
    }
  }

  // Caso 3: Solo fecha "dd/mm/yyyy"
  if (cleanStr.includes('/') && cleanStr.split('/').length === 3) {
    const [d, m, y] = cleanStr.split('/').map(x => parseInt(x, 10));
    const dt = new Date(y, m - 1, d);
    if (!isNaN(dt.getTime())) return dt.getTime();
  }

  // Caso 4: Solo hora (ej: "10:55 a. m." o "08:31 p. m.")
  // NO asumir 'hoy' si no hay fecha, para evitar que chats antiguos salten arriba
  const timeOnlyMatch = cleanStr.match(/^(\d+):(\d+)(?::(\d+))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?$/i);
  if (timeOnlyMatch) {
    let h = parseInt(timeOnlyMatch[1], 10);
    const m = parseInt(timeOnlyMatch[2], 10);
    const s = parseInt(timeOnlyMatch[3] || '0', 10);
    const ampm = (timeOnlyMatch[4] || '').toLowerCase().replace(/[^apm]/g, '');
    if (ampm.startsWith('p') && h < 12) h += 12;
    if (ampm.startsWith('a') && h === 12) h = 0;

    if (conv && typeof conv.id === 'number' && conv.id > 1700000000000) {
      const baseDate = new Date(conv.id);
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), h, m, s);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    return 0;
  }

  const fallback = new Date(cleanStr);
  return isNaN(fallback.getTime()) ? 0 : fallback.getTime();
}

/**
 * Ordena un array de conversaciones en orden cronológico descendente (de más nueva a más vieja)
 * @param {Array} convArray
 * @returns {Array}
 */
function sortConversationsDesc(convArray) {
  if (!Array.isArray(convArray)) return [];
  return convArray.sort((a, b) => {
    const ta = parseTimestampToMs(a ? a.time : null, a);
    const tb = parseTimestampToMs(b ? b.time : null, b);
    return tb - ta;
  });
}

/**
 * Obtiene el nombre a mostrar en el panel para una conversación:
 * - Si el cliente tiene un nombre registrado en WhatsApp (pushName), muestra ese nombre real.
 * - En su defecto:
 *   - Si el chat pertenece a Tractopower -> 'TractoPower'
 *   - Si el chat pertenece a Agropower -> 'Agropower'
 * NUNCA muestra 'Agropower' en conversaciones de Tractopower.
 */
function getChatDisplayName(c) {
  if (!c) return 'Contacto';

  if (c.platform === 'instagram' || c.channel === 'ig_agro' || c.channel === 'ig_tracto') {
    const raw = (c.name || '').trim();
    if (raw && !raw.startsWith('Usuario Instagram')) {
      return raw.startsWith('@') ? raw : `@${raw}`;
    }
    return 'Usuario Instagram';
  }
  if (c.platform === 'facebook' || c.channel === 'fb_agro' || c.channel === 'fb_tracto') {
    return c.name || 'Usuario Facebook';
  }

  const isTracto = c.channel === 'wa_tracto' || c.company === 'Tractopower' || c.channelKey === 'wa_tracto';
  const defaultCompanyName = isTracto ? 'TractoPower' : 'Agropower';

  const rawName = (c.name || '').trim();
  const digitsName = rawName.replace(/\D/g, '');
  const isPhoneOnly = digitsName.length >= 7 && (rawName.startsWith('+') || rawName === c.phone || rawName === c.formattedPhone || rawName.startsWith('58'));
  const isGeneric = !rawName || 
                    rawName === 'Contacto WhatsApp' || 
                    rawName === 'Sin número' || 
                    rawName === '.' || 
                    rawName === '-' ||
                    rawName.toLowerCase() === 'agropower' ||
                    rawName.toLowerCase() === 'tractopower';

  // Si tiene un nombre real de cliente en WhatsApp (ej. "Jesús D", "Maria Eugenia Maldonado Z", "Alis")
  if (!isPhoneOnly && !isGeneric) {
    return rawName;
  }

  // En su defecto:
  return defaultCompanyName;
}

/**
 * Obtiene las iniciales para el avatar del chat:
 * - Si el cliente tiene nombre propio, usa sus iniciales (ej. "ME", "JD")
 * - En su defecto: 'TR' para Tractopower, 'AG' para Agropower
 */
function getChatAvatarInitials(c) {
  if (!c) return 'WA';
  const isTracto = c.channel === 'wa_tracto' || c.company === 'Tractopower' || c.channelKey === 'wa_tracto';
  const defaultInitials = isTracto ? 'TR' : 'AG';

  const rawName = (c.name || '').trim();
  const digitsName = rawName.replace(/\D/g, '');
  const isPhoneOnly = digitsName.length >= 7 && (rawName.startsWith('+') || rawName === c.phone || rawName === c.formattedPhone || rawName.startsWith('58'));
  const isGeneric = !rawName || 
                    rawName === 'Contacto WhatsApp' || 
                    rawName === 'Sin número' || 
                    rawName === '.' || 
                    rawName === '-' ||
                    rawName.toLowerCase() === 'agropower' ||
                    rawName.toLowerCase() === 'tractopower';

  if (!isPhoneOnly && !isGeneric) {
    const letters = rawName.replace(/[^a-zA-Z0-9]/g, '');
    return letters.substring(0, 2).toUpperCase() || defaultInitials;
  }

  return defaultInitials;
}

function renderChatList() {
  const container = document.getElementById('chatListContainer');
  const search = document.getElementById('searchInput').value.toLowerCase();
  container.innerHTML = '';

  // Ordenar conversaciones en el array global: más recientes primero según su fecha y hora real
  sortConversationsDesc(conversations);

  conversations.forEach(c => {
    const meta = channelMeta[c.channel] || channelMeta['wa_agro'];
    const displayPhone = getDisplayPhoneForChat(c);
    const chatTitle = getChatDisplayName(c);
    const chatInitials = getChatAvatarInitials(c);

    if (currentFilter === 'company_agro' && meta.company !== 'agropower') return;
    if (currentFilter === 'company_tracto' && meta.company !== 'tractopower') return;
    if (
      currentFilter !== 'all' &&
      currentFilter !== 'company_agro' &&
      currentFilter !== 'company_tracto' &&
      c.channel !== currentFilter
    ) {
      return;
    }

    const lastMsg = c.messages[c.messages.length - 1];
    if (
      search &&
      !chatTitle.toLowerCase().includes(search) &&
      !c.name.toLowerCase().includes(search) &&
      !String(c.phone || '').toLowerCase().includes(search) &&
      !displayPhone.toLowerCase().includes(search) &&
      !(meta.companyName || '').toLowerCase().includes(search) &&
      !(meta.label || '').toLowerCase().includes(search)
    ) {
      return;
    }

    const isSelected = String(c.id) === String(activeChatId);
    const isAdmin = authenticatedUser && (authenticatedUser.isAdmin || authenticatedUser.role === 'admin' || String(authenticatedUser.username).toLowerCase() === 'admin');

    // Identificar si la conversación está sin leer (al estilo WhatsApp)
    const isUnread = !isSelected && (
      (typeof c.unreadCount === 'number' && c.unreadCount > 0) ||
      c.isRead === false ||
      c.waitingAdvisor === true ||
      (lastMsg && (lastMsg.sender === 'client' || lastMsg.from === 'client') && c.isRead !== true)
    );
    const unreadCountNum = (c.unreadCount && c.unreadCount > 0) ? c.unreadCount : 1;

    const item = document.createElement('div');
    item.className = `relative group transition cursor-pointer ${
      isSelected
        ? 'bg-slate-800/90 border-l-4 border-blue-500'
        : (isUnread
            ? 'bg-slate-900/95 border-l-4 border-emerald-500 hover:bg-slate-800/60 shadow-sm'
            : 'hover:bg-slate-800/40')
    }`;
    item.onclick = (e) => {
      if (e.target.closest('button')) return;
      selectConversation(c.id);
    };

    // Botón de eliminar (solo admin, aparece al hover)
    const deleteBtn = isAdmin ? `
      <button
        onclick="event.stopPropagation(); deleteConversation('${c.id}', '${(chatTitle || '').replace(/'/g, '\\\'')}')"
        class="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-full bg-rose-900/80 hover:bg-rose-600 border border-rose-700 flex items-center justify-center text-[9px] text-rose-300 hover:text-white"
        title="Eliminar conversación del panel">
        <i class="fa-solid fa-xmark"></i>
      </button>` : '';

    const innerContent = `
      <div class="p-2.5 flex items-start space-x-2.5">
        <div class="relative shrink-0">
          <div class="w-8 h-8 rounded-full ${isUnread ? 'bg-slate-700 border-2 border-emerald-400 text-white' : 'bg-slate-800 border border-slate-700 text-slate-200'} flex items-center justify-center font-bold text-[10px]">
            ${chatInitials}
          </div>
          <span class="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-slate-950 flex items-center justify-center text-[9px]">
            <i class="fa-brands ${meta.icon}"></i>
          </span>
          ${isUnread ? '<span class="absolute -top-0.5 -left-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-950 shadow animate-pulse" title="Nuevo mensaje sin leer"></span>' : ''}
        </div>
        <div class="flex-1 min-w-0 pr-4">
          <div class="flex justify-between items-start gap-1">
            <span class="${isUnread ? 'font-black text-white' : 'font-bold text-slate-200'} text-[11px] truncate">${chatTitle}</span>
            <div class="flex flex-col items-end shrink-0 gap-1">
              <span class="text-[9px] ${isUnread ? 'text-emerald-400 font-bold' : 'text-slate-400 font-mono'}">${formatConversationTimestamp(c.time)}</span>
              ${isUnread ? `
                <span class="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-slate-950 font-black text-[10px] flex items-center justify-center shadow shadow-emerald-500/40 shrink-0" title="Mensaje sin leer">
                  ${unreadCountNum}
                </span>` : ''}
            </div>
          </div>
          ${
            displayPhone
              ? `<div class="text-[10px] font-mono text-emerald-400 font-bold flex items-center gap-1 mt-0.5">
                   <i class="fa-solid fa-phone text-[8px]"></i>
                   <span>${displayPhone}</span>
                 </div>`
              : (c.platform === 'instagram'
                  ? `<div class="text-[10px] text-pink-400 font-semibold flex items-center gap-1 mt-0.5">
                       <i class="fa-brands fa-instagram text-[9px]"></i>
                       <span>${chatTitle}</span>
                     </div>`
                  : '')
          }
          <div class="text-[10px] ${isUnread ? 'text-slate-200 font-semibold' : 'text-slate-400'} truncate mt-0.5">${lastMsg ? lastMsg.text.replace(/\n/g, ' ') : ''}</div>
          <div class="flex items-center gap-1 mt-1 flex-wrap">
            <span class="text-[8px] px-1.5 py-0.2 rounded border ${meta.companyBadgeClass} font-bold">${meta.companyName}</span>
            <span class="text-[8px] px-1.5 py-0.2 rounded border ${meta.badgeClass} font-semibold">${meta.label}</span>
            ${c.attendedByName || c.attendedBy ? `<span class="text-[8px] px-1.5 py-0.2 rounded bg-slate-800 text-blue-300 border border-blue-900 font-semibold" title="Atendido por"><i class="fa-solid fa-user-check text-[7px] mr-0.5"></i>${c.attendedByName || c.attendedBy}</span>` : ''}
            ${c.saleClosed ? '<span class="text-[8px] bg-emerald-500 text-slate-950 font-extrabold px-1.5 py-0.2 rounded">🏆 VENTA CERRADA</span>' : ''}
            ${c.waitingAdvisor ? '<span class="text-[8px] bg-amber-500 text-slate-950 font-extrabold px-1.5 py-0.2 rounded animate-pulse">🔔 PIDE ASESOR</span>' : ''}
          </div>
        </div>
      </div>
    `;

    item.innerHTML = deleteBtn + innerContent;
    container.appendChild(item);
  });

  if (typeof renderFerdiumServiceDock === 'function') {
    renderFerdiumServiceDock();
  }
  if (typeof renderSplitConversationView === 'function') {
    renderSplitConversationView();
  }
}

function selectConversation(id) {
  activeChatId = id;
  if (typeof cancelAdvisorFile === 'function') {
    cancelAdvisorFile();
  }
  const c = conversations.find(x => String(x.id) === String(id));
  if (!c) return;

  // Marcar conversación como leída inmediatamente y refrescar badges
  c.isRead = true;
  c.unreadCount = 0;
  fetch('/api/conversations/read/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  if (typeof renderFerdiumServiceDock === 'function') {
    renderFerdiumServiceDock();
  }
  renderChatList();

  const meta = channelMeta[c.channel] || channelMeta['wa_agro'];
  const displayPhone = getDisplayPhoneForChat(c);
  const chatTitle = getChatDisplayName(c);
  const chatInitials = getChatAvatarInitials(c);

  document.getElementById('activeAvatar').innerText = chatInitials;
  document.getElementById('activeName').innerText = chatTitle;

  const phoneBadge = document.getElementById('activePhoneBadge');
  if (phoneBadge) {
    if (displayPhone) {
      phoneBadge.classList.remove('hidden');
      phoneBadge.innerText = `📱 ${displayPhone}`;
      phoneBadge.className = 'text-[10px] font-mono px-2 py-0.2 rounded font-bold bg-slate-800 text-emerald-300 border border-emerald-700/60';
    } else if (c.platform === 'instagram') {
      phoneBadge.classList.remove('hidden');
      phoneBadge.innerText = `📸 ${chatTitle}`;
      phoneBadge.className = 'text-[10px] font-mono px-2 py-0.2 rounded font-bold bg-slate-800 text-pink-400 border border-pink-700/60';
    } else if (c.platform === 'facebook') {
      phoneBadge.classList.remove('hidden');
      phoneBadge.innerText = `💬 Messenger`;
      phoneBadge.className = 'text-[10px] font-mono px-2 py-0.2 rounded font-bold bg-slate-800 text-blue-400 border border-blue-700/60';
    } else {
      phoneBadge.classList.add('hidden');
    }
  }

  const compBadge = document.getElementById('activeCompanyBadge');
  if (compBadge) {
    compBadge.innerText = meta.companyName;
    compBadge.className = `text-[9px] px-2 py-0.2 rounded font-extrabold border ${meta.companyBadgeClass}`;
  }

  const badge = document.getElementById('activeChannelBadge');
  badge.innerText = meta.label;
  badge.className = `text-[9px] px-2 py-0.2 rounded font-semibold border ${meta.badgeClass}`;

  const timeBadge = document.getElementById('activeTimeBadge');
  const timeText = document.getElementById('activeTimeText');
  if (timeText && c.time) {
    timeText.innerText = formatConversationTimestamp(c.time);
    if (timeBadge) {
      timeBadge.classList.remove('hidden');
      timeBadge.classList.add('inline-flex');
    }
  } else if (timeBadge) {
    timeBadge.classList.add('hidden');
    timeBadge.classList.remove('inline-flex');
  }

  const attendedBadge = document.getElementById('activeAttendedByBadge');
  const attendedText = document.getElementById('activeAttendedByText');
  if (attendedBadge && attendedText) {
    const who = c.attendedByName || c.attendedBy;
    if (who) {
      attendedText.innerText = `Atendido por ${who}`;
      attendedBadge.classList.remove('hidden');
      attendedBadge.classList.add('inline-flex');
    } else {
      attendedBadge.classList.add('hidden');
      attendedBadge.classList.remove('inline-flex');
    }
  }

  updateSaleButtonUI(c);
  updateWaitingAdvisorHeaderUI(c);
  renderMessages(c);
  renderChatList();

  if (typeof OmniDevice !== 'undefined' && OmniDevice.showChatView) {
    OmniDevice.showChatView();
  }
}

function updateWaitingAdvisorHeaderUI(c) {
  const badge = document.getElementById('activeWaitingAdvisorBadge');
  if (badge) {
    if (c && c.waitingAdvisor) {
      badge.classList.remove('hidden');
      badge.classList.add('flex');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }
  }

  const advisorSelect = document.getElementById('activeAdvisorSelect');
  if (advisorSelect && c) {
    if (advisorSelect.options.length <= 1) {
      populateAdvisorSelect().then(() => {
        advisorSelect.value = c.attendedBy || '';
      });
    } else {
      advisorSelect.value = c.attendedBy || '';
    }
  }
}

async function assignAdvisorToActiveChat(advisorUsername) {
  if (!activeChatId) return;
  const activeConv = conversations.find(c => String(c.id) === String(activeChatId));
  if (!activeConv) return;

  try {
    const res = await fetch('/api/conversations/assign-advisor', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : {})
      },
      body: JSON.stringify({
        conversationId: activeChatId,
        advisorUsername: advisorUsername || null
      })
    });
    const data = await res.json();
    if (data.success && data.conversation) {
      activeConv.attendedBy = data.conversation.attendedBy;
      activeConv.attendedByName = data.conversation.attendedByName;
      activeConv.waitingAdvisor = data.conversation.waitingAdvisor;

      renderMessages(activeConv);
      renderChatList();
      updateWaitingAdvisorHeaderUI(activeConv);

      const attendedBadge = document.getElementById('activeAttendedByBadge');
      const attendedText = document.getElementById('activeAttendedByText');
      if (attendedBadge && attendedText) {
        if (activeConv.attendedByName) {
          attendedText.innerText = `Atendido por ${activeConv.attendedByName}`;
          attendedBadge.classList.remove('hidden');
          attendedBadge.classList.add('inline-flex');
        } else {
          attendedBadge.classList.add('hidden');
          attendedBadge.classList.remove('inline-flex');
        }
      }
    }
  } catch (err) {
    console.error('[AssignAdvisor] Error asignando asesor:', err);
  }
}

async function populateAdvisorSelect() {
  const select = document.getElementById('activeAdvisorSelect');
  if (!select) return;

  let advisors = [];
  try {
    const res = await fetch('/api/users/advisors', {
      headers: (typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : {})
    });
    if (res.ok) {
      advisors = await res.json();
    }
  } catch (e) {}

  if (!advisors || advisors.length === 0) {
    advisors = [
      { username: 'Jesuse', firstName: 'Jesus', lastName: 'Eguis', role: 'operator' },
      { username: 'rcazorla', firstName: 'Ricardo', lastName: 'Cazorla', role: 'operator' }
    ];
  }

  const currentVal = select.value;
  select.innerHTML = '<option value="">Sin Asignar</option>';
  advisors.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.username;
    opt.className = 'bg-slate-900 text-blue-200 font-bold';
    const isAdv = u.role !== 'admin';
    opt.textContent = isAdv ? `Asesor ${u.firstName}` : `${u.firstName} (${u.role})`;
    select.appendChild(opt);
  });
  if (currentVal) select.value = currentVal;
}

async function dismissWaitingAdvisor(id) {
  const targetId = id || activeChatId;
  if (!targetId) return;
  const c = conversations.find(x => x.id === targetId);
  if (c) {
    c.waitingAdvisor = false;
    c.botActive = false;
    renderChatList();
    updateWaitingAdvisorHeaderUI(c);
  }
  try {
    await fetch('/api/conversations/dismiss-waiting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: targetId })
    });
  } catch (e) {
    console.error('Error apagando flag PIDE ASESOR:', e);
  }
}

function updateSaleButtonUI(c) {
  const btn = document.getElementById('btnCloseSale');
  const txt = document.getElementById('btnCloseSaleText');
  const topBadge = document.getElementById('activeSaleClosedBadge');
  if (!btn || !txt) return;

  if (c && c.saleClosed) {
    btn.className =
      'bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-1 rounded-lg text-xs font-extrabold shadow flex items-center gap-1.5 transition';
    txt.innerText = 'Venta Cerrada ✓';
    if (topBadge) {
      topBadge.classList.remove('hidden');
      topBadge.innerText = `🏆 VENTA CERRADA${c.saleClosedByName ? ' (' + c.saleClosedByName + ')' : ''}`;
    }
  } else {
    btn.className =
      'bg-amber-500 hover:bg-amber-400 text-slate-950 px-3 py-1 rounded-lg text-xs font-extrabold shadow flex items-center gap-1.5 transition';
    txt.innerText = 'Cerrar Venta';
    if (topBadge) topBadge.classList.add('hidden');
  }
}

async function toggleCloseSale() {
  try {
    const res = await fetch('/api/conversations/close-sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: activeChatId,
        userId: currentUserId
      })
    });
    const data = await res.json();
    if (data && data.conversation) {
      const idx = conversations.findIndex(x => String(x.id) === String(activeChatId));
      if (idx !== -1) conversations[idx] = data.conversation;
      updateSaleButtonUI(data.conversation);
      renderChatList();
      if (authenticatedUser && authenticatedUser.isAdmin) {
        loadAnalyticsSummary();
      }
    }
  } catch (e) {
    console.error('Error cerrando venta:', e);
  }
}







/**
 * Genera el HTML del bloque de media para un mensaje
 */
function renderMediaBlock(m) {
  if (!m.mediaType || !m.mediaUrl) return '';

  const url = m.mediaUrl;

  if (m.mediaType === 'sticker') {
    return `
      <div class="mt-1.5 inline-block">
        <img src="${url}" alt="${m.mediaLabel || '🎭 Sticker'}"
          class="max-w-[130px] max-h-[130px] object-contain cursor-pointer hover:scale-105 transition-transform"
          onclick="window.open('${url}', '_blank')"
          onerror="this.style.display='none';this.nextSibling.style.display='flex'">
        <div class="hidden items-center gap-1.5 text-slate-400 text-xs mt-1">
          <span>🎭 Sticker</span>
        </div>
      </div>`;
  }

  if (m.mediaType === 'image') {
    return `
      <div class="mt-1.5">
        <img src="${url}" alt="${m.mediaLabel || 'Imagen'}"
          class="max-w-[220px] max-h-[220px] rounded-lg cursor-pointer border border-slate-600 object-cover hover:opacity-90 transition"
          onclick="window.open('${url}', '_blank')"
          onerror="this.style.display='none';this.nextSibling.style.display='flex'">
        <div class="hidden items-center gap-1.5 text-slate-400 text-xs mt-1">
          <i class="fa-solid fa-image"></i>
          <span>${m.mediaLabel || 'Imagen no disponible'}</span>
        </div>
      </div>`;
  }

  if (m.mediaType === 'audio') {
    return `
      <div class="mt-1.5 flex flex-col gap-1">
        <div class="flex items-center gap-1.5 text-[10px] text-slate-300 mb-0.5">
          <i class="fa-solid fa-microphone text-emerald-400"></i>
          <span>${m.mediaLabel || '🎤 Nota de voz'}</span>
        </div>
        <audio controls src="${url}" class="w-full max-w-[240px] h-8"
          style="filter: invert(0.85) hue-rotate(180deg);"
          onerror="this.parentElement.innerHTML='<span class=\\'text-slate-400 text-xs\\'>⚠️ Audio no disponible</span>'">
        </audio>
      </div>`;
  }

  if (m.mediaType === 'video') {
    return `
      <div class="mt-1.5">
        <video controls src="${url}" class="max-w-[220px] max-h-[180px] rounded-lg border border-slate-600"
          onerror="this.style.display='none';this.nextSibling.style.display='flex'">
        </video>
        <div class="hidden items-center gap-1.5 text-slate-400 text-xs mt-1">
          <i class="fa-solid fa-video"></i>
          <span>${m.mediaLabel || 'Video no disponible'}</span>
        </div>
      </div>`;
  }

  if (m.mediaType === 'document') {
    const fileName = m.mediaLabel ? m.mediaLabel.replace('📄 Documento — ', '') : 'Documento';
    return `
      <div class="mt-1.5">
        <a href="${url}" target="_blank" download
          class="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-600 hover:border-blue-400 transition text-xs text-slate-200 no-underline">
          <i class="fa-solid fa-file-arrow-down text-blue-400 text-base"></i>
          <div>
            <div class="font-semibold">${fileName}</div>
            <div class="text-[9px] text-slate-400">Toca para descargar</div>
          </div>
        </a>
      </div>`;
  }

  // contact, location u otro — mostrar solo label
  return `<div class="mt-1 text-[10px] text-slate-400 italic">${m.mediaLabel || ''}</div>`;
}

function renderMessages(c) {
  const vp = document.getElementById('messagesViewport');
  vp.innerHTML = '';
  const displayPhone = getDisplayPhoneForChat(c);

  c.messages.forEach(m => {
    const div = document.createElement('div');

    // Texto principal: si el texto es igual al mediaLabel (etiqueta automática), no mostrarlo dos veces
    const rawText = (m.text && m.mediaLabel && m.text === m.mediaLabel) ? '' : (m.text || '');
    const htmlText = rawText
      .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    const mediaHtml = renderMediaBlock(m);

    const isClientMsg = m.from === 'client' || 
                        m.sender === 'client' || 
                        (m.sender && m.sender !== 'operator' && m.sender !== 'Agropower' && m.sender !== 'Tractopower' && m.sender !== 'bot' && m.sender !== 'scheduled' && !m.operatorName && !m.operatorUser && m.from !== 'operator');

    if (isClientMsg) {
      div.className = 'flex flex-col items-start max-w-[82%]';
      const displayText = htmlText || (mediaHtml ? '' : `<span class="italic text-slate-400"><i class="fa-solid fa-paperclip mr-1 text-slate-500"></i>[Contenido multimedia / Archivo compartido]</span>`);
      const clientHeaderName = getChatDisplayName(c);
      div.innerHTML = `
        <span class="text-[9px] text-slate-400 mb-0.5 flex items-center gap-1.5">
          <strong class="text-slate-300">${clientHeaderName}</strong>
          ${displayPhone ? `<span class="font-mono text-emerald-400 font-semibold">(${displayPhone})</span>` : ''}
          <span>• ${formatConversationTimestamp(m.time)}</span>
        </span>
        <div class="bg-slate-800 border border-slate-700 text-slate-100 rounded-xl rounded-tl-none p-2.5 text-xs leading-relaxed">
          ${displayText}
          ${mediaHtml}
        </div>
      `;
    } else {
      div.className = 'flex flex-col items-end max-w-[85%] ml-auto';
      let pdfBox = '';
      if (m.attachment) {
        pdfBox = `
          <div class="mt-2 p-2 rounded-lg bg-slate-950 border border-emerald-500/50 flex items-center justify-between gap-2">
            <div class="flex items-center space-x-2">
              <i class="fa-solid fa-file-pdf text-rose-500 text-base"></i>
              <div>
                <div class="font-bold text-[11px] text-white">${m.attachment}</div>
                <div class="text-[9px] text-emerald-400">Documento PDF Oficial Adjunto ✓✓</div>
              </div>
            </div>
          </div>
        `;
      }

      const isScheduled = m.sender === 'scheduled' || m.origin === 'scheduled';
      const isWeb = m.origin === 'web' ||
                    m.operatorUser === 'web' ||
                    (m.operatorName && (m.operatorName.includes('Web') || m.operatorName.includes('WhatsApp Web')));
      const isMobile = !isWeb && m.origin !== 'panel' && (
                        m.origin === 'mobile' || 
                        m.operatorUser === 'mobile' || 
                        (m.operatorName && (m.operatorName.includes('Móvil') || m.operatorName.includes('Movil') || m.operatorName.includes('Instagram App'))) || 
                        (m.text && m.text.includes('(Enviado desde el teléfono físico)'))
                       );

      const textLower = (m.text || '').toLowerCase();
      const isGreetingText = textLower.includes('saludos de parte del equipo') ||
                             textLower.includes('gracias por escribirnos') ||
                             textLower.includes('cotización de repuestos o maquinaria') ||
                             textLower.includes('cotizacion de repuestos') ||
                             textLower.includes('para orientarte mejor, cuéntanos') ||
                             textLower.includes('para orientarte mejor') ||
                             textLower.includes('escríbenos tu duda y ya te respondemos') ||
                             textLower.includes('escribenos tu duda y ya te respondemos') ||
                             textLower.includes('en un momento un asesor se pondrá en contacto') ||
                             textLower.includes('en un momento un asesor');

      const isBotMessage = m.sender === 'bot' || 
                           m.isBot === true ||
                           m.origin === 'bot' ||
                           (m.operatorName && (m.operatorName.includes('Bot') || m.operatorName.includes('bot'))) ||
                           (!isMobile && !isWeb && !m.operatorName && !m.operatorUser && (
                             isGreetingText ||
                             ((!m.text || m.text.trim() === '') && (m.sender === 'Agropower' || m.sender === 'Tractopower'))
                           ));

      let headerTag = '';
      if (isScheduled) {
        headerTag = `<span class="inline-flex items-center gap-1 bg-emerald-950/90 border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded text-[10px] font-bold shadow-sm"><i class="fa-solid fa-clock text-[9px]"></i><span>Mensaje Programado</span></span>`;
      } else if (isBotMessage) {
        headerTag = `<span class="inline-flex items-center gap-1 bg-amber-950/90 border border-amber-500/40 text-amber-300 px-2 py-0.5 rounded text-[10px] font-bold shadow-sm"><i class="fa-solid fa-robot text-[9px] text-amber-400"></i><span>Bot Programado</span></span>`;
      } else if (isWeb) {
        headerTag = `<span class="inline-flex items-center gap-1 bg-teal-950/90 border border-teal-500/50 text-teal-200 px-2 py-0.5 rounded text-[10px] font-bold shadow-sm" title="Mensaje enviado desde WhatsApp Web"><i class="fa-solid fa-laptop text-[9px] text-teal-400"></i><span>💻 Web</span></span>`;
      } else if (isMobile) {
        headerTag = `<span class="inline-flex items-center gap-1 bg-purple-950/90 border border-purple-500/50 text-purple-200 px-2 py-0.5 rounded text-[10px] font-bold shadow-sm" title="Mensaje enviado desde el teléfono móvil"><i class="fa-solid fa-mobile-screen text-[9px] text-purple-400"></i><span>📱 Móvil</span></span>`;
      } else {
        // Mensaje con remitente fijo e inmutable del panel (Administrador / Asesor Jesus / Asesor Ricardo)
        let displayName = 'Asesor';
        const raw = (m.operatorName || m.operatorUser || '').trim();
        const rawLower = raw.toLowerCase();

        if (rawLower.includes('jesus') || m.operatorUser === 'Jesuse') {
          displayName = 'Asesor Jesus';
        } else if (rawLower.includes('ricardo') || m.operatorUser === 'rcazorla') {
          displayName = 'Asesor Ricardo';
        } else if (rawLower.includes('admin') || m.operatorUser === 'admin') {
          displayName = 'Administrador';
        } else if (rawLower.includes('web') || m.origin === 'web' || m.operatorUser === 'web') {
          displayName = '💻 Web';
        } else if (rawLower.includes('móvil') || rawLower.includes('movil') || m.origin === 'mobile' || m.operatorUser === 'mobile') {
          displayName = '📱 Móvil';
        } else if (raw) {
          displayName = raw.startsWith('Asesor') ? raw : `Asesor ${raw}`;
        } else if (m.sender === 'Agropower' || m.sender === 'Tractopower') {
          displayName = '📱 Móvil / Cuenta';
        }

        const isAdm = displayName.includes('Admin');
        const isRic = displayName.includes('Ricardo');
        const isJes = displayName.includes('Jesus');
        const isWebBadge = displayName.includes('Web');
        const isMob = displayName.includes('Móvil');

        const badgeColor = isAdm 
          ? 'bg-slate-900/90 border-emerald-500/50 text-emerald-200' 
          : isRic 
          ? 'bg-indigo-950/90 border-indigo-400/50 text-indigo-200'
          : isJes
          ? 'bg-blue-950/90 border-blue-400/50 text-blue-200'
          : isWebBadge
          ? 'bg-teal-950/90 border-teal-500/50 text-teal-200'
          : isMob
          ? 'bg-purple-950/90 border-purple-500/50 text-purple-200'
          : 'bg-slate-900/90 border-slate-500/50 text-slate-200';

        const icon = isAdm 
          ? 'fa-shield-halved text-emerald-400' 
          : isWebBadge
          ? 'fa-laptop text-teal-400'
          : isMob 
          ? 'fa-mobile-screen text-purple-400' 
          : 'fa-user-tie text-blue-400';

        headerTag = `<span class="inline-flex items-center gap-1 ${badgeColor} border px-2 py-0.5 rounded text-[10px] font-bold shadow-sm"><i class="fa-solid ${icon} text-[9px]"></i><span>${displayName}</span></span>`;
      }

      let cleanHtmlText = htmlText || '';
      if (cleanHtmlText) {
        cleanHtmlText = cleanHtmlText.replace(/\(Enviado desde el teléfono físico\)/gi, '').trim();
      }
      const opDisplayText = cleanHtmlText || `<span class="italic text-slate-300/70"><i class="fa-solid fa-image mr-1"></i>[Imagen / Contenido enviado]</span>`;

      div.innerHTML = `
        <div class="flex items-center gap-1.5 mb-1 justify-end">
          ${headerTag}
          <span class="text-[9px] text-slate-400 font-mono">${formatConversationTimestamp(m.time)}</span>
        </div>
        <div class="${isScheduled ? 'bg-emerald-950/70 border border-emerald-700/60' : 'bg-blue-600'} text-slate-100 rounded-xl rounded-tr-none p-2.5 text-xs leading-relaxed shadow">
          ${opDisplayText}
          ${mediaHtml}
          ${pdfBox}
        </div>
      `;
    }
    vp.appendChild(div);
  });

  vp.scrollTop = vp.scrollHeight;
}

async function sendPreprogrammed(key) {
  const greetingMenuVal = document.getElementById('t_greeting_menu')
    ? document.getElementById('t_greeting_menu').value
    : DEFAULT_GREETING_TEXT;

  const texts = {
    menu_principal: greetingMenuVal,
    cat_modelos: document.getElementById('t_cat_modelos').value,
    repuestos: document.getElementById('t_repuestos').value,
    garantia: document.getElementById('t_garantia').value,
    precios: document.getElementById('t_precios').value,
    financiamiento: document.getElementById('t_financiamiento').value,
    compras_prog: document.getElementById('t_compras_prog').value,
    asesor: document.getElementById('t_asesor').value
  };

  customProgrammedOptions.forEach(opt => {
    texts[opt.id] = opt.reply;
  });

  const attachment = key === 'cat_modelos' ? document.getElementById('t_pdf_name')?.value : null;
  const replyText = texts[key] || '';
  if (!replyText && !attachment) return;

  const now = new Date().toLocaleString('es-VE', {
    timeZone: 'America/Caracas',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const activeConv = conversations.find(c => String(c.id) === String(activeChatId));
  let senderName = 'Asesor';
  let operatorUser = 'operator';

  if (authenticatedUser) {
    operatorUser = authenticatedUser.username;
    if (authenticatedUser.username === 'Jesuse' || authenticatedUser.firstName?.toLowerCase().includes('jesus')) {
      senderName = 'Asesor Jesus';
    } else if (authenticatedUser.username === 'rcazorla' || authenticatedUser.firstName?.toLowerCase().includes('ricardo')) {
      senderName = 'Asesor Ricardo';
    } else if (authenticatedUser.role === 'admin' || authenticatedUser.username === 'admin') {
      senderName = 'Administrador';
    } else {
      senderName = `Asesor ${authenticatedUser.firstName || authenticatedUser.username}`.trim();
    }
  } else if (activeConv && activeConv.attendedByName) {
    senderName = activeConv.attendedByName;
    operatorUser = activeConv.attendedBy || 'operator';
  }

  const optimisticMsg = {
    sender: 'operator',
    origin: 'panel',
    operatorName: senderName,
    operatorUser: operatorUser,
    text: replyText,
    attachment: attachment || null,
    time: now
  };
  if (activeConv) {
    activeConv.waitingAdvisor = false;
    activeConv.botActive = false;
    activeConv.isRead = true;
    activeConv.unreadCount = 0;
    activeConv.time = now;
    if (authenticatedUser) {
      activeConv.attendedBy = authenticatedUser.username;
      activeConv.attendedByName = senderName;
    }
    if (!Array.isArray(activeConv.messages)) activeConv.messages = [];
    activeConv.messages.push(optimisticMsg);
    renderMessages(activeConv);
    renderChatList();
    updateWaitingAdvisorHeaderUI(activeConv);
  }

  // Si es Meta (Instagram o Facebook), enviar por Meta API
  if (activeConv && activeConv.senderId && (activeConv.platform === 'instagram' || activeConv.platform === 'facebook')) {
    try {
      await fetch('/api/channels/meta/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : {})
        },
        body: JSON.stringify({
          channelKey: activeConv.channelKey || activeConv.channel,
          recipientId: activeConv.senderId,
          text: replyText
        })
      });
      return;
    } catch (e) {
      console.error('[Meta] Error enviando respuesta rápida:', e);
      return;
    }
  }

  // Detectar si es una conversación de TikTok
  if (activeConv && (activeConv.channel === 'tk_agro' || activeConv.channel === 'tk_tracto' || String(activeConv.id).startsWith('tk_'))) {
    try {
      const recipientUsername = activeConv.name || String(activeConv.phone || '').replace(/^@/, '');
      await fetch('/api/channels/tiktok/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : {})
        },
        body: JSON.stringify({
          channelKey: activeConv.channel,
          recipientUsername,
          text: replyText
        })
      });
      return;
    } catch (e) {
      console.error('[TikTok] Error enviando respuesta rápida:', e);
      return;
    }
  }

  try {
    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : {})
      },
      body: JSON.stringify({
        conversationId: activeChatId,
        text: replyText,
        attachment: attachment,
        userId: currentUserId
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      console.error('[WhatsApp Send Error]:', data.error);
      alert('Error enviando mensaje: ' + (data.error || 'No se pudo entregar'));
    } else if (data.conversation && activeConv) {
      activeConv.messages = data.conversation.messages;
      renderMessages(activeConv);
    }
  } catch (e) {
    console.error('[WhatsApp Send Error]:', e);
  }
}

let selectedAdvisorFile = null;

function triggerFileUpload() {
  const fileInput = document.getElementById('advisorFileInput');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

function handleAdvisorFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (file.size > 25 * 1024 * 1024) {
    alert('El archivo seleccionado supera el límite de 25 MB.');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    selectedAdvisorFile = {
      file: file,
      dataBase64: e.target.result,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size
    };

    const previewContainer = document.getElementById('filePreviewContainer');
    const previewName = document.getElementById('filePreviewName');
    const previewSize = document.getElementById('filePreviewSize');
    const previewIcon = document.getElementById('filePreviewIcon');

    if (previewContainer && previewName && previewSize) {
      previewName.textContent = file.name;

      let sizeStr = '';
      if (file.size < 1024) sizeStr = `${file.size} B`;
      else if (file.size < 1024 * 1024) sizeStr = `${(file.size / 1024).toFixed(1)} KB`;
      else sizeStr = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
      previewSize.textContent = sizeStr;

      let iconClass = 'fa-file text-slate-300';
      const t = (file.type || '').toLowerCase();
      if (t.startsWith('image/')) iconClass = 'fa-file-image text-emerald-400';
      else if (t.startsWith('video/')) iconClass = 'fa-file-video text-purple-400';
      else if (t.startsWith('audio/')) iconClass = 'fa-file-audio text-amber-400';
      else if (t.includes('pdf')) iconClass = 'fa-file-pdf text-rose-400';
      else if (t.includes('word') || t.includes('officedocument.word')) iconClass = 'fa-file-word text-blue-400';
      else if (t.includes('excel') || t.includes('spreadsheet') || t.includes('csv')) iconClass = 'fa-file-excel text-emerald-400';
      else if (t.includes('zip') || t.includes('rar') || t.includes('tar') || t.includes('7z')) iconClass = 'fa-file-zipper text-yellow-400';

      if (previewIcon) {
        previewIcon.innerHTML = `<i class="fa-solid ${iconClass} text-lg"></i>`;
      }

      previewContainer.classList.remove('hidden');
    }

    const inp = document.getElementById('operatorInput');
    if (inp) {
      inp.focus();
      inp.placeholder = `Escribe un comentario opcional para "${file.name}"...`;
    }
  };
  reader.readAsDataURL(file);
}

function cancelAdvisorFile() {
  selectedAdvisorFile = null;
  const fileInput = document.getElementById('advisorFileInput');
  if (fileInput) fileInput.value = '';
  const previewContainer = document.getElementById('filePreviewContainer');
  if (previewContainer) previewContainer.classList.add('hidden');
  const inp = document.getElementById('operatorInput');
  if (inp) {
    inp.placeholder = 'Escribe un mensaje libre al cliente...';
  }
}

async function operatorSendMessage() {
  const inp = document.getElementById('operatorInput');
  const val = inp ? inp.value.trim() : '';
  const fileToSend = selectedAdvisorFile;

  if (!val && !fileToSend) return;

  // Limpiar input y previsualización de inmediato
  if (inp) {
    inp.value = '';
    inp.placeholder = 'Escribe un mensaje libre al cliente...';
  }
  cancelAdvisorFile();

  const now = new Date().toLocaleString('es-VE', {
    timeZone: 'America/Caracas',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const activeConv = conversations.find(c => String(c.id) === String(activeChatId));
  let senderName = 'Asesor';
  let operatorUser = 'operator';

  if (authenticatedUser) {
    operatorUser = authenticatedUser.username;
    if (authenticatedUser.username === 'Jesuse' || authenticatedUser.firstName?.toLowerCase().includes('jesus')) {
      senderName = 'Asesor Jesus';
    } else if (authenticatedUser.username === 'rcazorla' || authenticatedUser.firstName?.toLowerCase().includes('ricardo')) {
      senderName = 'Asesor Ricardo';
    } else if (authenticatedUser.role === 'admin' || authenticatedUser.username === 'admin') {
      senderName = 'Administrador';
    } else {
      senderName = `Asesor ${authenticatedUser.firstName || authenticatedUser.username}`.trim();
    }
  } else if (activeConv && activeConv.attendedByName) {
    senderName = activeConv.attendedByName;
    operatorUser = activeConv.attendedBy || 'operator';
  }

  let mediaType = null;
  let mediaUrl = null;
  let mediaLabel = null;

  if (fileToSend) {
    mediaUrl = fileToSend.dataBase64;
    const fType = fileToSend.type || '';
    if (fType.startsWith('image/')) {
      mediaType = 'image';
      mediaLabel = `📷 Imagen (${fileToSend.name})`;
    } else if (fType.startsWith('video/')) {
      mediaType = 'video';
      mediaLabel = `🎥 Video (${fileToSend.name})`;
    } else if (fType.startsWith('audio/')) {
      mediaType = 'audio';
      mediaLabel = `🎤 Audio (${fileToSend.name})`;
    } else {
      mediaType = 'document';
      mediaLabel = `📄 Documento — ${fileToSend.name}`;
    }
  }

  const optimisticMsg = {
    sender: 'operator',
    origin: 'panel',
    operatorName: senderName,
    operatorUser: operatorUser,
    text: val,
    time: now
  };
  if (mediaType && mediaUrl) {
    optimisticMsg.mediaType = mediaType;
    optimisticMsg.mediaUrl = mediaUrl;
    optimisticMsg.mediaLabel = mediaLabel;
  }

  if (activeConv) {
    activeConv.waitingAdvisor = false;
    activeConv.botActive = false;
    activeConv.isRead = true;
    activeConv.unreadCount = 0;
    activeConv.time = now;
    if (authenticatedUser) {
      activeConv.attendedBy = authenticatedUser.username;
      activeConv.attendedByName = senderName;
    }
    if (!Array.isArray(activeConv.messages)) activeConv.messages = [];
    activeConv.messages.push(optimisticMsg);

    // ⚡ ACTUALIZACIÓN INSTANTÁNEA EN PANTALLA: Se muestra de inmediato sin parpadear
    renderMessages(activeConv);
    renderChatList();
    updateWaitingAdvisorHeaderUI(activeConv);
  }

  // Detectar si es una conversación de Meta (Instagram o Facebook)
  if (activeConv && activeConv.senderId && (activeConv.platform === 'instagram' || activeConv.platform === 'facebook')) {
    try {
      const res = await fetch('/api/channels/meta/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : {})
        },
        body: JSON.stringify({
          channelKey: activeConv.channelKey || activeConv.channel,
          recipientId: activeConv.senderId,
          text: val,
          fileData: fileToSend ? fileToSend.dataBase64 : null,
          fileName: fileToSend ? fileToSend.name : null,
          fileType: fileToSend ? fileToSend.type : null
        })
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('[Meta] Error enviando mensaje:', data.error);
        alert(`Error enviando mensaje por ${activeConv.platform}: ${data.error}`);
      }
      return;
    } catch (e) {
      console.error('[Meta] Error de conexión al enviar mensaje:', e);
      alert('Error de conexión al enviar mensaje por Meta.');
      return;
    }
  }

  // Detectar si es una conversación de TikTok
  if (activeConv && (activeConv.channel === 'tk_agro' || activeConv.channel === 'tk_tracto' || String(activeConv.id).startsWith('tk_'))) {
    try {
      const recipientUsername = activeConv.name || String(activeConv.phone || '').replace(/^@/, '');
      const res = await fetch('/api/channels/tiktok/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : {})
        },
        body: JSON.stringify({
          channelKey: activeConv.channel,
          recipientUsername,
          text: val || (fileToSend ? `📎 Archivo: ${fileToSend.name}` : '')
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(`Error enviando mensaje por TikTok: ${data.error || 'No se pudo enviar'}`);
      }
      return;
    } catch (e) {
      console.error('[TikTok] Error de conexión al enviar mensaje:', e);
      alert('Error de conexión al enviar mensaje por TikTok.');
      return;
    }
  }

  // WhatsApp: flujo en vivo con sincronización
  try {
    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : {})
      },
      body: JSON.stringify({
        conversationId: activeChatId,
        text: val,
        userId: currentUserId,
        fileData: fileToSend ? fileToSend.dataBase64 : null,
        fileName: fileToSend ? fileToSend.name : null,
        fileType: fileToSend ? fileToSend.type : null
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      console.error('[WhatsApp Send Error]:', data.error);
      alert('Error enviando mensaje de WhatsApp: ' + (data.error || 'No se pudo entregar'));
    } else if (data.conversation && activeConv) {
      // Reconciliar con la lista confirmada por el servidor
      activeConv.messages = data.conversation.messages;
      renderMessages(activeConv);
      renderChatList();
    }
  } catch (err) {
    console.error('[WhatsApp Network Error]:', err);
    alert('Error de conexión al enviar mensaje de WhatsApp.');
  }
}

function filterChannel(ch) {
  currentFilter = ch;
  const topBtns = ['all', 'company_agro', 'company_tracto'];
  topBtns.forEach(k => {
    const btn = document.getElementById('flt_' + k);
    if (!btn) return;
    if (k === ch) {
      btn.className = 'flex-1 px-2 py-1 rounded-lg bg-blue-600 text-white font-bold text-center transition';
    } else if (k === 'company_agro') {
      btn.className =
        'flex-1 px-2 py-1 rounded-lg bg-slate-800 text-emerald-300 hover:bg-slate-700 font-bold text-center border border-emerald-800/50 transition';
    } else if (k === 'company_tracto') {
      btn.className =
        'flex-1 px-2 py-1 rounded-lg bg-slate-800 text-amber-300 hover:bg-slate-700 font-bold text-center border border-amber-800/50 transition';
    } else {
      btn.className =
        'flex-1 px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold text-center transition';
    }
  });


  sortConversationsDesc(conversations);
  renderChatList();

  // Seleccionar automáticamente la conversación más reciente del canal filtrado
  const currentActive = conversations.find(c => String(c.id) === String(activeChatId));
  const activeMatches = currentActive ? (
    ch === 'all' ||
    (ch === 'company_agro' && (channelMeta[currentActive.channel]?.company === 'agropower')) ||
    (ch === 'company_tracto' && (channelMeta[currentActive.channel]?.company === 'tractopower')) ||
    ((currentActive.channel === 'wa1' ? 'wa_agro' : currentActive.channel) === ch)
  ) : false;

  if (!activeMatches) {
    const firstMatch = conversations.find(c => {
      if (ch === 'all') return true;
      const meta = channelMeta[c.channel] || channelMeta['wa_agro'];
      if (ch === 'company_agro') return meta.company === 'agropower';
      if (ch === 'company_tracto') return meta.company === 'tractopower';
      const cChan = c.channel === 'wa1' ? 'wa_agro' : c.channel;
      return cChan === ch;
    });
    if (firstMatch) {
      selectConversation(firstMatch.id);
    }
  }

  // Si se selecciona un canal de Instagram, sincronizar en segundo plano
  if (ch && ch.startsWith('ig_')) {
    syncInstagramDirectly(true);
  }

  // Mostrar/ocultar barra de acceso rápido TikTok
  if (typeof renderTikTokQuickAccessIfNeeded === 'function') {
    renderTikTokQuickAccessIfNeeded();
  }
}

/**
 * Sincroniza conversaciones de Instagram bajo demanda contra Meta Graph API
 * @param {boolean} [silent=false] - Si es true no muestra spinners o toasts intrusivos
 */
async function syncInstagramDirectly(silent = false) {
  const icon = document.getElementById('iconSyncMeta');
  if (icon) icon.classList.add('fa-spin');

  try {
    const res = await fetch('/api/meta/sync', { method: 'POST' });
    const data = await res.json();

    if (icon) icon.classList.remove('fa-spin');

    if (data.success) {
      if (!silent) {
        const msg = data.newMessages > 0
          ? `✅ Sincronizado: ${data.newMessages} nuevos mensajes recibidos de Instagram.`
          : '✅ Instagram sincronizado al día con Meta Graph API.';
        if (typeof showModalFeedback === 'function') {
          showModalFeedback(msg, 'success');
        } else {
          alert(msg);
        }
      }
    } else if (!silent) {
      if (typeof showModalFeedback === 'function') {
        showModalFeedback(`Aviso al sincronizar: ${data.error || 'Error desconocido'}`, 'warning');
      }
    }
  } catch (err) {
    if (icon) icon.classList.remove('fa-spin');
    console.warn('[MetaSync] Error sincronizando Instagram:', err);
    if (!silent) {
      alert('Error al conectar con el servidor para sincronizar Instagram.');
    }
  }
}

// ─── Funciones de Exportación Exhaustiva de Conversaciones ───
function openExportModal() {
  const modal = document.getElementById('exportModal');
  if (modal) {
    modal.classList.remove('hidden');
    const totalConvsEl = document.getElementById('exportTotalConvs');
    const totalMsgsEl = document.getElementById('exportTotalMsgs');
    if (totalConvsEl && Array.isArray(conversations)) {
      totalConvsEl.textContent = conversations.length.toLocaleString('es-VE');
    }
    if (totalMsgsEl && Array.isArray(conversations)) {
      const msgSum = conversations.reduce((acc, c) => acc + (c.messages ? c.messages.length : 0), 0);
      totalMsgsEl.textContent = msgSum.toLocaleString('es-VE');
    }
  }
}

function closeExportModal() {
  const modal = document.getElementById('exportModal');
  if (modal) modal.classList.add('hidden');
}

async function downloadExportFile(format) {
  const fmt = (format || 'csv').toLowerCase();
  const token = localStorage.getItem('token') || (typeof getToken === 'function' ? getToken() : '');
  const url = `/api/conversations/export?format=${fmt}`;

  try {
    const res = await fetch(url, {
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    });

    if (!res.ok) {
      throw new Error(`Error en servidor: ${res.status}`);
    }

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    const nowISO = new Date().toISOString().slice(0, 10);
    a.download = `export_conversaciones_${fmt}_${nowISO}.${fmt === 'json' ? 'json' : 'csv'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);

    if (typeof showToast === 'function') {
      showToast('Exportación descargada con éxito', 'success');
    } else {
      console.log('✅ Exportación descargada con éxito.');
    }
    closeExportModal();
  } catch (err) {
    console.error('Error al descargar exportación:', err);
    alert('No se pudo descargar la exportación. Intenta nuevamente.');
  }
}
