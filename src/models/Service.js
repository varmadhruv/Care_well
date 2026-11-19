const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    serviceName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    priceUnit: {
      type: String,
      default: "Visit",
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    serviceIcon: {
      type: String,
      default: "",
    },
    enrollDeveloper: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isAvailable24x7: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Service = mongoose.models.Service || mongoose.model("Service", serviceSchema, "services");

module.exports = { Service };
