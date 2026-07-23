const fs = require("fs");
const path = require("path");
const axios = require("axios");

/* ─── helpers ────────────────────────────────────────────────────── */

function getEnv(name) {
  return String(process.env[name] || "").trim();
}

function requireEnv(name) {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`${name} is missing.`);
  }
  return value;
}

/* ─── HTML email template ────────────────────────────────────────── */

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

/* ─── Fallback file persistence ──────────────────────────────────── */

function persistFallbackEmail(payload) {
  try {
    const fallbackDir = path.join(__dirname, "..", "..", "data");
    const fallbackFile = path.join(fallbackDir, "assistance-requests.jsonl");
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    fs.appendFileSync(fallbackFile, `${JSON.stringify(payload)}\n`);
  } catch (err) {
    console.error("Failed to write to fallback file", err);
  }
}

/* ─── Main send function (Brevo API) ─────────────────────────────── */

async function sendBrevoMail(formData) {
  const apiKey = getEnv("BREVO_API_KEY");
  const fromEmail = getEnv("MAIL_FROM");
  const fromName = getEnv("MAIL_FROM_NAME");
  const toEmail = getEnv("MAIL_TO");

  if (!apiKey || !fromEmail || !toEmail) {
    throw new Error("BREVO_API_KEY, MAIL_FROM or MAIL_TO is missing in environment variables.");
  }

  let htmlContent = `
    <div style="font-family: Arial, sans-serif;">
      <p>--------------------------------</p>
      <h3>New CareWell Enquiry</h3>
  `;

  for (const [key, value] of Object.entries(formData || {})) {
    if (value !== undefined && value !== null && value !== "") {
      const formattedKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1').trim();
      htmlContent += `
        <p><strong>${formattedKey}:</strong><br/>
        ${value}</p>
      `;
    }
  }

  htmlContent += `
      <p><strong>Submitted At:</strong><br/>
      ${new Date().toLocaleString()}</p>
      <p>--------------------------------</p>
    </div>
  `;

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to: [{ email: toEmail }],
    subject: "New CareWell Enquiry",
    htmlContent,
  };

  try {
    console.log("=== Brevo API Payload (sendBrevoMail) ===");
    console.log(JSON.stringify(payload, null, 2));

    const response = await axios.post("https://api.brevo.com/v3/smtp/email", payload, {
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
    });

    console.log("=== Brevo API Response (sendBrevoMail) ===");
    console.log(JSON.stringify(response.data, null, 2));
    console.log(`Email sent successfully. Message ID: ${response.data.messageId}`);
    return response.data;
  } catch (error) {
    const errorResponse = error.response ? JSON.stringify(error.response.data) : error.message;
    console.warn("Exact Brevo error response:", errorResponse);
    throw new Error(`Brevo error: ${errorResponse}`);
  }
}

async function sendMail({ to, subject, title, heading, message, ctaLabel, ctaUrl, text }) {
  const html = buildHtmlEmail({ title, heading, message, ctaLabel, ctaUrl });
  const plainText = text || String(message || "").replace(/<[^>]+>/g, "");

  const apiKey = getEnv("BREVO_API_KEY");
  const fromEmail = getEnv("MAIL_FROM");
  const fromName = getEnv("MAIL_FROM_NAME");
  
  if (!apiKey || !fromEmail) {
    console.warn("BREVO_API_KEY or MAIL_FROM is missing. Saving to fallback file.");
    persistFallbackEmail({ to, subject, text: plainText, htmlPreview: String(message || "").slice(0, 240) });
    throw new Error("Mail delivery failed: Brevo API key or FROM email missing.");
  }

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to: Array.isArray(to) ? to.map(e => ({ email: e })) : [{ email: to }],
    subject,
    htmlContent: html,
    textContent: plainText,
  };

  try {
    console.log("=== Brevo API Payload (sendMail) ===");
    console.log(JSON.stringify(payload, null, 2));

    const response = await axios.post("https://api.brevo.com/v3/smtp/email", payload, {
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
    });
    
    console.log("=== Brevo API Response (sendMail) ===");
    console.log(JSON.stringify(response.data, null, 2));
    console.log(`Email sent successfully via Brevo. Message ID: ${response.data.messageId}`);
    return response.data;
  } catch (error) {
    const errorResponse = error.response ? JSON.stringify(error.response.data) : error.message;
    console.warn("SMTP delivery failed:", errorResponse);
    persistFallbackEmail({ to, subject, errors: [errorResponse] });
    throw new Error(`Mail delivery failed via all methods: ${errorResponse}`);
  }
}

/* ─── Verification email helper ──────────────────────────────────── */

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
  sendBrevoMail,
  sendVerificationEmail,
  buildHtmlEmail,
};
