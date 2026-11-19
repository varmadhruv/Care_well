const express = require("express");
const Contribution = require("../models/Contribution");
const Nurse = require("../models/Nurse");
const Doctor = require("../models/Doctor");
const DoctorSequence = require("../models/DoctorSequence");
const { indexToDoctorId } = require("../utils/doctorIdGenerator");
const { sendMail } = require("../services/mailService");

const contributionsRouter = express.Router();

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pass = "CareWell@";
  for (let i = 0; i < 4; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

// 1. Submit a Contribution Application (Landing Page Form)
contributionsRouter.post("/", async (req, res) => {
  try {
    const {
      role,
      name,
      email,
      phone,
      place,
      age,
      workplaceType,
      clinicName,
      clinicAddress,
      workingHours,
      experience,
      specialty,
      photo,
      clinicPhoto,
      shortDescription,
    } = req.body || {};

    if (!role || !["nurse", "doctor"].includes(role)) {
      return res.status(400).json({ success: false, message: "Valid role (nurse or doctor) is required." });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Full Name is required." });
    }
    if (!email || !String(email).trim() || !email.includes("@")) {
      return res.status(400).json({ success: false, message: "A valid Email address is required." });
    }

    const contribution = new Contribution({
      role,
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      phone: phone ? String(phone).trim() : "",
      place: place ? String(place).trim() : "",
      age: age ? Number(age) : null,
      workplaceType: workplaceType || "",
      clinicName: clinicName ? String(clinicName).trim() : "",
      clinicAddress: clinicAddress ? String(clinicAddress).trim() : "",
      workingHours: workingHours ? String(workingHours).trim() : "24 Hours",
      experience: experience ? String(experience).trim() : "0",
      specialty: specialty ? String(specialty).trim() : (role === "doctor" ? "General Physician" : "Clinical Nurse"),
      photo: photo || "",
      clinicPhoto: clinicPhoto || "",
      shortDescription: shortDescription ? String(shortDescription).trim() : "",
      status: "Pending",
    });

    await contribution.save();

    return res.status(201).json({
      success: true,
      message: "Your application has been submitted successfully! The Head Administrator will audit and verify your credentials.",
      contributionId: contribution._id,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 2. GET all contributions with optional filtering
contributionsRouter.get("/", async (req, res) => {
  try {
    const { role, status, search } = req.query;
    const filter = {};

    if (role && ["nurse", "doctor"].includes(role)) {
      filter.role = role;
    }
    if (status && ["Pending", "Verified", "Unverified", "Blocked", "Rejected"].includes(status)) {
      filter.status = status;
    }
    if (search && String(search).trim()) {
      const q = String(search).trim();
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { clinicName: { $regex: q, $options: "i" } },
        { place: { $regex: q, $options: "i" } },
      ];
    }

    const contributions = await Contribution.find(filter).sort({ createdAt: -1 });
    return res.json({ success: true, count: contributions.length, contributions });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 3. POST /:id/verify - Verify candidate, auto-generate credentials & dispatch email
contributionsRouter.post("/:id/verify", async (req, res) => {
  try {
    const { id } = req.params;
    const contribution = await Contribution.findById(id);

    if (!contribution) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    const cleanName = contribution.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    const password = generatePassword();
    let generatedUserId = "";

    if (contribution.role === "nurse") {
      const count = await Nurse.countDocuments();
      const nurseId = `CW-N-${100 + count + 1}`;
      generatedUserId = `nurse_${cleanName || "staff"}_${Math.floor(100 + Math.random() * 900)}`;

      // Create Nurse Record
      let nurse = await Nurse.findOne({ email: contribution.email });
      if (!nurse) {
        nurse = new Nurse({
          nurseId,
          name: contribution.name,
          email: contribution.email,
          phone: contribution.phone,
          age: contribution.age,
          place: contribution.place,
          experience: contribution.experience,
          specialty: contribution.specialty || "Clinical Nurse",
          photo: contribution.photo,
          shortDescription: contribution.shortDescription,
          username: generatedUserId,
          password: password,
          status: "Verified",
        });
        await nurse.save();
      } else {
        nurse.status = "Verified";
        nurse.username = generatedUserId;
        nurse.password = password;
        await nurse.save();
      }
    } else {
      // Doctor role
      const seqDoc = await DoctorSequence.findOneAndUpdate(
        { _id: "doctor_id_seq" },
        { $inc: { lastIndex: 1 } },
        { new: true, upsert: true }
      );
      const doctorId = indexToDoctorId(seqDoc.lastIndex);
      generatedUserId = `dr_${cleanName || "doctor"}_${Math.floor(100 + Math.random() * 900)}`;

      // Create Doctor Record
      let doctor = await Doctor.findOne({ email: contribution.email });
      if (!doctor) {
        doctor = new Doctor({
          doctorId,
          name: contribution.name,
          username: generatedUserId,
          email: contribution.email,
          phone: contribution.phone,
          clinicName: contribution.clinicName || (contribution.workplaceType === "Hospital" ? "CareWell Partner Hospital" : "CareWell Specialist Clinic"),
          clinicAddress: contribution.clinicAddress || contribution.place,
          experience: contribution.experience || "3",
          specialty: contribution.specialty || "General Physician",
          role: "Medical Doctor",
          status: "Active",
          doctorPhoto: contribution.photo || "herosectionprofilepicture.jpeg",
          photo: contribution.photo || "herosectionprofilepicture.jpeg",
          clinicPhotos: contribution.clinicPhoto ? [contribution.clinicPhoto] : ["clinic-facade.svg"],
          availability: "Available",
          workingHours: contribution.workingHours || "24 Hours",
          workingTime: contribution.workingHours || "24 Hours",
        });
        await doctor.save();
      } else {
        doctor.status = "Active";
        await doctor.save();
      }
    }

    // Update contribution state
    contribution.status = "Verified";
    contribution.generatedUserId = generatedUserId;
    contribution.generatedPassword = password;
    contribution.verifiedAt = new Date();
    await contribution.save();

    // Send congratulatory acceptance email (without user ID or password)
    let emailSent = false;
    let emailError = "";
    if (contribution.email && contribution.email.includes("@")) {
      try {
        const roleLabel = contribution.role === "doctor" ? "Medical Doctor" : "Clinical Nurse";
        await sendMail({
          to: contribution.email,
          subject: `Congratulations! Your Profile is Accepted - CareWell ${roleLabel}`,
          title: `CareWell Profile Accepted`,
          heading: `Congratulations ${contribution.name}! Your Profile Has Been Accepted`,
          message: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
              <p style="font-size: 16px; margin-bottom: 16px;">
                Dear <strong>${contribution.name}</strong>,
              </p>
              <p style="font-size: 15px; margin-bottom: 16px;">
                We are delighted to inform you that <strong>your profile has been accepted by our team</strong>! Congratulations on becoming an approved <strong>${roleLabel}</strong> with CareWell Healthcare.
              </p>
              <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 16px 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; color: #166534; font-size: 15px; font-weight: 600;">
                  ✓ Our team will reach out to you shortly to guide you through the next steps and onboarding schedule.
                </p>
              </div>
              <p style="font-size: 14px; color: #64748b; margin-top: 20px;">
                If you have any questions in the meantime, feel free to reply to this email or contact our support desk. Welcome to the CareWell family!
              </p>
            </div>
          `,
          text: `Congratulations ${contribution.name}! Your profile has been accepted by our team as a ${roleLabel}. Our team will reach out to you shortly with next steps. Welcome to CareWell!`,
        });
        emailSent = true;
      } catch (mErr) {
        emailError = mErr.message;
        console.warn("[VERIFICATION EMAIL NOTICE]", mErr.message);
      }
    }

    return res.json({
      success: true,
      message: `${contribution.name}'s profile has been accepted and a congratulatory email has been sent to ${contribution.email}!`,
      contribution,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 4. POST /:id/unverify - Unverify candidate
contributionsRouter.post("/:id/unverify", async (req, res) => {
  try {
    const { id } = req.params;
    const contribution = await Contribution.findById(id);
    if (!contribution) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    contribution.status = "Unverified";
    await contribution.save();

    return res.json({
      success: true,
      message: `${contribution.name}'s status updated to Unverified.`,
      contribution,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 5. POST /:id/block - Block candidate
contributionsRouter.post("/:id/block", async (req, res) => {
  try {
    const { id } = req.params;
    const contribution = await Contribution.findById(id);
    if (!contribution) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    contribution.status = "Blocked";
    await contribution.save();

    return res.json({
      success: true,
      message: `${contribution.name} has been blocked from the system.`,
      contribution,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 6. POST /:id/reject - Reject candidate and dispatch notification email
contributionsRouter.post("/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const contribution = await Contribution.findById(id);
    if (!contribution) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    contribution.status = "Rejected";
    await contribution.save();

    let emailSent = false;
    let emailError = "";
    if (contribution.email && contribution.email.includes("@")) {
      try {
        const roleLabel = contribution.role === "doctor" ? "Medical Doctor" : "Clinical Nurse";
        await sendMail({
          to: contribution.email,
          subject: `Update Regarding Your CareWell ${roleLabel} Application`,
          title: `Application Status Notification`,
          heading: `CareWell Application Update for ${contribution.name}`,
          message: `
            <p>Dear ${contribution.name},</p>
            <p>Thank you for taking the time to submit your credentials and interest in joining <strong>CareWell Nursing Care &amp; Clinical Services</strong> as a <strong>${roleLabel}</strong>.</p>
            <p>After a careful review of your submitted profile and our current staffing requirements, we regret to inform you that <strong>our team is unable to accept your profile at this time</strong>.</p>
            ${reason ? `<div style="background:#fef2f2; border:1px solid #fee2e2; border-radius:10px; padding:12px 16px; margin:16px 0; font-size:14px; color:#991b1b;"><strong>Review Note:</strong> ${reason}</div>` : ""}
            <p>We truly appreciate your interest in our healthcare organization. Your records will remain in our talent archive should an opening better aligned with your background become available, and our team will reach out if future opportunities arise.</p>
            <p style="margin-top:24px; font-size:14px; color:#64748b; line-height:1.6;">We wish you every success in your medical and clinical endeavors.</p>
            <p style="margin-top:16px; font-weight:700; color:#0f172a;">Warm regards,<br/><span style="color:#0b4f8c;">CareWell Clinical Recruitment &amp; Administration Desk</span></p>
          `,
        });
        emailSent = true;
      } catch (mErr) {
        emailError = mErr.message;
        console.warn("[REJECTION EMAIL NOTICE]", mErr.message);
      }
    }

    return res.json({
      success: true,
      message: `${contribution.name}'s application has been rejected and status notification sent to ${contribution.email}.`,
      contribution,
      emailSent,
      emailError,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = { contributionsRouter };

