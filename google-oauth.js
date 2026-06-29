(() => {
  const CLIENT_ID = '65018618868-5keclcugaqha3hus3lc6903p4a7gpq2h.apps.googleusercontent.com';
  const SDK_SRC = 'https://accounts.google.com/gsi/client';
  const BACKEND_EXCHANGE_URL = '/api/auth/google/exchange';

  let sdkPromise = null;
  let tokenClient = null;

  function loadSdk() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (sdkPromise) return sdkPromise;

    sdkPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-carewell-google-sdk="true"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load Google SDK')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = SDK_SRC;
      script.async = true;
      script.defer = true;
      script.dataset.carewellGoogleSdk = 'true';
      script.onload = () => resolve();
      script.onerror = () => {
        sdkPromise = null;
        reject(new Error('Failed to load Google SDK'));
      };
      document.head.appendChild(script);
    });

    return sdkPromise;
  }

  function normalizeProfile(data) {
    return {
      googleUserId: data.googleUserId || '',
      fullName: data.fullName || '',
      email: data.email || '',
      profilePicture: data.profilePicture || '',
      provider: data.provider || 'Google',
      emailVerified: Boolean(data.emailVerified),
      createdAt: data.createdAt || sessionStorage.getItem('googleCreatedAt') || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
      lastLoginAt: data.lastLoginAt || new Date().toISOString(),
    };
  }

  function saveSession(profile) {
    sessionStorage.setItem('googleUserId', profile.googleUserId);
    sessionStorage.setItem('googleFullName', profile.fullName);
    sessionStorage.setItem('googleEmail', profile.email);
    sessionStorage.setItem('googlePhoto', profile.profilePicture || '');
    sessionStorage.setItem('googleCreatedAt', profile.createdAt);
    sessionStorage.setItem('googleLastLoginAt', profile.lastLoginAt);
    sessionStorage.setItem('googleProvider', profile.provider);
    sessionStorage.setItem('googleEmailVerified', String(profile.emailVerified));
    sessionStorage.setItem('userProfile', JSON.stringify(profile));
  }

  function ensureToastHost() {
    let host = document.getElementById('carewell-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'carewell-toast-host';
      host.style.position = 'fixed';
      host.style.left = '50%';
      host.style.bottom = '24px';
      host.style.transform = 'translateX(-50%)';
      host.style.zIndex = '9999';
      host.style.pointerEvents = 'none';
      document.body.appendChild(host);
    }
    return host;
  }

  function showToast(message) {
    const host = ensureToastHost();
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.background = 'rgba(15, 23, 42, 0.95)';
    toast.style.color = '#fff';
    toast.style.padding = '14px 18px';
    toast.style.borderRadius = '999px';
    toast.style.boxShadow = '0 14px 34px rgba(15, 23, 42, 0.18)';
    toast.style.font = '600 14px Inter, system-ui, sans-serif';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'opacity 180ms ease, transform 180ms ease';
    host.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      window.setTimeout(() => toast.remove(), 220);
    }, 3200);
  }

  async function startGoogleAuth({ onSuccess, onError } = {}) {
    try {
      await loadSdk();

      if (!tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: 'openid email profile',
          prompt: 'select_account',
          callback: async (tokenResponse) => {
            try {
              if (!tokenResponse || tokenResponse.error) {
                const errorCode = tokenResponse?.error || '';
                const message = errorCode === 'access_denied' || errorCode === 'popup_closed_by_user'
                  ? 'Google sign-in was cancelled.'
                  : errorCode === 'popup_failed_to_open'
                    ? 'Popup blocked. Please allow popups and try again.'
                    : 'Authentication failed.';
                showToast(message);
                onError?.(message);
                return;
              }

              const response = await fetch(BACKEND_EXCHANGE_URL, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  accessToken: tokenResponse.access_token,
                }),
              });

              const payload = await response.json().catch(() => ({}));
              if (!response.ok) {
                throw new Error(payload?.message || 'Unable to connect to Google. Please try again.');
              }

              const profile = normalizeProfile(payload.profile || {});
              saveSession(profile);
              onSuccess?.(profile);
            } catch (error) {
              const message = error?.message || 'Unable to connect to Google. Please try again.';
              showToast(message);
              onError?.(message);
            }
          },
        });
      }

      tokenClient.requestAccessToken({ prompt: 'select_account' });
    } catch (error) {
      sdkPromise = null;
      const message = 'Unable to connect to Google. Please try again.';
      showToast(message);
      onError?.(message);
    }
  }

  function bindGoogleButton(button, options = {}) {
    if (!button) return;
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      if (button.dataset.googleBusy === 'true') return;
      button.dataset.googleBusy = 'true';
      try {
        await startGoogleAuth(options);
      } finally {
        window.setTimeout(() => {
          delete button.dataset.googleBusy;
        }, 700);
      }
    });
  }

  window.CareWellGoogleAuth = {
    startGoogleAuth,
    bindGoogleButton,
    showToast,
    loadSdk,
  };
})();
