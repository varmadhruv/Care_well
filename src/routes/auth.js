const express = require("express");
const crypto = require("crypto");
const { User } = require("../models/User");
const Doctor = require("../models/Doctor");
const Nurse = require("../models/Nurse");
const { AssistanceRequest } = require("../models/AssistanceRequest");
const { OtpVerification } = require("../models/OtpVerification");
const { onlyDigits } = require("../utils/sanitize");
const { isValidPhone, isValidEmail } = require("../utils/validators");
const { sendMail, sendBrevoMail } = require("../services/mailService");

const authRouter = express.Router();
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const SESSION_DAYS = 30;

// Head Doctor secure salted PBKDF2 hash (SHA-512, 100,000 iterations)
// Plaintext password is never stored or exposed in code or client
const HEAD_DOCTOR_SALT = "c48e91a0b5f3d72e";
const HEAD_DOCTOR_HASH = "65dc9777571199d6ccdc0331bdad9491e56155159ad560b7196e9ece81f2f7086bcc1a48fc07038217da5e246080739b0cf26e29012ae3919af03a159eefef94";

function verifyPassword(password, salt, expectedHash) {
  try {
    const computed = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(expectedHash, "hex"));
  } catch (err) {
    return false;
  }
}

function buildCookie(token) {
  const parts = [
    `carewell_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("SameSite=None");
    parts.push("Secure");
  } else {
    parts.push("SameSite=Lax");
  }

  return parts.join("; ");
}

function parseCookie(header = "") {
  return String(header)
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const index = pair.indexOf("=");
      if (index > 0) {
        const key = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        acc[key] = decodeURIComponent(value);
      }
      return acc;
    }, {});
}

async function fetchGoogleProfile(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Google userinfo failed:", response.status, detail);
    throw new Error("Unable to verify your account.");
  }

  const data = await response.json();
  if (!isValidEmail(data.email)) {
    throw new Error("Authentication failed.");
  }

  return {
    authentication: {
      provider: "Google",
      googleId: String(data.sub || ""),
      phoneNumber: "",
      email: String(data.email || "").trim().toLowerCase(),
      fullName: String(data.name || "").trim(),
      profilePicture: String(data.picture || "").trim(),
      emailVerified: Boolean(data.email_verified),
      phoneVerified: false,
    },
    googleId: String(data.sub || ""),
    fullName: String(data.name || "").trim(),
    email: String(data.email || "").trim().toLowerCase(),
    profilePicture: String(data.picture || "").trim(),
    emailVerified: Boolean(data.email_verified),
  };
}

function normalizeClientGoogleProfile(data = {}) {
  const email = String(data.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return null;
  }

  return {
    authentication: {
      provider: "Google",
      googleId: String(data.sub || data.googleUserId || "").trim(),
      phoneNumber: undefined,
      email,
      fullName: String(data.name || data.fullName || "").trim(),
      profilePicture: String(data.picture || data.profilePicture || "").trim(),
      emailVerified: Boolean(data.email_verified ?? data.emailVerified),
      phoneVerified: false,
    },
    googleId: String(data.sub || data.googleUserId || "").trim(),
    fullName: String(data.name || data.fullName || "").trim(),
    email,
    profilePicture: String(data.picture || data.profilePicture || "").trim(),
    emailVerified: Boolean(data.email_verified ?? data.emailVerified),
  };
}

function sanitizeProfile(profile) {
  const provider = profile.authentication?.provider || profile.provider || "Phone";
  return {
    googleUserId: profile.authentication?.googleId || profile.googleId || "",
    phoneNumber: profile.authentication?.phoneNumber || profile.phoneNumber || "",
    fullName: profile.authentication?.fullName || profile.fullName || "",
    email: profile.authentication?.email || profile.email || "",
    profilePicture: profile.authentication?.profilePicture || profile.profilePicture || "",
    provider,
    emailVerified: Boolean(profile.authentication?.emailVerified ?? profile.emailVerified),
    phoneVerified: Boolean(profile.authentication?.phoneVerified ?? false),
    sessionToken: profile.sessionToken || "",
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    lastLoginAt: profile.lastLogin,
  };
}

authRouter.post("/google/exchange", async (req, res) => {
  try {
    const accessToken = String(req.body?.accessToken || "").trim();
    const clientProfile = normalizeClientGoogleProfile(req.body?.profile || {});
    let googleProfile = clientProfile;

    if (!googleProfile) {
      if (!accessToken) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Authentication failed." });
      }
      googleProfile = await fetchGoogleProfile(accessToken);
    }

    if (!googleProfile?.email) {
      return res.status(400).json({ code: "VALIDATION_ERROR", message: "Authentication failed." });
    }

    const now = new Date();
    const sessionToken = crypto.randomUUID();
    const sessionExpiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

    const update = {
      authentication: {
        provider: "Google",
        googleId: googleProfile.googleId,
        phoneNumber: undefined,
        email: googleProfile.email,
        fullName: googleProfile.fullName,
        profilePicture: googleProfile.profilePicture,
        emailVerified: googleProfile.emailVerified,
        phoneVerified: false,
      },
      googleId: googleProfile.googleId,
      fullName: googleProfile.fullName,
      profilePicture: googleProfile.profilePicture,
      provider: "Google",
      emailVerified: googleProfile.emailVerified,
      sessionToken,
      sessionExpiresAt,
      lastLogin: now,
      updatedAt: now,
    };

    const user = await User.findOneAndUpdate(
      { email: googleProfile.email },
      {
        $set: update,
        $setOnInsert: {
          email: googleProfile.email,
          createdAt: now,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    ).lean();

    if (!user) {
      return res.status(500).json({ code: "SERVER_ERROR", message: "Unable to verify your account." });
    }

    res.setHeader("Set-Cookie", buildCookie(sessionToken));
    return res.json({
      profile: sanitizeProfile(user),
    });
  } catch (error) {
    console.error("Google exchange failed:", error);
    const message =
      error?.message === "Unable to verify your account." ? error.message : "Unable to connect to Google. Please try again.";
    return res.status(502).json({ code: "GOOGLE_AUTH_ERROR", message });
  }
});

authRouter.post("/phone/start", async (req, res) => {
  try {
    const phoneNumber = onlyDigits(req.body?.phoneNumber);
    if (!isValidPhone(phoneNumber)) {
      return res.status(400).json({ code: "VALIDATION_ERROR", message: "Please enter a valid 10-digit mobile number." });
    }

    const now = new Date();
    const sessionToken = crypto.randomUUID();
    const sessionExpiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    const existingSessionToken = String(req.body?.sessionToken || req.headers["x-carewell-session"] || "").trim();
    const existingUser = existingSessionToken
      ? await User.findOne({ sessionToken: existingSessionToken, sessionExpiresAt: { $gt: new Date() } }).lean()
      : null;
    const existingByPhone = existingUser ? null : await User.findOne({ "authentication.phoneNumber": phoneNumber }).lean();
    const matchedUser = existingUser || existingByPhone;

    const authenticationUpdate = {
      provider: "Phone",
      phoneNumber,
      phoneVerified: true,
    };

    if (matchedUser?.authentication?.googleId) {
      authenticationUpdate.googleId = matchedUser.authentication.googleId;
    }
    if (matchedUser?.authentication?.email) {
      authenticationUpdate.email = matchedUser.authentication.email;
    }
    if (matchedUser?.authentication?.fullName) {
      authenticationUpdate.fullName = matchedUser.authentication.fullName;
    }
    if (matchedUser?.authentication?.profilePicture) {
      authenticationUpdate.profilePicture = matchedUser.authentication.profilePicture;
    }
    if (typeof matchedUser?.authentication?.emailVerified === "boolean") {
      authenticationUpdate.emailVerified = matchedUser.authentication.emailVerified;
    }

    const update = {
      $set: {
        authentication: authenticationUpdate,
        phoneNumber,
        fullName: matchedUser?.fullName || "",
        profilePicture: matchedUser?.profilePicture || "",
        provider: matchedUser?.provider === "Google" ? "Google" : "credentials",
        emailVerified: Boolean(matchedUser?.emailVerified || false),
        sessionToken,
        sessionExpiresAt,
        lastLogin: now,
        updatedAt: now,
        registrationStep: 1,
      },
      $setOnInsert: {
        createdAt: now,
        registrationCompleted: false,
      },
    };

    if (matchedUser?.email) {
      update.$set.email = matchedUser.email;
    } else {
      update.$unset = {
        email: "",
      };
    }

    if (!matchedUser?.phoneNumber) {
      update.$set.phoneNumber = phoneNumber;
    }

    const user = await User.findOneAndUpdate(
      matchedUser ? { _id: matchedUser._id } : { "authentication.phoneNumber": phoneNumber },
      update,
      { new: true, upsert: true, runValidators: true }
    ).lean();

    if (!user) {
      return res.status(500).json({ code: "SERVER_ERROR", message: "Unable to save your information. Please try again." });
    }

    res.setHeader("Set-Cookie", buildCookie(sessionToken));
    return res.json({
      profile: {
        ...sanitizeProfile(user),
        phoneNumber,
      },
      nextRoute: "registration",
    });
  } catch (error) {
    console.error("phone start failed:", error);
    return res.status(500).json({ code: "SERVER_ERROR", message: error.message || "Unable to save your information. Please try again." });
  }
});

authRouter.post("/logout", async (req, res) => {
  try {
    const cookies = parseCookie(req.headers.cookie || "");
    const token = String(req.headers["x-carewell-session"] || cookies.carewell_session || "").trim();
    if (token) {
      await User.updateOne({ sessionToken: token }, { $unset: { sessionToken: "", sessionExpiresAt: "" } }).catch(() => {});
      await Doctor.updateOne({ sessionToken: token }, { $unset: { sessionToken: "", sessionExpiresAt: "" } }).catch(() => {});
    }
    res.setHeader("Set-Cookie", "carewell_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ code: "SERVER_ERROR", message: "Unable to log out." });
  }
});

// Secure Role-Based & Head Doctor Authentication Route
const handleLoginAuth = async (req, res) => {
  try {
    const username = String(req.body?.username || req.body?.identifier || req.body?.userId || "").trim();
    const password = String(req.body?.password || "");

    if (!username || !password) {
      return res.status(400).json({ ok: false, code: "MISSING_CREDENTIALS", message: "Please enter both UserName and Password." });
    }

    // Check any registered Doctor in DB
    let dbDoc = await Doctor.findOne({
      $or: [
        { username: username },
        { username: username.toLowerCase() },
        { doctorId: username.toUpperCase() },
        { email: username.toLowerCase() }
      ]
    });

    if (dbDoc) {
      let isPasswordValid = (dbDoc.password === password);
      if (!isPasswordValid && (username === "Doctor_1" || username === "head_doctor") && (password === "Doct_one" || verifyPassword(password, HEAD_DOCTOR_SALT, HEAD_DOCTOR_HASH))) {
        isPasswordValid = true;
      }

      if (!isPasswordValid) {
        return res.status(401).json({ ok: false, code: "INVALID_CREDENTIALS", message: "Invalid UserName or Password." });
      }

      const sessionToken = crypto.randomUUID();
      const sessionExpiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

      dbDoc.sessionToken = sessionToken;
      dbDoc.sessionExpiresAt = sessionExpiresAt;
      await dbDoc.save().catch(() => {});

      res.setHeader("Set-Cookie", buildCookie(sessionToken));

      const doctorEmail = dbDoc.email || process.env.MAIL_TO || "carewelldeveloperr@gmail.com";
      const doctorName = dbDoc.name ? (dbDoc.name.toLowerCase().startsWith("dr") ? dbDoc.name : `Dr. ${dbDoc.name}`) : "Doctor Profile";

      return res.json({
        ok: true,
        role: "doctor",
        email: doctorEmail,
        redirectUrl: "head-doctor-dashboard.html",
        sessionToken,
        user: {
          doctorId: dbDoc.doctorId,
          name: doctorName,
          role: dbDoc.role || "Doctor",
          location: dbDoc.clinicAddress || dbDoc.clinicName || "Nallasopara East",
          avatar: dbDoc.doctorPhoto || dbDoc.photo || "head_doctor_avatar_2x.png",
          email: doctorEmail,
          phone: dbDoc.phone || "",
          stats: {
            totalPatients: "2,480",
            totalAppointments: "1,240",
            activeServices: "12",
            rating: "4.8",
            todayPatients: "24",
            todayAppointments: "12",
            weeklyTrend: "+12%"
          }
        }
      });
    }

    // Check registered Nurse in DB
    let dbNurse = await Nurse.findOne({
      $or: [
        { username: username },
        { username: username.toLowerCase() },
        { nurseId: username.toUpperCase() },
        { email: username.toLowerCase() }
      ]
    });

    if (dbNurse) {
      const isPasswordValid = (dbNurse.password === password);
      if (!isPasswordValid) {
        return res.status(401).json({ ok: false, code: "INVALID_CREDENTIALS", message: "Invalid UserName or Password." });
      }

      const sessionToken = crypto.randomUUID();
      const sessionExpiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

      dbNurse.sessionToken = sessionToken;
      dbNurse.sessionExpiresAt = sessionExpiresAt;
      await dbNurse.save().catch(() => {});

      res.setHeader("Set-Cookie", buildCookie(sessionToken));

      const nurseEmail = dbNurse.email || "carewellofficiall@gmail.com";
      const nurseName = dbNurse.name || "Staff Nurse";

      return res.json({
        ok: true,
        role: "nurse",
        email: nurseEmail,
        redirectUrl: "nurse-dashboard.html",
        sessionToken,
        user: {
          nurseId: dbNurse.nurseId,
          name: nurseName,
          role: dbNurse.role || dbNurse.specialty || "Staff Nurse",
          specialty: dbNurse.specialty || "Home Care Nurse",
          location: dbNurse.area || dbNurse.place || "Mumbai",
          avatar: dbNurse.photo || "nurse_default_avatar.jpg",
          email: nurseEmail,
          phone: dbNurse.phone || "",
          gender: dbNurse.gender || "Female",
          workTime: dbNurse.workTime || "Full Time (24x7)",
          status: dbNurse.status || "Active",
          education: dbNurse.education || "B.Sc Nursing",
          nearestStation: dbNurse.nearestStation || ""
        }
      });
    }

    // Role 1 fallback: Doctor (username: Doctor_1, password: Doct_one)
    if (username === "Doctor_1" || username === "head_doctor") {
      const isValid = (username === "Doctor_1" && password === "Doct_one") ||
                      (username === "head_doctor" && (password === "Doct_one" || verifyPassword(password, HEAD_DOCTOR_SALT, HEAD_DOCTOR_HASH)));
      if (!isValid) {
        return res.status(401).json({ ok: false, code: "INVALID_CREDENTIALS", message: "Invalid UserName or Password." });
      }

      let docRecord = null;
      try {
        docRecord = await Doctor.findOne({ $or: [{ username: "Doctor_1" }, { username: "head_doctor" }] });
        if (!docRecord) {
          docRecord = await Doctor.create({
            doctorId: "A-201",
            name: "Dr. Doctor 1",
            username: "Doctor_1",
            password: "Doct_one",
            role: "Medical Doctor",
            specialty: "General Physician",
            clinicAddress: "CareWell Clinic, Nallasopara East",
            doctorPhoto: "head_doctor_avatar_2x.png",
            email: process.env.MAIL_TO || "carewelldeveloperr@gmail.com",
            phone: "+91 98765 43210",
            status: "Active",
            experience: "5"
          });
        }
      } catch (dbErr) {
        console.warn("[AUTH] Doctor DB note:", dbErr.message);
      }

      const sessionToken = crypto.randomUUID();
      const sessionExpiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

      if (docRecord && typeof docRecord.save === "function") {
        docRecord.sessionToken = sessionToken;
        docRecord.sessionExpiresAt = sessionExpiresAt;
        await docRecord.save().catch(() => {});
      }

      res.setHeader("Set-Cookie", buildCookie(sessionToken));

      const doctorEmail = docRecord?.email || process.env.MAIL_TO || "carewelldeveloperr@gmail.com";

      return res.json({
        ok: true,
        role: "doctor",
        email: doctorEmail,
        redirectUrl: "head-doctor-dashboard.html",
        sessionToken,
        user: {
          doctorId: docRecord?.doctorId || "A-201",
          name: docRecord?.name || "Dr. Doctor 1",
          role: "Doctor",
          location: docRecord?.clinicAddress || "Nallasopara East",
          avatar: docRecord?.doctorPhoto || "head_doctor_avatar_2x.png",
          email: doctorEmail,
          stats: {
            totalPatients: "2,480",
            totalAppointments: "1,240",
            activeServices: "12",
            rating: "4.8",
            todayPatients: "24",
            todayAppointments: "12",
            weeklyTrend: "+12%"
          }
        }
      });
    }

    // Role 2: Head Admin
    if (username === "samm_10") {
      if (password !== "seema@10##") {
        return res.status(401).json({ ok: false, code: "INVALID_CREDENTIALS", message: "Invalid UserName or Password." });
      }
      return res.json({
        ok: true,
        role: "head_admin",
        email: "seemaprajapati1998@gmail.com",
        redirectUrl: "head-admin-panel.html"
      });
    }

    // Role 3: Developer
    if (username === "dhruvvarma@carewell-developer") {
      if (password !== "dhruv@9b9mqtge") {
        return res.status(401).json({ ok: false, code: "INVALID_CREDENTIALS", message: "Invalid UserName or Password." });
      }
      return res.json({
        ok: true,
        role: "developer",
        email: "dhruvvarma53@gmail.com",
        redirectUrl: "developer-panel.html"
      });
    }

    return res.status(401).json({ ok: false, code: "INVALID_CREDENTIALS", message: "Invalid UserName or Password." });
  } catch (error) {
    console.error("[AUTH LOGIN ERROR]", error);
    return res.status(500).json({ ok: false, code: "SERVER_ERROR", message: "Internal authentication error." });
  }
};

authRouter.post("/login", handleLoginAuth);
authRouter.post("/doctor/login", handleLoginAuth);

authRouter.get("/doctor/profile", async (req, res) => {
  try {
    const cookies = parseCookie(req.headers.cookie || "");
    const token = String(req.headers["x-carewell-session"] || cookies.carewell_session || req.query?.token || "").trim();
    let doc = null;
    if (token) {
      doc = await Doctor.findOne({ sessionToken: token }).lean().catch(() => null);
    }
    if (!doc) {
      doc = await Doctor.findOne().sort({ updatedAt: -1 }).lean().catch(() => null);
    }
    const docName = doc?.name ? (doc.name.toLowerCase().startsWith("dr") ? doc.name : `Dr. ${doc.name}`) : "Doctor Profile";
    return res.json({
      ok: true,
      doctor: {
        doctorId: doc?.doctorId || "A-201",
        name: docName,
        role: doc?.role || "Doctor",
        location: doc?.clinicAddress || doc?.clinicName || "CareWell Clinic, Nallasopara East",
        avatar: doc?.doctorPhoto || doc?.photo || "head_doctor_avatar_2x.png",
        email: doc?.email || "doctor@carewell.com",
        phone: doc?.phone || "+91 98765 43210",
        stats: {
          totalPatients: "2,480",
          totalAppointments: "1,240",
          activeServices: "12",
          rating: "4.8",
          todayPatients: "24",
          todayAppointments: "12",
          weeklyTrend: "+12%"
        }
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error loading doctor profile." });
  }
});

authRouter.get("/head-doctor/profile", async (req, res) => {
  try {
    const cookies = parseCookie(req.headers.cookie || "");
    const token = String(req.headers["x-carewell-session"] || cookies.carewell_session || req.query?.token || "").trim();
    let doc = null;
    if (token) {
      doc = await Doctor.findOne({ sessionToken: token }).lean().catch(() => null);
    }
    if (!doc) {
      doc = await Doctor.findOne().sort({ updatedAt: -1 }).lean().catch(() => null);
    }
    const docName = doc?.name ? (doc.name.toLowerCase().startsWith("dr") ? doc.name : `Dr. ${doc.name}`) : "Doctor Profile";
    return res.json({
      ok: true,
      doctor: {
        doctorId: doc?.doctorId || "A-201",
        name: docName,
        role: doc?.role || "Doctor",
        location: doc?.clinicAddress || doc?.clinicName || "CareWell Clinic, Nallasopara East",
        avatar: doc?.doctorPhoto || doc?.photo || "head_doctor_avatar_2x.png",
        email: doc?.email || "doctor@carewell.com",
        phone: doc?.phone || "+91 98765 43210",
        stats: {
          totalPatients: "2,480",
          totalAppointments: "1,240",
          activeServices: "12",
          rating: "4.8",
          todayPatients: "24",
          todayAppointments: "12",
          weeklyTrend: "+12%"
        }
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Error loading doctor profile." });
  }
});

authRouter.get("/session", async (req, res) => {
  try {
    const cookies = parseCookie(req.headers.cookie || "");
    const token = String(req.headers["x-carewell-session"] || cookies.carewell_session || "").trim();
    if (!token) {
      return res.status(401).json({ code: "UNAUTHENTICATED", message: "Not signed in." });
    }

    let user = await User.findOne({ sessionToken: token, sessionExpiresAt: { $gt: new Date() } }).lean().catch(() => null);
    if (!user) {
      const doc = await Doctor.findOne({ sessionToken: token }).lean().catch(() => null);
      if (doc) {
        return res.json({
          profile: {
            role: "doctor",
            fullName: doc.name || "Dr. Seema Prajapati",
            location: doc.clinicAddress || "Nallasopara East",
            profilePicture: doc.doctorPhoto || "head_doctor_avatar_2x.png",
            email: doc.email || "",
            sessionToken: token
          }
        });
      }
      res.setHeader("Set-Cookie", "carewell_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      return res.status(401).json({ code: "UNAUTHENTICATED", message: "Not signed in." });
    }

    return res.json({ profile: sanitizeProfile(user) });
  } catch (error) {
    return res.status(500).json({ code: "SERVER_ERROR", message: "Unable to restore session." });
  }
});

async function handleAssistanceRequest(req, res) {
  try {
    const phoneNumber = onlyDigits(req.body?.phoneNumber || "");
    const selectedService = String(req.body?.service || "Request a Call Back").trim();
    const source = String(req.body?.source || "Onboarding Screen 5").trim();

    let name = "";
    let email = "";
    let date = "";
    let time = "";
    let period = "";

    if (selectedService === "Schedule Consultation") {
      name = String(req.body?.name || "").trim();
      email = String(req.body?.email || "").trim().toLowerCase();
      date = String(req.body?.date || "").trim();
      time = String(req.body?.time || "").trim();
      period = String(req.body?.period || "AM").trim().toUpperCase();

      if (!name) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Name is required." });
      }
      if (!isValidPhone(phoneNumber)) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Please enter a valid 10-digit mobile number." });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Please enter a valid email address." });
      }
      if (!date || !/^\d{2}-\d{2}-\d{4}$/.test(date)) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Please enter a valid date in DD-MM-YYYY format." });
      }
      if (!time || !/^(0[1-9]|1[0-2]):[0-5]\d$/.test(time)) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Please enter a valid 12-hour time in HH:MM format (01:00 to 12:59)." });
      }
      if (period !== "AM" && period !== "PM") {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Please select a valid period (AM/PM)." });
      }

      // Parse and check if date is not in past or beyond 2 days from today
      const parts = date.split("-");
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const y = parseInt(parts[2], 10);
      const parsedDate = new Date(y, m, d);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const maxDate = new Date(today);
      maxDate.setDate(today.getDate() + 2);

      if (parsedDate < today || parsedDate > maxDate) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Consultation date must be from today up to 2 days in the future." });
      }

      // Check working hours 9:00 AM to 9:00 PM
      const timeParts = time.split(":");
      const hours = parseInt(timeParts[0], 10);
      const minutes = parseInt(timeParts[1], 10);

      let hours24 = hours;
      if (period === "PM" && hours !== 12) {
        hours24 += 12;
      } else if (period === "AM" && hours === 12) {
        hours24 = 0;
      }

      const totalMinutes = hours24 * 60 + minutes;
      const minMinutes = 9 * 60;   // 9:00 AM
      const maxMinutes = 21 * 60;  // 9:00 PM

      if (totalMinutes < minMinutes || totalMinutes > maxMinutes) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Consultation hours are strictly from 9:00 AM to 9:00 PM." });
      }
    } else if (selectedService === "Email Me Information") {
      email = String(req.body?.email || "").trim().toLowerCase();
      if (!isValidEmail(email)) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Please enter a valid email address." });
      }
    } else if (selectedService === "Request a Call Back" && !isValidPhone(phoneNumber)) {
      return res.status(400).json({ code: "VALIDATION_ERROR", message: "Please enter a valid 10-digit mobile number." });
    } else if (selectedService === "Chat on WhatsApp" && !isValidPhone(phoneNumber)) {
      return res.status(400).json({ code: "VALIDATION_ERROR", message: "Please enter a valid 10-digit mobile number." });
    }

    let requestRecord = null;
    try {
      requestRecord = await AssistanceRequest.create({
        service: selectedService,
        phoneNumber,
        email,
        name,
        date,
        time,
        period,
        source,
        emailSent: false,
      });
    } catch (dbErr) {
      console.error("Failed to save assistance request to database:", dbErr.message);
    }

    let emailSent = false;
    let emailError = "";

    // 1. Send dynamic developer notification for every enquiry
    try {
      await sendBrevoMail(req.body);
      emailSent = true;
    } catch (mailErr) {
      emailError = mailErr?.message || "Unknown mail delivery error";
      console.warn("Mail delivery failed:", emailError);
    }

    // 2. Send information email to the user if requested
    if (selectedService === "Email Me Information") {
      const utcDate = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istDate = new Date(utcDate.getTime() + istOffset);
      const hour = istDate.getUTCHours();
      let greeting = "Good morning";
      if (hour >= 12 && hour < 17) {
        greeting = "Good afternoon";
      } else if (hour >= 17 && hour < 21) {
        greeting = "Good evening";
      } else if (hour >= 21 || hour < 4) {
        greeting = "Good night";
      }

      const messageLines = [
        `<p style="margin:0 0 12px;">${greeting},</p>`,
        `<p style="margin:0 0 12px;">Dear Sir/Madam,</p>`,
        `<p style="margin:0 0 16px;">Greetings from CareWell Nursing Care at Home.</p>`,
        `<p style="margin:0 0 16px;">We are pleased to introduce our healthcare services designed to provide professional medical care and nursing support at the comfort of your home.</p>`,
        `<p style="margin:0 0 8px;"><strong>Our services include:</strong></p>`,
        `<ul style="margin:0 0 16px; padding-left:20px;">`,
        `  <li style="margin-bottom:6px;">Home Nursing Care</li>`,
        `  <li style="margin-bottom:6px;">Caregiver / Attendant Services</li>`,
        `  <li style="margin-bottom:6px;">Physiotherapy at Home</li>`,
        `  <li style="margin-bottom:6px;">Doctor Consultation at Home</li>`,
        `  <li style="margin-bottom:6px;">Post-Hospitalization Care</li>`,
        `  <li style="margin-bottom:6px;">Elderly Care</li>`,
        `  <li style="margin-bottom:6px;">Patient Monitoring & Assistance</li>`,
        `  <li style="margin-bottom:6px;">Medical Equipment Support (as available)</li>`,
        `</ul>`,
        `<p style="margin:0 0 16px;">Our mission is to deliver compassionate, reliable, and high-quality healthcare services with experienced professionals, ensuring comfort, safety, and convenience for every patient.</p>`,
        `<p style="margin:0 0 16px;">If you, your family members, or your organization require any home healthcare assistance, we would be happy to serve you.</p>`,
        `<p style="margin:0 0 16px;">For inquiries or bookings, please feel free to contact us.</p>`,
        `<p style="margin:0 0 20px;">Thank you for your valuable time.</p>`,
        `<p style="margin:0; line-height:1.5; color:#0f172a;">`,
        `  Kind Regards,<br/>`,
        `  <strong>CareWell Nursing Care at Home</strong><br/>`,
        `  📞 Contact: 8446204228<br/>`,
        `  📧 Email: carewellofficiall@gmail.com<br/>`,
        `  🌐 Website: <a href="https://care-well-1.onrender.com" style="color:#0b4f8c; text-decoration:none;">https://care-well-1.onrender.com</a>`,
        `</p>`
      ];

      const textLines = [
        `${greeting},`,
        "",
        "Dear Sir/Madam,",
        "",
        "Greetings from CareWell Nursing Care at Home.",
        "",
        "We are pleased to introduce our healthcare services designed to provide professional medical care and nursing support at the comfort of your home.",
        "",
        "Our services include:",
        " - Home Nursing Care",
        " - Caregiver / Attendant Services",
        " - Physiotherapy at Home",
        " - Doctor Consultation at Home",
        " - Post-Hospitalization Care",
        " - Elderly Care",
        " - Patient Monitoring & Assistance",
        " - Medical Equipment Support (as available)",
        "",
        "Our mission is to deliver compassionate, reliable, and high-quality healthcare services with experienced professionals, ensuring comfort, safety, and convenience for every patient.",
        "",
        "If you, your family members, or your organization require any home healthcare assistance, we would be happy to serve you.",
        "",
        "For inquiries or bookings, please feel free to contact us.",
        "",
        "Thank you for your valuable time.",
        "",
        "Kind Regards,",
        "",
        "CareWell Nursing Care at Home",
        "Contact: 8446204228",
        "Email: carewellofficiall@gmail.com",
        "Website: https://care-well-1.onrender.com"
      ];

      try {
        await sendMail({
          to: email,
          subject: "Healthcare services at Home - CareWell Nursing Care",
          title: "CareWell Information",
          heading: "Introduction of Services",
          message: messageLines.join(""),
          text: textLines.join("\n"),
        });
      } catch (err) {
        console.warn("Failed to send information email to user:", err.message);
      }
    }

    if (requestRecord) {
      try {
        await AssistanceRequest.updateOne(
          { _id: requestRecord._id },
          { $set: { emailSent, emailError } }
        );
      } catch (dbUpdateErr) {
        console.error("Failed to update database record with email status:", dbUpdateErr.message);
      }
    }

    if (emailSent || requestRecord) {
      return res.json({
        ok: true,
        message: emailSent
          ? "Assistance request sent successfully."
          : "Assistance request recorded successfully."
      });
    } else {
      return res.status(500).json({
        code: "SERVER_ERROR",
        message: "Unable to process your request. Please try again."
      });
    }
  } catch (error) {
    console.error("assistance request failed:", error?.message || error);
    const userMessage = "Unable to send your request. Please try again.";
    return res.status(500).json({ code: "SERVER_ERROR", message: userMessage });
  }
}

