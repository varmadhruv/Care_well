(() => {
  const API_BASE = window.CAREWELL_API_BASE_URL || '';
  const API_HOSTS = Array.isArray(window.CAREWELL_API_BASE_URLS) && window.CAREWELL_API_BASE_URLS.length
    ? window.CAREWELL_API_BASE_URLS
    : [API_BASE].filter(Boolean);

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

  function normalizeState(input) {
    input = input || {};
    const merged = Object.assign({}, clone(DEFAULT_STATE), clone(input));

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
    state.listeners.forEach(function(listener) {
      try {
        listener(snapshot);
      } catch (error) {
        // Listener errors should not disrupt registration.
      }
    });
  }

  function setState(nextState) {
    state.data = normalizeState(Object.assign({}, state.data, clone(nextState)));
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

  function validateSection(sectionName, sectionData) {
    sectionData = sectionData || {};
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
      return clone(incomingValue != null ? incomingValue : (baseValue != null ? baseValue : []));
    }

    if (!isPlainObject(baseValue) || !isPlainObject(incomingValue)) {
      return clone(incomingValue != null ? incomingValue : (baseValue != null ? baseValue : {}));
    }

    const result = Object.assign({}, clone(baseValue));
    Object.entries(incomingValue).forEach(function(entry) {
      const key = entry[0];
      const value = entry[1];
      if (isPlainObject(value) && isPlainObject(baseValue[key])) {
        result[key] = deepMerge(baseValue[key], value);
      } else if (value !== undefined) {
        result[key] = clone(value);
      }
    });
    return result;
  }

  async function requestJson(url, options) {
    options = options || {};
    const response = await fetch(url, Object.assign({}, options, {
      headers: Object.assign({}, options.headers || {}, buildAuthHeaders()),
    }));

    const payload = await response.json().catch(function() { return {}; });
    if (!response.ok) {
      throw new Error(payload && payload.message ? payload.message : "Unable to restore registration progress.");
    }
    return payload;
  }

  async function loadRegistrationStatus() {
    let lastError;
    for (const baseUrl of API_HOSTS) {
      try {
        return await requestJson(baseUrl + '/api/users/me/status');
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
        return await requestJson(baseUrl + '/api/users/me');
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Unable to restore registration progress.");
  }

  function normalizeSectionPayload(sectionName, payload) {
    payload = payload || {};
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

  async function saveRegistrationStep(opts) {
    const registrationStep = opts.registrationStep;
    const sectionName = opts.sectionName;
    const sectionData = opts.sectionData || {};
    const registrationCompleted = opts.registrationCompleted || false;

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

    async function trySave() {
      let lastError;
      for (const baseUrl of API_HOSTS) {
        try {
          const response = await fetch(baseUrl + '/api/users/me/registration', {
            method: "PATCH",
            credentials: "include",
            headers: Object.assign({ "Content-Type": "application/json" }, buildAuthHeaders()),
            body: JSON.stringify(payload),
          });

          const result = await response.json().catch(function() { return {}; });
          if (!response.ok) {
            const status = Number(response.status || 0);
            if ([404, 408, 425, 429, 500, 502, 503, 504].indexOf(status) === -1) {
              throw new Error(result && result.message ? result.message : "Unable to save your information. Please try again.");
            }
            lastError = new Error(result && result.message ? result.message : "Unable to save your information. Please try again.");
            continue;
          }

          if (result && result.profile) {
            setUserProfile(result.profile);
            state.data.profile = result.profile;
          }
          if (result && typeof result.registrationStep === "number") {
            state.data.registrationStep = normalizeStep(result.registrationStep);
          }
          if (result && typeof result.registrationCompleted === "boolean") {
            state.data.registrationCompleted = result.registrationCompleted;
          }
          if (result && result.profile && result.profile[resolvedSectionName]) {
            state.data[resolvedSectionName] = deepMerge(state.data[resolvedSectionName], result.profile[resolvedSectionName]);
          } else {
            state.data[resolvedSectionName] = deepMerge(state.data[resolvedSectionName], sectionData);
          }
          state.data.progress = computeProgress(state.data.registrationStep, state.data.registrationCompleted);
          emit();
          return result;
        } catch (networkError) {
          lastError = networkError;
        }
      }
      throw lastError || new Error("Unable to save your information. Please try again.");
    }

    const savePromise = trySave().finally(function() {
      state.pendingSave = null;
      state.pendingSaveKey = "";
    });

    state.pendingSave = savePromise;
    state.pendingSaveKey = saveKey;

    return savePromise;
  }

  function scheduleAutosave(sectionName, sectionData, options) {
    sectionData = sectionData || {};
    options = options || {};
    const resolvedSectionName = sectionName || getSectionForStep(options.registrationStep || getState().registrationStep);
    const timerKey = resolvedSectionName;
    const currentTimer = state.autosaveTimers.get(timerKey);
    if (currentTimer) {
      clearTimeout(currentTimer);
    }

    const timerId = window.setTimeout(function() {
      state.autosaveTimers.delete(timerKey);
      saveRegistrationStep({
        registrationStep: options.registrationStep || getStepForSection(resolvedSectionName),
        sectionName: resolvedSectionName,
        sectionData: sectionData,
        registrationCompleted: Boolean(options.registrationCompleted),
      }).catch(function() {
        // Autosave failures are surfaced by the page layer if needed.
      });
    }, SAVE_DEBOUNCE_MS);

    state.autosaveTimers.set(timerKey, timerId);
    return timerId;
  }

  function recordSection(sectionName, sectionData, options) {
    sectionData = sectionData || {};
    options = options || {};
    const resolvedSectionName = sectionName || getSectionForStep(options.registrationStep || getState().registrationStep);
    const resolvedStep = normalizeStep(options.registrationStep || getStepForSection(resolvedSectionName));
    const regCompleted = options.registrationCompleted != null ? options.registrationCompleted : state.data.registrationCompleted;
    state.data = normalizeState(Object.assign({}, state.data, {
      registrationStep: resolvedStep,
      registrationCompleted: Boolean(regCompleted),
      [resolvedSectionName]: deepMerge(state.data[resolvedSectionName], sectionData),
      progress: computeProgress(resolvedStep, Boolean(regCompleted)),
    }));
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

    const results = await Promise.allSettled([loadRegistrationStatus(), loadCurrentUser()]);
    const status = results[0];
    const profile = results[1];

    if (status.status === "fulfilled") {
      nextState.registrationStep = normalizeStep((status.value && status.value.registrationStep) || nextState.registrationStep || 1);
      nextState.registrationCompleted = Boolean((status.value && status.value.registrationCompleted != null) ? status.value.registrationCompleted : nextState.registrationCompleted);
    }

    if (profile.status === "fulfilled") {
      const serverProfile = (profile.value && profile.value.profile) || {};
      nextState.profile = serverProfile;
      nextState.registrationStep = normalizeStep(serverProfile.registrationStep || nextState.registrationStep || 1);
      nextState.registrationCompleted = Boolean(serverProfile.registrationCompleted != null ? serverProfile.registrationCompleted : nextState.registrationCompleted);
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

  function navigateToStep(step, opts) {
    opts = opts || {};
    const replace = opts.replace !== false;
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
    state.autosaveTimers.forEach(function(timerId) { clearTimeout(timerId); });
    state.autosaveTimers.clear();
    try {
      sessionStorage.removeItem(STORAGE_KEYS.draft);
    } catch (error) {
      // No-op.
    }
    emit();
  }

  function onChange(listener) {
    if (typeof listener !== "function") return function() {};
    state.listeners.add(listener);
    return function() { state.listeners.delete(listener); };
  }

  function isCompleted() {
    return Boolean(getState().registrationCompleted);
  }

  function hydrateFromProfile(profile) {
    profile = profile || {};
    const current = getState();
    const nextState = normalizeState(Object.assign({}, current, {
      profile: profile,
      registrationStep: profile.registrationStep || current.registrationStep,
      registrationCompleted: Boolean(profile.registrationCompleted != null ? profile.registrationCompleted : current.registrationCompleted),
      personalInformation: profile.personalInformation || current.personalInformation,
      biologicalInformation: profile.biologicalInformation || current.biologicalInformation,
      contactInformation: profile.contactInformation || current.contactInformation,
      addressInformation: profile.addressInformation || current.addressInformation,
      emergencyContact: profile.emergencyContact || current.emergencyContact,
      healthcarePreferences: profile.healthcarePreferences || current.healthcarePreferences,
      consentInformation: profile.consentInformation || current.consentInformation,
    }));

    state.data = nextState;
    emit();
    return nextState;
  }

  window.CareWellRegistration = {
    API_BASE: API_BASE,
    STORAGE_KEYS: STORAGE_KEYS,
    getUserProfile: getUserProfile,
    setUserProfile: setUserProfile,
    getState: getState,
    setState: setState,
    getProgress: getProgress,
    getSectionForStep: getSectionForStep,
    getStepForSection: getStepForSection,
    getRouteForStep: getRouteForStep,
    validateSection: validateSection,
    recordSection: recordSection,
    scheduleAutosave: scheduleAutosave,
    saveRegistrationStep: saveRegistrationStep,
    resumeRegistration: resumeRegistration,
    refreshAndRoute: refreshAndRoute,
    gateDashboard: gateDashboard,
    navigateToStep: navigateToStep,
    goNext: goNext,
    goBack: goBack,
    loadRegistrationStatus: loadRegistrationStatus,
    loadCurrentUser: loadCurrentUser,
    hydrateFromProfile: hydrateFromProfile,
    reset: reset,
    onChange: onChange,
    isCompleted: isCompleted,
  };
})();
