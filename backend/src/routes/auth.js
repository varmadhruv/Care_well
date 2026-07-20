const express = require("express");
const crypto = require("crypto");
const { User } = require("../models/User");
const { AssistanceRequest } = require("../models/AssistanceRequest");
const { onlyDigits } = require("../utils/sanitize");
const { isValidPhone, isValidEmail } = require("../utils/validators");
const { sendMail } = require("../services/mailService");

const authRouter = express.Router();
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const SESSION_DAYS = 30;

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
    return res.status(500).json({ code: "SERVER_ERROR", message: "Unable to save your information. Please try again." });
  }
});

authRouter.post("/logout", async (req, res) => {
  try {
    const cookies = parseCookie(req.headers.cookie || "");
    const token = String(req.headers["x-carewell-session"] || cookies.carewell_session || "").trim();
    if (token) {
      await User.updateOne({ sessionToken: token }, { $unset: { sessionToken: "", sessionExpiresAt: "" } });
    }
    res.setHeader("Set-Cookie", "carewell_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ code: "SERVER_ERROR", message: "Unable to log out." });
  }
});

authRouter.get("/session", async (req, res) => {
  try {
    const cookies = parseCookie(req.headers.cookie || "");
    const token = String(req.headers["x-carewell-session"] || cookies.carewell_session || "").trim();
    if (!token) {
      return res.status(401).json({ code: "UNAUTHENTICATED", message: "Not signed in." });
    }

    const user = await User.findOne({ sessionToken: token, sessionExpiresAt: { $gt: new Date() } }).lean();
    if (!user) {
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

    let messageLines;
    let textLines;
    let mailTarget = "carewelldeveloperr@gmail.com";
    let mailSubject = "CareWell assistance request";

    if (selectedService === "Schedule Consultation") {
      messageLines = [
        "<p style=\"margin:0 0 16px;\"><strong>New Consultation Scheduled</strong></p>",
        `<p style="margin:0 0 12px;">A user has scheduled a video consultation with CareWell.</p>`,
        `<p style="margin:0 0 8px;"><strong>👤 Full Name:</strong> ${name}</p>`,
        `<p style="margin:0 0 8px;"><strong>📞 Contact Number:</strong> <span style="font-size:18px; font-weight:600; color:#0b4f8c;">${phoneNumber}</span></p>`,
        `<p style="margin:0 0 8px;"><strong>📧 Email Address:</strong> ${email}</p>`,
        `<p style="margin:0 0 8px;"><strong>📅 Scheduled Date:</strong> ${date}</p>`,
        `<p style="margin:0 0 8px;"><strong>⏰ Scheduled Time:</strong> ${time} ${period}</p>`,
        `<p style="margin:0 0 8px;"><strong>Service Type:</strong> ${selectedService}</p>`,
        `<p style="margin:0 0 8px;"><strong>Request From:</strong> ${source}</p>`,
      ];

      textLines = [
        "NEW CONSULTATION SCHEDULED",
        "",
        "A user has scheduled a video consultation with CareWell.",
        "",
        `Full Name: ${name}`,
        `Contact Number: ${phoneNumber}`,
        `Email Address: ${email}`,
        `Scheduled Date: ${date}`,
        `Scheduled Time: ${time} ${period}`,
        `Service Type: ${selectedService}`,
        `Request From: ${source}`,
      ];
    } else if (selectedService === "Email Me Information") {
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

      mailTarget = email;
      mailSubject = "Healthcare services at Home - CareWell Nursing Care";

      messageLines = [
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

      textLines = [
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
    } else {
      const isWhatsApp = selectedService === "Chat on WhatsApp";
      const callInstruction = isWhatsApp
        ? "Please talk through WhatsApp <strong style=\"color:#e74c3c;\">(do not connect call)</strong>"
        : "Please call this person to provide CareWell assistance.";

      messageLines = [
        "<p style=\"margin:0 0 16px;\"><strong>New Assistance Request</strong></p>",
        `<p style="margin:0 0 12px;">A user wants to talk with CareWell for assistance.</p>`,
        `<p style="margin:0 0 8px;"><strong>📞 Contact Number:</strong> <span style="font-size:18px; font-weight:600; color:#0b4f8c;">${phoneNumber || "Not provided"}</span></p>`,
        `<p style="margin:0 0 8px;"><strong>Service Type:</strong> ${selectedService}</p>`,
        `<p style="margin:0 0 8px;"><strong>Request From:</strong> ${source}</p>`,
        `<p style="margin:0; color:#666;\"><em>${callInstruction}</em></p>`,
      ];

      textLines = [
        "NEW ASSISTANCE REQUEST",
        "",
        "A user wants to talk with CareWell for assistance.",
        "",
        `Contact Number: ${phoneNumber || "Not provided"}`,
        `Service Type: ${selectedService}`,
        `Request From: ${source}`,
        "",
        isWhatsApp ? "Please talk through WhatsApp (do not connect call)" : "Please call this person to provide CareWell assistance.",
      ];
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

    try {
      await sendMail({
        to: mailTarget,
        subject: mailSubject,
        title: "CareWell Information",
        heading: selectedService === "Email Me Information" ? "Introduction of Services" : "New care assistance request",
        message: messageLines.join(""),
        text: textLines.join("\n"),
      });
      emailSent = true;
    } catch (mailErr) {
      emailError = mailErr?.message || "Unknown mail delivery error";
      console.warn("Mail delivery failed (likely blocked on Render free tier). Saved request to database instead. Error:", emailError);
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

module.exports = { authRouter };
