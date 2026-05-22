"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CHAT_SUPPORT_CONFIG = void 0;

var _siteContact = require("$lib/config/siteContact.js");

var phoneDigits = String(_siteContact.SITE_CONTACT.phone || '').replace(/\D+/g, '');
var CHAT_SUPPORT_CONFIG = {
  phoneLabel: _siteContact.SITE_CONTACT.phone || '0867 024 186',
  phoneHref: phoneDigits ? "tel:".concat(phoneDigits) : 'tel:0867024186',
  zaloUrl: 'https://zalo.me/0867024186',
  messengerUrl: 'https://m.me/inoxpranvietnam',
  liveChatUrl: '/contact'
};
exports.CHAT_SUPPORT_CONFIG = CHAT_SUPPORT_CONFIG;