(function () {
  const DEFAULT_PRODUCTION_API_BASE_URL = 'https://care-well-1.onrender.com';
  const hasDocument = typeof document !== 'undefined';
  const currentOrigin = typeof window !== 'undefined' ? String(window.location.origin || '').trim() : '';
  const explicit =
    (typeof window !== 'undefined' && typeof window.CAREWELL_API_BASE_URL === 'string' && window.CAREWELL_API_BASE_URL.trim()) ||
    (hasDocument ? document.querySelector('meta[name="carewell-api-base-url"]')?.content?.trim() : '') ||
    '';

  const candidates = [];
  const pushUnique = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  pushUnique(explicit);

  const isLocalOrigin = /localhost|127\.0\.0\.1|:3000$/i.test(currentOrigin);
  const isFileOrigin = currentOrigin === 'null' || currentOrigin.startsWith('file:');

  if (!isFileOrigin && currentOrigin) {
    pushUnique(currentOrigin);
  }

  pushUnique('http://127.0.0.1:3000');
  pushUnique('http://localhost:3000');
  pushUnique(DEFAULT_PRODUCTION_API_BASE_URL);

  if (!explicit && !currentOrigin) {
    pushUnique(DEFAULT_PRODUCTION_API_BASE_URL);
  }

  window.CAREWELL_API_BASE_URLS = candidates;
  window.CAREWELL_API_BASE_URL = candidates[0] || (isLocalOrigin ? currentOrigin : DEFAULT_PRODUCTION_API_BASE_URL);
})();
