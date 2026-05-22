"use strict";

const express = require("express");
const asyncHandler = require("../../helpers/asyncHandler");
const publicChatController = require("../../controllers/publicChat.controller");

const router = express.Router();

router.post("/session", asyncHandler(publicChatController.createSession));
router.post("/message", asyncHandler(publicChatController.createChatExchange));
router.get("/messages", asyncHandler(publicChatController.getMessages));
router.post("/handoff", asyncHandler(publicChatController.requestHandoff));
router.post("/presence", asyncHandler(publicChatController.updatePresence));

module.exports = router;
