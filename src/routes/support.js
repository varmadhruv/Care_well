const express = require("express");
const { sendMail } = require("../services/mailService");

const supportRouter = express.Router();

supportRouter.post("/ticket", async (req, res) => {
  try {
    const { subject, module: featureModule, priority, description, ticketId } = req.body;

    if (!subject || !description) {
      return res.status(400).json({ success: false, message: "Subject and description are required." });
    }

    const tId = ticketId || `CW-${Math.floor(1000 + Math.random() * 9000)}`;
    const formattedPriority = (priority || "normal").toUpperCase();
    const formattedModule = (featureModule || "General").toUpperCase();
    const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const priorityBadgeColor = formattedPriority === "CRITICAL" ? "#ef4444" : formattedPriority === "HIGH" ? "#f59e0b" : "#10b981";

    const htmlMessage = `
      <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden; box-shadow:0 4px 14px rgba(0,0,0,0.06);">
        <div style="background:linear-gradient(135deg,#5c1a2e,#7a2040); padding:24px 28px; color:#ffffff;">
          <div style="font-size:12px; letter-spacing:1px; text-transform:uppercase; color:#fca5a5; font-weight:700;">CareWell Head Admin Panel &bull; Engineering Support Desk</div>
          <h2 style="margin:8px 0 0; font-size:22px; font-weight:700; color:#ffffff;">Technical Bug / Incident Ticket</h2>
          <div style="margin-top:6px; font-size:14px; color:rgba(255,255,255,0.85); font-weight:600;">Ticket ID: <span style="background:rgba(255,255,255,0.2); padding:2px 8px; border-radius:6px;">#${tId}</span></div>
        </div>

        <div style="padding:28px;">
          <!-- Metadata Table -->
          <table style="width:100%; border-collapse:collapse; margin-bottom:24px; font-size:14px;">
            <tr>
              <td style="padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; width:35%; font-weight:600; color:#475569;">Issue Subject:</td>
              <td style="padding:10px 12px; border:1px solid #e2e8f0; font-weight:700; color:#0f172a;">${subject}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; font-weight:600; color:#475569;">Module / Area:</td>
              <td style="padding:10px 12px; border:1px solid #e2e8f0; color:#1e293b; font-weight:600;">${formattedModule}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; font-weight:600; color:#475569;">Urgency Priority:</td>
              <td style="padding:10px 12px; border:1px solid #e2e8f0;">
                <span style="display:inline-block; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:800; color:#ffffff; background:${priorityBadgeColor};">${formattedPriority}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; font-weight:600; color:#475569;">Logged At:</td>
              <td style="padding:10px 12px; border:1px solid #e2e8f0; color:#64748b;">${timestamp} (IST)</td>
            </tr>
          </table>

          <!-- Description Box -->
          <div style="font-size:14px; font-weight:700; color:#334155; margin-bottom:8px;">Detailed Reproduction Steps &amp; Technical Logs:</div>
          <div style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px; padding:16px; font-family:Consolas,monospace,sans-serif; font-size:13px; line-height:1.6; color:#0f172a; white-space:pre-wrap;">${description}</div>

          <div style="margin-top:28px; padding-top:16px; border-top:1px solid #f1f5f9; font-size:12px; color:#94a3b8; text-align:center;">
            This automated dispatch was submitted from the CareWell Head Admin Panel (Contact Developer desk).
          </div>
        </div>
      </div>
    `;

    const plainText = `
[CareWell Engineering Ticket #${tId}]
Subject: ${subject}
Module: ${formattedModule}
Priority: ${formattedPriority}
Time: ${timestamp}

Reproduction Steps / Logs:
${description}
    `.trim();

    await sendMail({
      to: "pixelforgemumbai@gmail.com",
      subject: `[CareWell Ticket #${tId}] [${formattedPriority}] ${subject}`,
      title: `Engineering Ticket #${tId}`,
      heading: `Technical Ticket: ${subject}`,
      message: htmlMessage,
      text: plainText,
    });

    return res.status(200).json({
      success: true,
      ticketId: tId,
      message: `Ticket #${tId} has been successfully sent to pixelforgemumbai@gmail.com!`,
    });
  } catch (error) {
    console.error("Support ticket error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to deliver support ticket email.",
    });
  }
});

// GET /api/support/patients - List registered patients from DB
supportRouter.get("/patients", async (req, res) => {
  try {
    const { User } = require("../models/User");
    const users = await User.find({}).lean();
    const patients = (users || []).map((u, i) => {
      const pInfo = u.personalInformation || {};
      const cInfo = u.contactInformation || {};
      const bInfo = u.biologicalInformation || {};
      const auth = u.authentication || {};
      const fullName = pInfo.fullName || auth.fullName || `Patient #${i + 1}`;
      const email = cInfo.email || auth.email || "";
      const phone = cInfo.primaryPhone || auth.phoneNumber || "";
      return {
        id: `PT-${u._id.toString().slice(-6).toUpperCase()}`,
        name: fullName,
        email: email,
        phone: phone,
        age: bInfo.age || 42,
        gender: bInfo.gender || "Other",
        blood: bInfo.bloodGroup || "O+",
        status: u.registrationCompleted ? "Active" : "Stable",
        condition: (u.healthcarePreferences && u.healthcarePreferences.condition) || "General Care",
      };
    }).filter(p => !!p.email);
    return res.json({ success: true, patients });
  } catch (err) {
    console.warn("Could not fetch DB patients (fallback to local):", err.message);
    return res.json({ success: true, patients: [] });
  }
});

