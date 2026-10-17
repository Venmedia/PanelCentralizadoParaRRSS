/* =========================================================================
   MÓDULO 3: AUTENTICACIÓN, SESIÓN, RBAC Y NAVEGACIÓN (public/js/auth.js)
   ========================================================================= */

function toggleLoginPasswordVisibility() {
  const inp = document.getElementById('loginPassword');
  const icon = document.getElementById('loginPwdEyeIcon');
  if (!inp || !icon) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    icon.className = 'fa-solid fa-eye-slash text-xs text-blue-400';
  } else {
    inp.type = 'password';
    icon.className = 'fa-solid fa-eye text-xs';
  }
}

function showLoginError(msg, isLocked = false) {
  const box = document.getElementById('loginErrorBox');
  if (!box) return;
  box.classList.remove('hidden');
  box.className = isLocked
    ? 'rounded-xl p-3 text-xs font-bold border bg-rose-950/90 border-rose-600 text-rose-200'
    : 'rounded-xl p-3 text-xs font-semibold border bg-amber-950/90 border-amber-700 text-amber-200';
  box.textContent = msg;
}

function startLockoutCountdown(seconds) {
  if (lockoutTimerInterval) clearInterval(lockoutTimerInterval);
  const btn = document.getElementById('btnLoginSubmit');
  if (btn) btn.disabled = true;
  let remaining = Number(seconds) || 60;

  const tick = () => {
    if (remaining <= 0) {
      clearInterval(lockoutTimerInterval);
      if (btn) btn.disabled = false;
      const box = document.getElementById('loginErrorBox');
      if (box) box.classList.add('hidden');
      return;
    }
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    showLoginError(
      `🔒 Demasiados intentos fallidos (Rate Limit). Acceso bloqueado temporalmente por seguridad: ${m}m ${s}s restantes.`,
      true
    );
    remaining--;
  };
  tick();
  lockoutTimerInterval = setInterval(tick, 1000);
}

async function submitLoginForm(event) {
  if (event) event.preventDefault();
  const userEl = document.getElementById('loginUsername');
  const passEl = document.getElementById('loginPassword');
  const btn = document.getElementById('btnLoginSubmit');
  const btnText = document.getElementById('btnLoginSubmitText');
  const errBox = document.getElementById('loginErrorBox');
  if (errBox) errBox.classList.add('hidden');

  const username = (userEl?.value || '').trim();
  const password = passEl?.value || '';

  if (!username || !password) {
    showLoginError('⚠️ Por favor ingresa tu nombre de usuario y contraseña.');
    return;
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    showLoginError('🛡️ Caracteres no permitidos detectados en el nombre de usuario.');
    return;
  }

  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Verificando credenciales...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.status === 429 || data.locked) {
      if (btnText) btnText.textContent = 'Iniciar Sesión en el Panel';
      startLockoutCountdown(data.retryAfterSeconds || 900);
      return;
    }

    if (!res.ok || !data.success) {
      if (btn) btn.disabled = false;
      if (btnText) btnText.textContent = 'Iniciar Sesión en el Panel';
      showLoginError(`❌ ${data.error || 'Usuario o contraseña incorrectos.'}`);
      return;
    }

    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Iniciar Sesión en el Panel';
    if (passEl) passEl.value = '';

    onAuthenticatedSuccess(data.user, data.token, data.csrfToken);
  } catch (err) {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Iniciar Sesión en el Panel';
    showLoginError('❌ Error de conexión con el servidor.');
  }
}

function showLoginScreen() {
  authenticatedUser = null;
  authToken = '';
  csrfToken = '';
  sessionStorage.removeItem('omnipanel_token');
  sessionStorage.removeItem('omnipanel_csrf');
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  document.getElementById('mainHeader')?.classList.add('hidden');
  document.getElementById('viewInbox')?.classList.add('hidden');
  document.getElementById('viewStats')?.classList.add('hidden');
  document.getElementById('viewSettings')?.classList.add('hidden');
  document.getElementById('loginScreenOverlay')?.classList.remove('hidden');
}

async function logoutUser() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}
  showLoginScreen();
}

