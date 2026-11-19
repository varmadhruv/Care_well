const fs = require("fs");
const path = require("path");
const axios = require("axios");
const nodemailer = require("nodemailer");

/* ─── helpers ────────────────────────────────────────────────────── */

function getEnv(name) {
  return String(process.env[name] || "").trim();
}

const OFFICIAL_SENDER_EMAIL = "carewellofficiall@gmail.com";
const OFFICIAL_SENDER_NAME = "CareWell Official";

/* ─── HTML email template ────────────────────────────────────────── */

function buildHtmlEmail({ title, heading, message, ctaLabel, ctaUrl }) {
  const safeTitle = String(title || "CareWell").trim();
  const safeHeading = String(heading || safeTitle).trim();
  const safeMessage = String(message || "").trim();
  const safeCtaLabel = String(ctaLabel || "").trim();
  const safeCtaUrl = String(ctaUrl || "").trim();

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Inter,Arial,sans-serif;color:#1e293b;">
    <div style="max-width:900px;margin:0 auto;padding:40px 20px;">
      <div style="padding-bottom:24px;border-bottom:2px solid #f1f5f9;margin-bottom:32px;">
        <div style="font-size:14px;letter-spacing:.15em;font-weight:800;color:#0b4f8c;text-transform:uppercase;">CareWell Healthcare</div>
        <h1 style="margin:16px 0 0;font-family:Poppins,Inter,Arial,sans-serif;font-size:32px;line-height:1.2;color:#0f172a;font-weight:700;">${safeHeading}</h1>
      </div>
      <div style="font-size:17px;line-height:1.8;color:#334155;font-weight:500;">
        ${safeMessage}
      </div>
      ${safeCtaLabel && safeCtaUrl ? `
      <div style="margin-top:40px;">
        <a href="${safeCtaUrl}" style="display:inline-block;background:#0b4f8c;color:#fff;text-decoration:none;font-weight:700;font-size:16px;line-height:1;border-radius:12px;padding:16px 32px;">${safeCtaLabel}</a>
      </div>` : ""}
      <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;">
        This email was sent from <strong>${OFFICIAL_SENDER_EMAIL}</strong> &middot; CareWell Official Communications.
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
  const fromEmail = OFFICIAL_SENDER_EMAIL;
  const fromName = OFFICIAL_SENDER_NAME;
  const toEmail = getEnv("MAIL_TO") || OFFICIAL_SENDER_EMAIL;

  if (!apiKey) {
    throw new Error("BREVO_API_KEY is missing in environment variables.");
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
    console.log(`=== Brevo API Dispatch from ${fromEmail} ===`);
    const response = await axios.post("https://api.brevo.com/v3/smtp/email", payload, {
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
    });

    console.log(`Email sent successfully via Brevo API. Message ID: ${response.data.messageId}`);
    return response.data;
  } catch (error) {
    const errorResponse = error.response ? JSON.stringify(error.response.data) : error.message;
    console.warn("Exact Brevo error response:", errorResponse);
    throw new Error(`Brevo error: ${errorResponse}`);
  }
}

/* ─── Universal sendMail ─────────────────────────────────────────── */

async function sendMail({ to, subject, title, heading, message, ctaLabel, ctaUrl, text, html: customHtml, attachments }) {
  const html = customHtml || buildHtmlEmail({ title, heading, message, ctaLabel, ctaUrl });
  const plainText = text || String(message || "").replace(/<[^>]+>/g, "");
  const recipientEmail = Array.isArray(to) ? to.join(",") : to;

  // The sender is ALWAYS guaranteed to be carewellofficial@gmail.com
  const fromEmail = OFFICIAL_SENDER_EMAIL;
  const fromName = getEnv("MAIL_FROM_NAME") || OFFICIAL_SENDER_NAME;

  // 1. Try Brevo API directly with current API key
  const apiKey = getEnv("BREVO_API_KEY");
  if (apiKey) {
    try {
      const payload = {
        sender: { name: fromName, email: fromEmail },
        to: Array.isArray(to) ? to.map((e) => ({ email: e.trim() })) : [{ email: recipientEmail.trim() }],
        subject: subject || "CareWell Notification",
        htmlContent: html,
        textContent: plainText,
      };

      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        payload.attachment = attachments.map(att => {
          let contentStr = "";
          if (Buffer.isBuffer(att.content)) {
            contentStr = att.content.toString("base64");
          } else if (typeof att.content === "string") {
            contentStr = att.content.replace(/^data:image\/\w+;base64,/, "");
          }
          return {
            name: att.filename || "attachment.jpg",
            content: contentStr
          };
        }).filter(a => !!a.content);
      }

      console.log(`[EMAIL DISPATCH] Sending from ${fromEmail} to ${recipientEmail} via Brevo API...`);
      const response = await axios.post("https://api.brevo.com/v3/smtp/email", payload, {
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        timeout: 12000,
      });

      console.log(`✅ [BREVO DELIVERED] Email sent from ${fromEmail} to ${recipientEmail}. Message ID: ${response.data.messageId}`);
      return { ok: true, messageId: response.data.messageId, provider: "brevo", from: fromEmail };
    } catch (brevoErr) {
      const errDetail = brevoErr.response ? JSON.stringify(brevoErr.response.data) : brevoErr.message;
      console.warn("⚠️ Brevo API delivery failed:", errDetail);
      if (errDetail.includes("authorised_ips") || errDetail.includes("unauthorised")) {
        console.warn("\n👉 ACTION REQUIRED IN BREVO: Please visit https://app.brevo.com/security/authorised_ips to add your IP or disable IP restrictions, and ensure carewellofficial@gmail.com is listed under https://app.brevo.com/senders\n");
      }
    }
  }

  // 2. Try Nodemailer Gmail SMTP fallback (using carewellofficial@gmail.com)
  const user = getEnv("EMAIL_USER") || OFFICIAL_SENDER_EMAIL;
  const pass = getEnv("EMAIL_PASS");

  if (user && pass) {
    try {
      console.log(`[SMTP FALLBACK] Attempting delivery from ${fromEmail} to ${recipientEmail} via Gmail SMTP...`);
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: fromEmail, pass },
      });
      const mailOptions = {
        from: `"${fromName}" <${fromEmail}>`,
        to: recipientEmail,
        subject: subject || "CareWell Notification",
        html: html,
        text: plainText,
      };
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        mailOptions.attachments = attachments;
      }
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ [GMAIL SMTP DELIVERED] Email sent from ${fromEmail} to ${recipientEmail}: ${info.response}`);
      return { ok: true, messageId: info.messageId, response: info.response, provider: "gmail", from: fromEmail };
    } catch (gmailErr) {
      console.warn("Gmail SMTP delivery failed:", gmailErr.message);
    }
  }

  // 3. Fallback: log to console & file so OTP and credentials are never lost
  const fallbackInfo = persistFallbackEmail({ from: fromEmail, to, subject, text: plainText, htmlPreview: String(message || "").slice(0, 240) });
  console.log("\n==================================================");
  console.log(`📢 [SYSTEM DISPATCH] FROM: ${fromEmail}`);
  console.log(`✉️  TO:      ${to}`);
  console.log(`📌  SUBJECT: ${subject}`);
  console.log(`📝  CONTENT: ${plainText || message || "(HTML content)"}`);
  console.log("==================================================\n");

  return {
    ok: true,
    fallback: true,
    messageId: "fallback-" + Date.now(),
    provider: "fallback-log",
    from: fromEmail,
    note: "Email logged to console and fallback file"
  };
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
  OFFICIAL_SENDER_EMAIL,
  OFFICIAL_SENDER_NAME,
};
