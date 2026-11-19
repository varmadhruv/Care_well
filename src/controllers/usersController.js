const { updateRegistration } = require("../services/registrationService");

function projectUser(user) {
  return {
    id: user._id,
    authentication: user.authentication || {},
    registrationStep: user.registrationStep || 1,
    registrationCompleted: Boolean(user.registrationCompleted),
    personalInformation: user.personalInformation || {},
    biologicalInformation: user.biologicalInformation || {},
    contactInformation: user.contactInformation || {},
    addressInformation: user.addressInformation || {},
    emergencyContact: user.emergencyContact || {},
    healthcarePreferences: user.healthcarePreferences || {},
    consentInformation: user.consentInformation || {},
    sessionToken: user.sessionToken || "",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function patchRegistration(req, res) {
  try {
    const user = await updateRegistration(req.user._id, req.body || {});
    return res.json({
      profile: projectUser(user),
      registrationStep: user.registrationStep || 1,
      registrationCompleted: Boolean(user.registrationCompleted),
      nextRoute: user.registrationCompleted ? "dashboard" : "registration",
    });
  } catch (error) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ code: "NOT_FOUND", message: "User not found." });
    }
    if (error.message === "INVALID_STEP") {
      return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid registration step." });
    }
    console.error("registration patch failed:", error);
    return res.status(500).json({ code: "SERVER_ERROR", message: "Unable to save your information. Please try again." });
  }
}

async function getMe(req, res) {
  return res.json({ profile: projectUser(req.user.toObject ? req.user.toObject() : req.user) });
}

async function getStatus(req, res) {
  return res.json({
    registrationStep: req.user.registrationStep || 1,
    registrationCompleted: Boolean(req.user.registrationCompleted),
  });
}

module.exports = {
  patchRegistration,
  getMe,
  getStatus,
};
