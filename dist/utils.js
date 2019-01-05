"use strict";

var _interopRequireDefault = require("@babel/runtime-corejs2/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _chance = _interopRequireDefault(require("chance"));

var _adjectives = _interopRequireDefault(require("./data/adjectives.json"));

var _animals = _interopRequireDefault(require("./data/animals.json"));

function generateUsernameFromSeed(seed) {
  const chance = new _chance.default(seed);
  const index1 = chance.integer({
    min: 0,
    max: _adjectives.default.length - 1
  });
  const index2 = chance.integer({
    min: 0,
    max: _adjectives.default.length - 1
  });
  const index3 = chance.integer({
    min: 0,
    max: _animals.default.length - 1
  });
  return [_adjectives.default[index1], _adjectives.default[index2], _animals.default[index3]].map(u => u[0].toUpperCase() + u.slice(1)).join(" ");
}

var _default = {
  generateUsernameFromSeed
};
exports.default = _default;
//# sourceMappingURL=utils.js.map