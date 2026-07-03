const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { patchRegistration, getMe, getStatus } = require("../controllers/usersController");

const usersRouter = express.Router();

usersRouter.get("/me", requireAuth, getMe);
usersRouter.get("/me/status", requireAuth, getStatus);
usersRouter.patch("/me/registration", requireAuth, patchRegistration);

module.exports = { usersRouter };
