const express = require("express");
const mongoose = require("mongoose");
const Nurse = require("../models/Nurse");
const { sendMail } = require("../services/mailService");

const nursesRouter = express.Router();

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pass = "Nurse@";
  for (let i = 0; i < 4; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  for (let i = 0; i < 2; i++) {
    pass += Math.floor(Math.random() * 10).toString();
  }
  return pass;
}

// In-memory OTP storage for nurse registration (10-minute expiry)
const nurseEmailOtps = new Map();

// Route: Send Nurse Registration Email OTP
nursesRouter.post("/send-email-otp", async (req, res) => {
  try {
    const { email, nurseName } = req.body || {};
    if (!email || !String(email).trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "A valid email address is required." });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Check if email is already registered to another nurse
    const existingNurse = await Nurse.findOne({ email: cleanEmail });
    if (existingNurse) {
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_EMAIL",
        message: `Email ${cleanEmail} is already registered to nurse ${existingNurse.name} (ID: ${existingNurse.nurseId || existingNurse._id}).`
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    nurseEmailOtps.set(cleanEmail, { otp, expiresAt, verified: false });

    try {
      await sendMail({
        to: cleanEmail,
        subject: `CareWell Nurse Verification Code: ${otp}`,
        title: "CareWell Email Verification",
        heading: "Nurse Email Verification",
        message: `
          <p>Hello ${nurseName ? String(nurseName).trim() : "Staff Nurse"},</p>
          <p>Your 6-digit email verification code for CareWell Nurse Registration is:</p>
          <div style="background:#fdf2f8; border:2px dashed #db2777; border-radius:12px; padding:18px 24px; text-align:center; margin:24px 0;">
            <span style="font-family:monospace; font-size:32px; font-weight:800; letter-spacing:8px; color:#be185d;">${otp}</span>
          </div>
          <p style="font-size:14px; color:#64748b;">This code expires in 10 minutes. If you did not request this, please ignore this email.</p>
        `,
      });
    } catch (mailErr) {
      console.warn("[NURSE EMAIL OTP NOTICE]", mailErr.message);
    }

    return res.json({
      success: true,
      message: `Verification code sent to ${cleanEmail}. Please check your inbox.`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Route: Verify Nurse Registration Email OTP
nursesRouter.post("/verify-email-otp", async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP code are required." });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanOtp = String(otp).trim();
    const record = nurseEmailOtps.get(cleanEmail);

    if (!record) {
      return res.status(400).json({
        success: false,
        message: "No verification code was requested for this email or it has expired.",
      });
    }

    if (Date.now() > record.expiresAt) {
      nurseEmailOtps.delete(cleanEmail);
      return res.status(400).json({
        success: false,
        message: "Verification code has expired. Please request a new OTP.",
      });
    }

    if (record.otp !== cleanOtp) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code. Please check and retry.",
      });
    }

    record.verified = true;
    nurseEmailOtps.set(cleanEmail, record);

    return res.json({
      success: true,
      message: "Email address verified successfully!",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// GET all nurses
nursesRouter.get("/", async (req, res) => {
  try {
    const nurses = await Nurse.find().sort({ createdAt: -1 });
    return res.json({ success: true, nurses });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST add new nurse
nursesRouter.post("/", async (req, res) => {
  try {
    const {
      name,
      dob,
      age,
      gender,
      bloodGroup,
      email,
      phone,
      altPhone,
      place,
      state,
      city,
      area,
      nearestStation,
      homeVisit,
      workTime,
      experience,
      specialty,
      specialties,
      fullAddress,
      reference,
      refNote,
      aadhaarPhoto,
      panPhoto,
      role,
      education,
      degrees,
      certificates,
      kycDocuments,
      workplaces,
      photo,
      shortDescription,
      username,
      password,
      status,
      aadhaarNumber,
      panNumber,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Nurse name is required." });
    }

    // Duplicate Checks: Email, Phone, Aadhaar, PAN
    const cleanEmail = email ? String(email).trim().toLowerCase() : "";
    if (cleanEmail) {
      const dupEmail = await Nurse.findOne({ email: cleanEmail });
      if (dupEmail) {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_EMAIL",
          message: `A nurse with email ${cleanEmail} is already registered (${dupEmail.name}, ID: ${dupEmail.nurseId}).`
        });
      }
    }

    const cleanPhone = phone ? String(phone).replace(/\D/g, "") : "";
    if (cleanPhone) {
      const dupPhone = await Nurse.findOne({ phone: cleanPhone });
      if (dupPhone) {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_PHONE",
          message: `A nurse with mobile number ${cleanPhone} is already registered (${dupPhone.name}, ID: ${dupPhone.nurseId}).`
        });
      }
    }

    const cleanAltPhone = altPhone ? String(altPhone).replace(/\D/g, "") : "";
    if (cleanAltPhone) {
      if (cleanPhone && cleanAltPhone === cleanPhone) {
        return res.status(400).json({
          success: false,
          code: "SAME_PHONE_NUMBERS",
          message: "Alternate contact number cannot be the same as primary contact number."
        });
      }
      const dupAltPhone = await Nurse.findOne({ phone: cleanAltPhone });
      if (dupAltPhone) {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_ALT_PHONE",
          message: `The alternate number ${cleanAltPhone} is already in use as primary mobile by nurse ${dupAltPhone.name} (ID: ${dupAltPhone.nurseId}).`
        });
      }
    }

    const cleanAadhaar = (aadhaarNumber || req.body?.aadhaarNumber) ? String(aadhaarNumber || req.body?.aadhaarNumber).replace(/\D/g, "") : "";
    if (cleanAadhaar && cleanAadhaar.length === 12) {
      const dupAadhaar = await Nurse.findOne({ aadhaarNumber: cleanAadhaar });
      if (dupAadhaar) {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_AADHAAR",
          message: `A nurse with Aadhaar number ending in ${cleanAadhaar.slice(-4)} is already registered (${dupAadhaar.name}, ID: ${dupAadhaar.nurseId}).`
        });
      }
    }

    const cleanPan = (panNumber || req.body?.panNumber) ? String(panNumber || req.body?.panNumber).trim().toUpperCase() : "";
    if (cleanPan) {
      const dupPan = await Nurse.findOne({ panNumber: cleanPan });
      if (dupPan) {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_PAN",
          message: `A nurse with PAN number ${cleanPan} is already registered (${dupPan.name}, ID: ${dupPan.nurseId}).`
        });
      }
    }

    const count = await Nurse.countDocuments();
    const cleanName = String(name).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    const nurseId = `CW-N-${100 + count + 1}`;
    const finalUsername = (username && String(username).trim())
      ? String(username).trim()
      : `nurse_${cleanName || "staff"}_${Math.floor(100 + Math.random() * 900)}`;
    const finalPassword = (password && String(password).trim()) ? String(password).trim() : generatePassword();

    const newNurse = new Nurse({
      nurseId,
      name: String(name).trim(),
      dob: dob ? String(dob).trim() : "",
      age: age ? Number(age) : null,
      gender: gender ? String(gender).trim() : "Female",
      bloodGroup: bloodGroup ? String(bloodGroup).trim() : "",
      email: email ? String(email).trim().toLowerCase() : "",
      emailVerified: true,
      phone: phone ? String(phone).trim() : "",
      altPhone: altPhone ? String(altPhone).trim() : "",
      place: (area || city || place) ? String(area || city || place).trim() : "",
      state: state ? String(state).trim() : "",
      city: city ? String(city).trim() : "",
      area: (area || city || place) ? String(area || city || place).trim() : "",
      nearestStation: nearestStation ? String(nearestStation).trim() : "",
      homeVisit: homeVisit === true || homeVisit === "true",
      workTime: workTime ? String(workTime).trim() : "Full Time (24x7)",
      experience: experience ? String(experience).trim() : "1",
      specialty: specialty || role || "General Clinical Care",
      specialties: Array.isArray(specialties) ? specialties : (specialty ? [specialty] : []),
      fullAddress: fullAddress ? String(fullAddress).trim() : "",
      reference: reference ? String(reference).trim() : "",
      refNote: refNote ? String(refNote).trim() : "",
      aadhaarPhoto: aadhaarPhoto || "",
      aadhaarNumber: cleanAadhaar,
      panPhoto: panPhoto || "",
      panNumber: cleanPan,
      role: role || specialty || "Home Care Nurse",
      education: education || "B.Sc Nursing",
      degrees: Array.isArray(degrees) ? degrees : [],
      certificates: Array.isArray(certificates) ? certificates : [],
      kycDocuments: kycDocuments || {},
      workplaces: Array.isArray(workplaces) ? workplaces : [],
      photo: photo || "",
      shortDescription: shortDescription ? String(shortDescription).trim() : "",
      username: finalUsername,
      password: finalPassword,
      status: status || "Active",
    });

    await newNurse.save();

    // Send credentials email if valid email is provided
    let emailSent = false;
    if (newNurse.email && newNurse.email.includes("@")) {
      try {
        await sendMail({
          to: newNurse.email,
          subject: "Welcome to CareWell — Your Staff Account Credentials",
          title: "CareWell Nurse Staff Access",
          heading: `Welcome to CareWell, ${newNurse.name}!`,
          message: `
            <p>You have been officially registered as a <strong>Clinical Nurse</strong> on the CareWell Healthcare System.</p>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:18px 24px; margin:24px 0;">
              <p style="margin:0 0 10px; font-size:15px; color:#475569;"><strong>Your Staff ID:</strong> <span style="font-family:monospace; color:#0b4f8c; font-size:16px;">${nurseId}</span></p>
              <p style="margin:0 0 10px; font-size:15px; color:#475569;"><strong>Your User ID:</strong> <span style="font-family:monospace; color:#0b4f8c; font-size:16px;">${newNurse.username}</span></p>
              <p style="margin:0; font-size:15px; color:#475569;"><strong>Temporary Password:</strong> <span style="font-family:monospace; color:#0b4f8c; font-size:16px; font-weight:700;">${newNurse.password}</span></p>
            </div>
            <p style="color:#64748b; font-size:14px;">Use these credentials to log in to the CareWell portal. For security reasons, please update your password after your initial login.</p>
          `,
          ctaLabel: "Login to CareWell",
          ctaUrl: "http://localhost:3000",
        });
        emailSent = true;
      } catch (mailErr) {
        console.warn("[NURSE ADD EMAIL NOTICE]", mailErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: `Nurse ${newNurse.name} added successfully!`,
      nurse: newNurse,
      credentials: {
        nurseId,
        username: newNurse.username,
        password: newNurse.password,
        email: newNurse.email,
        emailSent,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE nurse by ID (supports MongoDB _id or nurseId like CW-N-101, case-insensitive)
nursesRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Nurse ID is required." });
    }
    const cleanId = String(id).trim();
    const isObjectId = mongoose.Types.ObjectId.isValid(cleanId);
    const query = isObjectId
      ? { $or: [{ _id: cleanId }, { nurseId: cleanId }, { nurseId: cleanId.toUpperCase() }] }
      : { $or: [{ nurseId: cleanId }, { nurseId: cleanId.toUpperCase() }, { nurseId: new RegExp(`^${cleanId}$`, "i") }] };

    const deleted = await Nurse.findOneAndDelete(query);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Nurse not found." });
    }
    return res.json({ success: true, message: `Nurse ${deleted.name} [${deleted.nurseId}] deleted successfully.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = { nursesRouter };
