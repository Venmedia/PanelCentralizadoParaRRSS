/* =========================================================================
   MÓDULO 2: INTERCEPTOR SEGURO DE FETCH Y API (public/js/api.js)
   ========================================================================= */

const nativeFetch = window.fetch.bind(window);

window.fetch = async function (resource, config = {}) {
  const urlStr = typeof resource === 'string' ? resource : (resource?.url || '');
  if (urlStr.startsWith('/api/')) {
    const headers = new Headers(config.headers || {});
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
    config.headers = headers;
    config.credentials = 'same-origin';
  }
  const response = await nativeFetch(resource, config);
  if (
    response.status === 401 &&
    !urlStr.includes('/api/auth/login') &&
    !urlStr.includes('/api/auth/me')
  ) {
    if (typeof showLoginScreen === 'function') {
      showLoginScreen();
    }
  }
  return response;
};
