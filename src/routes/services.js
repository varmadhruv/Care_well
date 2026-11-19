const express = require("express");
const { Service } = require("../models/Service");
const { servicesCatalog } = require("../data/servicesCatalog");

const servicesRouter = express.Router();

// Helper to seed services if empty
async function ensureServicesSeeded() {
  const count = await Service.countDocuments();
  if (count === 0) {
    console.log("[SERVICES] Seeding 60 CareWell services into MongoDB...");
    await Service.insertMany(servicesCatalog);
    console.log("[SERVICES] 60 services successfully seeded!");
  }
}

// GET all services
servicesRouter.get("/", async (req, res) => {
  try {
    await ensureServicesSeeded();
    const services = await Service.find().sort({ createdAt: 1 });
    return res.json({ success: true, services });
  } catch (error) {
    console.error("Failed to fetch services:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch services." });
  }
});

// POST seed or re-seed catalog
servicesRouter.post("/seed", async (req, res) => {
  try {
    const force = Boolean(req.body?.force);
    if (force) {
      await Service.deleteMany({});
    }
    await ensureServicesSeeded();
    const services = await Service.find().sort({ createdAt: 1 });
    return res.json({ success: true, message: "Catalog seeded successfully!", count: services.length, services });
  } catch (error) {
    console.error("Failed to seed services:", error);
    return res.status(500).json({ success: false, message: "Failed to seed services." });
  }
});

// POST create service
servicesRouter.post("/", async (req, res) => {
  try {
    const { serviceName, description, price, priceUnit, category, serviceIcon, enrollDeveloper, isActive, isAvailable24x7 } = req.body;

    if (!serviceName || typeof serviceName !== "string" || !serviceName.trim()) {
      return res.status(400).json({ success: false, message: "Service name is required." });
    }
    if (!description || typeof description !== "string" || !description.trim()) {
      return res.status(400).json({ success: false, message: "Service description is required." });
    }
    if (price === undefined || price === null || isNaN(Number(price)) || Number(price) < 0 || Number(price) > 10000) {
      return res.status(400).json({ success: false, message: "Valid price between ₹0 and ₹10,000 is required." });
    }
    if (!category || typeof category !== "string" || !category.trim()) {
      return res.status(400).json({ success: false, message: "Category is required." });
    }

    const newService = new Service({
      serviceName: serviceName.trim(),
      description: description.trim(),
      price: Number(price),
      priceUnit: priceUnit ? String(priceUnit).trim() : "Visit",
      category: category.trim(),
      serviceIcon: serviceIcon || "",
      enrollDeveloper: Boolean(enrollDeveloper),
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      isAvailable24x7: Boolean(isAvailable24x7),
    });

    await newService.save();
    return res.status(201).json({ success: true, service: newService, message: "Service added successfully!" });
  } catch (error) {
    console.error("Failed to create service:", error);
    return res.status(500).json({ success: false, message: "Failed to create service." });
  }
});

// PATCH update service
servicesRouter.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    if (updates.price !== undefined) {
      const numPrice = Number(updates.price);
      if (isNaN(numPrice) || numPrice < 0 || numPrice > 10000) {
        return res.status(400).json({ success: false, message: "Valid price between ₹0 and ₹10,000 is required." });
      }
      updates.price = numPrice;
    }

    const updatedService = await Service.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
    if (!updatedService) {
      return res.status(404).json({ success: false, message: "Service not found." });
    }

    return res.json({ success: true, service: updatedService, message: "Service updated successfully!" });
  } catch (error) {
    console.error("Failed to update service:", error);
    return res.status(500).json({ success: false, message: "Failed to update service." });
  }
});

// DELETE service
servicesRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deletedService = await Service.findByIdAndDelete(id);
    if (!deletedService) {
      return res.status(404).json({ success: false, message: "Service not found." });
    }
    return res.json({ success: true, message: "Service deleted successfully!" });
  } catch (error) {
    console.error("Failed to delete service:", error);
    return res.status(500).json({ success: false, message: "Failed to delete service." });
  }
});

module.exports = { servicesRouter };
