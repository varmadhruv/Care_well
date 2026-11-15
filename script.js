const nextBtn = document.getElementById('nextBtn');
const loginBtn = document.getElementById('loginBtn');

const loginModal = document.getElementById('loginModal');
const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
const loginForm = document.getElementById('loginForm');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const togglePasswordBtn = document.getElementById('togglePasswordBtn');
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

const USERNAME_ADMIN = "samm_10";
const PASSWORD_ADMIN = "seema@10##";
const EMAIL_ADMIN = "seemaprajapati1998@gmail.com";
const REDIRECT_ADMIN = "head-admin-panel.html";

const USERNAME_DEV = "dhruvvarma@carewell-developer";
const PASSWORD_DEV = "dhruv@9b9mqtge";
const EMAIL_DEV = "dhruvvarma53@gmail.com";
const REDIRECT_DEV = "developer-panel.html";

let currentTargetEmail = '';
let currentRedirectUrl = '';
let timerInterval = null;

function resetPasswordVisibility() {
  if (loginPassword) {
    loginPassword.type = 'password';
  }
  if (togglePasswordBtn) {
    const eyeOpen = togglePasswordBtn.querySelector('.eye-open');
    const eyeClosed = togglePasswordBtn.querySelector('.eye-closed');
    if (eyeOpen) eyeOpen.style.display = 'block';
    if (eyeClosed) eyeClosed.style.display = 'none';
  }
}

togglePasswordBtn?.addEventListener('click', () => {
  if (!loginPassword) return;
  const isPassword = loginPassword.type === 'password';
  loginPassword.type = isPassword ? 'text' : 'password';

  const eyeOpen = togglePasswordBtn.querySelector('.eye-open');
  const eyeClosed = togglePasswordBtn.querySelector('.eye-closed');
  if (eyeOpen && eyeClosed) {
    eyeOpen.style.display = isPassword ? 'none' : 'block';
    eyeClosed.style.display = isPassword ? 'block' : 'none';
  }
});

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
  resetPasswordVisibility();
  if (loginModal) loginModal.style.display = 'flex';
});