// POST /api/support/send-promo-email - Broadcast promotional emails with optional photo attachment
supportRouter.post("/send-promo-email", async (req, res) => {
  try {
    const { recipients, subject, message, heading, ctaLabel, ctaUrl, imageData, imageName } = req.body;

    if (!recipients || (!Array.isArray(recipients) && typeof recipients !== "string")) {
      return res.status(400).json({ success: false, message: "Recipient list is required." });
    }

    let targetEmails = [];
    if (Array.isArray(recipients)) {
      targetEmails = recipients.map(r => (typeof r === "object" ? r.email : r)).filter(Boolean);
    } else {
      targetEmails = String(recipients).split(/[,;]/).map(e => e.trim()).filter(Boolean);
    }

    // Deduplicate
    targetEmails = Array.from(new Set(targetEmails.map(e => e.trim().toLowerCase())));

    if (targetEmails.length === 0) {
      return res.status(400).json({ success: false, message: "Please select at least one valid recipient email." });
    }

    if (!message && !imageData) {
      return res.status(400).json({ success: false, message: "Message body or promotion image is required." });
    }

    const emailSubject = subject || "CareWell Special Health Announcement";
    const emailHeading = heading || emailSubject;
    const safeMsg = String(message || "").trim();

    // Prepare attachments if image is provided
    let attachments = [];
    let imageHtml = "";
    if (imageData && typeof imageData === "string" && imageData.startsWith("data:image")) {
      const match = imageData.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (match) {
        const ext = match[1];
        const base64Data = match[2];
        const filename = imageName || `promo-image.${ext}`;
        attachments.push({
          filename: filename,
          content: Buffer.from(base64Data, "base64"),
          cid: "promo_banner_cid",
        });
        imageHtml = `
          <div style="margin:24px 0; text-align:center;">
            <img src="cid:promo_banner_cid" alt="CareWell Promotion" style="max-width:100%; max-height:360px; height:auto; border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.12); display:inline-block;" />
          </div>
        `;
      }
    }

    const formattedBodyHtml = safeMsg
      ? safeMsg.split(/\n+/).map(p => `<p style="margin:0 0 16px 0; line-height:1.75; font-size:16px; color:#334155;">${p}</p>`).join("")
      : "";

    const fullHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>${emailSubject}</title>
  </head>
  <body style="margin:0; padding:0; background:#0f0710; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#1e293b;">
    <div style="max-width:680px; margin:30px auto; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,0.25);">
      
      <!-- Brand Top Header -->
      <div style="background:linear-gradient(135deg, #7a2040 0%, #4a1228 100%); padding:32px 28px; text-align:center; color:#ffffff;">
        <div style="display:inline-block; font-size:11px; letter-spacing:2px; font-weight:800; text-transform:uppercase; color:#f9a8b8; margin-bottom:8px; background:rgba(255,255,255,0.12); padding:4px 14px; border-radius:999px;">CareWell Healthcare Announcement</div>
        <h1 style="margin:8px 0 4px; font-size:26px; font-weight:800; color:#ffffff; letter-spacing:-0.5px;">${emailHeading}</h1>
        <p style="margin:0; font-size:13px; color:rgba(255,255,255,0.75);">Care in Minutes &bull; Dedicated Home &amp; Clinical Nursing</p>
      </div>

      <!-- Main Body -->
      <div style="padding:32px 28px;">
        ${imageHtml}
        <div style="font-size:16px; line-height:1.75; color:#334155;">
          ${formattedBodyHtml}
        </div>

        ${ctaLabel && ctaUrl ? `
        <div style="margin-top:32px; text-align:center;">
          <a href="${ctaUrl}" style="display:inline-block; background:linear-gradient(135deg, #7a2040, #5c1a2e); color:#ffffff; font-weight:700; font-size:15px; text-decoration:none; padding:14px 32px; border-radius:12px; box-shadow:0 6px 20px rgba(122,32,64,0.35);">${ctaLabel}</a>
        </div>
        ` : ''}

        <!-- Footer Info -->
        <div style="margin-top:40px; padding-top:24px; border-top:1px solid #f1f5f9; text-align:center; font-size:12px; color:#94a3b8; line-height:1.6;">
          <p style="margin:0 0 4px 0; font-weight:600; color:#64748b;">CareWell Healthcare Services &bull; Patient Relations Hub</p>
          <p style="margin:0;">You are receiving this communication as a registered patient of CareWell Healthcare. For emergency care or 24/7 nursing assistance, contact your CareWell coordinator.</p>
        </div>
      </div>
    </div>
  </body>
</html>`;

    const results = [];
    for (const recipient of targetEmails) {
      try {
        const resMail = await sendMail({
          to: recipient,
          subject: emailSubject,
          html: fullHtml,
          text: safeMsg,
          attachments: attachments.length ? attachments : undefined,
        });
        results.push({ email: recipient, success: true, messageId: resMail.messageId, provider: resMail.provider });
      } catch (err) {
        console.error(`Failed to send promo email to ${recipient}:`, err.message);
        results.push({ email: recipient, success: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return res.status(200).json({
      success: successCount > 0,
      total: targetEmails.length,
      sentCount: successCount,
      results,
      message: successCount > 0
        ? `Promotional email sent successfully to ${successCount} of ${targetEmails.length} recipient(s)!`
        : `Failed to deliver promotional email to recipients. Check email service credentials.`,
    });
  } catch (error) {
    console.error("send-promo-email error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to process promotional email.",
    });
  }
});

module.exports = { supportRouter };
