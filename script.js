const nextBtn = document.getElementById('nextBtn');
const loginBtn = document.getElementById('loginBtn');

const loginModal = document.getElementById('loginModal');
const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
const loginForm = document.getElementById('loginForm');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');

const otpModal = document.getElementById('otpModal');
const closeOtpModalBtn = document.getElementById('closeOtpModalBtn');
const otpSkipBtn = document.getElementById('otpSkipBtn');
const otpSubtitle = document.getElementById('otpSubtitle');
const otpInputsContainer = document.getElementById('otpInputs');
const otpBoxes = Array.from(document.querySelectorAll('.otp-box'));
const otpVerifyBtn = document.getElementById('otpVerifyBtn');
const otpResendWrap = document.getElementById('otpResendWrap');
const otpError = document.getElementById('otpError');

const USERNAME_ADMIN = "SeemaPrajapati@carewell";
const PASSWORD_ADMIN = "Seema@ytmq";
const EMAIL_ADMIN = "seemaprajapati1998@gmail.com";
const REDIRECT_ADMIN = "head-admin-panel.html";

const USERNAME_DEV = "dhruvvarma@carewell-developer";
const PASSWORD_DEV = "dhruv@9b9mqtge";
const EMAIL_DEV = "dhruvvarma53@gmail.com";
const REDIRECT_DEV = "developer-panel.html";

let currentTargetEmail = '';
let currentRedirectUrl = '';
let timerInterval = null;

nextBtn?.addEventListener('click', () => {
  window.location.href = 'onboarding-screen-2.html';
});

// Open Login Modal
loginBtn?.addEventListener('click', () => {
  if (loginError) {
    loginError.style.display = 'none';
    loginError.textContent = '';
  }
  if (loginForm) loginForm.reset();
  if (loginModal) loginModal.style.display = 'flex';
});

// Close Modals
function closeAllModals() {
  if (loginModal) loginModal.style.display = 'none';
  if (otpModal) otpModal.style.display = 'none';
  if (timerInterval) clearInterval(timerInterval);
}

closeLoginModalBtn?.addEventListener('click', closeAllModals);
closeOtpModalBtn?.addEventListener('click', closeAllModals);

// Temporary Skip OTP - Direct redirect if credentials are valid
otpSkipBtn?.addEventListener('click', () => {
  if (currentRedirectUrl) {
    window.location.href = currentRedirectUrl;
  }
});

// Close overlay on click outside content
[loginModal, otpModal].forEach((overlay) => {
  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeAllModals();
    }
  });
});

let pinnedApiBaseUrl = null;

function getApiCandidates() {
  const windowBase = typeof window !== 'undefined' ? window.CAREWELL_API_BASE_URL : '';
  const windowBases = (typeof window !== 'undefined' && Array.isArray(window.CAREWELL_API_BASE_URLS)) ? window.CAREWELL_API_BASE_URLS : [];
  const currentOrigin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
  const isPort5500 = /:550\d/.test(currentOrigin);
  const isFileOrigin = !currentOrigin || currentOrigin === 'null' || currentOrigin.startsWith('file:');

  const candidates = [];
  if (pinnedApiBaseUrl) candidates.push(pinnedApiBaseUrl);
  if (windowBase) candidates.push(windowBase);
  candidates.push(...windowBases);

  if (isPort5500 || isFileOrigin) {
    candidates.push('http://127.0.0.1:3000');
    candidates.push('http://localhost:3000');
  }
  if (!isPort5500 && !isFileOrigin && currentOrigin) {
    candidates.push(currentOrigin);
  }
  candidates.push('http://127.0.0.1:3000');
  candidates.push('http://localhost:3000');
  candidates.push('https://care-well-1.onrender.com');

  return Array.from(new Set(candidates.map(u => String(u || '').trim().replace(/\/+$/, '')).filter(Boolean)));
}

