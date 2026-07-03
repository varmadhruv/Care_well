const { User } = require("../models/User");
const { REGISTRATION_SECTION_BY_STEP } = require("../constants/registrationSteps");
const { sanitizeObject } = require("../utils/sanitize");
const { isValidStep } = require("../utils/validators");
const KNOWN_SECTIONS = new Set(Object.values(REGISTRATION_SECTION_BY_STEP));

function mergeSection(current, incoming) {
  const safeIncoming = sanitizeObject(incoming);
  return {
    ...sanitizeObject(current),
    ...safeIncoming,
  };
}

function nextRegistrationStep(step) {
  const value = Number(step);
  if (!Number.isFinite(value)) return 1;
  return Math.min(7, Math.max(1, value + 1));
}

function findSectionName(payload = {}, step) {
  if (payload && typeof payload.sectionName === "string" && KNOWN_SECTIONS.has(payload.sectionName)) {
    return payload.sectionName;
  }

  const sectionFromPayload = Object.values(REGISTRATION_SECTION_BY_STEP).find((section) =>
    Object.prototype.hasOwnProperty.call(payload || {}, section)
  );

  return sectionFromPayload || REGISTRATION_SECTION_BY_STEP[step];
}

async function updateRegistration(userId, payload = {}) {
  const currentUser = await User.findById(userId).lean();
  if (!currentUser) {
    throw new Error("USER_NOT_FOUND");
  }

  const step = isValidStep(payload.registrationStep) ? Number(payload.registrationStep) : currentUser.registrationStep || 1;
  const sectionName = findSectionName(payload, step);
  if (!sectionName || !KNOWN_SECTIONS.has(sectionName)) {
    throw new Error("INVALID_STEP");
  }
  const sectionPayload = sanitizeObject(payload[sectionName] || payload.sectionData || payload.data);
  const now = new Date();

  const update = {
    $set: {
      updatedAt: now,
      registrationStep: nextRegistrationStep(step),
      [sectionName]: mergeSection(currentUser[sectionName], sectionPayload),
    },
  };

  if (step >= 7 || payload.registrationCompleted === true) {
    update.$set.registrationCompleted = true;
    update.$set.registrationStep = 7;
  }

  const user = await User.findByIdAndUpdate(userId, update, { new: true }).lean();
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  return user;
}

module.exports = {
  updateRegistration,
};
