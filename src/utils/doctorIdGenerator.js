const mongoose = require('mongoose');

/**
 * Converts a zero-based sequence index (0..20799) to a Doctor ID (A-200 .. Z-999).
 * Format: ONE uppercase letter + hyphen + EXACTLY 3 digits (200..999).
 * Capacity: 26 letters * 800 numbers = 20,800 total unique IDs.
 */
function indexToDoctorId(index) {
  if (typeof index !== 'number' || isNaN(index) || index < 0 || index >= 20800) {
    throw new Error('Doctor ID range has been exhausted (maximum capacity Z-999 reached).');
  }
  const letterIndex = Math.floor(index / 800); // 0 = 'A', 1 = 'B', ..., 25 = 'Z'
  const letter = String.fromCharCode(65 + letterIndex);
  const number = 200 + (index % 800); // 200..999
  return `${letter}-${number}`;
}

/**
 * Parses a Doctor ID string (e.g. "A-200") back to its sequence index (0..20799).
 * Returns -1 if invalid format or out of bounds.
 */
function doctorIdToIndex(doctorId) {
  if (!doctorId || typeof doctorId !== 'string') return -1;
  const match = doctorId.trim().toUpperCase().match(/^([A-Z])-(\d{3})$/);
  if (!match) return -1;
  const letterIndex = match[1].charCodeAt(0) - 65;
  const num = parseInt(match[2], 10);
  if (letterIndex < 0 || letterIndex > 25 || num < 200 || num > 999) return -1;
  return letterIndex * 800 + (num - 200);
}

module.exports = {
  indexToDoctorId,
  doctorIdToIndex
};
