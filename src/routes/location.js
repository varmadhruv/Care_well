const express = require("express");

const locationRouter = express.Router();

locationRouter.get("/reverse", async (req, res) => {
  try {
    const lat = String(req.query.lat || "").trim();
    const lon = String(req.query.lon || "").trim();
    if (!lat || !lon) {
      return res.status(400).json({ message: "Latitude and longitude are required." });
    }

    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "CareWell/1.0",
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Reverse geocoding failed:", response.status, detail);
      return res.status(502).json({ message: "Unable to resolve your location." });
    }

    const data = await response.json();
    return res.json({
      displayName: data.display_name || "",
      address: data.address || {},
      latitude: lat,
      longitude: lon,
    });
  } catch (error) {
    console.error("Location reverse lookup error:", error);
    return res.status(500).json({ message: "Unable to resolve your location." });
  }
});

module.exports = { locationRouter };
