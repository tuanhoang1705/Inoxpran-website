"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getItalianTrustBadges = void 0;

var getItalianTrustBadges = function getItalianTrustBadges() {
  var locale = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'vi';
  var isEnglish = locale === 'en';
  return ['Italia 1954', isEnglish ? '304 stainless promise' : 'Cam kết inox 304', isEnglish ? '12-month warranty' : 'Bảo hành 12 tháng', isEnglish ? 'Nationwide COD' : 'COD toàn quốc'];
};

exports.getItalianTrustBadges = getItalianTrustBadges;