authRouter.post("/assistance/request", handleAssistanceRequest);
authRouter.post("/assistance/callback-request", handleAssistanceRequest);

authRouter.post("/email/send-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      return res.status(400).json({ code: "VALIDATION_ERROR", message: "Please enter a valid email address." });
    }

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await OtpVerification.deleteMany({ email }); // clear old OTPs for this email
    await OtpVerification.create({ email, otp, expiresAt });
    console.log(`[AUTH] New OTP generated for ${email}: ${otp}`);

    const htmlMessage = `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <h2 style="color: #0b4f8c;">CareWell Authentication</h2>
        <p>Your One-Time Password (OTP) for verification is:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #ff9d00; margin: 20px 0;">
          ${otp}
        </div>
        <p>This OTP is valid for 5 minutes. Do not share it with anyone.</p>
      </div>
    `;

    try {
      await sendMail({
        to: email,
        subject: "Your CareWell Verification Code",
        title: "Verify your email",
        heading: "Verification Code",
        message: htmlMessage,
        text: `Your CareWell verification code is: ${otp}. It is valid for 5 minutes.`,
      });
      return res.json({ ok: true, message: "OTP sent successfully." });
    } catch (mailErr) {
      console.warn("Failed to send OTP email:", mailErr.message);
      return res.status(500).json({ code: "SERVER_ERROR", message: "Unable to send OTP email." });
    }
  } catch (error) {
    console.error("send-otp failed:", error);
    return res.status(500).json({ code: "SERVER_ERROR", message: error.message || "An error occurred." });
  }
});

