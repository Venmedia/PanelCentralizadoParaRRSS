/* =========================================================================
   MÓDULO 4: BANDEJA OMNICANAL, CHAT ACTIVO, BOT Y VENTAS (public/js/inbox.js)
   ========================================================================= */

async function loadInitialData() {
  try {
    const res = await fetch('/api/conversations');
    conversations = await res.json();

    // Cargar conversaciones de Meta (Instagram DMs + Facebook Messenger)
    await loadMetaConversationsIntoInbox();

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
    conversations.unshift(metaConv);
  }
  renderChatList();
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
  renderChatList();
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

function renderChatList() {
  const container = document.getElementById('chatListContainer');
  const search = document.getElementById('searchInput').value.toLowerCase();
  container.innerHTML = '';

  conversations.forEach(c => {
    const meta = channelMeta[c.channel] || channelMeta['wa_agro'];
    const displayPhone = getDisplayPhoneForChat(c);

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

    const item = document.createElement('div');
    item.className = `relative group transition cursor-pointer ${isSelected ? 'bg-slate-800/90 border-l-4 border-blue-500' : 'hover:bg-slate-800/40'}`;
    item.onclick = (e) => {
      if (e.target.closest('button')) return;
      selectConversation(c.id);
    };

    // Botón de eliminar (solo admin, aparece al hover)
    const deleteBtn = isAdmin ? `
      <button
        onclick="event.stopPropagation(); deleteConversation('${c.id}', '${(c.name || '').replace(/'/g, '\\\'')}')"
        class="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-full bg-rose-900/80 hover:bg-rose-600 border border-rose-700 flex items-center justify-center text-[9px] text-rose-300 hover:text-white"
        title="Eliminar conversación del panel">
        <i class="fa-solid fa-xmark"></i>
      </button>` : '';

    const innerContent = `
      <div class="p-2.5 flex items-start space-x-2.5">
        <div class="relative shrink-0">
          <div class="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-[10px] text-slate-200">
            ${c.initials || 'WA'}
          </div>
          <span class="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-slate-950 flex items-center justify-center text-[9px]">
            <i class="fa-brands ${meta.icon}"></i>
          </span>
        </div>
        <div class="flex-1 min-w-0 pr-4">
          <div class="flex justify-between items-baseline gap-1">
            <span class="font-bold text-[11px] text-white truncate">${c.name}</span>
            <span class="text-[9px] text-slate-400 shrink-0">${c.time || ''}</span>
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
                       <span>@${c.name}</span>
                     </div>`
                  : '')
          }
          <div class="text-[10px] text-slate-400 truncate mt-0.5">${lastMsg ? lastMsg.text.replace(/\n/g, ' ') : ''}</div>
          <div class="flex items-center gap-1 mt-1 flex-wrap">
            <span class="text-[8px] px-1.5 py-0.2 rounded border ${meta.companyBadgeClass} font-bold">${meta.companyName}</span>
            <span class="text-[8px] px-1.5 py-0.2 rounded border ${meta.badgeClass} font-semibold">${meta.label}</span>
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
  const c = conversations.find(x => String(x.id) === String(id));
  if (!c) return;

  const meta = channelMeta[c.channel] || channelMeta['wa_agro'];
  const displayPhone = getDisplayPhoneForChat(c);
  document.getElementById('activeAvatar').innerText = c.initials || 'WA';
  document.getElementById('activeName').innerText = c.name;

  const phoneBadge = document.getElementById('activePhoneBadge');
  if (phoneBadge) {
    if (displayPhone) {
      phoneBadge.classList.remove('hidden');
      phoneBadge.innerText = `📱 ${displayPhone}`;
      phoneBadge.className = 'text-[10px] font-mono px-2 py-0.2 rounded font-bold bg-slate-800 text-emerald-300 border border-emerald-700/60';
    } else if (c.platform === 'instagram') {
      phoneBadge.classList.remove('hidden');
      phoneBadge.innerText = `📸 @${c.name}`;
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

  updateSaleButtonUI(c);
  updateWaitingAdvisorHeaderUI(c);
  const replySelect = document.getElementById('replyChannelSelect');
  if (replySelect) replySelect.value = c.channel === 'wa1' ? 'wa_agro' : c.channel;
  renderMessages(c);
  renderChatList();

  if (typeof OmniDevice !== 'undefined' && OmniDevice.showChatView) {
    OmniDevice.showChatView();
  }
}

function updateWaitingAdvisorHeaderUI(c) {
  const badge = document.getElementById('activeWaitingAdvisorBadge');
  if (!badge) return;
  if (c && c.waitingAdvisor) {
    badge.classList.remove('hidden');
    badge.classList.add('flex');
  } else {
    badge.classList.add('hidden');
    badge.classList.remove('flex');
  }
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

  if (m.mediaType === 'image' || m.mediaType === 'sticker') {
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

    if (m.sender === 'client') {
      div.className = 'flex flex-col items-start max-w-[82%]';
      div.innerHTML = `
        <span class="text-[9px] text-slate-400 mb-0.5 flex items-center gap-1.5">
          <strong class="text-slate-300">${c.name}</strong>
          ${displayPhone ? `<span class="font-mono text-emerald-400 font-semibold">(${displayPhone})</span>` : ''}
          <span>• ${m.time}</span>
        </span>
        <div class="bg-slate-800 border border-slate-700 text-slate-100 rounded-xl rounded-tl-none p-2.5 text-xs leading-relaxed">
          ${htmlText}
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

      const isScheduled = m.sender === 'scheduled';
      const senderLabel = isScheduled
        ? '⚡ Mensaje Programado'
        : `👤 ${m.operatorName || 'Asesor'}`;
      div.innerHTML = `
        <span class="text-[9px] ${isScheduled ? 'text-emerald-400' : 'text-blue-400'} mb-0.5 flex items-center gap-1">
          <span>${senderLabel} • ${m.time}</span>
        </span>
        <div class="${isScheduled ? 'bg-emerald-950/70 border border-emerald-700/60' : 'bg-blue-600'} text-slate-100 rounded-xl rounded-tr-none p-2.5 text-xs leading-relaxed shadow">
          ${htmlText}
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

  const attachment = key === 'cat_modelos' ? document.getElementById('t_pdf_name').value : null;

  const activeConv = conversations.find(c => String(c.id) === String(activeChatId));
  if (activeConv) {
    activeConv.waitingAdvisor = false;
    activeConv.botActive = false;
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
          text: texts[key]
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
          text: texts[key]
        })
      });
      return;
    } catch (e) {
      console.error('[TikTok] Error enviando respuesta rápida:', e);
      return;
    }
  }

  await fetch('/api/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: activeChatId,
      text: texts[key],
      attachment: attachment,
      userId: currentUserId
    })
  });
}

