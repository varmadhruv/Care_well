const { User } = require("../models/User");

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

async function requireAuth(req, res, next) {
  try {
    const cookies = parseCookie(req.headers.cookie || "");
    const token = String(req.headers["x-carewell-session"] || cookies.carewell_session || "").trim();
    if (!token) {
      return res.status(401).json({ code: "UNAUTHENTICATED", message: "Not signed in." });
    }

    const user = await User.findOne({ sessionToken: token, sessionExpiresAt: { $gt: new Date() } });
    if (!user) {
      return res.status(401).json({ code: "UNAUTHENTICATED", message: "Not signed in." });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(500).json({ code: "SERVER_ERROR", message: "Unable to verify session." });
  }
}

module.exports = { requireAuth, parseCookie };
