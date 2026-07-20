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

  const isLocalOrigin = /localhost|127\.0\.0\.1/i.test(currentOrigin);
  const isFileOrigin = currentOrigin === 'null' || currentOrigin.startsWith('file:');

  if (isLocalOrigin) {
    // Running locally — prefer current origin, then localhost fallbacks, then production
    let isStaticServer = false;
    if (currentOrigin) {
      try {
        const url = new URL(currentOrigin);
        // Exclude common static preview servers (like VS Code Live Server on 5500-5505) from being the API host
        if (url.port && ['5500', '5501', '5502', '5503', '5504', '5505'].includes(url.port)) {
          isStaticServer = true;
        }
      } catch (e) {}
    }
    if (!isFileOrigin && currentOrigin && !isStaticServer) {
      pushUnique(currentOrigin);
    }
    pushUnique('http://127.0.0.1:3000');
    pushUnique('http://localhost:3000');
    pushUnique(DEFAULT_PRODUCTION_API_BASE_URL);
  } else {
    // Running on production / deployed — prefer production URL, never add localhost
    pushUnique(DEFAULT_PRODUCTION_API_BASE_URL);
    if (!isFileOrigin && currentOrigin) {
      pushUnique(currentOrigin);
    }
  }

  window.CAREWELL_API_BASE_URLS = candidates;
  window.CAREWELL_API_BASE_URL = candidates[0] || DEFAULT_PRODUCTION_API_BASE_URL;
})();
