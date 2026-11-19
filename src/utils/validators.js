function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value) {
  return typeof value === "string" && /^\d{10}$/.test(value.trim());
}

function isValidStep(step) {
  const num = Number(step);
  return Number.isInteger(num) && num >= 1 && num <= 7;
}

module.exports = {
  isValidEmail,
  isValidPhone,
  isValidStep,
};
