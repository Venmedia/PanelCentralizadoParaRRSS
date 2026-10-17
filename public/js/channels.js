/* =========================================================================
   MÓDULO 9: LOGIN DE REDES SOCIALES, BÓVEDA SEGURA Y RECIPES FERDIUM (public/js/channels.js)
   ========================================================================= */

let channelsVaultState = null;

const PLATFORM_UI_META = {
  instagram: {
    label: 'Instagram Oficial',
    icon: 'fa-brands fa-instagram text-pink-400',
    btnClass: 'bg-pink-600 hover:bg-pink-500 text-white'
  },
  tiktok: {
    label: 'TikTok Oficial',
    icon: 'fa-brands fa-tiktok text-cyan-400',
    btnClass: 'bg-cyan-600 hover:bg-cyan-500 text-white'
  },
  facebook: {
    label: 'Facebook Messenger',
    icon: 'fa-brands fa-facebook-messenger text-blue-400',
    btnClass: 'bg-blue-600 hover:bg-blue-500 text-white'
  },
  whatsapp: {
    label: 'WhatsApp',
    icon: 'fa-brands fa-whatsapp text-emerald-400',
    btnClass: 'bg-emerald-600 hover:bg-emerald-500 text-white'
  }
};

function getAuthHeadersForChannels() {
  const headers = { 'Content-Type': 'application/json' };
  if (typeof authToken === 'string' && authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (typeof csrfToken === 'string' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  return headers;
}

async function loadChannelsVaultStatus() {
  if (!authenticatedUser) return;
  try {
    const res = await fetch('/api/channels/auth-state', {
      headers: getAuthHeadersForChannels()
    });
    if (!res.ok) return;
    const data = await res.json();
    channelsVaultState = data;
    renderChannelsVaultUI(data);
    if (typeof renderFerdiumServiceDock === 'function') {
      renderFerdiumServiceDock();
    }
  } catch (e) {
    console.error('[Channels] Error consultando estado de canales:', e);
  }
}

const loadChannelsAuthState = loadChannelsVaultStatus;

function syncHiddenCompanyInputs(channels) {
  if (!channels) return;
  const map = {
    ig_agro: 'c_agro_ig',
    tk_agro: 'c_agro_tk',
    fb_agro: 'c_agro_fb',
    wa_agro: 'c_agro_wa',
    ig_tracto: 'c_tracto_ig',
    tk_tracto: 'c_tracto_tk',
    fb_tracto: 'c_tracto_fb',
    wa_tracto: 'c_tracto_wa'
  };
  Object.entries(map).forEach(([chKey, inputId]) => {
    const el = document.getElementById(inputId);
    if (el && channels[chKey]?.accountHandle) {
      el.value = channels[chKey].accountHandle;
    }
  });
}

function buildChannelVaultCardHTML(ch) {
  const ui = PLATFORM_UI_META[ch.platform] || PLATFORM_UI_META.whatsapp;
  const isOAuth = ch.authType === 'oauth2';
  const connected = Boolean(ch.connected);
  const hibernated = Boolean(ch.hibernated);
  const channelKey = ch.key;

  // Mostrar cuenta logueada si ya inició sesión, o la cuenta oficial de referencia para Instagram y TikTok
  let accountSubtitle = '';
  if (connected && ch.loggedAccount) {
    accountSubtitle =
      ch.platform === 'instagram' || ch.platform === 'tiktok'
        ? '@' + String(ch.loggedAccount).replace(/^@/, '')
        : ch.loggedAccount;
  } else if (ch.platform === 'instagram' || ch.platform === 'tiktok') {
    accountSubtitle = '@' + String(ch.defaultReferenceAccount || '').replace(/^@/, '');
  } else {
    accountSubtitle = ch.defaultReferenceAccount || 'Sin cuenta vinculada';
  }

  let statusBadge = '';
  if (connected && hibernated) {
    statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700 flex items-center gap-1.5">
      <i class="fa-solid fa-moon text-[9px]"></i>
      Hibernado
    </span>`;
  } else if (connected) {
    const isQr = ch.platform === 'tiktok' || ch.authType === 'qr';
    statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1.5">
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
      ${isQr ? '🟢 Conectado por QR' : 'Sesión Activa'}
    </span>`;
  } else {
    statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-900 text-slate-400 border border-slate-700 flex items-center gap-1.5">
      <span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
      Sin iniciar sesión
    </span>`;
  }

  const tokenInfoRow =
    connected && ch.credentialHash
      ? `<div class="flex items-center justify-between text-[10px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 font-mono text-slate-400">
           <span class="truncate" title="${ch.credentialHash}">🔒 Token: <strong class="text-emerald-400">${ch.credentialHash.slice(0, 22)}...</strong></span>
           <span class="text-[9px] text-slate-500 shrink-0 ml-2">${ch.partition || ''}</span>
         </div>`
      : '';

  return `
    <div class="bg-slate-900/95 border ${connected ? (hibernated ? 'border-amber-700/60' : 'border-emerald-700/60') : 'border-slate-800'} rounded-xl p-3.5 space-y-2.5 transition hover:border-slate-700">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-base shrink-0">
            <i class="${ui.icon}"></i>
          </div>
          <div class="min-w-0">
            <div class="font-bold text-white text-xs truncate">
              ${ch.name || ui.label}
            </div>
            <div class="text-[11px] font-mono ${connected ? 'text-emerald-300 font-bold' : 'text-slate-400'} truncate">
              ${accountSubtitle}
            </div>
          </div>
        </div>

        <div class="shrink-0">
          ${statusBadge}
        </div>
      </div>

      ${tokenInfoRow}

      <div class="flex flex-wrap items-center justify-end gap-1.5 pt-1">
        ${
          ch.platform === 'tiktok'
            ? `<button
                 type="button"
                 onclick="openTikTokWindow('${channelKey}')"
                 class="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-cyan-950/90 hover:bg-cyan-800 text-cyan-200 border border-cyan-700/60 flex items-center gap-1 transition"
                 title="Abrir Bandeja Oficial de TikTok Messages en ventana aislada"
               >
                 <i class="fa-brands fa-tiktok text-[10px]"></i>
                 <span>Bandeja TikTok</span>
               </button>`
            : (connected && ch.serviceURL
                ? `<button
                     type="button"
                     onclick="openFerdiumServiceWindow('${channelKey}')"
                     class="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-indigo-950/90 hover:bg-indigo-800 text-indigo-200 border border-indigo-700/60 flex items-center gap-1 transition"
                     title="Abrir bandeja directa de ${ch.name} en ventana aislada estilo Ferdium"
                   >
                     <i class="fa-solid fa-up-right-from-square text-[9px]"></i>
                     <span>Abrir App</span>
                   </button>`
                : '')
        }
        ${
          connected && ch.platform !== 'tiktok'
            ? `<button
                 type="button"
                 onclick="toggleChannelHibernationUI('${channelKey}')"
                 class="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 flex items-center gap-1 transition"
                 title="${hibernated ? 'Reactivar servicio' : 'Hibernar servicio (Modo Ferdium)'}"
               >
                 <i class="fa-solid ${hibernated ? 'fa-sun' : 'fa-moon'} text-[9px]"></i>
                 <span>${hibernated ? 'Despertar' : 'Hibernar'}</span>
               </button>`
            : ''
        }
        <button
          type="button"
          onclick="openChannelAuthModal('${channelKey}')"
          class="px-3 py-1.5 rounded-lg text-[11px] font-extrabold ${
            connected
              ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
              : `${ui.btnClass} shadow`
          } flex items-center gap-1.5 transition"
        >
          <i class="fa-solid ${ch.platform === 'tiktok' ? 'fa-qrcode' : (isOAuth ? 'fa-right-to-bracket' : 'fa-plug')}"></i>
          <span>${connected ? (ch.platform === 'tiktok' ? 'Reconectar QR' : 'Cambiar Cuenta') : (ch.platform === 'tiktok' ? 'Vincular por QR' : 'Iniciar Sesión')}</span>
        </button>
        ${
          connected
            ? `<button
                 type="button"
                 onclick="disconnectChannelSession('${channelKey}')"
                 class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-rose-950/80 hover:bg-rose-800 text-rose-300 border border-rose-800/60 transition"
                 title="Cerrar sesión"
               >
                 <i class="fa-solid fa-power-off"></i>
               </button>`
            : ''
        }
      </div>
    </div>
  `;
}

function renderChannelsVaultUI(data) {
  if (!data || !data.channels) return;
  channelsVaultState = data;
  syncHiddenCompanyInputs(data.channels);

  const agroKeys = ['ig_agro', 'tk_agro', 'fb_agro', 'wa_agro'];
  const tractoKeys = ['ig_tracto', 'tk_tracto', 'fb_tracto', 'wa_tracto'];

  const agroContainer = document.getElementById('agroChannelsVaultContainer');
  if (agroContainer) {
    agroContainer.innerHTML = agroKeys
      .map(k => data.channels[k])
      .filter(Boolean)
      .map(buildChannelVaultCardHTML)
      .join('');
  }

  const tractoContainer = document.getElementById('tractoChannelsVaultContainer');
  if (tractoContainer) {
    tractoContainer.innerHTML = tractoKeys
      .map(k => data.channels[k])
      .filter(Boolean)
      .map(buildChannelVaultCardHTML)
      .join('');
  }

  const agroCount = agroKeys.filter(k => data.channels[k]?.connected).length;
  const tractoCount = tractoKeys.filter(k => data.channels[k]?.connected).length;

  const agroBadge = document.getElementById('agroConnectedCountBadge');
  if (agroBadge) agroBadge.textContent = `${agroCount}/4 Conectados`;

  const tractoBadge = document.getElementById('tractoConnectedCountBadge');
  if (tractoBadge) tractoBadge.textContent = `${tractoCount}/4 Conectados`;

  if (typeof renderFerdiumServiceDock === 'function') {
    renderFerdiumServiceDock();
  }
}

const renderChannelsVaultCards = renderChannelsVaultUI;

function showModalFeedback(message, type = 'info') {
  const fb = document.getElementById('modalChannelFeedback');
  if (!fb) return;
  fb.classList.remove('hidden');
  if (type === 'error') {
    fb.className =
      'text-[11px] font-semibold p-2.5 rounded-xl text-center bg-rose-950 text-rose-200 border border-rose-700';
  } else if (type === 'success') {
    fb.className =
      'text-[11px] font-semibold p-2.5 rounded-xl text-center bg-emerald-950 text-emerald-200 border border-emerald-700';
  } else {
    fb.className =
      'text-[11px] font-semibold p-2.5 rounded-xl text-center bg-blue-950 text-blue-200 border border-blue-700';
  }
  fb.textContent = message;
}

/**
 * Abre el modal completamente limpio y vacío esperando usuario y contraseña de la red social
 */
function openChannelAuthModal(channelKey) {
  if (!channelsVaultState || !channelsVaultState.channels?.[channelKey]) return;
  const ch = channelsVaultState.channels[channelKey];
  const ui = PLATFORM_UI_META[ch.platform] || PLATFORM_UI_META.whatsapp;
  const isTikTok = ch.platform === 'tiktok';
  const isOAuth = ch.authType === 'oauth2' && !isTikTok;

  document.getElementById('modalChannelKey').value = ch.key;
  document.getElementById('modalAuthMethod').value = ch.authType;

  const iconEl = document.getElementById('modalChannelIcon');
  if (iconEl) iconEl.className = ui.icon;

  document.getElementById('modalChannelTitle').textContent = isTikTok
    ? `Vincular TikTok • ${ch.name} (${ch.company})`
    : `Iniciar Sesión • ${ch.name} (${ch.company})`;
  document.getElementById('modalChannelSubtitle').textContent = isTikTok
    ? 'Escanea el código QR oficial de TikTok desde tu móvil (Método A)'
    : (isOAuth
        ? 'Ingresa el usuario y la contraseña de la cuenta que deseas vincular'
        : 'Configura la conexión de WhatsApp (Baileys / Evolution API)');

  const oauthFields = document.getElementById('modalOAuthFields');
  const waFields = document.getElementById('modalWhatsAppFields');
  const tkFields = document.getElementById('modalTikTokFields');
  const btnSubmit = document.getElementById('btnSubmitChannelAuth');
  const fb = document.getElementById('modalChannelFeedback');
  if (fb) fb.classList.add('hidden');

  if (isTikTok) {
    oauthFields?.classList.add('hidden');
    waFields?.classList.add('hidden');
    tkFields?.classList.remove('hidden');
    if (btnSubmit) btnSubmit.classList.add('hidden');

    const accNameEl = document.getElementById('modalTkAccountName');
    if (accNameEl) {
      accNameEl.textContent = `@${String(ch.loggedAccount || ch.defaultReferenceAccount || '').replace(/^@/, '')}`;
    }

    // Solicitar código QR oficial generado por Playwright en el backend
    requestTikTokQrCode(ch.key);
  } else if (isOAuth) {
    oauthFields?.classList.remove('hidden');
    waFields?.classList.add('hidden');
    tkFields?.classList.add('hidden');
    if (btnSubmit) btnSubmit.classList.remove('hidden');

    // Campos 100% vacíos esperando que el usuario ingrese cualquier cuenta y contraseña
    const userInp = document.getElementById('modalLoginUsername');
    const passInp = document.getElementById('modalLoginPassword');
    const popupCheck = document.getElementById('modalLaunchFerdiumPopup');
    if (userInp) userInp.value = '';
    if (passInp) passInp.value = '';
    if (popupCheck) popupCheck.checked = false;
    setTimeout(() => userInp?.focus(), 80);
  } else {
    oauthFields?.classList.add('hidden');
    waFields?.classList.remove('hidden');
    tkFields?.classList.add('hidden');
    if (btnSubmit) btnSubmit.classList.remove('hidden');

    const modeSelect = document.getElementById('modalWaConnectionMode');
    if (modeSelect) modeSelect.value = ch.connectionMode || 'baileys_direct';
    document.getElementById('modalWaEvolutionUrl').value = ch.evolutionUrl || 'http://localhost:8080';
    document.getElementById('modalWaInstanceName').value = ch.instanceName || '';
    document.getElementById('modalWaApiKey').value = '';
  }

  document.getElementById('channelAuthModal')?.classList.remove('hidden');
}

function closeChannelAuthModal() {
  document.getElementById('channelAuthModal')?.classList.add('hidden');
}

/**
 * Abre la ventana aislada de la red social apuntando al `serviceURL` de la Recipe de Ferdium
 */
function openFerdiumServiceWindow(channelKey) {
  const ch = channelsVaultState?.channels?.[channelKey];
  if (!ch) return;
  const targetUrl = ch.serviceURL || ch.loginUrl || 'https://www.instagram.com/direct/inbox/';
  const width = 1020;
  const height = 720;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2));

  window.open(
    targetUrl,
    `ferdium_${ch.partition || channelKey}`,
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no`
  );
}

/**
 * Hiberna o despierta un canal logueado (Modo Ferdium Service Hibernation)
 */
async function toggleChannelHibernationUI(channelKey) {
  try {
    const res = await fetch('/api/channels/toggle-hibernation', {
      method: 'POST',
      headers: getAuthHeadersForChannels(),
      body: JSON.stringify({ channelKey })
    });
    if (res.ok) {
      await loadChannelsVaultStatus();
    }
  } catch (e) {
    console.error('Error alternando hibernación del canal:', e);
  }
}

/**
 * Envía el usuario y contraseña al servidor para generar el token y guardarlo cifrado en la bóveda
 */
async function submitChannelAuthModal(event) {
  if (event) event.preventDefault();
  const channelKey = document.getElementById('modalChannelKey')?.value;
  const authMethod = document.getElementById('modalAuthMethod')?.value;
  const launchPopup = Boolean(document.getElementById('modalLaunchFerdiumPopup')?.checked);

  try {
    let res;
    if (authMethod === 'oauth2') {
      const username = document.getElementById('modalLoginUsername')?.value.trim();
      const password = document.getElementById('modalLoginPassword')?.value || '';

      if (!username || !password) {
        showModalFeedback('⚠️ Ingresa el usuario y la contraseña de la red social.', 'error');
        return;
      }

      showModalFeedback('🔐 Iniciando sesión y guardando token en la bóveda segura...', 'info');

      res = await fetch('/api/channels/connect-oauth', {
        method: 'POST',
        headers: getAuthHeadersForChannels(),
        body: JSON.stringify({
          channelKey,
          username,
          password
        })
      });
    } else {
      const connectionMode = document.getElementById('modalWaConnectionMode')?.value || 'baileys_direct';
      const evolutionUrl = document.getElementById('modalWaEvolutionUrl')?.value.trim();
      const instanceName = document.getElementById('modalWaInstanceName')?.value.trim();
      const evolutionApiKey = document.getElementById('modalWaApiKey')?.value.trim();

      showModalFeedback('🔐 Guardando configuración de WhatsApp...', 'info');

      res = await fetch('/api/channels/connect-whatsapp', {
        method: 'POST',
        headers: getAuthHeadersForChannels(),
        body: JSON.stringify({
          channelKey,
          connectionMode,
          evolutionUrl,
          instanceName,
          evolutionApiKey
        })
      });
    }

    const data = await res.json();
    if (!res.ok || !data.success) {
      showModalFeedback(`❌ ${data.error || 'No se pudo iniciar sesión.'}`, 'error');
      return;
    }

    await loadChannelsVaultStatus();
    showModalFeedback(`✅ ${data.message}`, 'success');

    if (launchPopup && authMethod === 'oauth2') {
      openFerdiumServiceWindow(channelKey);
    }

    setTimeout(() => {
      closeChannelAuthModal();
    }, 900);
  } catch (err) {
    showModalFeedback('❌ Error de conexión con el servidor.', 'error');
  }
}

async function disconnectChannelSession(channelKey) {
  const ch = channelsVaultState?.channels?.[channelKey];
  if (!ch) return;
  if (!confirm(`¿Deseas cerrar la sesión de ${ch.name} (${ch.company})?`)) {
    return;
  }

  try {
    const res = await fetch('/api/channels/disconnect', {
      method: 'POST',
      headers: getAuthHeadersForChannels(),
      body: JSON.stringify({ channelKey })
    });
    if (res.ok) {
      await loadChannelsVaultStatus();
      if (typeof renderFerdiumServiceDock === 'function') renderFerdiumServiceDock();
      if (typeof updateTikTokStatusBar === 'function') updateTikTokStatusBar();
    }
  } catch (e) {
    console.error('Error al desconectar canal:', e);
  }
}

/**
 * Solicita al backend el código QR oficial de TikTok generado por Playwright en segundo plano
 */
async function requestTikTokQrCode(forcedKey) {
  const channelKey = forcedKey || document.getElementById('modalChannelKey')?.value || 'tk_agro';
  const qrLoading = document.getElementById('modalTikTokQrLoading');
  const qrImage = document.getElementById('modalTikTokQrImage');
  const qrStatus = document.getElementById('modalTikTokQrStatus');

  if (qrLoading) {
    qrLoading.classList.remove('hidden');
    qrLoading.innerHTML = `
      <i class="fa-solid fa-spinner fa-spin text-2xl text-cyan-600"></i>
      <span class="text-xs font-bold">Generando código QR oficial en el servidor...</span>
      <span class="text-[10px] text-slate-500">Iniciando instancia headless de TikTok (${channelKey})</span>
    `;
  }
  if (qrImage) qrImage.classList.add('hidden');
  if (qrStatus) qrStatus.classList.add('hidden');

  showModalFeedback('🔄 Iniciando instancia Chromium y generando código QR oficial de TikTok...', 'info');

  try {
    const res = await fetch('/api/channels/tiktok/request-qr', {
      method: 'POST',
      headers: getAuthHeadersForChannels(),
      body: JSON.stringify({ channelKey })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showModalFeedback(`❌ ${data.error || 'No se pudo generar el código QR.'}`, 'error');
      if (qrLoading) {
        qrLoading.innerHTML = `<span class="text-xs text-rose-500 font-bold">Error generando QR: ${data.error || 'Reintenta en un momento'}</span>`;
      }
      return;
    }

    if (data.status === 'already_connected') {
      showModalFeedback('✅ La cuenta ya tiene sesión activa en el servidor.', 'success');
      await loadChannelsVaultStatus();
      setTimeout(closeChannelAuthModal, 1200);
      return;
    }

    if (data.qrBase64) {
      if (qrImage) {
        qrImage.src = data.qrBase64;
        qrImage.classList.remove('hidden');
      }
      if (qrLoading) qrLoading.classList.add('hidden');
      if (qrStatus) qrStatus.classList.remove('hidden');
      showModalFeedback('📸 Código QR oficial generado. Escanéalo desde tu app de TikTok.', 'info');
    }
  } catch (err) {
    showModalFeedback('❌ Error de conexión al generar código QR en el servidor.', 'error');
  }
}

/**
 * Abre la ventana emergente oficial de TikTok para iniciar sesión escaneando el código QR (Método A)
 */
function openTikTokLoginPopup() {
  const channelKey = document.getElementById('modalChannelKey')?.value || 'tk_agro';
  const ch = channelsVaultState?.channels?.[channelKey];
  const targetUrl = ch?.loginUrl || 'https://www.tiktok.com/login';
  const width = 1050;
  const height = 750;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2));

  window.open(
    targetUrl,
    `tiktok_login_${channelKey}`,
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no`
  );
}

/**
 * Confirma que el usuario escaneó el QR en la app móvil y activa el canal en la bóveda
 */
async function confirmTikTokQrLinked() {
  const channelKey = document.getElementById('modalChannelKey')?.value || 'tk_agro';
  const ch = channelsVaultState?.channels?.[channelKey];
  const accountHandle = ch?.defaultReferenceAccount || ch?.loggedAccount || (channelKey === 'tk_agro' ? '@agropower_venezuela' : '@tractopowervenezuela');

  showModalFeedback('🔐 Verificando y activando canal TikTok en el panel...', 'info');

  try {
    const res = await fetch('/api/channels/connect-qr', {
      method: 'POST',
      headers: getAuthHeadersForChannels(),
      body: JSON.stringify({
        channelKey,
        accountHandle
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showModalFeedback(`❌ ${data.error || 'No se pudo activar el canal.'}`, 'error');
      return;
    }

    await loadChannelsVaultStatus();
    showModalFeedback(`✅ ${data.message || 'TikTok enlazado con éxito por QR.'}`, 'success');

    if (typeof renderFerdiumServiceDock === 'function') renderFerdiumServiceDock();
    if (typeof updateTikTokStatusBar === 'function') updateTikTokStatusBar();

    setTimeout(() => {
      closeChannelAuthModal();
    }, 1200);
  } catch (err) {
    showModalFeedback('❌ Error de comunicación con el servidor.', 'error');
  }
}

/**
 * Permite cambiar opcionalmente a login clásico de usuario/contraseña si el usuario lo desea
 */
function toggleClassicOAuthInModal() {
  const tkFields = document.getElementById('modalTikTokFields');
  const oauthFields = document.getElementById('modalOAuthFields');
  const btnSubmit = document.getElementById('btnSubmitChannelAuth');
  if (tkFields && oauthFields) {
    tkFields.classList.add('hidden');
    oauthFields.classList.remove('hidden');
    if (btnSubmit) btnSubmit.classList.remove('hidden');
    document.getElementById('modalAuthMethod').value = 'oauth2';
  }
}