async function operatorSendMessage() {
  const inp = document.getElementById('operatorInput');
  const val = inp.value.trim();
  if (!val) return;

  const activeConv = conversations.find(c => String(c.id) === String(activeChatId));
  if (activeConv) {
    activeConv.waitingAdvisor = false;
    activeConv.botActive = false;
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
          text: val
        })
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('[Meta] Error enviando mensaje:', data.error);
        alert(`Error enviando mensaje por ${activeConv.platform}: ${data.error}`);
        return;
      }

      // El mensaje se agregará cuando llegue la actualización via socket
      inp.value = '';
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
          text: val
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        console.error('[TikTok] Error enviando mensaje:', data.error);
        alert(`Error enviando mensaje por TikTok: ${data.error || 'No se pudo enviar'}`);
        return;
      }

      inp.value = '';
      return;
    } catch (e) {
      console.error('[TikTok] Error de conexión al enviar mensaje:', e);
      alert('Error de conexión al enviar mensaje por TikTok.');
      return;
    }
  }

  // WhatsApp: flujo existente
  await fetch('/api/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: activeChatId,
      text: val,
      userId: currentUserId
    })
  });

  inp.value = '';
}

async function simulateCustomerClick(actionText) {
  const ch = document.getElementById('simChannel').value;
  const conv = conversations.find(c => String(c.id) === String(activeChatId));
  if (conv) conv.channel = ch;

  await fetch('/api/messages/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: activeChatId,
      channel: ch,
      text: actionText
    })
  });
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


  renderChatList();

  // Mostrar/ocultar barra de acceso rápido TikTok
  if (typeof renderTikTokQuickAccessIfNeeded === 'function') {
    renderTikTokQuickAccessIfNeeded();
  }
}