async function fetchWithApiFallback(endpoint, options = {}) {
  const candidates = getApiCandidates();
  let lastError = null;

  for (const baseUrl of candidates) {
    const url = `${baseUrl}${endpoint}`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status < 500) {
        pinnedApiBaseUrl = baseUrl;
        return await res.json();
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("All API candidates failed");
}

// Send OTP via Backend API
async function triggerSendOtpEmail(email) {
  try {
    const data = await fetchWithApiFallback('/api/auth/email/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    console.log("send-otp response:", data);
    return data;
  } catch (err) {
    console.warn("Backend server request failed (offline/fallback mode):", err);
    return { ok: false };
  }
}

// Verify OTP via Backend API
async function triggerVerifyOtpEmail(email, otp) {
  try {
    const data = await fetchWithApiFallback('/api/auth/email/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    });
    console.log("verify-otp response:", data);
    return data;
  } catch (err) {
    console.warn("Backend server request failed (offline/fallback mode):", err);
    return { ok: false, fallback: true };
  }
}

// Start OTP Timer
function startOtpTimer(email) {
  if (timerInterval) clearInterval(timerInterval);
  let timeLeft = 30;
  if (otpResendWrap) {
    otpResendWrap.innerHTML = `Resend OTP in <span id="otpTimer">30</span>s`;
  }
  
  timerInterval = setInterval(() => {
    timeLeft--;
    const currentTimerEl = document.getElementById('otpTimer');
    if (currentTimerEl) currentTimerEl.textContent = timeLeft;
    
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      if (otpResendWrap) {
        otpResendWrap.innerHTML = `Didn't receive it? <button id="resendBtn" type="button">Resend OTP</button>`;
        const resendBtn = document.getElementById('resendBtn');
        if (resendBtn) {
          resendBtn.onclick = async () => {
            resendBtn.disabled = true;
            resendBtn.textContent = 'Sending...';
            await triggerSendOtpEmail(email);
            resendBtn.textContent = 'Sent!';
            startOtpTimer(email);
          };
        }
      }
    }
  }, 1000);
}

// Setup OTP Inputs behavior
function setupOtpInputs() {
  otpBoxes.forEach((box, index) => {
    box.value = '';
    box.classList.remove('pop');
    
    box.oninput = (e) => {
      const val = e.target.value;
      if (val) {
        box.classList.add('pop');
        if (index < otpBoxes.length - 1) {
          otpBoxes[index + 1].focus();
        }
      }
      checkOtpComplete();
    };

    box.onkeydown = (e) => {
      if (e.key === 'Backspace' && !box.value && index > 0) {
        otpBoxes[index - 1].focus();
      }
    };

    box.onpaste = (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim();
      if (/^\d{4}$/.test(pasteData)) {
        pasteData.split('').forEach((char, i) => {
          if (otpBoxes[i]) otpBoxes[i].value = char;
        });
        otpBoxes[3].focus();
        checkOtpComplete();
      }
    };
  });

  if (otpInputsContainer) {
    otpInputsContainer.classList.remove('collapsing', 'success', 'failure');
  }
}

function getEnteredOtp() {
  return otpBoxes.map(b => b.value).join('');
}

function checkOtpComplete() {
  const otp = getEnteredOtp();
  if (otpVerifyBtn) {
    otpVerifyBtn.disabled = otp.length !== 4;
  }
}

// Open OTP Snackbar & Send Email
async function openOtpModal(email, redirectUrl) {
  currentTargetEmail = email;
  currentRedirectUrl = redirectUrl;

  if (loginModal) loginModal.style.display = 'none';
  if (otpSubtitle) {
    otpSubtitle.textContent = `Enter 4-digit code sent to ${email}`;
  }
  if (otpError) {
    otpError.style.display = 'none';
    otpError.textContent = '';
  }

  setupOtpInputs();
  startOtpTimer(email);

  if (otpModal) otpModal.style.display = 'flex';
  setTimeout(() => {
    if (otpBoxes[0]) otpBoxes[0].focus();
  }, 100);

  // Trigger real email send via backend API
  triggerSendOtpEmail(email);
}

// Handle Login Form Submission
loginForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const username = loginUsername ? loginUsername.value.trim() : '';
  const password = loginPassword ? loginPassword.value.trim() : '';

  if (!username || !password) {
    if (loginError) {
      loginError.textContent = 'Please enter both UserName and Password.';
      loginError.style.display = 'block';
    }
    return;
  }

  if (username === USERNAME_ADMIN && password === PASSWORD_ADMIN) {
    openOtpModal(EMAIL_ADMIN, REDIRECT_ADMIN);
  } else if (username === USERNAME_DEV && password === PASSWORD_DEV) {
    openOtpModal(EMAIL_DEV, REDIRECT_DEV);
  } else {
    if (loginError) {
      loginError.textContent = 'Invalid UserName or Password.';
      loginError.style.display = 'block';
    }
  }
});

// Handle OTP Verification
otpVerifyBtn?.addEventListener('click', async () => {
  const otp = getEnteredOtp();
  if (otp.length !== 4) return;

  if (otpVerifyBtn) {
    otpVerifyBtn.disabled = true;
    otpVerifyBtn.textContent = 'Verifying...';
  }

  if (otpError) {
    otpError.style.display = 'none';
  }

  const result = await triggerVerifyOtpEmail(currentTargetEmail, otp);

  const isSuccess = Boolean(result.ok || result.profile || result.nextRoute || (result.fallback && !result.code));

  if (isSuccess) {
    if (otpInputsContainer) {
      otpInputsContainer.classList.add('collapsing', 'success');
    }

    if (otpVerifyBtn) {
      otpVerifyBtn.textContent = 'Verified!';
      otpVerifyBtn.style.background = '#10b981';
      otpVerifyBtn.style.color = '#fff';
    }

    setTimeout(() => {
      window.location.href = currentRedirectUrl;
    }, 750);
  } else {
    if (otpInputsContainer) otpInputsContainer.classList.add('failure');
    if (otpError) {
      otpError.textContent = result.message || 'Invalid OTP. Please check your email.';
      otpError.style.display = 'block';
    }
    if (otpVerifyBtn) {
      otpVerifyBtn.textContent = 'Verify';
      otpVerifyBtn.disabled = false;
    }
  }
});
