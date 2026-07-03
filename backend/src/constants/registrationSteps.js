const REGISTRATION_STEPS = {
  PERSONAL_INFORMATION: 1,
  BIOLOGICAL_INFORMATION: 2,
  CONTACT_INFORMATION: 3,
  ADDRESS_INFORMATION: 4,
  EMERGENCY_CONTACT: 5,
  HEALTHCARE_PREFERENCES: 6,
  CONSENT_INFORMATION: 7,
};

const REGISTRATION_SECTION_BY_STEP = {
  1: "personalInformation",
  2: "biologicalInformation",
  3: "contactInformation",
  4: "addressInformation",
  5: "emergencyContact",
  6: "healthcarePreferences",
  7: "consentInformation",
};

module.exports = { REGISTRATION_STEPS, REGISTRATION_SECTION_BY_STEP };