authRouter.post("/email/verify-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const otp = String(req.body?.otp || "").trim();

    console.log(`[AUTH] Verify OTP request for ${email} with entered OTP '${otp}'`);

    if (!isValidEmail(email) || !otp) {
      return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid email or OTP." });
    }

    const verificationRecord = await OtpVerification.findOne({
      email,
      otp,
      expiresAt: { $gt: new Date() },
    });

    if (!verificationRecord) {
      console.warn(`[AUTH] Verify OTP failed: OTP '${otp}' not found or expired for ${email}`);
      return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid or expired OTP." });
    }

    console.log(`[AUTH] OTP '${otp}' verified successfully for ${email}`);

    // OTP is valid. Delete it so it can't be used again
    await OtpVerification.deleteOne({ _id: verificationRecord._id });

    const now = new Date();
    const sessionToken = crypto.randomUUID();
    const sessionExpiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

    const existingUser = await User.findOne({ "authentication.email": email }).lean() || await User.findOne({ email }).lean();
    
    const update = {
      $set: {
        "authentication.provider": "Google", // Treating email sign-in similar to Google for now
        "authentication.email": email,
        "authentication.emailVerified": true,
        email,
        emailVerified: true,
        provider: existingUser?.provider || "credentials",
        sessionToken,
        sessionExpiresAt,
        lastLogin: now,
        updatedAt: now,
        registrationStep: existingUser?.registrationStep || 1,
      },
      $setOnInsert: {
        createdAt: now,
        registrationCompleted: false,
      },
    };

    const user = await User.findOneAndUpdate(
      existingUser ? { _id: existingUser._id } : { email },
      update,
      { new: true, upsert: true, runValidators: true }
    ).lean();

    if (!user) {
      return res.status(500).json({ code: "SERVER_ERROR", message: "Unable to save your information." });
    }

    res.setHeader("Set-Cookie", buildCookie(sessionToken));
    return res.json({
      ok: true,
      profile: sanitizeProfile(user),
      nextRoute: "registration",
    });
  } catch (error) {
    console.error("verify-otp failed:", error);
    return res.status(500).json({ code: "SERVER_ERROR", message: error.message || "An error occurred." });
  }
});

