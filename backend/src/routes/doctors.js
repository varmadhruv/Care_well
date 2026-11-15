const express = require('express');
const mongoose = require('mongoose');
const Doctor = require('../models/Doctor');
const DoctorSequence = require('../models/DoctorSequence');
const { indexToDoctorId, doctorIdToIndex } = require('../utils/doctorIdGenerator');
const { sendMail } = require('../services/mailService');

const doctorsRouter = express.Router();

function generatePassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  let pass = 'Doc@';
  for (let i = 0; i < 4; i++) pass += letters.charAt(Math.floor(Math.random() * letters.length));
  for (let i = 0; i < 2; i++) pass += digits.charAt(Math.floor(Math.random() * digits.length));
  return pass;
}

function calculateAgeFromDob(dobStr) {
  if (!dobStr) return null;
  const birth = new Date(dobStr);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

async function generateUniqueDoctorUsername(preferred) {
  if (preferred && String(preferred).trim()) {
    const cleanPref = String(preferred).trim();
    const existing = await Doctor.findOne({ username: cleanPref });
    if (!existing) return cleanPref;
  }
  for (let i = 0; i < 100; i++) {
    const candidate = `Doctor_${Math.floor(1000 + Math.random() * 9000)}`;
    const existing = await Doctor.findOne({ username: candidate });
    if (!existing) return candidate;
  }
  return `Doctor_${Date.now().toString().slice(-6)}`;
}

/**
 * Atomically generates the next unique Doctor ID in sequence (A-200 .. Z-999).
 * - Safe for concurrent creation requests.
 * - Never reuses deleted IDs (counter only increments).
 * - Enforces database uniqueness.
 */
async function generateNextDoctorId() {
  while (true) {
    const seqDoc = await DoctorSequence.findOneAndUpdate(
      { _id: 'doctor_id_seq' },
      { $inc: { lastIndex: 1 } },
      { new: true, upsert: true }
    );

    const candidateId = indexToDoctorId(seqDoc.lastIndex);

    // Verify uniqueness in database
    const existing = await Doctor.findOne({ doctorId: candidateId });
    if (!existing) {
      return candidateId;
    }
  }
}

/**
 * Backfills Doctor IDs for existing records missing a Doctor ID.
 * Preserves existing valid Doctor IDs without overwriting them.
 */
async function backfillDoctorIds() {
  try {
    const existingDocs = await Doctor.find({ doctorId: { $exists: true, $ne: null, $ne: '' } });
    let maxIndex = -1;
    for (const doc of existingDocs) {
      const idx = doctorIdToIndex(doc.doctorId);
      if (idx > maxIndex) {
        maxIndex = idx;
      }
    }

    if (maxIndex >= 0) {
      await DoctorSequence.updateOne(
        { _id: 'doctor_id_seq' },
        { $max: { lastIndex: maxIndex } },
        { upsert: true }
      );
    }

    const missingDocs = await Doctor.find({
      $or: [
        { doctorId: { $exists: false } },
        { doctorId: null },
        { doctorId: '' }
      ]
    });

    for (const doc of missingDocs) {
      doc.doctorId = await generateNextDoctorId();
      await doc.save();
    }
  } catch (err) {
    console.error('[DOCTOR ID MIGRATION ERROR]', err.message);
  }
}

// Route: Get all doctors
doctorsRouter.get('/', async (req, res) => {
  try {
    await backfillDoctorIds();
    const doctors = await Doctor.find().sort({ createdAt: -1 });
    res.json({ success: true, doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Route: Get next Doctor ID preview
doctorsRouter.get('/next-id', async (req, res) => {
  try {
    const seqDoc = await DoctorSequence.findOne({ _id: 'doctor_id_seq' });
    const currentIndex = seqDoc ? seqDoc.lastIndex : -1;
    const nextIndex = currentIndex + 1;
    const nextDoctorId = indexToDoctorId(nextIndex);
    res.json({ success: true, nextDoctorId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// In-memory OTP storage for doctor registration email verification (10-minute expiry)
const doctorEmailOtps = new Map();

// Route: Send Doctor Registration Email OTP
doctorsRouter.post('/send-email-otp', async (req, res) => {
  try {
    const { email, doctorName } = req.body || {};
    if (!email || !String(email).trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'A valid email address is required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    doctorEmailOtps.set(cleanEmail, { otp, expiresAt, verified: false });

    // Send email via CareWell official mailService
    try {
      await sendMail({
        to: cleanEmail,
        subject: `CareWell Doctor Verification Code: ${otp}`,
        title: 'CareWell Email Verification',
        heading: 'Doctor Email Verification',
        message: `
          <p>Hello ${doctorName ? 'Dr. ' + String(doctorName).trim() : 'Doctor'},</p>
          <p>Your 6-digit email verification code for CareWell Doctor Registration is:</p>
          <div style="background:#f0fdf4; border:2px dashed #16a34a; border-radius:12px; padding:18px 24px; text-align:center; margin:24px 0;">
            <span style="font-family:monospace; font-size:32px; font-weight:800; letter-spacing:8px; color:#15803d;">${otp}</span>
          </div>
          <p style="font-size:14px; color:#64748b;">This OTP code will expire in 10 minutes. If you did not request this verification, please disregard this email.</p>
        `,
      });
    } catch (mailErr) {
      console.warn('[EMAIL OTP NOTICE]', mailErr.message);
    }

    return res.json({
      success: true,
      message: `Verification code sent to ${cleanEmail}. Please check your inbox.`
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Route: Verify Doctor Registration Email OTP
doctorsRouter.post('/verify-email-otp', async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP code are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanOtp = String(otp).trim();
    const record = doctorEmailOtps.get(cleanEmail);

    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'No verification code was requested for this email, or code has expired. Please request a new OTP.'
      });
    }

    if (Date.now() > record.expiresAt) {
      doctorEmailOtps.delete(cleanEmail);
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new OTP.'
      });
    }

    if (record.otp !== cleanOtp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code. Please check the 6-digit code and try again.'
      });
    }

    record.verified = true;
    doctorEmailOtps.set(cleanEmail, record);

    return res.json({
      success: true,
      message: 'Email address verified successfully!'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Route: Get unique preview credentials
doctorsRouter.get('/generate-credentials', async (req, res) => {
  try {
    const username = await generateUniqueDoctorUsername();
    const password = generatePassword();
    res.json({ success: true, username, password });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Route: Create a new Doctor with backend-generated Doctor ID
doctorsRouter.post('/', async (req, res) => {
  try {
    const {
      name, dob, age, gender, bloodGroup,
      username, password, email, phone, altPhone, clinicName, clinicAddress,
      nearestStation, homeVisit,
      doctorPhoto, photo, clinicPhotos, certificate, certificates, experience,
      workingTime, workingMode, workStart, workEnd,
      role, specialty, status, availability, workingHours
    } = req.body || {};

    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Doctor name is required.' });
    }

    // Age & Experience logic validation
    const calculatedAge = calculateAgeFromDob(dob) ?? (Number(age) || null);
    const expNum = Number(experience) || 0;

    if (calculatedAge !== null) {
      if (calculatedAge < 22) {
        return res.status(400).json({
          success: false,
          message: `Invalid Date of Birth. Doctor must be at least 22 years old to practice medicine (Calculated age: ${calculatedAge} yrs).`
        });
      }
      const maxAllowedExp = Math.max(0, calculatedAge - 22);
      if (expNum > maxAllowedExp) {
        return res.status(400).json({
          success: false,
          message: `Invalid experience (${expNum} yrs). A doctor aged ${calculatedAge} yrs could have started practice only after graduating at ~22 yrs, so maximum experience can be ${maxAllowedExp} years.`
        });
      }
    }

    // Backend generates authoritative unique Doctor ID
    let doctorId;
    try {
      doctorId = await generateNextDoctorId();
    } catch (genErr) {
      return res.status(500).json({
        success: false,
        message: genErr.message || 'Unable to generate a unique Doctor ID. Please try again.'
      });
    }

    // Generate guaranteed unique username & secure password
    const finalUsername = await generateUniqueDoctorUsername(username);
    const finalPassword = (password && String(password).trim()) ? String(password).trim() : generatePassword();

    const newDoctor = new Doctor({
      doctorId,
      name: String(name).trim(),
      dob: dob ? String(dob).trim() : '',
      age: calculatedAge !== null ? calculatedAge : undefined,
      gender: gender ? String(gender).trim() : '',
      bloodGroup: bloodGroup ? String(bloodGroup).trim() : '',
      username: finalUsername,
      password: finalPassword,
      email: email ? String(email).trim().toLowerCase() : '',
      phone: phone ? String(phone).trim() : '',
      altPhone: altPhone ? String(altPhone).trim() : '',
      clinicName: clinicName ? String(clinicName).trim() : '',
      clinicAddress: clinicAddress ? String(clinicAddress).trim() : '',
      nearestStation: nearestStation ? String(nearestStation).trim() : '',
      homeVisit: homeVisit === true || homeVisit === 'true',
      certificate: (Array.isArray(certificates) && certificates.length > 0 && certificates[0].file) ? certificates[0].file : (certificate || ''),
      certificates: Array.isArray(certificates) && certificates.length > 0
        ? certificates.map(c => ({
            name: c.name || 'Medical Certificate',
            file: c.file || c.url || '',
            url: c.url || c.file || '',
            description: c.description || ''
          }))
        : (certificate ? [{ name: 'Medical Certificate', file: certificate, description: '' }] : []),
      emailVerified: true,
      experience: String(expNum),
      role: role ? String(role).trim() : 'Medical Doctor',
      specialty: specialty ? String(specialty).trim() : 'General Physician',
      status: status || 'Active',
      photo: doctorPhoto || photo || '',
      doctorPhoto: doctorPhoto || photo || '',
      clinicPhotos: Array.isArray(clinicPhotos) ? clinicPhotos.filter(Boolean) : [],
      availability: availability || (workingTime ? 'Available' : 'Available'),
      workingHours: workingHours || workingTime || '24 Hours',
      workingTime: workingTime || workingHours || '24 Hours'
    });

    await newDoctor.save();

    // Send credentials email if valid email is provided
    let emailSent = false;
    let emailError = '';
    if (newDoctor.email && newDoctor.email.includes('@')) {
      try {
        await sendMail({
          to: newDoctor.email,
          subject: 'Welcome to CareWell — Your Doctor Portal Credentials',
          title: 'CareWell Doctor Portal Access',
          heading: `Welcome to CareWell, Dr. ${newDoctor.name}!`,
          message: `
            <p>You have been officially registered as a <strong>Medical Doctor</strong> in the CareWell Healthcare System.</p>
            <p>Your doctor portal access credentials have been provisioned:</p>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:20px 24px; margin:24px 0;">
              <p style="margin:0 0 10px; font-size:15px; color:#475569;"><strong>Doctor ID:</strong> <span style="font-family:monospace; color:#0b4f8c; font-size:17px; font-weight:700;">${newDoctor.doctorId}</span></p>
              <p style="margin:0 0 10px; font-size:15px; color:#475569;"><strong>User ID:</strong> <span style="font-family:monospace; color:#0b4f8c; font-size:17px; font-weight:700;">${newDoctor.username}</span></p>
              <p style="margin:0; font-size:15px; color:#475569;"><strong>Temporary Password:</strong> <span style="font-family:monospace; color:#0b4f8c; font-size:17px; font-weight:700;">${newDoctor.password}</span></p>
            </div>
            <p style="font-size:14px; color:#64748b; line-height:1.6;">You can now access your doctor dashboard, appointments, and patient records. Please update your password after logging in.</p>
          `,
          ctaLabel: 'Login to CareWell',
          ctaUrl: 'http://localhost:3000',
        });
        emailSent = true;
      } catch (mailErr) {
        emailError = mailErr.message;
        console.warn('[DOCTOR ADD EMAIL NOTICE]', mailErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      doctorId: newDoctor.doctorId,
      doctor: newDoctor,
      credentials: {
        doctorId: newDoctor.doctorId,
        username: newDoctor.username,
        password: finalPassword,
        email: newDoctor.email,
        emailSent,
        emailError
      },
      message: `Doctor successfully created with ID: ${newDoctor.doctorId}`
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Unable to generate a unique Doctor ID. Please try again.'
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Route: Delete a Doctor by doctorId or _id
doctorsRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required.' });
    }
    const query = mongoose.Types.ObjectId.isValid(id)
      ? { $or: [{ _id: id }, { doctorId: id.toUpperCase() }] }
      : { doctorId: id.toUpperCase() };

    const deleted = await Doctor.findOneAndDelete(query);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }
    return res.json({ success: true, message: `Doctor [${deleted.doctorId || id}] deleted successfully.` });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = { doctorsRouter, backfillDoctorIds, generateNextDoctorId };
