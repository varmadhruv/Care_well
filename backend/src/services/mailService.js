const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is missing.`);
  }
  return value;
}

function createTransport() {
  const emailUser = requireEnv("EMAIL_USER");
  const emailPass = requireEnv("EMAIL_PASS");

  if (!emailUser.includes("@")) {
    throw new Error("EMAIL_USER must be a valid email address.");
  }

  if (/^https?:\/\//i.test(emailPass)) {
    throw new Error("EMAIL_PASS looks like a URL. Please set a real Gmail app password instead.");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: emailUser,
      pass: emailPass,
    },
    connectionTimeout: 30000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

function buildHtmlEmail({ title, heading, message, ctaLabel, ctaUrl }) {
  const safeTitle = String(title || "CareWell").trim();
  const safeHeading = String(heading || safeTitle).trim();
  const safeMessage = String(message || "").trim();
  const safeCtaLabel = String(ctaLabel || "").trim();
  const safeCtaUrl = String(ctaUrl || "").trim();

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:850px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:24px;box-shadow:0 16px 40px rgba(15,23,42,.08);overflow:hidden;">
        <div style="padding:28px 28px 16px;">
          <div style="font-size:13px;letter-spacing:.12em;font-weight:700;color:#6cbf43;text-transform:uppercase;">CareWell Nursing Care</div>
          <h1 style="margin:12px 0 0;font-family:Poppins,Inter,Arial,sans-serif;font-size:28px;line-height:1.15;color:#0f172a;">${safeHeading}</h1>
        </div>
        <div style="padding:0 28px 24px;font-size:16px;line-height:1.7;color:#64748b;">
          ${safeMessage}
        </div>
        ${safeCtaLabel && safeCtaUrl ? `
        <div style="padding:0 28px 28px;">
          <a href="${safeCtaUrl}" style="display:inline-block;background:#0b4f8c;color:#fff;text-decoration:none;font-weight:700;font-size:16px;line-height:1;border-radius:16px;padding:14px 22px;">${safeCtaLabel}</a>
        </div>` : ""}
      </div>
    </div>
  </body>
</html>`;
}

function persistFallbackEmail(payload) {
  const fallbackDir = path.join(__dirname, "..", "..", "data");
  const fallbackFile = path.join(fallbackDir, "assistance-requests.jsonl");
  fs.mkdirSync(fallbackDir, { recursive: true });
  fs.appendFileSync(fallbackFile, `${JSON.stringify(payload)}\n`);
}

async function sendMail({ to, subject, title, heading, message, ctaLabel, ctaUrl, text }) {
  const transport = createTransport();
  const from = process.env.EMAIL_FROM || requireEnv("EMAIL_USER");
  const mailOptions = {
    from,
    to,
    subject,
    text: text || String(message || "").replace(/<[^>]+>/g, ""),
    html: buildHtmlEmail({ title, heading, message, ctaLabel, ctaUrl }),
  };

  try {
    return await transport.sendMail(mailOptions);
  } catch (error) {
    const fallbackPayload = {
      createdAt: new Date().toISOString(),
      to,
      subject,
      from,
      text: mailOptions.text,
      htmlPreview: String(message || "").slice(0, 240),
      error: error?.message || "Unknown mail delivery error",
    };

    persistFallbackEmail(fallbackPayload);
    console.warn("Mail delivery failed. Saved request to fallback file:", error?.message || error);
    return { fallback: true, savedTo: path.join("backend", "data", "assistance-requests.jsonl") };
  }
}

async function sendVerificationEmail({ to, name, verifyUrl }) {
  return sendMail({
    to,
    subject: "CareWell verification",
    title: "Verify your email",
    heading: `Hi ${String(name || "there").trim()}, verify your email`,
    message: "Thanks for joining CareWell. Please verify your email address to continue with your account setup.",
    ctaLabel: "Verify Email",
    ctaUrl: verifyUrl,
  });
}

module.exports = {
  sendMail,
  sendVerificationEmail,
  buildHtmlEmail,
};