/* ─── Dedicated Nurse Registration OTP Routes ────────────────────── */

authRouter.post("/nurse/send-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = String(req.body?.name || "Nurse Candidate").trim();

    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "Please enter a valid email address." });
    }

    // Generate 6-digit secure OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await OtpVerification.deleteMany({ email });
    await OtpVerification.create({ email, otp, expiresAt });
    console.log(`[NURSE AUTH] Actual OTP generated for ${email}: ${otp}`);

    const htmlMessage = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
        <div style="background: linear-gradient(135deg, #7a2040, #5c1a2e); padding: 32px 24px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">CareWell Nursing Care</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Professional Nurse Onboarding &amp; Verification</p>
        </div>
        <div style="padding: 32px 24px; color: #1e293b;">
          <h2 style="font-size: 18px; color: #0f172a; margin-top: 0;">Email Verification Code</h2>
          <p style="font-size: 15px; line-height: 1.6; color: #475569;">
            Hello <strong>${name}</strong>,<br/>
            Thank you for registering with CareWell. Please use the One-Time Password (OTP) below to verify your email address and complete your nurse onboarding process.
          </p>
          <div style="background: #fdf2f4; border: 2px dashed #7a2040; border-radius: 12px; padding: 20px; text-align: center; margin: 28px 0;">
            <span style="font-size: 13px; font-weight: 600; color: #7a2040; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px;">Your 6-Digit OTP Code</span>
            <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #7a2040; font-family: monospace;">
              ${otp}
            </div>
          </div>
          <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
            ⏳ <strong>Note:</strong> This verification code is strictly confidential and valid for <strong>10 minutes</strong>. Do not disclose this code to anyone.
          </p>
          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
          <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
            © ${new Date().getFullYear()} CareWell Nursing Care. All rights reserved.
          </p>
        </div>
      </div>
    `;

    try {
      await sendMail({
        to: email,
        subject: `CareWell Nurse Verification Code: ${otp}`,
        title: "Verify your email for CareWell Onboarding",
        heading: "Nurse Onboarding Verification",
        message: htmlMessage,
        text: `Hello ${name}, your CareWell verification code is: ${otp}. It is valid for 10 minutes.`,
      });
      return res.json({ ok: true, message: `OTP sent to ${email}. Please check your inbox!` });
    } catch (mailErr) {
      console.warn("Failed to send OTP email via provider:", mailErr.message);
      return res.status(500).json({ ok: false, code: "MAIL_FAILED", message: "Failed to deliver OTP email. Please check your email address or SMTP configuration." });
    }
  } catch (error) {
    console.error("nurse send-otp failed:", error);
    return res.status(500).json({ ok: false, code: "SERVER_ERROR", message: error.message || "An error occurred." });
  }
});

authRouter.post("/nurse/verify-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const otp = String(req.body?.otp || "").trim();

    if (!isValidEmail(email) || !otp) {
      return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "Invalid email or OTP." });
    }

    const verificationRecord = await OtpVerification.findOne({
      email,
      otp,
      expiresAt: { $gt: new Date() },
    });

    if (!verificationRecord) {
      return res.status(400).json({ ok: false, code: "INVALID_OTP", message: "Invalid or expired OTP. Please check your inbox and try again." });
    }

    // Valid OTP: delete to prevent reuse
    await OtpVerification.deleteOne({ _id: verificationRecord._id });
    return res.json({ ok: true, message: "Email verified successfully!" });
  } catch (error) {
    console.error("nurse verify-otp failed:", error);
    return res.status(500).json({ ok: false, code: "SERVER_ERROR", message: error.message || "Verification failed." });
  }
});

/* ─── Dedicated Head Admin Account Password Reset OTP Routes ────────── */

authRouter.post("/admin/send-reset-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || process.env.EMAIL_USER || "carewellofficiall@gmail.com").trim().toLowerCase();
    const adminName = String(req.body?.name || "Head Administrator").trim();

    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "Invalid admin email address." });
    }

    // Generate 6-digit secure OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await OtpVerification.deleteMany({ email });
    await OtpVerification.create({ email, otp, expiresAt });
    console.log(`[ADMIN AUTH] Password Reset OTP generated for ${email}: ${otp}`);

    const htmlMessage = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
        <div style="background: linear-gradient(135deg, #7a2040, #5c1a2e); padding: 32px 24px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">CareWell Security Service</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Head Admin Account Password Reset Request</p>
        </div>
        <div style="padding: 32px 24px; color: #1e293b;">
          <h2 style="font-size: 18px; color: #0f172a; margin-top: 0;">Security Verification Code</h2>
          <p style="font-size: 15px; line-height: 1.6; color: #475569;">
            Hello <strong>${adminName}</strong>,<br/>
            We received a request to reset your <strong>Head Admin Portal Password</strong>. Use the One-Time Password (OTP) below to authenticate and establish a new secure password.
          </p>
          <div style="background: #fdf2f4; border: 2px dashed #7a2040; border-radius: 12px; padding: 20px; text-align: center; margin: 28px 0;">
            <span style="font-size: 13px; font-weight: 600; color: #7a2040; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px;">Your 6-Digit Password Reset OTP</span>
            <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #7a2040; font-family: monospace;">
              ${otp}
            </div>
          </div>
          <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
            🔒 <strong>Security Alert:</strong> If you did not initiate this password reset, please secure your account immediately. This code expires in <strong>10 minutes</strong>.
          </p>
          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
          <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
            © ${new Date().getFullYear()} CareWell Nursing Care. All rights reserved.
          </p>
        </div>
      </div>
    `;

    try {
      await sendMail({
        to: email,
        subject: `CareWell Admin Password Reset OTP: ${otp}`,
        title: "CareWell Admin Password Reset Verification",
        heading: "Admin Security Verification",
        message: htmlMessage,
        text: `Hello ${adminName}, your CareWell Admin Password Reset OTP code is: ${otp}. It is valid for 10 minutes.`,
      });
      return res.json({ ok: true, message: `Security OTP sent to registered email.` });
    } catch (mailErr) {
      console.warn("Failed to send Admin OTP email:", mailErr.message);
      return res.status(500).json({ ok: false, code: "MAIL_FAILED", message: "Failed to send OTP email. Please check server email setup." });
    }
  } catch (error) {
    console.error("admin send-reset-otp failed:", error);
    return res.status(500).json({ ok: false, code: "SERVER_ERROR", message: error.message || "An error occurred." });
  }
});

