/* =========================================================================
   MÓDULO 8: ARRANQUE DE APLICACIÓN Y EVENTOS SOCKET.IO (public/js/main.js)
   ========================================================================= */

function registerSocketListeners() {
  if (!socket) return;

  socket.on('whatsapp_status_update', data => {
    if (authenticatedUser) updateWhatsAppUI(data);
  });

  socket.on('whatsapp_status_tracto', data => {
    if (authenticatedUser) updateWhatsAppUI({ tracto: data });
  });

  socket.on('whatsapp_status_agro', data => {
    if (authenticatedUser) updateWhatsAppUI({ agro: data });
  });

  socket.on('conversations_updated', updated => {
    if (!authenticatedUser) return;
    conversations = updated;
    renderChatList();
    const active = conversations.find(c => c.id === activeChatId);
    if (active) {
      renderMessages(active);
      if (typeof updateBotHeaderUI === 'function') updateBotHeaderUI(active);
      if (typeof updateWaitingAdvisorHeaderUI === 'function') updateWaitingAdvisorHeaderUI(active);
      if (typeof updateSaleButtonUI === 'function') updateSaleButtonUI(active);
    }
  });

  socket.on('users_updated', updatedUsers => {
    if (!authenticatedUser || !authenticatedUser.isAdmin) return;
    usersList = updatedUsers;
    renderSettingsUsersTable();
  });

  socket.on('analytics_updated', () => {
    if (authenticatedUser && authenticatedUser.isAdmin) {
      loadAnalyticsSummary();
    }
  });

  socket.on('config_updated', updatedConfig => {
    if (authenticatedUser) {
      applyConfigToUI(updatedConfig);
    }
  });

  socket.on('channels_auth_updated', updatedVault => {
    if (!authenticatedUser) return;
    channelsVaultState = updatedVault;
    if (authenticatedUser.isAdmin && typeof renderChannelsVaultUI === 'function') {
      renderChannelsVaultUI(updatedVault);
    }
    if (typeof renderFerdiumServiceDock === 'function') {
      renderFerdiumServiceDock();
    }
  });

  // Listeners de Meta Graph API (Instagram DMs + Facebook Messenger)
  socket.on('meta_message_received', data => {
    if (!authenticatedUser) return;
    console.log(`[Meta] 📩 Mensaje ${data.platform} de ${data.message?.senderName || 'desconocido'}`);
    if (typeof mergeMetaConversation === 'function') {
      mergeMetaConversation(data.conversation);
    }
  });

  socket.on('meta_conversations_updated', metaConvs => {
    if (!authenticatedUser) return;
    if (typeof mergeAllMetaConversations === 'function') {
      mergeAllMetaConversations(metaConvs);
    }
  });

  // Listeners de TikTok Headless Browser Bridge (Playwright)
  socket.on('tiktok_status_update', data => {
    if (!authenticatedUser) return;
    console.log(`[TikTok] 🎵 Estado actualizado para ${data.channelKey}:`, data.status);
    const qrLoading = document.getElementById('modalTikTokQrLoading');
    const qrImage = document.getElementById('modalTikTokQrImage');
    const qrStatus = document.getElementById('modalTikTokQrStatus');

    if (data.status === 'qr_ready' && data.qrBase64) {
      if (qrImage) {
        qrImage.src = data.qrBase64;
        qrImage.classList.remove('hidden');
      }
      if (qrLoading) qrLoading.classList.add('hidden');
      if (qrStatus) qrStatus.classList.remove('hidden');
      if (typeof showModalFeedback === 'function') {
        showModalFeedback('📸 Código QR oficial de TikTok listo. Escanéalo desde tu móvil.', 'info');
      }
    } else if (data.status === 'connected') {
      if (typeof showModalFeedback === 'function') {
        showModalFeedback('✅ ¡TikTok conectado exitosamente por QR!', 'success');
      }
      if (typeof loadChannelsVaultStatus === 'function') {
        loadChannelsVaultStatus();
      }
      setTimeout(() => {
        if (typeof closeChannelAuthModal === 'function') closeChannelAuthModal();
      }, 1500);
    }
    if (typeof updateTikTokStatusBar === 'function') {
      updateTikTokStatusBar();
    }
  });

  socket.on('tiktok_message_received', data => {
    if (!authenticatedUser) return;
    console.log(`[TikTok] 📩 Mensaje recibido en ${data.channelKey}:`, data.message?.text);
  });
}

