const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    authentication: {
      provider: {
        type: String,
        enum: ["Google", "Phone"],
        default: "Phone",
      },
      googleId: {
        type: String,
        default: "",
        index: true,
        sparse: true,
      },
      phoneNumber: {
        type: String,
        default: "",
        index: true,
        sparse: true,
      },
      email: {
        type: String,
        default: "",
        trim: true,
        lowercase: true,
        index: true,
        sparse: true,
      },
      fullName: {
        type: String,
        trim: true,
        default: "",
      },
      profilePicture: {
        type: String,
        trim: true,
        default: "",
      },
      emailVerified: {
        type: Boolean,
        default: false,
      },
      phoneVerified: {
        type: Boolean,
        default: false,
      },
    },
    googleId: {
      type: String,
      index: true,
      sparse: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
      default: "",
      index: true,
      sparse: true,
    },
    fullName: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
      index: true,
      default: undefined,
    },
    profilePicture: {
      type: String,
      trim: true,
      default: "",
    },
    provider: {
      type: String,
      required: true,
      enum: ["Google", "credentials", "Apple"],
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    lastLogin: {
      type: Date,
      default: Date.now,
    },
    sessionToken: {
      type: String,
      index: true,
      sparse: true,
    },
    sessionExpiresAt: {
      type: Date,
    },
    registrationStep: {
      type: Number,
      default: 1,
      min: 1,
      max: 7,
    },
    registrationCompleted: {
      type: Boolean,
      default: false,
    },
    personalInformation: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    biologicalInformation: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    contactInformation: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    addressInformation: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    emergencyContact: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    healthcarePreferences: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    consentInformation: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: false,
  }
);

const User = mongoose.models.User || mongoose.model("User", userSchema, "users");

module.exports = { User };