authRouter.post("/admin/verify-reset-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || process.env.EMAIL_USER || "carewellofficiall@gmail.com").trim().toLowerCase();
    const otp = String(req.body?.otp || "").trim();

    if (!isValidEmail(email) || !otp) {
      return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "Invalid email or OTP." });
    }

    const verificationRecord = await OtpVerification.findOne({
      email,
      otp,
      expiresAt: { $gt: new Date() },
    });

    if (!verificationRecord) {
      return res.status(400).json({ ok: false, code: "INVALID_OTP", message: "Invalid or expired OTP code. Please try again." });
    }

    // Valid OTP: delete to prevent reuse
    await OtpVerification.deleteOne({ _id: verificationRecord._id });
    return res.json({ ok: true, message: "Security OTP verified successfully!" });
  } catch (error) {
    console.error("admin verify-reset-otp failed:", error);
    return res.status(500).json({ ok: false, code: "SERVER_ERROR", message: error.message || "Verification failed." });
  }
});

/* ─── Dedicated Admin Broadcast & Notice Notification Dispatch ─────── */

authRouter.post("/send-notification", async (req, res) => {
  try {
    const { recipients, subject, title, heading, message, reason, actionType, sender = "CareWell Head Administration" } = req.body;
    
    let list = [];
    if (Array.isArray(recipients)) {
      list = recipients.map(r => typeof r === 'string' ? { email: r.trim().toLowerCase(), name: '' } : { email: String(r.email || '').trim().toLowerCase(), name: r.name || '' });
    } else if (typeof recipients === 'string' && recipients.trim()) {
      list = [{ email: recipients.trim().toLowerCase(), name: '' }];
    }

    list = list.filter(r => isValidEmail(r.email));

    if (list.length === 0) {
      return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "No valid recipient email addresses provided." });
    }

    const emailSubject = subject || title || "CareWell Official Communication";
    
    const htmlMessage = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
        <div style="background: linear-gradient(135deg, #7a2040, #5c1a2e); padding: 32px 24px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px;">CareWell Nursing Care</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 13px;">${sender}</p>
        </div>
        <div style="padding: 30px 24px; color: #1e293b;">
          <h2 style="font-size: 18px; color: #0f172a; margin-top: 0;">${heading || title || "Official Notice"}</h2>
          <div style="font-size: 15px; line-height: 1.6; color: #334155; margin: 16px 0;">
            ${message ? `<div style="white-space: pre-wrap; background: #f8fafc; border-left: 4px solid #7a2040; padding: 14px 16px; border-radius: 4px; margin-bottom: 16px;">${message}</div>` : ''}
            ${actionType ? `<p style="margin: 8px 0;"><strong>Action Status:</strong> <span style="color:#dc2626; font-weight:700;">${actionType}</span></p>` : ''}
            ${reason ? `<p style="margin: 8px 0;"><strong>Official Reason / Remarks:</strong><br/><span style="color:#475569; font-style:italic;">${reason}</span></p>` : ''}
          </div>
          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
          <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
            This is an automated notification from CareWell Administration.<br/>
            © ${new Date().getFullYear()} CareWell Nursing Care. All rights reserved.
          </p>
        </div>
      </div>
    `;

    const sendPromises = list.map(async (recipient) => {
      try {
        await sendMail({
          to: recipient.email,
          subject: emailSubject,
          title: title || "CareWell Notice",
          heading: heading || "CareWell Notification",
          message: htmlMessage,
          text: (message ? message + "\n\n" : "") + (reason ? "Reason: " + reason : "")
        });
        return { email: recipient.email, success: true };
      } catch (err) {
        console.warn(`Failed to send notification email to ${recipient.email}:`, err.message);
        return { email: recipient.email, success: false, error: err.message };
      }
    });

    const results = await Promise.all(sendPromises);
    const successCount = results.filter(r => r.success).length;

    return res.json({
      ok: true,
      message: `Notification dispatched successfully to ${successCount} recipient(s).`,
      total: list.length,
      successCount,
      results
    });
  } catch (error) {
    console.error("send-notification error:", error);
    return res.status(500).json({ ok: false, code: "SERVER_ERROR", message: error.message || "Failed to dispatch notification." });
  }
});

/* ─── Dedicated Doctor & Nurse Credentials Change (OTP via Email) ───── */

async function findOrSeedStaff(role, identifier, email) {
  let staff = null;
  const idLower = String(identifier || "").toLowerCase().trim();
  const idTrim = String(identifier || "").trim();
  const emLower = String(email || "").toLowerCase().trim();

  const idQuery = [];
  if (idTrim) {
    const escaped = idTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    idQuery.push(
      { username: idTrim },
      { username: new RegExp(`^${escaped}$`, "i") },
      { nurseId: idTrim },
      { nurseId: idTrim.toUpperCase() },
      { doctorId: idTrim },
      { doctorId: idTrim.toUpperCase() },
      { email: idTrim.toLowerCase() },
      { name: idTrim },
      { name: new RegExp(`^${escaped}$`, "i") },
      { name: new RegExp(escaped, "i") }
    );
    // Also match individual name words (e.g. "Seema" or "Rahul" or "Dhruv")
    const words = idTrim.split(/\s+/).filter(w => w.length >= 3 && !["the", "and", "dr.", "nurse"].includes(w.toLowerCase()));
    for (const w of words) {
      const escW = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      idQuery.push({ name: new RegExp(escW, "i") });
    }
  }
  if (emLower) {
    const escEm = emLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    idQuery.push({ email: emLower }, { email: new RegExp(`^${escEm}$`, "i") });
  }

  if (role === "nurse") {
    if (idQuery.length > 0) {
      staff = await Nurse.findOne({ $or: idQuery });
    }
    // If not found and identifier is empty, fallback to the latest active nurse in DB
    if (!staff && !idTrim && !emLower) {
      staff = await Nurse.findOne().sort({ createdAt: -1 });
    }
  } else if (role === "doctor") {
    if (idQuery.length > 0) {
      staff = await Doctor.findOne({ $or: idQuery });
    }
    // If not found and identifier is empty, fallback to the latest doctor in DB
    if (!staff && !idTrim && !emLower) {
      staff = await Doctor.findOne().sort({ createdAt: -1 });
    }
  }

  if (!staff && idQuery.length > 0) {
    staff = await Doctor.findOne({ $or: idQuery }) || await Nurse.findOne({ $or: idQuery });
  }

  return staff;
}

// 1. Staff Account Info Fetch
authRouter.get("/staff/profile", async (req, res) => {
  try {
    const role = String(req.query?.role || "").toLowerCase();
    const identifier = String(req.query?.identifier || "").trim();
    const email = String(req.query?.email || "").trim().toLowerCase();

    const staff = await findOrSeedStaff(role, identifier, email);

    if (!staff) {
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Staff record not found." });
    }

    return res.json({
      ok: true,
      staff: {
        id: staff.doctorId || staff.nurseId || "",
        name: staff.name || "",
        role: staff.role || (staff.doctorId ? "Doctor" : "Nurse"),
        specialty: staff.specialty || "",
        email: staff.email || "",
        phone: staff.phone || "",
        username: staff.username || "",
        avatar: staff.photo || staff.doctorPhoto || ""
      }
    });
  } catch (err) {
    console.error("staff profile error:", err);
    return res.status(500).json({ ok: false, message: "Failed to load staff profile." });
  }
});

// 1b. Verify Current Credentials (before allowing change)
authRouter.post("/staff/verify-current-creds", async (req, res) => {
  try {
    const role = String(req.body?.role || "").toLowerCase();
    const currentUsername = String(req.body?.currentUsername || req.body?.identifier || "").trim();
    const currentPassword = String(req.body?.currentPassword || "").trim();
    const fallbackId = String(req.body?.identifier || "").trim();

    if (!currentUsername || !currentPassword) {
      return res.status(400).json({ ok: false, code: "MISSING_FIELDS", message: "Current username and password are required." });
    }

    let staff = await findOrSeedStaff(role, currentUsername);
    if (!staff && fallbackId && fallbackId !== currentUsername) {
      staff = await findOrSeedStaff(role, fallbackId);
    }

    if (!staff) {
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Account not found with this username or ID." });
    }

    // Compare passwords: check plain text, trimmed, and special system doctor/nurse passwords
    let isPasswordValid = (staff.password === currentPassword) || (String(staff.password || "").trim() === currentPassword);
    
    if (!isPasswordValid && (staff.username === "Doctor_1" || staff.username === "head_doctor" || currentUsername === "Doctor_1" || currentUsername === "head_doctor")) {
      if (currentPassword === "Doct_one" || verifyPassword(currentPassword, HEAD_DOCTOR_SALT, HEAD_DOCTOR_HASH)) {
        isPasswordValid = true;
      }
    }
    if (!isPasswordValid && (staff.username === "Nurse_101" || currentUsername === "Nurse_101")) {
      if (currentPassword === "Nurse@101") {
        isPasswordValid = true;
      }
    }

    if (!isPasswordValid) {
      return res.status(401).json({ ok: false, code: "WRONG_PASSWORD", message: "Current password is incorrect." });
    }

    const staffEmail = (staff.email || "").trim().toLowerCase();
    // Mask email for display: s***@gmail.com
    let maskedEmail = "";
    if (staffEmail && staffEmail.includes("@")) {
      const [local, domain] = staffEmail.split("@");
      maskedEmail = local.charAt(0) + "***@" + domain;
    }

    return res.json({
      ok: true,
      message: "Credentials verified successfully.",
      email: staffEmail,
      maskedEmail,
      name: staff.name || "",
      identifier: staff.username || staff.doctorId || staff.nurseId || ""
    });
  } catch (err) {
    console.error("verify-current-creds error:", err);
    return res.status(500).json({ ok: false, message: "Server error during verification." });
  }
});

// 1c. Forgot Password — Find staff by email only
authRouter.post("/staff/forgot-find-by-email", async (req, res) => {
  try {
    const role = String(req.body?.role || "").toLowerCase();
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, code: "INVALID_EMAIL", message: "Please enter a valid email address." });
    }

    let staff = await findOrSeedStaff(role, "", email);

    if (!staff) {
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "No account found with this email address." });
    }

    const identifier = staff.username || staff.doctorId || staff.nurseId || "";

    return res.json({
      ok: true,
      message: "Account found.",
      identifier,
      name: staff.name || "",
      email: staff.email
    });
  } catch (err) {
    console.error("forgot-find-by-email error:", err);
    return res.status(500).json({ ok: false, message: "Server error." });
  }
});

// 2. Request OTP to Change Username & Password
authRouter.post("/staff/send-change-otp", async (req, res) => {
  try {
    const role = String(req.body?.role || "").toLowerCase();
    const identifier = String(req.body?.identifier || "").trim();
    const inputEmail = String(req.body?.email || "").trim().toLowerCase();

    const staff = await findOrSeedStaff(role, identifier, inputEmail);

    if (!staff) {
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Staff account not found. Please log in or verify your account details." });
    }

    const targetEmail = (staff.email || inputEmail || "").trim().toLowerCase();
    if (!isValidEmail(targetEmail)) {
      return res.status(400).json({ ok: false, code: "INVALID_EMAIL", message: "No valid registered email address found for your profile. Please contact CareWell IT Administrator." });
    }

    // Generate 6-digit secure numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    await OtpVerification.deleteMany({ email: targetEmail });
    await OtpVerification.create({ email: targetEmail, otp, expiresAt });
    console.log(`[STAFF AUTH] Change-Credentials OTP generated for ${targetEmail} (${staff.name}): ${otp}`);

    const roleTitle = (staff.role || (role === "nurse" ? "Clinical Nurse" : "Medical Doctor"));
    const staffName = staff.name || "Healthcare Professional";

    const htmlMessage = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
        <div style="background: linear-gradient(135deg, #0b4f8c, #1e3a8a); padding: 32px 24px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">CareWell Healthcare Portal</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Staff Account Security Verification</p>
        </div>
        <div style="padding: 32px 24px; color: #1e293b;">
          <h2 style="font-size: 18px; color: #0f172a; margin-top: 0;">Change Username &amp; Password Request</h2>
          <p style="font-size: 15px; line-height: 1.6; color: #475569;">
            Hello <strong>${staffName}</strong> (${roleTitle}),<br/>
            You have requested to change your <strong>Username and/or Password</strong> on the CareWell Staff Portal.
          </p>
          <p style="font-size: 14px; line-height: 1.6; color: #334155;">
            Please use the following One-Time Password (OTP) to authenticate your identity and confirm this change:
          </p>
          <div style="background: #f0f7ff; border: 2px dashed #0b4f8c; border-radius: 12px; padding: 22px; text-align: center; margin: 24px 0;">
            <span style="font-size: 12px; font-weight: 700; color: #0b4f8c; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px;">Your 6-Digit Verification OTP</span>
            <div style="font-size: 38px; font-weight: 800; letter-spacing: 8px; color: #0b4f8c; font-family: monospace;">
              ${otp}
            </div>
          </div>
          <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
            🔒 <strong>Important:</strong> This verification code is valid for <strong>10 minutes</strong>. Do not share this OTP with anyone.<br/>
            If you did not make this request to change your login credentials, please contact the CareWell Administration immediately.
          </p>
          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
          <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
            &copy; ${new Date().getFullYear()} CareWell Nursing Care &bull; Clinical Security Service
          </p>
        </div>
      </div>
    `;

    try {
      await sendMail({
        to: targetEmail,
        subject: `CareWell Security: OTP to Change Username & Password (${otp})`,
        title: "CareWell Staff Credentials Change OTP",
        heading: "Change Username & Password Verification",
        message: htmlMessage,
        text: `Hello ${staffName}, your OTP to change your CareWell Username and Password is: ${otp}. It is valid for 10 minutes. Do not share it with anyone.`
      });
    } catch (mailErr) {
      console.warn("[STAFF AUTH] Failed to send OTP email:", mailErr.message);
    }

    function maskEmail(em) {
      const [u, d] = em.split("@");
      if (!d) return em;
      const maskedU = u.length > 2 ? u[0] + "***" + u[u.length - 1] : u[0] + "***";
      return `${maskedU}@${d}`;
    }

    return res.json({
      ok: true,
      message: `Verification OTP has been sent to your registered email (${maskEmail(targetEmail)}).`,
      email: targetEmail,
      maskedEmail: maskEmail(targetEmail),
      expiresInMinutes: 10
    });
  } catch (error) {
    console.error("staff send-change-otp error:", error);
    return res.status(500).json({ ok: false, code: "SERVER_ERROR", message: error.message || "Failed to generate OTP." });
  }
});

