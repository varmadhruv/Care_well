function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toLowerString(value) {
  return trimString(value).toLowerCase();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function sanitizeObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input;
}

module.exports = {
  trimString,
  toLowerString,
  onlyDigits,
  sanitizeObject,
};
