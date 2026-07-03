const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const { connectDb } = require("./src/db");
const { authRouter } = require("./src/routes/auth");
const { usersRouter } = require("./src/routes/users");
const { locationRouter } = require("./src/routes/location");
const net = require("net");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const app = express();
const preferredPort = Number(process.env.PORT) || 3000;
let activePort = preferredPort;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "null");
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CareWell-Session");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/location", locationRouter);

app.use(express.static(path.join(__dirname, "..")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.close(() => resolve(true));
      })
      .listen(port, "0.0.0.0");
  });
}

async function start() {
  try {
    await connectDb();
    let portToUse = preferredPort;
    if (!(await isPortFree(portToUse))) {
      portToUse = preferredPort + 1;
      while (!(await isPortFree(portToUse))) {
        portToUse += 1;
      }
    }
    activePort = portToUse;
    app.listen(activePort, () => {
      console.log(`CareWell backend running on http://localhost:${activePort}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

start();
