/* =========================================================================
   MÓDULO CARGADOR DE SECCIONES HTML (public/js/loader.js)
   Carga e inyecta de forma asíncrona y modular todos los bloques HTML
   de public/sections/*.html para mantener public/index.html ultraligero.
   ========================================================================= */

async function fetchHtmlFragment(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Error cargando sección modular: ${url} (${res.status})`);
  }
  return await res.text();
}

function replaceMountPoint(mountId, htmlContent) {
  const mountEl = document.getElementById(mountId);
  if (mountEl) {
    mountEl.outerHTML = htmlContent;
  }
}

async function loadModularSections() {
  try {
    // 1. Cargar en paralelo todas las vistas principales y sub-bloques de Ajustes
    const [
      loginHtml,
      headerHtml,
      inboxHtml,
      statsHtml,
      settingsShellHtml,
      settingsUsersHtml,
      settingsCompaniesHtml,
      settingsWhatsappHtml,
      settingsScheduleHtml,
      settingsTemplatesHtml,
      settingsMetaHtml
    ] = await Promise.all([
      fetchHtmlFragment('/sections/login.html'),
      fetchHtmlFragment('/sections/header.html'),
      fetchHtmlFragment('/sections/inbox.html'),
      fetchHtmlFragment('/sections/stats.html'),
      fetchHtmlFragment('/sections/settings.html'),
      fetchHtmlFragment('/sections/settings-users.html'),
      fetchHtmlFragment('/sections/settings-companies.html'),
      fetchHtmlFragment('/sections/settings-whatsapp.html'),
      fetchHtmlFragment('/sections/settings-schedule.html'),
      fetchHtmlFragment('/sections/settings-templates.html'),
      fetchHtmlFragment('/sections/settings-meta.html')
    ]);

    // 2. Montar las 5 secciones principales en el contenedor raíz
    replaceMountPoint('mount-login', loginHtml);
    replaceMountPoint('mount-header', headerHtml);
    replaceMountPoint('mount-inbox', inboxHtml);
    replaceMountPoint('mount-stats', statsHtml);
    replaceMountPoint('mount-settings', settingsShellHtml);

    // 3. Montar los sub-bloques modulares dentro de la vista de Ajustes (#viewSettings)
    replaceMountPoint('mount-settings-users', settingsUsersHtml);
    replaceMountPoint('mount-settings-companies', settingsCompaniesHtml);
    replaceMountPoint('mount-settings-whatsapp', settingsWhatsappHtml);
    replaceMountPoint('mount-settings-schedule', settingsScheduleHtml);
    replaceMountPoint('mount-settings-templates', settingsTemplatesHtml);
    replaceMountPoint('mount-settings-meta', settingsMetaHtml);
  } catch (err) {
    console.error('[Loader Modular] Error al montar las secciones del panel:', err);
  }
}