function updateHeaderSessionBanner() {
  if (!authenticatedUser) return;
  const isAdmin = Boolean(
    authenticatedUser.isAdmin ||
      authenticatedUser.role === 'admin' ||
      String(authenticatedUser.username).toLowerCase() === 'admin'
  );
  const nameEl = document.getElementById('headerAuthUserName');
  const statusEl = document.getElementById('headerAuthStatsStatus');
  const roleIcon = document.getElementById('activeUserRoleIcon');

  if (roleIcon) {
    roleIcon.className = isAdmin
      ? 'fa-solid fa-user-shield text-amber-400 text-xs'
      : 'fa-solid fa-headset text-emerald-400 text-xs';
  }

  if (nameEl) {
    nameEl.textContent = `${isAdmin ? '👑' : '🧑‍💼'} ${authenticatedUser.firstName} ${authenticatedUser.lastName} (@${authenticatedUser.username})`;
  }

  if (statusEl) {
    if (isAdmin) {
      statusEl.className = 'text-[9px] text-amber-300 font-semibold';
      statusEl.textContent = '🛡️ Modo Admin (Exento de estadísticas)';
    } else {
      const elapsedSec = Math.max(
        0,
        Math.floor((Date.now() - (authenticatedUser.loginTimestamp || Date.now())) / 1000)
      );
      const hrs = Math.floor(elapsedSec / 3600);
      const mins = Math.floor((elapsedSec % 3600) / 60);
      const secs = elapsedSec % 60;
      const timeStr =
        hrs > 0
          ? `${hrs}h ${String(mins).padStart(2, '0')}m`
          : `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
      statusEl.className = 'text-[9px] text-emerald-400 font-semibold';
      statusEl.textContent = `🟢 Registrando Estadísticas • ⏱️ ${timeStr}`;
    }
  }
}

function applyRolePermissions() {
  const isAdmin = Boolean(
    authenticatedUser &&
      (authenticatedUser.isAdmin ||
        authenticatedUser.role === 'admin' ||
        String(authenticatedUser.username).toLowerCase() === 'admin')
  );
  const navStats = document.getElementById('navStats');
  const navSettings = document.getElementById('navSettings');

  if (isAdmin) {
    if (navStats) navStats.classList.remove('hidden');
    if (navSettings) navSettings.classList.remove('hidden');
    const btnSyncWA = document.getElementById('btnSyncWA');
    if (btnSyncWA) btnSyncWA.classList.remove('hidden');
  } else {
    if (navStats) navStats.classList.add('hidden');
    if (navSettings) navSettings.classList.add('hidden');
    const btnSyncWA = document.getElementById('btnSyncWA');
    if (btnSyncWA) btnSyncWA.classList.add('hidden');
  }
  updateHeaderSessionBanner();
}

async function onAuthenticatedSuccess(user, token, newCsrfToken) {
  authenticatedUser = user;
  currentUserId = user.id;
  if (token) {
    authToken = token;
    sessionStorage.setItem('omnipanel_token', token);
  }
  if (newCsrfToken) {
    csrfToken = newCsrfToken;
    sessionStorage.setItem('omnipanel_csrf', newCsrfToken);
  }

  document.getElementById('loginScreenOverlay')?.classList.add('hidden');
  document.getElementById('mainHeader')?.classList.remove('hidden');

  applyRolePermissions();
  switchView('inbox');

  await loadInitialData();
  if (typeof loadChannelsVaultStatus === 'function') {
    await loadChannelsVaultStatus();
  }
  if (authenticatedUser.isAdmin) {
    await loadUsersList();
    await loadAnalyticsSummary();
    // Cargar configuración de Meta Graph API
    if (typeof loadMetaConfigState === 'function') {
      loadMetaConfigState();
    }
  }
  // Detectar si venimos de un redirect OAuth de Meta
  if (typeof checkMetaOAuthResult === 'function') {
    checkMetaOAuthResult();
  }

  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  sessionTimerInterval = setInterval(updateHeaderSessionBanner, 1000);
  updateHeaderSessionBanner();

  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(async () => {
    if (!authenticatedUser) return;
    try {
      await fetch('/api/auth/heartbeat', { method: 'POST' });
    } catch (e) {}
  }, 45000);
}

async function initAuthSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data && data.authenticated && data.user) {
        await onAuthenticatedSuccess(data.user, authToken, data.csrfToken);
        return;
      }
    }
  } catch (e) {}
  showLoginScreen();
}

function toggleSidebar() {
  const dock = document.getElementById('ferdiumServiceDock');
  const backdrop = document.getElementById('mobileDrawerBackdrop');
  const leftSidebar = document.getElementById('leftSidebar');

  if (typeof OmniDevice !== 'undefined' && (OmniDevice.isMobile || OmniDevice.isTablet)) {
    // En móviles/tablets, abrir el Dock de servicios Ferdium como menú lateral off-canvas
    if (dock) {
      const isOpen = dock.classList.contains('mobile-drawer-open');
      if (isOpen) {
        dock.classList.remove('mobile-drawer-open');
        if (backdrop) backdrop.classList.add('hidden');
      } else {
        const sim = document.getElementById('simulatorPanel');
        if (sim) {
          sim.classList.remove('mobile-drawer-open');
          sim.classList.add('hidden');
        }
        dock.classList.add('mobile-drawer-open');
        if (backdrop) backdrop.classList.remove('hidden');
      }
    }
  } else {
    // En PC de escritorio: toggle clásico de la barra de chats
    if (leftSidebar) leftSidebar.classList.toggle('hidden');
  }
}

function toggleSimulator() {
  const sim = document.getElementById('simulatorPanel');
  const backdrop = document.getElementById('mobileDrawerBackdrop');
  if (!sim) return;

  if (typeof OmniDevice !== 'undefined' && (OmniDevice.isMobile || OmniDevice.isTablet)) {
    const isOpen = sim.classList.contains('mobile-drawer-open');
    if (isOpen) {
      sim.classList.remove('mobile-drawer-open');
      sim.classList.add('hidden');
      if (backdrop) backdrop.classList.add('hidden');
    } else {
      const dock = document.getElementById('ferdiumServiceDock');
      if (dock) dock.classList.remove('mobile-drawer-open');
      sim.classList.remove('hidden');
      sim.classList.add('mobile-drawer-open');
      if (backdrop) backdrop.classList.remove('hidden');
    }
  } else {
    sim.classList.toggle('hidden');
  }
}

function switchView(view) {
  const isAdmin = Boolean(
    authenticatedUser &&
      (authenticatedUser.isAdmin ||
        authenticatedUser.role === 'admin' ||
        String(authenticatedUser.username).toLowerCase() === 'admin')
  );

  if ((view === 'stats' || view === 'settings') && !isAdmin) {
    view = 'inbox';
  }

  // Cerrar cualquier drawer móvil al cambiar de pestaña
  if (typeof OmniDevice !== 'undefined' && OmniDevice.closeMobileDrawers) {
    OmniDevice.closeMobileDrawers();
  }

  document.getElementById('viewInbox').classList.add('hidden');
  document.getElementById('viewStats').classList.add('hidden');
  document.getElementById('viewSettings').classList.add('hidden');

  const baseTabClass =
    'px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 transition';
  const activeTabClass =
    'px-2 sm:px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white shadow flex items-center gap-1.5 transition';

  document.getElementById('navInbox').className = baseTabClass;
  document.getElementById('navStats').className = isAdmin ? baseTabClass : 'hidden';
  document.getElementById('navSettings').className = isAdmin ? baseTabClass : 'hidden';

  if (view === 'inbox') {
    document.getElementById('viewInbox').classList.remove('hidden');
    document.getElementById('navInbox').className = activeTabClass;
    if (typeof OmniDevice !== 'undefined') {
      OmniDevice.applyResponsiveLayout();
    }
  } else if (view === 'stats' && isAdmin) {
    document.getElementById('viewStats').classList.remove('hidden');
    document.getElementById('navStats').className = activeTabClass;
    initAnalyticsSection();
  } else if (view === 'settings' && isAdmin) {
    document.getElementById('viewSettings').classList.remove('hidden');
    document.getElementById('navSettings').className = activeTabClass;
    checkWhatsAppStatus();
    previewScheduleState();
    checkCatalogPdfStatus();
    loadUsersList();
    if (typeof loadChannelsVaultStatus === 'function') {
      loadChannelsVaultStatus();
    }
  }
}