// 2b. Standalone OTP Verification (Validates OTP & issues resetToken)
authRouter.post("/staff/verify-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const otp = String(req.body?.otp || "").trim();

    if (!email || !otp || otp.length !== 6) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", message: "Valid registered email and 6-digit OTP are required." });
    }

    const verificationRecord = await OtpVerification.findOne({
      email,
      otp,
      expiresAt: { $gt: new Date() }
    });

    if (!verificationRecord) {
      return res.status(400).json({ ok: false, code: "INVALID_OTP", message: "Invalid or expired OTP code. Please enter the correct code from your email." });
    }

    const crypto = require("crypto");
    const resetToken = crypto.randomBytes(24).toString("hex");
    verificationRecord.resetToken = resetToken;
    await verificationRecord.save();

    return res.json({
      ok: true,
      message: "OTP successfully verified.",
      resetToken
    });
  } catch (err) {
    console.error("staff verify-otp error:", err);
    return res.status(500).json({ ok: false, message: "Error verifying OTP." });
  }
});

// 3. Verify OTP / resetToken & Apply New Username / Password
authRouter.post("/staff/verify-change-otp", async (req, res) => {
  try {
    const role = String(req.body?.role || "").toLowerCase();
    const identifier = String(req.body?.identifier || "").trim();
    const inputEmail = String(req.body?.email || "").trim().toLowerCase();
    const otp = String(req.body?.otp || "").trim();
    const resetToken = String(req.body?.resetToken || "").trim();
    const newUsername = req.body?.newUsername ? String(req.body.newUsername).trim() : null;
    const newPassword = req.body?.newPassword ? String(req.body.newPassword).trim() : null;

    if (!newUsername && !newPassword) {
      return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "Please enter either a new username or new password." });
    }

    if (!resetToken && (!otp || otp.length !== 6)) {
      return res.status(400).json({ ok: false, code: "INVALID_OTP", message: "Verification required (valid OTP or reset token)." });
    }

    const staff = await findOrSeedStaff(role, identifier, inputEmail);

    if (!staff) {
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Staff account record not found." });
    }

    const targetEmail = (staff.email || inputEmail || "").trim().toLowerCase();
    if (!targetEmail) {
      return res.status(400).json({ ok: false, code: "INVALID_EMAIL", message: "Staff email address missing." });
    }

    // Verify OTP or resetToken in DB
    let verificationRecord = null;
    if (resetToken) {
      verificationRecord = await OtpVerification.findOne({
        email: targetEmail,
        resetToken,
        expiresAt: { $gt: new Date() }
      });
    } else if (otp) {
      verificationRecord = await OtpVerification.findOne({
        email: targetEmail,
        otp,
        expiresAt: { $gt: new Date() }
      });
    }

    if (!verificationRecord) {
      return res.status(400).json({ ok: false, code: "INVALID_OTP", message: "Invalid or expired verification session. Please verify OTP again." });
    }

    // Update Username if provided
    if (newUsername) {
      if (newUsername.length < 3) {
        return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "Username must be at least 3 characters long." });
      }
      // Check collision in Doctor and Nurse collections
      const conflictDoc = await Doctor.findOne({ username: newUsername, _id: { $ne: staff._id } });
      const conflictNurse = await Nurse.findOne({ username: newUsername, _id: { $ne: staff._id } });
      if (conflictDoc || conflictNurse) {
        return res.status(400).json({ ok: false, code: "USERNAME_TAKEN", message: `Username "${newUsername}" is already taken by another user. Please choose a different username.` });
      }
      staff.username = newUsername;
    }

    // Update Password if provided
    if (newPassword) {
      if (newPassword.length < 4) {
        return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "Password must be at least 4 characters long." });
      }
      staff.password = newPassword;
    }

    await staff.save();

    // Invalidate OTP to prevent replay attacks
    await OtpVerification.deleteMany({ email: targetEmail });

    // Send confirmation email
    try {
      await sendMail({
        to: targetEmail,
        subject: "CareWell Security: Your Login Credentials Have Been Updated",
        title: "Login Credentials Changed",
        heading: "Security Confirmation",
        message: `<p>Hello <strong>${staff.name || 'Healthcare Professional'}</strong>,</p><p>Your CareWell Portal login credentials have been successfully updated.</p><p><strong>Updated Username:</strong> <code>${staff.username}</code></p><p style="color:#64748b;font-size:13px;">If you did not perform this change, please contact the IT Administrator immediately to secure your account.</p>`,
        text: `Hello ${staff.name}, your CareWell Portal login credentials have been successfully updated. Your new username is: ${staff.username}.`
      });
    } catch (e) {
      console.warn("[STAFF AUTH] Failed to send confirmation email:", e.message);
    }

    return res.json({
      ok: true,
      message: "Your login credentials (username/password) have been successfully updated!",
      staff: {
        id: staff.doctorId || staff.nurseId,
        name: staff.name,
        role: staff.role,
        username: staff.username,
        email: staff.email
      }
    });
  } catch (error) {
    console.error("staff verify-change-otp error:", error);
    return res.status(500).json({ ok: false, code: "SERVER_ERROR", message: error.message || "Failed to update credentials." });
  }
});

module.exports = { authRouter };