async function bootstrapOmniPanel() {
  // 0. Inicializar motor de reconocimiento y adaptación de dispositivo
  if (typeof OmniDevice !== 'undefined' && OmniDevice.init) {
    OmniDevice.init();
  }

  // 1. Montar todos los bloques HTML modulares en el DOM
  if (typeof loadModularSections === 'function') {
    await loadModularSections();
  }

  // Actualizar layout y badge de dispositivo tras montar los módulos HTML
  if (typeof OmniDevice !== 'undefined' && OmniDevice.detect) {
    OmniDevice.detect();
  }

  // 2. Activar escuchadores Socket.io en tiempo real
  registerSocketListeners();

  // 3. Verificar sesión autenticada (si no hay sesión activa, muestra Login)
  await initAuthSession();

  // 4. Iniciar intervalos de monitoreo
  setInterval(() => {
    if (authenticatedUser) checkWhatsAppStatus();
  }, 4000);

  setInterval(() => {
    if (authenticatedUser && authenticatedUser.isAdmin) previewScheduleState();
  }, 15000);
}

/**
 * Sincronización manual de conversaciones WhatsApp.
 * Recarga la lista de conversaciones desde el servidor.
 * Para eliminar conversaciones obsoletas, usar el botón X en cada conversación.
 */
async function syncWhatsAppChats() {
  const btn = document.getElementById('btnSyncWA');
  const icon = btn ? btn.querySelector('i') : null;

  if (btn) btn.disabled = true;
  if (icon) {
    icon.classList.remove('fa-rotate');
    icon.classList.add('fa-spinner', 'fa-spin');
  }

  try {
    // Recargar conversaciones desde el servidor
    const res = await fetch('/api/conversations');
    if (!res.ok) throw new Error('Error al cargar conversaciones');
    conversations = await res.json();

    // También recargar Meta si está disponible
    if (typeof loadMetaConversationsIntoInbox === 'function') {
      await loadMetaConversationsIntoInbox();
    }

    renderChatList();

    const active = conversations.find(c => c.id === activeChatId);
    if (active) {
      renderMessages(active);
    }

    showSyncToast(`✅ Actualizado. ${conversations.length} conversación(es) en el panel.\n💡 Usa el botón ✕ en cada chat para eliminarlo.`, 'emerald');
  } catch (e) {
    showSyncToast('❌ Error al recargar conversaciones', 'rose');
  } finally {
    if (btn) btn.disabled = false;
    if (icon) {
      icon.classList.remove('fa-spinner', 'fa-spin');
      icon.classList.add('fa-rotate');
    }
  }
}

function showSyncToast(message, color) {
  const existing = document.getElementById('syncToast');
  if (existing) existing.remove();

  const colorMap = {
    emerald: 'bg-emerald-900/95 border-emerald-600 text-emerald-200',
    amber: 'bg-amber-900/95 border-amber-600 text-amber-200',
    cyan: 'bg-cyan-900/95 border-cyan-600 text-cyan-200',
    rose: 'bg-rose-900/95 border-rose-600 text-rose-200'
  };

  const toast = document.createElement('div');
  toast.id = 'syncToast';
  toast.className = `fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl border shadow-2xl text-xs font-semibold max-w-xs whitespace-pre-line transition-all ${colorMap[color] || colorMap.emerald}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

bootstrapOmniPanel();
