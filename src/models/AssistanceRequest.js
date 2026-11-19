const mongoose = require("mongoose");

const assistanceRequestSchema = new mongoose.Schema(
  {
    service: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      default: "",
    },
    email: {
      type: String,
      default: "",
    },
    name: {
      type: String,
      default: "",
    },
    date: {
      type: String,
      default: "",
    },
    time: {
      type: String,
      default: "",
    },
    period: {
      type: String,
      default: "",
    },
    source: {
      type: String,
      default: "Onboarding Screen 5",
    },
    emailSent: {
      type: Boolean,
      default: false,
    },
    emailError: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const AssistanceRequest =
  mongoose.models.AssistanceRequest ||
  mongoose.model("AssistanceRequest", assistanceRequestSchema, "assistance_requests");

module.exports = { AssistanceRequest };
