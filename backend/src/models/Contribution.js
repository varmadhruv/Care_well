const mongoose = require("mongoose");

const ContributionSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["nurse", "doctor"],
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    // Nurse specific
    place: {
      type: String,
      trim: true,
      default: "",
    },
    age: {
      type: Number,
      default: null,
    },
    // Doctor specific
    workplaceType: {
      type: String,
      enum: ["Clinic", "Hospital", ""],
      default: "",
    },
    clinicName: {
      type: String,
      trim: true,
      default: "",
    },
    clinicAddress: {
      type: String,
      trim: true,
      default: "",
    },
    workingHours: {
      type: String,
      trim: true,
      default: "",
    },
    // Shared
    experience: {
      type: String,
      trim: true,
      default: "0",
    },
    specialty: {
      type: String,
      trim: true,
      default: "",
    },
    photo: {
      type: String,
      default: "",
    },
    clinicPhoto: {
      type: String,
      default: "",
    },
    shortDescription: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["Pending", "Verified", "Unverified", "Blocked"],
      default: "Pending",
      index: true,
    },
    generatedUserId: {
      type: String,
      trim: true,
      default: "",
    },
    generatedPassword: {
      type: String,
      default: "",
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "contributions",
  }
);

const Contribution =
  mongoose.models.Contribution || mongoose.model("Contribution", ContributionSchema);

module.exports = Contribution;

