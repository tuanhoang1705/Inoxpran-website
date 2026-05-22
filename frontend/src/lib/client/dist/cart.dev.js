"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.removeFromCart = exports.addToCart = void 0;

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

var buildPayload = function buildPayload(payload) {
  if (!payload || _typeof(payload) !== 'object') return {};
  return payload;
};

var addToCart = function addToCart() {
  var _ref,
      productId,
      _ref$quantity,
      quantity,
      response,
      payload,
      _args = arguments;

  return regeneratorRuntime.async(function addToCart$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _ref = _args.length > 0 && _args[0] !== undefined ? _args[0] : {}, productId = _ref.productId, _ref$quantity = _ref.quantity, quantity = _ref$quantity === void 0 ? 1 : _ref$quantity;

          if (productId) {
            _context.next = 3;
            break;
          }

          return _context.abrupt("return", {
            ok: false,
            status: 400,
            error: 'missing-product'
          });

        case 3:
          _context.next = 5;
          return regeneratorRuntime.awrap(fetch('/api/cart', {
            method: 'POST',
            headers: {
              'content-type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(buildPayload({
              productId: productId,
              quantity: quantity
            }))
          }));

        case 5:
          response = _context.sent;
          payload = null;
          _context.prev = 7;
          _context.next = 10;
          return regeneratorRuntime.awrap(response.json());

        case 10:
          payload = _context.sent;
          _context.next = 16;
          break;

        case 13:
          _context.prev = 13;
          _context.t0 = _context["catch"](7);
          payload = null;

        case 16:
          if (response.ok && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('cart:change'));
          }

          return _context.abrupt("return", {
            ok: response.ok,
            status: response.status,
            payload: payload
          });

        case 18:
        case "end":
          return _context.stop();
      }
    }
  }, null, null, [[7, 13]]);
};

exports.addToCart = addToCart;

var removeFromCart = function removeFromCart() {
  var _ref2,
      productId,
      response,
      payload,
      _args2 = arguments;

  return regeneratorRuntime.async(function removeFromCart$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _ref2 = _args2.length > 0 && _args2[0] !== undefined ? _args2[0] : {}, productId = _ref2.productId;

          if (productId) {
            _context2.next = 3;
            break;
          }

          return _context2.abrupt("return", {
            ok: false,
            status: 400,
            error: 'missing-product'
          });

        case 3:
          _context2.next = 5;
          return regeneratorRuntime.awrap(fetch('/api/cart', {
            method: 'DELETE',
            headers: {
              'content-type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(buildPayload({
              productId: productId
            }))
          }));

        case 5:
          response = _context2.sent;
          payload = null;
          _context2.prev = 7;
          _context2.next = 10;
          return regeneratorRuntime.awrap(response.json());

        case 10:
          payload = _context2.sent;
          _context2.next = 16;
          break;

        case 13:
          _context2.prev = 13;
          _context2.t0 = _context2["catch"](7);
          payload = null;

        case 16:
          if (response.ok && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('cart:change'));
          }

          return _context2.abrupt("return", {
            ok: response.ok,
            status: response.status,
            payload: payload
          });

        case 18:
        case "end":
          return _context2.stop();
      }
    }
  }, null, null, [[7, 13]]);
};

exports.removeFromCart = removeFromCart;