// Close Modals
function closeAllModals() {
  if (loginModal) loginModal.style.display = 'none';
  if (otpModal) otpModal.style.display = 'none';
  if (timerInterval) clearInterval(timerInterval);
  resetPasswordVisibility();
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
        if (val.length > 1) {
          box.value = val[0];
        }
        if (box.value.match(/[0-9]/)) {
          box.classList.add('pop');
          setTimeout(() => box.classList.remove('pop'), 200);
          if (index < otpBoxes.length - 1) {
            otpBoxes[index + 1].focus();
          }
        } else {
          box.value = '';
        }
      }
      checkOtpComplete();
    };

    box.onkeydown = (e) => {
      if (e.key === 'Backspace' && !box.value && index > 0) {
        otpBoxes[index - 1].focus();
        otpBoxes[index - 1].value = '';
        checkOtpComplete();
      }
      if (e.key === 'ArrowLeft' && index > 0) {
        otpBoxes[index - 1].focus();
      }
      if (e.key === 'ArrowRight' && index < otpBoxes.length - 1) {
        otpBoxes[index + 1].focus();
      }
    };

    box.onpaste = (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim().replace(/\D/g, '');
      if (pasteData) {
        for (let i = 0; i < otpBoxes.length; i++) {
          if (pasteData[i]) {
            otpBoxes[i].value = pasteData[i];
            otpBoxes[i].classList.add('pop');
            setTimeout(() => otpBoxes[i].classList.remove('pop'), 200);
          }
        }
        const targetIndex = Math.min(pasteData.length, otpBoxes.length) - 1;
        if (otpBoxes[targetIndex]) otpBoxes[targetIndex].focus();
        checkOtpComplete();
      }
    };
  });

  if (otpInputsContainer) {
    otpInputsContainer.classList.remove('collapsing', 'success', 'failure');
  }

  if (otpVerifyBtn) {
    otpVerifyBtn.disabled = true;
    otpVerifyBtn.textContent = 'Verify';
    otpVerifyBtn.style.background = '';
    otpVerifyBtn.style.color = '';
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

// Handle Login Form Submission — Automatically checks role & sends OTP to registered email
loginForm?.addEventListener('submit', async (event) => {
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

  const submitBtn = document.getElementById('loginSubmitBtn');
  const originalText = submitBtn ? submitBtn.textContent : 'Login';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying...';
  }

  try {
    const response = await fetchWithApiFallback('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (response && response.ok) {
      if (response.sessionToken) {
        sessionStorage.setItem('carewell_session', response.sessionToken);
      }
      if (response.user) {
        sessionStorage.setItem('carewell_doctor_profile', JSON.stringify(response.user));
      }
      if (loginError) {
        loginError.style.display = 'none';
        loginError.textContent = '';
      }
      // Send OTP to registered email and open OTP modal
      const targetEmail = response.email || (username === 'head_doctor' ? 'carewelldeveloperr@gmail.com' : EMAIL_ADMIN);
      const targetRedirect = response.redirectUrl || (username === 'head_doctor' ? 'head-doctor-dashboard.html' : REDIRECT_ADMIN);
      openOtpModal(targetEmail, targetRedirect);
      return;
    } else {
      if (loginError) {
        loginError.textContent = response?.message || 'Invalid UserName or Password.';
        loginError.style.display = 'block';
      }
    }
  } catch (err) {
    console.warn("Backend auth offline, applying local role fallback:", err);

    // Fallback role verification if backend connection failed
    if (username === 'head_doctor') {
      openOtpModal('carewelldeveloperr@gmail.com', 'head-doctor-dashboard.html');
      return;
    } else if (username === USERNAME_ADMIN && password === PASSWORD_ADMIN) {
      openOtpModal(EMAIL_ADMIN, REDIRECT_ADMIN);
      return;
    } else if (username === USERNAME_DEV && password === PASSWORD_DEV) {
      openOtpModal(EMAIL_DEV, REDIRECT_DEV);
      return;
    } else {
      if (loginError) {
        loginError.textContent = 'Invalid UserName or Password.';
        loginError.style.display = 'block';
      }
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
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

  // 1. Immediately trigger collapse animation
  if (otpInputsContainer) {
    otpInputsContainer.classList.remove('failure', 'success');
    otpInputsContainer.classList.add('collapsing');
  }

  const startTime = Date.now();
  const result = await triggerVerifyOtpEmail(currentTargetEmail, otp);
  const elapsedTime = Date.now() - startTime;
  
  // Ensure collapse transition (400ms) finishes before triggering success/failure
  const minWait = 400;
  const remainingWait = Math.max(0, minWait - elapsedTime);

  const isSuccess = Boolean(result.ok || result.profile || result.nextRoute || (result.fallback && !result.code));

  setTimeout(() => {
    if (isSuccess) {
      // 2. Trigger Success Animation after collapse
      if (otpInputsContainer) {
        otpInputsContainer.classList.add('success');
      }

      if (otpVerifyBtn) {
        otpVerifyBtn.textContent = 'Verified!';
        otpVerifyBtn.style.background = '#10b981';
        otpVerifyBtn.style.color = '#fff';
      }

      setTimeout(() => {
        window.location.href = currentRedirectUrl;
      }, 1000);
    } else {
      // 3. Trigger Failure Animation on error
      if (otpInputsContainer) {
        otpInputsContainer.classList.remove('collapsing');
        otpInputsContainer.classList.add('failure');
      }

      if (otpError) {
        otpError.textContent = result.message || 'Invalid OTP. Please check your email.';
        otpError.style.display = 'block';
      }

      if (otpVerifyBtn) {
        otpVerifyBtn.textContent = result.message || 'Invalid OTP';
        otpVerifyBtn.style.background = '#ef4444';
        otpVerifyBtn.style.color = '#fff';
      }

      otpBoxes.forEach(i => (i.value = ''));

      setTimeout(() => {
        if (otpInputsContainer) otpInputsContainer.classList.remove('failure');
        if (otpBoxes[0]) otpBoxes[0].focus();
        checkOtpComplete();

        setTimeout(() => {
          if (otpVerifyBtn) {
            otpVerifyBtn.textContent = 'Verify';
            otpVerifyBtn.style.background = '';
            otpVerifyBtn.style.color = '';
            otpVerifyBtn.disabled = true;
          }
        }, 2000);
      }, 400);
    }
  }, remainingWait);
});

// ========================================================
// CONTRIBUTE MODAL CONTROLLER (2-STEP DISCIPLINE SELECTION & APPLICATION)
// ========================================================
(function initContributeModal() {
  const contributeBtn = document.getElementById('contributeBtn');
  const contributeModal = document.getElementById('contributeModal');
  const closeContributeBtn = document.getElementById('closeContributeBtn');
  const contributeRoleSelection = document.getElementById('contributeRoleSelection');
  const selectRoleDoctor = document.getElementById('selectRoleDoctor');
  const selectRoleNurse = document.getElementById('selectRoleNurse');
  const contrBackBtn = document.getElementById('contrBackBtn');
  const contrDoneBtn = document.getElementById('contrDoneBtn');

  const nurseFieldsGroup = document.getElementById('nurseFieldsGroup');
  const doctorFieldsGroup = document.getElementById('doctorFieldsGroup');
  const contributeSelectedRole = document.getElementById('contributeSelectedRole');
  const contributeTitle = document.getElementById('contributeTitle');
  const contributeSubtitle = document.getElementById('contributeSubtitle');
  const contributeForm = document.getElementById('contributeForm');
  const contributeSubmitBtn = document.getElementById('contributeSubmitBtn');
  const contributeError = document.getElementById('contributeError');
  const contributeFormContainer = document.getElementById('contributeFormContainer');
  const contributeSuccessCard = document.getElementById('contributeSuccessCard');

  // Doctor Workplace Card Selectors
  const wpClinicCard = document.getElementById('contrDocWorkplaceClinicCard');
  const wpHospCard = document.getElementById('contrDocWorkplaceHospCard');
  const wpCheckClinic = document.getElementById('wpCheckClinic');
  const wpCheckHosp = document.getElementById('wpCheckHosp');

  if (!contributeBtn || !contributeModal) return;

  let nursePhotoBase64 = '';
  let docPhotoBase64 = '';
  let docClinicPhotoBase64 = '';

  function openContributeModal() {
    contributeModal.style.display = 'flex';
    contributeModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Always start at Step 1: Discipline Selection
    if (contributeRoleSelection) contributeRoleSelection.style.display = 'block';
    if (contributeFormContainer) contributeFormContainer.style.display = 'none';
    if (contributeSuccessCard) contributeSuccessCard.style.display = 'none';
    if (contributeError) contributeError.style.display = 'none';
  }

  function closeContributeModal() {
    contributeModal.style.display = 'none';
    contributeModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';

    // Reset view to selection
    if (contributeRoleSelection) contributeRoleSelection.style.display = 'block';
    if (contributeFormContainer) contributeFormContainer.style.display = 'none';
    if (contributeSuccessCard) contributeSuccessCard.style.display = 'none';
  }

  contributeBtn.addEventListener('click', openContributeModal);
  if (closeContributeBtn) closeContributeBtn.addEventListener('click', closeContributeModal);
  if (contrDoneBtn) contrDoneBtn.addEventListener('click', closeContributeModal);

  // Close when clicking overlay backdrop
  contributeModal.addEventListener('click', (e) => {
    if (e.target === contributeModal) closeContributeModal();
  });

  // Step 1: Click Doctor or Nurse Card to open respective form
  if (selectRoleDoctor) {
    selectRoleDoctor.addEventListener('click', () => {
      if (contributeSelectedRole) contributeSelectedRole.value = 'doctor';
      if (contributeRoleSelection) contributeRoleSelection.style.display = 'none';
      if (contributeFormContainer) contributeFormContainer.style.display = 'block';
      if (doctorFieldsGroup) doctorFieldsGroup.style.display = 'block';
      if (nurseFieldsGroup) nurseFieldsGroup.style.display = 'none';
      if (contributeTitle) contributeTitle.textContent = 'Medical Doctor Application';
      if (contributeSubtitle) contributeSubtitle.textContent = 'Provide your clinical credentials, workplace, and practice details.';
      if (contributeError) contributeError.style.display = 'none';
      contributeModal.querySelector('.snackbar-card')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  if (selectRoleNurse) {
    selectRoleNurse.addEventListener('click', () => {
      if (contributeSelectedRole) contributeSelectedRole.value = 'nurse';
      if (contributeRoleSelection) contributeRoleSelection.style.display = 'none';
      if (contributeFormContainer) contributeFormContainer.style.display = 'block';
      if (nurseFieldsGroup) nurseFieldsGroup.style.display = 'block';
      if (doctorFieldsGroup) doctorFieldsGroup.style.display = 'none';
      if (contributeTitle) contributeTitle.textContent = 'Clinical Nurse Application';
      if (contributeSubtitle) contributeSubtitle.textContent = 'Provide your nursing experience, residency, and qualification details.';
      if (contributeError) contributeError.style.display = 'none';
      contributeModal.querySelector('.snackbar-card')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Back to role selection
  if (contrBackBtn) {
    contrBackBtn.addEventListener('click', () => {
      if (contributeFormContainer) contributeFormContainer.style.display = 'none';
      if (contributeRoleSelection) contributeRoleSelection.style.display = 'block';
      if (contributeError) contributeError.style.display = 'none';
      contributeModal.querySelector('.snackbar-card')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Doctor Workplace Type Interactive Card Switcher
  function selectWorkplace(type) {
    const radioClinic = document.querySelector('input[name="contrDocWorkplace"][value="Clinic"]');
    const radioHosp = document.querySelector('input[name="contrDocWorkplace"][value="Hospital"]');

    if (type === 'Clinic') {
      if (radioClinic) radioClinic.checked = true;
      if (radioHosp) radioHosp.checked = false;

      if (wpClinicCard) {
        wpClinicCard.style.background = '#f0f9ff';
        wpClinicCard.style.borderColor = '#0284c7';
        wpClinicCard.style.boxShadow = '0 2px 8px rgba(2, 132, 199, 0.1)';
      }
      if (wpCheckClinic) {
        wpCheckClinic.style.background = '#0284c7';
        wpCheckClinic.style.borderColor = '#0284c7';
        wpCheckClinic.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      }

      if (wpHospCard) {
        wpHospCard.style.background = '#ffffff';
        wpHospCard.style.borderColor = '#e2e8f0';
        wpHospCard.style.boxShadow = '0 1px 4px rgba(0,0,0,0.03)';
      }
      if (wpCheckHosp) {
        wpCheckHosp.style.background = 'transparent';
        wpCheckHosp.style.borderColor = '#cbd5e1';
        wpCheckHosp.innerHTML = '';
      }
    } else {
      if (radioClinic) radioClinic.checked = false;
      if (radioHosp) radioHosp.checked = true;

      if (wpHospCard) {
        wpHospCard.style.background = '#f0fdf4';
        wpHospCard.style.borderColor = '#10b981';
        wpHospCard.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.1)';
      }
      if (wpCheckHosp) {
        wpCheckHosp.style.background = '#10b981';
        wpCheckHosp.style.borderColor = '#10b981';
        wpCheckHosp.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      }

      if (wpClinicCard) {
        wpClinicCard.style.background = '#ffffff';
        wpClinicCard.style.borderColor = '#e2e8f0';
        wpClinicCard.style.boxShadow = '0 1px 4px rgba(0,0,0,0.03)';
      }
      if (wpCheckClinic) {
        wpCheckClinic.style.background = 'transparent';
        wpCheckClinic.style.borderColor = '#cbd5e1';
        wpCheckClinic.innerHTML = '';
      }
    }
  }

  if (wpClinicCard) {
    wpClinicCard.addEventListener('click', (e) => {
      e.preventDefault();
      selectWorkplace('Clinic');
    });
  }
  if (wpHospCard) {
    wpHospCard.addEventListener('click', (e) => {
      e.preventDefault();
      selectWorkplace('Hospital');
    });
  }

  // Photo uploads
  const nursePhotoInput = document.getElementById('contrNursePhotoInput');
  const nursePhotoLabel = document.getElementById('contrNursePhotoLabel');
  if (nursePhotoInput) {
    nursePhotoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          nursePhotoBase64 = ev.target.result;
          if (nursePhotoLabel) {
            nursePhotoLabel.innerHTML = `
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span style="color:#10b981; font-weight:700;">${file.name.slice(0, 16)}</span>
            `;
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  const docPhotoInput = document.getElementById('contrDocPhotoInput');
  const docPhotoLabel = document.getElementById('contrDocPhotoLabel');
  if (docPhotoInput) {
    docPhotoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          docPhotoBase64 = ev.target.result;
          if (docPhotoLabel) {
            docPhotoLabel.innerHTML = `
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span style="color:#10b981; font-weight:700;">${file.name.slice(0, 16)}</span>
            `;
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  const docClinicPhotoInput = document.getElementById('contrDocClinicPhotoInput');
  const docClinicPhotoLabel = document.getElementById('contrDocClinicPhotoLabel');
  if (docClinicPhotoInput) {
    docClinicPhotoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          docClinicPhotoBase64 = ev.target.result;
          if (docClinicPhotoLabel) {
            docClinicPhotoLabel.innerHTML = `
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span style="color:#10b981; font-weight:700;">${file.name.slice(0, 16)}</span>
            `;
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Submit Handler with Interactive Animation
  if (contributeForm) {
    contributeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (contributeError) contributeError.style.display = 'none';

      const role = contributeSelectedRole.value;
      let payload = { role };

      if (role === 'nurse') {
        const name = (document.getElementById('contrNurseName')?.value || '').trim();
        const place = (document.getElementById('contrNursePlace')?.value || '').trim();
        const age = document.getElementById('contrNurseAge')?.value || '';
        const email = (document.getElementById('contrNurseEmail')?.value || '').trim();
        const phone = (document.getElementById('contrNursePhone')?.value || '').trim();
        const experience = (document.getElementById('contrNurseExp')?.value || '').trim();
        const shortDescription = (document.getElementById('contrNurseDesc')?.value || '').trim();

        if (!name) return showError('Please enter your full name.');
        if (!place) return showError('Please enter the place where you live.');
        if (!age) return showError('Please enter your age.');
        if (!email || !email.includes('@')) return showError('Please enter a valid email address.');
        if (!phone) return showError('Please enter your phone number.');

        payload = {
          role,
          name,
          place,
          age: Number(age),
          email,
          phone,
          experience,
          photo: nursePhotoBase64,
          shortDescription,
        };
      } else {
        const workplaceEl = document.querySelector('input[name="contrDocWorkplace"]:checked');
        const workplaceType = workplaceEl ? workplaceEl.value : 'Clinic';
        const name = (document.getElementById('contrDocName')?.value || '').trim();
        const clinicName = (document.getElementById('contrDocClinicName')?.value || '').trim();
        const workingHours = (document.getElementById('contrDocHours')?.value || '').trim();
        const email = (document.getElementById('contrDocEmail')?.value || '').trim();
        const phone = (document.getElementById('contrDocPhone')?.value || '').trim();
        const shortDescription = (document.getElementById('contrDocDesc')?.value || '').trim();

        if (!name) return showError('Please enter doctor name.');
        if (!clinicName) return showError('Please enter clinic or hospital name.');
        if (!workingHours) return showError('Please enter your working hours.');
        if (!email || !email.includes('@')) return showError('Please enter a valid email address.');
        if (!phone) return showError('Please enter your phone number.');

        payload = {
          role,
          name,
          workplaceType,
          clinicName,
          workingHours,
          email,
          phone,
          photo: docPhotoBase64,
          clinicPhoto: docClinicPhotoBase64,
          shortDescription,
        };
      }

      function showError(msg) {
        if (contributeError) {
          contributeError.textContent = msg;
          contributeError.style.display = 'block';
        }
      }

      // Start submission animation on button
      if (contributeSubmitBtn) {
        contributeSubmitBtn.disabled = true;
        contributeSubmitBtn.innerHTML = `
          <svg style="animation: spin 0.8s linear infinite; width: 18px; height: 18px; stroke: #fff;" viewBox="0 0 24 24" fill="none" stroke-width="3">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
          </svg>
          <span>Submitting Application...</span>
        `;
      }

      try {
        const res = await fetch('/api/contributions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          // Success animation
          if (contributeSubmitBtn) {
            contributeSubmitBtn.style.background = '#10b981';
            contributeSubmitBtn.innerHTML = '✓ Submitted Successfully!';
          }
          setTimeout(() => {
            if (contributeFormContainer) contributeFormContainer.style.display = 'none';
            if (contributeRoleSelection) contributeRoleSelection.style.display = 'none';
            if (contributeSuccessCard) contributeSuccessCard.style.display = 'block';
            contributeForm.reset();
            nursePhotoBase64 = '';
            docPhotoBase64 = '';
            docClinicPhotoBase64 = '';
            if (nursePhotoLabel) {
              nursePhotoLabel.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                <span>Upload Photo</span>
              `;
            }
            if (docPhotoLabel) {
              docPhotoLabel.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>Doctor Photo</span>
              `;
            }
            if (docClinicPhotoLabel) {
              docClinicPhotoLabel.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="9" y1="22" x2="9" y2="22.01"/><line x1="15" y1="22" x2="15" y2="22.01"/><line x1="12" y1="18" x2="12" y2="18.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="12" y1="10" x2="12" y2="10.01"/><line x1="12" y1="6" x2="12" y2="6.01"/><line x1="16" y1="18" x2="16" y2="18.01"/><line x1="16" y1="14" x2="16" y2="14.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="16" y1="6" x2="16" y2="6.01"/><line x1="8" y1="18" x2="8" y2="18.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="8" y1="10" x2="8" y2="10.01"/><line x1="8" y1="6" x2="8" y2="6.01"/></svg>
                <span>Clinic Photo</span>
              `;
            }
            if (contributeSubmitBtn) {
              contributeSubmitBtn.disabled = false;
              contributeSubmitBtn.style.background = '';
              contributeSubmitBtn.innerHTML = '<span id="contrBtnText">Submit Contribution Application</span>';
            }
          }, 600);
        } else {
          throw new Error(data.message || 'Failed to submit application.');
        }
      } catch (err) {
        showError(err.message || 'Error communicating with server.');
        if (contributeSubmitBtn) {
          contributeSubmitBtn.disabled = false;
          contributeSubmitBtn.innerHTML = '<span id="contrBtnText">Submit Contribution Application</span>';
        }
      }
    });
  }
})();
