(function () {
  const DEFAULT_PRODUCTION_API_BASE_URL = 'https://care-well-1.onrender.com';
  const hasDocument = typeof document !== 'undefined';
  const explicit =
    (typeof window !== 'undefined' && typeof window.CAREWELL_API_BASE_URL === 'string' && window.CAREWELL_API_BASE_URL.trim()) ||
    (hasDocument ? document.querySelector('meta[name="carewell-api-base-url"]')?.content?.trim() : '') ||
    '';

  let baseUrl = explicit;
  if (!baseUrl) {
    const origin = typeof window !== 'undefined' ? String(window.location.origin || '').trim() : '';
    const isLocalOrigin = /localhost|127\.0\.0\.1|:3000$/i.test(origin);
    const isFileOrigin = origin === 'null' || origin.startsWith('file:');
    baseUrl = !isFileOrigin && !isLocalOrigin ? DEFAULT_PRODUCTION_API_BASE_URL : origin || DEFAULT_PRODUCTION_API_BASE_URL;
  }

  window.CAREWELL_API_BASE_URL = baseUrl;
})();
