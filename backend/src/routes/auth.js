const express = require("express");
const crypto = require("crypto");
const { User } = require("../models/User");
const { onlyDigits } = require("../utils/sanitize");
const { isValidPhone, isValidEmail } = require("../utils/validators");

const authRouter = express.Router();
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const SESSION_DAYS = 30;

function buildCookie(token) {
  const parts = [
    `carewell_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
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

module.exports = { authRouter };
