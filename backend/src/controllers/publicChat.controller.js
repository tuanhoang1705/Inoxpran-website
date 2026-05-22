"use strict";

const PublicChatService = require("../services/publicChat.service");
const { SuccessResponse } = require("../core/success.response");

class PublicChatController {
  createSession = async (req, res, next) => {
    new SuccessResponse({
      message: "Create chat session success",
      metadata: await PublicChatService.createSession(req.body || {}),
    }).send(res);
  };

  createChatExchange = async (req, res, next) => {
    new SuccessResponse({
      message: "Persist chat exchange success",
      metadata: await PublicChatService.createChatExchange(req.body || {}),
    }).send(res);
  };

  getMessages = async (req, res, next) => {
    new SuccessResponse({
      message: "Get chat messages success",
      metadata: await PublicChatService.getMessages(req.query || {}),
    }).send(res);
  };

  requestHandoff = async (req, res, next) => {
    new SuccessResponse({
      message: "Request chat handoff success",
      metadata: await PublicChatService.requestHandoff(req.body || {}),
    }).send(res);
  };

  updatePresence = async (req, res, next) => {
    new SuccessResponse({
      message: "Update chat presence success",
      metadata: await PublicChatService.updatePresence(req.body || {}),
    }).send(res);
  };
}

module.exports = new PublicChatController();
