(() => {
  const API_HOSTS = ['http://127.0.0.1:3000', 'http://localhost:3000'];
  const API_BASE =
    window.CAREWELL_API_BASE_URL ||
    API_HOSTS[0];

  const STORAGE_KEYS = {
    draft: "carewellRegistrationDraft",
    profile: "userProfile",
    sessionToken: "carewellSessionToken",
  };

  const DEFAULT_STATE = {
    registrationStep: 1,
    registrationCompleted: false,
    personalInformation: {},
    biologicalInformation: {},
    contactInformation: {},
    addressInformation: {},
    emergencyContact: {},
    healthcarePreferences: {},
    consentInformation: {},
    profile: {},
    progress: {
      currentStep: 1,
      totalSteps: 7,
      percent: 0,
    },
  };

  const STEP_TO_SECTION = {
    1: "personalInformation",
    2: "biologicalInformation",
    3: "contactInformation",
    4: "addressInformation",
    5: "emergencyContact",
    6: "healthcarePreferences",
    7: "consentInformation",
  };

  const SECTION_TO_STEP = Object.entries(STEP_TO_SECTION).reduce((acc, [step, section]) => {
    acc[section] = Number(step);
    return acc;
  }, {});
  const KNOWN_SECTIONS = new Set(Object.values(STEP_TO_SECTION));

  const ROUTES = {
    1: "registration.html",
    2: "registration.html",
    3: "registration.html",
    4: "registration.html",
    5: "registration.html",
    6: "registration.html",
    7: "dashboard.html",
  };

  const SAVE_DEBOUNCE_MS = 550;

  const state = {
    data: loadDraft(),
    listeners: new Set(),
    pendingSave: null,
    pendingSaveKey: "",
    autosaveTimers: new Map(),
  };

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value ?? {}));
  }

  function getUserProfile() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.profile) || "{}");
    } catch (error) {
      return {};
    }
  }

  function setUserProfile(profile) {
    sessionStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile || {}));
  }

  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.draft);
      if (!raw) {
        return clone(DEFAULT_STATE);
      }

      const parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch (error) {
      return clone(DEFAULT_STATE);
    }
  }

  function persistDraft(nextState) {
    try {
      sessionStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(nextState));
    } catch (error) {
      // Draft persistence should never break the flow.
    }
  }

  function buildAuthHeaders() {
    const headers = {};
    const token = sessionStorage.getItem(STORAGE_KEYS.sessionToken);
    if (token) {
      headers["x-carewell-session"] = token;
    }
    return headers;
  }

  function normalizeStep(step) {
    const value = Number(step);
    if (!Number.isFinite(value)) return 1;
    return Math.min(7, Math.max(1, Math.trunc(value)));
  }

  function computeProgress(step, completed) {
    const currentStep = normalizeStep(step);
    const totalSteps = 7;
    const percent = Math.round((Math.min(currentStep, totalSteps) / totalSteps) * 100);
    return {
      currentStep,
      totalSteps,
      percent: completed ? 100 : percent,
    };
  }

  function normalizeState(input = {}) {
    const merged = {
      ...clone(DEFAULT_STATE),
      ...clone(input),
    };

    merged.registrationStep = normalizeStep(merged.registrationStep);
    merged.registrationCompleted = Boolean(merged.registrationCompleted);
    merged.personalInformation = isPlainObject(merged.personalInformation) ? merged.personalInformation : {};
    merged.biologicalInformation = isPlainObject(merged.biologicalInformation) ? merged.biologicalInformation : {};
    merged.contactInformation = isPlainObject(merged.contactInformation) ? merged.contactInformation : {};
    merged.addressInformation = isPlainObject(merged.addressInformation) ? merged.addressInformation : {};
    merged.emergencyContact = isPlainObject(merged.emergencyContact) ? merged.emergencyContact : {};
    merged.healthcarePreferences = isPlainObject(merged.healthcarePreferences) ? merged.healthcarePreferences : {};
    merged.consentInformation = isPlainObject(merged.consentInformation) ? merged.consentInformation : {};
    merged.profile = isPlainObject(merged.profile) ? merged.profile : getUserProfile();
    merged.progress = computeProgress(merged.registrationStep, merged.registrationCompleted);
    return merged;
  }

  function getState() {
    return normalizeState(state.data);
  }

  function emit() {
    const snapshot = getState();
    persistDraft(snapshot);
    state.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        // Listener errors should not disrupt registration.
      }
    });
  }

  function setState(nextState) {
    state.data = normalizeState({
      ...state.data,
      ...clone(nextState),
    });
    emit();
    return getState();
  }

  function getSectionForStep(step) {
    return STEP_TO_SECTION[normalizeStep(step)] || "personalInformation";
  }

  function getStepForSection(sectionName) {
    return SECTION_TO_STEP[sectionName] || 1;
  }

  function getRouteForStep(step) {
    return ROUTES[normalizeStep(step)] || "registration.html";
  }

  function sanitizeString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function validateEmail(value) {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  function validatePhone(value) {
    return typeof value === "string" && /^\d{10}$/.test(value.trim());
  }

  function validateDate(value) {
    if (typeof value !== "string" && !(value instanceof Date)) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
  }

  function validateSection(sectionName, sectionData = {}) {
    if (!sectionName || !KNOWN_SECTIONS.has(sectionName)) {
      return { valid: false, message: "Invalid registration section." };
    }
    if (!isPlainObject(sectionData)) {
      return { valid: false, message: "Invalid registration data." };
    }

    const value = clone(sectionData);

    if (Object.prototype.hasOwnProperty.call(value, "email") && value.email && !validateEmail(value.email)) {
      return { valid: false, message: "Please enter a valid email address." };
    }

    if (Object.prototype.hasOwnProperty.call(value, "phoneNumber") && value.phoneNumber && !validatePhone(value.phoneNumber)) {
      return { valid: false, message: "Please enter a valid 10-digit mobile number." };
    }

    if (Object.prototype.hasOwnProperty.call(value, "dateOfBirth") && value.dateOfBirth && !validateDate(value.dateOfBirth)) {
      return { valid: false, message: "Please enter a valid date." };
    }

    if (Object.prototype.hasOwnProperty.call(value, "name") && sanitizeString(value.name).length > 120) {
      return { valid: false, message: "Please shorten the entered name." };
    }

    if (Object.prototype.hasOwnProperty.call(value, "notes") && sanitizeString(value.notes).length > 1000) {
      return { valid: false, message: "Please shorten the entered notes." };
    }

    return { valid: true, message: "" };
  }

  function deepMerge(baseValue, incomingValue) {
    if (Array.isArray(baseValue) || Array.isArray(incomingValue)) {
      return clone(incomingValue ?? baseValue ?? []);
    }

    if (!isPlainObject(baseValue) || !isPlainObject(incomingValue)) {
      return clone(incomingValue ?? baseValue ?? {});
    }

    const result = { ...clone(baseValue) };
    Object.entries(incomingValue).forEach(([key, value]) => {
      if (isPlainObject(value) && isPlainObject(baseValue[key])) {
        result[key] = deepMerge(baseValue[key], value);
      } else if (value !== undefined) {
        result[key] = clone(value);
      }
    });
    return result;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...buildAuthHeaders(),
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || "Unable to restore registration progress.");
    }
    return payload;
  }

  async function loadRegistrationStatus() {
    let lastError;
    for (const baseUrl of API_HOSTS) {
      try {
        return await requestJson(`${baseUrl}/api/users/me/status`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Unable to restore registration progress.");
  }

  async function loadCurrentUser() {
    let lastError;
    for (const baseUrl of API_HOSTS) {
      try {
        return await requestJson(`${baseUrl}/api/users/me`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Unable to restore registration progress.");
  }

  function normalizeSectionPayload(sectionName, payload = {}) {
    if (Object.prototype.hasOwnProperty.call(payload, sectionName) && isPlainObject(payload[sectionName])) {
      return clone(payload[sectionName]);
    }

    if (isPlainObject(payload.sectionData)) {
      return clone(payload.sectionData);
    }

    if (isPlainObject(payload.data)) {
      return clone(payload.data);
    }

    return {};
  }

  async function saveRegistrationStep({
    registrationStep,
    sectionName,
    sectionData = {},
    registrationCompleted = false,
    immediate = true,
  }) {
    const resolvedStep = normalizeStep(registrationStep || getStepForSection(sectionName));
    const resolvedSectionName = sectionName || getSectionForStep(resolvedStep);
    const validation = validateSection(resolvedSectionName, sectionData);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const payload = {
      registrationStep: resolvedStep,
      registrationCompleted: Boolean(registrationCompleted),
      [resolvedSectionName]: clone(sectionData),
    };

    const saveKey = JSON.stringify(payload);
    if (state.pendingSave && state.pendingSaveKey === saveKey) {
      return state.pendingSave;
    }

    const savePromise = fetch(`${API_BASE}/api/users/me/registration`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(),
      },
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result?.message || "Unable to save your information. Please try again.");
        }

        if (result?.profile) {
          setUserProfile(result.profile);
          state.data.profile = result.profile;
        }
        if (typeof result?.registrationStep === "number") {
          state.data.registrationStep = normalizeStep(result.registrationStep);
        }
        if (typeof result?.registrationCompleted === "boolean") {
          state.data.registrationCompleted = result.registrationCompleted;
        }
        if (result?.profile?.[resolvedSectionName]) {
          state.data[resolvedSectionName] = deepMerge(state.data[resolvedSectionName], result.profile[resolvedSectionName]);
        } else {
          state.data[resolvedSectionName] = deepMerge(state.data[resolvedSectionName], sectionData);
        }
        state.data.progress = computeProgress(state.data.registrationStep, state.data.registrationCompleted);
        emit();
        return result;
      })
      .finally(() => {
        state.pendingSave = null;
        state.pendingSaveKey = "";
      });

    state.pendingSave = savePromise;
    state.pendingSaveKey = saveKey;

    if (immediate) {
      return savePromise;
    }

    return savePromise;
  }

  function scheduleAutosave(sectionName, sectionData = {}, options = {}) {
    const resolvedSectionName = sectionName || getSectionForStep(options.registrationStep || getState().registrationStep);
    const timerKey = resolvedSectionName;
    const currentTimer = state.autosaveTimers.get(timerKey);
    if (currentTimer) {
      clearTimeout(currentTimer);
    }

    const timerId = window.setTimeout(() => {
      state.autosaveTimers.delete(timerKey);
      saveRegistrationStep({
        registrationStep: options.registrationStep || getStepForSection(resolvedSectionName),
        sectionName: resolvedSectionName,
        sectionData,
        registrationCompleted: Boolean(options.registrationCompleted),
      }).catch(() => {
        // Autosave failures are surfaced by the page layer if needed.
      });
    }, SAVE_DEBOUNCE_MS);

    state.autosaveTimers.set(timerKey, timerId);
    return timerId;
  }

  function recordSection(sectionName, sectionData = {}, options = {}) {
    const resolvedSectionName = sectionName || getSectionForStep(options.registrationStep || getState().registrationStep);
    const resolvedStep = normalizeStep(options.registrationStep || getStepForSection(resolvedSectionName));
    state.data = normalizeState({
      ...state.data,
      registrationStep: resolvedStep,
      registrationCompleted: Boolean(options.registrationCompleted ?? state.data.registrationCompleted),
      [resolvedSectionName]: deepMerge(state.data[resolvedSectionName], sectionData),
      progress: computeProgress(resolvedStep, Boolean(options.registrationCompleted ?? state.data.registrationCompleted)),
    });
    emit();

    if (options.autosave !== false) {
      scheduleAutosave(resolvedSectionName, sectionData, {
        registrationStep: resolvedStep,
        registrationCompleted: Boolean(options.registrationCompleted),
      });
    }

    return getState();
  }

  async function resumeRegistration() {
    const localDraft = loadDraft();
    const nextState = normalizeState(localDraft);

    const [status, profile] = await Promise.allSettled([loadRegistrationStatus(), loadCurrentUser()]);

    if (status.status === "fulfilled") {
      nextState.registrationStep = normalizeStep(status.value?.registrationStep || nextState.registrationStep || 1);
      nextState.registrationCompleted = Boolean(status.value?.registrationCompleted ?? nextState.registrationCompleted);
    }

    if (profile.status === "fulfilled") {
      const serverProfile = profile.value?.profile || {};
      nextState.profile = serverProfile;
      nextState.registrationStep = normalizeStep(serverProfile.registrationStep || nextState.registrationStep || 1);
      nextState.registrationCompleted = Boolean(serverProfile.registrationCompleted ?? nextState.registrationCompleted);
      nextState.personalInformation = deepMerge(nextState.personalInformation, serverProfile.personalInformation || {});
      nextState.biologicalInformation = deepMerge(nextState.biologicalInformation, serverProfile.biologicalInformation || {});
      nextState.contactInformation = deepMerge(nextState.contactInformation, serverProfile.contactInformation || {});
      nextState.addressInformation = deepMerge(nextState.addressInformation, serverProfile.addressInformation || {});
      nextState.emergencyContact = deepMerge(nextState.emergencyContact, serverProfile.emergencyContact || {});
      nextState.healthcarePreferences = deepMerge(nextState.healthcarePreferences, serverProfile.healthcarePreferences || {});
      nextState.consentInformation = deepMerge(nextState.consentInformation, serverProfile.consentInformation || {});
      setUserProfile(serverProfile);
    }

    state.data = normalizeState(nextState);
    emit();
    return getState();
  }

  async function refreshAndRoute() {
    const current = await resumeRegistration();
    if (current.registrationCompleted) {
      window.location.replace("dashboard.html");
      return current;
    }
    window.location.replace(getRouteForStep(current.registrationStep));
    return current;
  }

  async function gateDashboard() {
    const current = await resumeRegistration();
    if (!current.registrationCompleted) {
      window.location.replace(getRouteForStep(current.registrationStep));
      return false;
    }
    return true;
  }

  function navigateToStep(step, { replace = true } = {}) {
    const route = getRouteForStep(step);
    if (replace) {
      window.location.replace(route);
    } else {
      window.location.href = route;
    }
    return route;
  }

  function goNext() {
    const nextStep = Math.min(7, normalizeStep(getState().registrationStep) + 1);
    return navigateToStep(nextStep);
  }

  function goBack() {
    const previousStep = Math.max(1, normalizeStep(getState().registrationStep) - 1);
    return navigateToStep(previousStep);
  }

  function getProgress() {
    return clone(getState().progress);
  }

  function reset() {
    state.data = clone(DEFAULT_STATE);
    state.pendingSave = null;
    state.pendingSaveKey = "";
    state.autosaveTimers.forEach((timerId) => clearTimeout(timerId));
    state.autosaveTimers.clear();
    try {
      sessionStorage.removeItem(STORAGE_KEYS.draft);
    } catch (error) {
      // No-op.
    }
    emit();
  }

  function onChange(listener) {
    if (typeof listener !== "function") return () => {};
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  function isCompleted() {
    return Boolean(getState().registrationCompleted);
  }

  function hydrateFromProfile(profile = {}) {
    const nextState = normalizeState({
      ...getState(),
      profile,
      registrationStep: profile.registrationStep || getState().registrationStep,
      registrationCompleted: Boolean(profile.registrationCompleted ?? getState().registrationCompleted),
      personalInformation: profile.personalInformation || getState().personalInformation,
      biologicalInformation: profile.biologicalInformation || getState().biologicalInformation,
      contactInformation: profile.contactInformation || getState().contactInformation,
      addressInformation: profile.addressInformation || getState().addressInformation,
      emergencyContact: profile.emergencyContact || getState().emergencyContact,
      healthcarePreferences: profile.healthcarePreferences || getState().healthcarePreferences,
      consentInformation: profile.consentInformation || getState().consentInformation,
    });

    state.data = nextState;
    emit();
    return nextState;
  }

  window.CareWellRegistration = {
    API_BASE,
    STORAGE_KEYS,
    getUserProfile,
    setUserProfile,
    getState,
    setState,
    getProgress,
    getSectionForStep,
    getStepForSection,
    getRouteForStep,
    validateSection,
    recordSection,
    scheduleAutosave,
    saveRegistrationStep,
    resumeRegistration,
    refreshAndRoute,
    gateDashboard,
    navigateToStep,
    goNext,
    goBack,
    loadRegistrationStatus,
    loadCurrentUser,
    hydrateFromProfile,
    reset,
    onChange,
    isCompleted,
  };
})();
