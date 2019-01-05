"use strict";

var _interopRequireDefault = require("@babel/runtime-corejs2/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _constants = _interopRequireDefault(require("./constants.js"));

const Topics = _constants.default.topics;

class MailServers {
  constructor(web3) {
    this.web3 = void 0;
    this.mailserver = "";
    this.symKeyID = "";
    this.web3 = web3;
  }

  async useMailserver(enode, cb) {
    this.symKeyID = await this.web3.shh.generateSymKeyFromPassword("status-offline-inbox");
    this.web3.currentProvider.send({
      id: new Date().getTime(),
      jsonrpc: "2.0",
      method: "admin_addPeer",
      params: [enode]
    }, (err, res) => {
      if (err) {
        if (cb) {
          return cb(err, false);
        }

        return;
      }

      if (!res.result) {
        if (cb) {
          return cb(err, false);
        }

        return;
      }

      setTimeout(() => {
        this.web3.shh.markTrustedPeer(enode).then(() => {
          this.mailserver = enode;

          if (!cb) {
            return true;
          }

          cb(null, true);
        }).catch(e => {
          if (!cb) {
            return;
          }

          cb(e, false);
        });
      }, 1000);
    });
  }

  async requestUserMessages(options, cb) {
    await this.requestChannelMessages(_constants.default.topics.CONTACT_DISCOVERY_TOPIC, options, cb);
  }

  async requestChannelMessages(topic, options, cb) {
    if (this.mailserver === "") {
      if (!cb) {
        return;
      }

      return cb("Mailserver is not set", false);
    }

    const topics = [topic.slice(0, 2) === "0x" ? topic : this.web3.utils.sha3(topic).slice(0, 10)];
    const mailserverPeer = this.mailserver;
    const timeout = options.timeout || 30; // seconds

    const symKeyID = this.symKeyID;
    const from = options.from || 0; // unix timestamp

    const to = options.to || 0;
    const limit = options.limit || 0;
    this.web3.currentProvider.send({
      id: new Date().getTime(),
      jsonrpc: "2.0",
      method: "shhext_requestMessages",
      params: [{
        from,
        limit,
        mailserverPeer,
        symKeyID,
        timeout,
        to,
        topics
      }]
    }, (err, res) => {
      if (err) {
        if (cb) {
          return cb(err);
        }

        return false;
      }

      if (cb) {
        return cb(null, true);
      }

      return true;
    });
  }

}

var _default = MailServers;
exports.default = _default;
//# sourceMappingURL=mailservers.js.map