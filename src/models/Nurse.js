const mongoose = require("mongoose");

const NurseSchema = new mongoose.Schema(
  {
    nurseId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    dob: {
      type: String,
      trim: true,
      default: "",
    },
    age: {
      type: Number,
      default: null,
    },
    gender: {
      type: String,
      trim: true,
      default: "Female",
    },
    bloodGroup: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    emailVerified: {
      type: Boolean,
      default: true,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    altPhone: {
      type: String,
      trim: true,
      default: "",
    },
    place: {
      type: String,
      trim: true,
      default: "",
    },
    state: {
      type: String,
      trim: true,
      default: "",
    },
    city: {
      type: String,
      trim: true,
      default: "",
    },
    area: {
      type: String,
      trim: true,
      default: "",
    },
    nearestStation: {
      type: String,
      trim: true,
      default: "",
    },
    homeVisit: {
      type: Boolean,
      default: true,
    },
    workTime: {
      type: String,
      trim: true,
      default: "Full Time (24x7)",
    },
    experience: {
      type: String,
      trim: true,
      default: "1",
    },
    specialty: {
      type: String,
      trim: true,
      default: "General Clinical Care",
    },
    specialties: {
      type: [String],
      default: [],
    },
    fullAddress: {
      type: String,
      trim: true,
      default: "",
    },
    reference: {
      type: String,
      trim: true,
      default: "",
    },
    refNote: {
      type: String,
      trim: true,
      default: "",
    },
    aadhaarPhoto: {
      type: String,
      default: "",
    },
    aadhaarNumber: {
      type: String,
      trim: true,
      default: "",
    },
    panPhoto: {
      type: String,
      default: "",
    },
    panNumber: {
      type: String,
      trim: true,
      default: "",
    },
    role: {
      type: String,
      trim: true,
      default: "Home Care Nurse",
    },
    education: {
      type: String,
      trim: true,
      default: "B.Sc Nursing",
    },
    degrees: {
      type: Array,
      default: [],
    },
    certificates: {
      type: Array,
      default: [],
    },
    kycDocuments: {
      type: Object,
      default: {},
    },
    workplaces: {
      type: Array,
      default: [],
    },
    photo: {
      type: String,
      default: "",
    },
    shortDescription: {
      type: String,
      trim: true,
      default: "",
    },
    username: {
      type: String,
      trim: true,
      default: "",
    },
    password: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["Active", "Verified", "Pending", "Suspended", "Terminated"],
      default: "Active",
    },
  },
  {
    timestamps: true,
    collection: "nurses",
  }
);

const Nurse = mongoose.models.Nurse || mongoose.model("Nurse", NurseSchema);

module.exports = Nurse;
