/* =========================================================================
   MÓDULO RESPONSIVE & DEVICE INTELLIGENCE (public/js/responsive.js)
   Reconocimiento automático del dispositivo (PC, Tablet, Celular)
   y adaptación de layouts, navegación y componentes en tiempo real.
   ========================================================================= */

const OmniDevice = {
  type: 'desktop', // 'mobile' | 'tablet' | 'desktop'
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  isTouch: false,
  os: 'unknown',
  screenWidth: window.innerWidth,
  screenHeight: window.innerHeight,
  orientation: 'landscape',
  activeMobileView: 'list', // 'list' | 'chat'
  quickRepliesCollapsed: false,
  _userToggledQuickReplies: false,

  init() {
    this.detect();
    this.bindEvents();
    console.log(`[OmniDevice] 📱 Dispositivo detectado: ${this.getDeviceLabel()} (${this.screenWidth}x${this.screenHeight})`);
  },

  detect() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ua = navigator.userAgent || '';
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

    // 1. Detección de Sistema Operativo
    let os = 'unknown';
    if (/android/i.test(ua)) os = 'android';
    else if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) os = 'ios';
    else if (/Win/i.test(ua)) os = 'windows';
    else if (/Mac/i.test(ua)) os = 'mac';
    else if (/Linux/i.test(ua)) os = 'linux';

    // 2. Detección del tipo de dispositivo
    let type = 'desktop';
    if (width < 768) {
      type = 'mobile';
    } else if (width >= 768 && width < 1024) {
      type = 'tablet';
    } else {
      type = 'desktop';
    }

    const prevType = this.type;
    this.type = type;
    this.isMobile = type === 'mobile';
    this.isTablet = type === 'tablet';
    this.isDesktop = type === 'desktop';
    this.isTouch = isTouch;
    this.os = os;
    this.screenWidth = width;
    this.screenHeight = height;
    this.orientation = width > height ? 'landscape' : 'portrait';

    // 3. Inyectar atributos dinámicos en HTML y BODY para CSS condicional
    const root = document.documentElement;
    root.setAttribute('data-device', type);
    root.setAttribute('data-os', os);
    root.setAttribute('data-touch', isTouch ? 'true' : 'false');
    root.setAttribute('data-orientation', this.orientation);

    document.body.classList.remove('device-mobile', 'device-tablet', 'device-desktop', 'touch-device');
    document.body.classList.add(`device-${type}`);
    if (isTouch) document.body.classList.add('touch-device');

    // En pantallas móviles con poca altura vertical, colapsar respuestas rápidas por defecto
    if (this.isMobile && height < 750 && !this._userToggledQuickReplies) {
      this.quickRepliesCollapsed = true;
    }

    this.updateDeviceBadge();
    this.applyResponsiveLayout(prevType !== type);
  },

  bindEvents() {
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.detect(), 120);
    });

    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.detect(), 200);
    });
  },

  getDeviceLabel() {
    const osMap = {
      android: 'Android',
      ios: /iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone / iOS',
      windows: 'Windows PC',
      mac: 'macOS',
      linux: 'Linux'
    };
    const osName = osMap[this.os] || 'Sistema';

    if (this.isMobile) return `📱 Celular (${osName})`;
    if (this.isTablet) return `📟 Tablet (${osName})`;
    return `💻 PC (${osName})`;
  },

  updateDeviceBadge() {
    const badgeEl = document.getElementById('headerDeviceBadge');
    if (!badgeEl) return;

    if (this.isMobile) {
      const icon = this.os === 'ios' ? 'fa-apple' : (this.os === 'android' ? 'fa-android' : 'fa-mobile-screen');
      badgeEl.innerHTML = `
        <span class="inline-flex items-center gap-1 text-[8px] sm:text-[9px] px-1.5 sm:px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-700 font-bold" title="${this.getDeviceLabel()}">
          <i class="fa-solid ${icon}"></i>
          <span>Móvil</span>
        </span>`;
    } else if (this.isTablet) {
      badgeEl.innerHTML = `
        <span class="inline-flex items-center gap-1 text-[8px] sm:text-[9px] px-1.5 sm:px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-700 font-bold" title="${this.getDeviceLabel()}">
          <i class="fa-solid fa-tablet-screen-button"></i>
          <span>Tablet</span>
        </span>`;
    } else {
      badgeEl.innerHTML = `
        <span class="inline-flex items-center gap-1 text-[8px] sm:text-[9px] px-1.5 sm:px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-semibold" title="${this.getDeviceLabel()}">
          <i class="fa-solid fa-desktop"></i>
          <span>PC</span>
        </span>`;
    }
  },

  applyResponsiveLayout(deviceChanged = false) {
    const leftSidebar = document.getElementById('leftSidebar');
    const activeChatSection = document.getElementById('activeChatSection');
    const btnBack = document.getElementById('btnBackToChatList');
    const simPanel = document.getElementById('simulatorPanel');

    if (this.isMobile) {
      if (btnBack) btnBack.classList.remove('hidden');

      // En celular: mostrar lista o chat (patrón WhatsApp nativo)
      if (this.activeMobileView === 'chat') {
        if (leftSidebar) leftSidebar.classList.add('hidden');
        if (activeChatSection) activeChatSection.classList.remove('hidden');
      } else {
        if (leftSidebar) leftSidebar.classList.remove('hidden');
        if (activeChatSection) activeChatSection.classList.add('hidden');
      }

      // En móvil, el simulador no se muestra como columna fija
      if (simPanel && !simPanel.classList.contains('mobile-drawer-open')) {
        simPanel.classList.add('hidden');
      }
    } else {
      // En Tablet y PC: ambos visibles en paralelo
      if (leftSidebar) leftSidebar.classList.remove('hidden');
      if (activeChatSection) activeChatSection.classList.remove('hidden');
      if (btnBack) btnBack.classList.add('hidden');

      if (deviceChanged) {
        this.closeMobileDrawers();
      }
    }

    this.renderQuickRepliesState();
  },

  showChatView() {
    if (this.isMobile) {
      this.activeMobileView = 'chat';
      const leftSidebar = document.getElementById('leftSidebar');
      const activeChatSection = document.getElementById('activeChatSection');
      if (leftSidebar) leftSidebar.classList.add('hidden');
      if (activeChatSection) activeChatSection.classList.remove('hidden');

      // Auto-scroll al fondo al ingresar al chat
      const vp = document.getElementById('messagesViewport');
      if (vp) setTimeout(() => { vp.scrollTop = vp.scrollHeight; }, 80);
    }
  },

  backToChatList() {
    this.activeMobileView = 'list';
    const leftSidebar = document.getElementById('leftSidebar');
    const activeChatSection = document.getElementById('activeChatSection');
    if (leftSidebar) leftSidebar.classList.remove('hidden');
    if (activeChatSection) activeChatSection.classList.add('hidden');
  },

  toggleQuickReplies() {
    this._userToggledQuickReplies = true;
    this.quickRepliesCollapsed = !this.quickRepliesCollapsed;
    this.renderQuickRepliesState();
  },

  renderQuickRepliesState() {
    const body = document.getElementById('quickRepliesBody');
    const chevron = document.getElementById('quickRepliesChevron');
    if (!body) return;

    if (this.quickRepliesCollapsed) {
      body.classList.add('hidden');
      if (chevron) chevron.className = 'fa-solid fa-chevron-down text-[9px] transition-transform';
    } else {
      body.classList.remove('hidden');
      if (chevron) chevron.className = 'fa-solid fa-chevron-up text-[9px] transition-transform';
    }
  },

  closeMobileDrawers() {
    const simPanel = document.getElementById('simulatorPanel');
    const dock = document.getElementById('ferdiumServiceDock');
    const backdrop = document.getElementById('mobileDrawerBackdrop');
    if (simPanel) {
      simPanel.classList.remove('mobile-drawer-open');
      if (this.isMobile || this.isTablet) simPanel.classList.add('hidden');
    }
    if (dock) dock.classList.remove('mobile-drawer-open');
    if (backdrop) backdrop.classList.add('hidden');
  }
};

// Funciones globales expuestas para eventos HTML inline
function backToChatList() {
  OmniDevice.backToChatList();
}

function toggleQuickReplies() {
  OmniDevice.toggleQuickReplies();
}

function closeAllMobileDrawers() {
  OmniDevice.closeMobileDrawers();
}
