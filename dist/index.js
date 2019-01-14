"use strict";

var _interopRequireDefault = require("@babel/runtime-corejs2/helpers/interopRequireDefault");

var _weakMap = _interopRequireDefault(require("@babel/runtime-corejs2/core-js/weak-map"));

var _stringify = _interopRequireDefault(require("@babel/runtime-corejs2/core-js/json/stringify"));

var _utils = _interopRequireDefault(require("./utils.js"));

var _mailservers = _interopRequireDefault(require("./mailservers.js"));

var _constants = _interopRequireDefault(require("./constants.js"));

const Web3 = require("web3");

const {
  utils: {
    asciiToHex,
    hexToAscii
  }
} = Web3;

function createStatusPayload(content, messageType, clockValue, isJson = false) {
  const tag = _constants.default.messageTags.message;
  const oneMonthInMs = 60 * 60 * 24 * 31 * 1000;

  if (clockValue < new Date().getTime()) {
    clockValue = (new Date().getTime() + oneMonthInMs) * 100;
  }

  const contentType = isJson ? "content/json" : "text/plain";
  const timestamp = new Date().getTime();
  return asciiToHex((0, _stringify.default)([tag, [content, contentType, messageType, clockValue, timestamp, ["^ ", "~:text", content]]]));
}

const sig = new _weakMap.default();

class StatusJS {
  constructor() {
    this.channels = void 0;
    this.contacts = void 0;
    this.userMessagesSubscription = void 0;
    this.mailservers = void 0;
    this.isHttpProvider = void 0;
    this.shh = void 0;
    this.chatRequestCb = void 0;
    this.channels = {};
    this.contacts = {};
    this.userMessagesSubscription = null;
    this.mailservers = null;
    this.isHttpProvider = false;
  }

  async connect(url, privateKey) {
    const web3 = new Web3();

    if (url.startsWith("ws://")) {
      web3.setProvider(new Web3.providers.WebsocketProvider(url, {
        headers: {
          Origin: "statusjs"
        }
      }));
    } else if (url.startsWith("http://") || url.startsWith("https://")) {
      // Deprecated but required for statusd
      web3.setProvider(new Web3.providers.HttpProvider(url));
      this.isHttpProvider = true;
    } else {
      const net = require("net");

      web3.setProvider(new Web3.providers.IpcProvider(url, net));
    }

    this.shh = web3.shh;
    this.mailservers = new _mailservers.default(web3);
    await web3.shh.setMinPoW(_constants.default.post.POW_TARGET);
    sig.set(this, privateKey ? await this.generateWhisperKeyFromWallet(privateKey) : await web3.shh.newKeyPair());
  }

  isConnected() {
    return this.shh.isListening();
  }

  async generateWhisperKeyFromWallet(key) {
    const keyId = await this.shh.addPrivateKey(key);
    return keyId;
  }

  async getPublicKey() {
    const pubKey = await this.shh.getPublicKey(sig.get(this));
    return pubKey;
  }

  async getKeyId() {
    return sig.get(this);
  }

  async getUserName(pubKey) {
    if (!pubKey) {
      pubKey = await this.getPublicKey();
    }

    return _utils.default.generateUsernameFromSeed(pubKey);
  }

  async joinChat(channelName, cb) {
    const channelKey = await this.shh.generateSymKeyFromPassword(channelName);
    this.channels[channelName] = {
      channelCode: Web3.utils.sha3(channelName).slice(0, 10),
      channelKey,
      channelName,
      lastClockValue: 0
    };

    if (cb) {
      cb();
    }
  }

  async addContact(contactCode, cb) {
    this.contacts[contactCode] = {
      lastClockValue: 0,
      username: _utils.default.generateUsernameFromSeed(contactCode)
    };

    if (cb) {
      cb();
    }
  }

  leaveChat(channelName) {
    if (!this.isHttpProvider) {
      this.channels[channelName].subscription.unsubscribe();
    } else {
      this.shh.deleteMessageFilter(this.channels[channelName].filterId).then(() => {
        clearInterval(this.channels[channelName].interval);
      });
    }

    delete this.channels[channelName];
  }

  async removeContact(contactCode) {
    delete this.contacts[contactCode];
  }

  isSubscribedTo(channelName) {
    return !!this.channels[channelName];
  }

  onMessage(par1, par2) {
    if (typeof par1 === "function") {
      this.onUserMessage(par1);
    } else {
      this.onChannelMessage(par1, par2);
    }
  }

  onChatRequest(cb) {
    this.chatRequestCb = cb;
  }

  onChannelMessage(channelName, cb) {
    if (!this.channels[channelName]) {
      return cb("unknown channel: " + channelName);
    }

    const filters = {
      allowP2P: true,
      symKeyID: this.channels[channelName].channelKey,
      topics: [this.channels[channelName].channelCode]
    };

    const messageHandler = data => {
      const username = _utils.default.generateUsernameFromSeed(data.sig);

      const payloadArray = JSON.parse(hexToAscii(data.payload));

      if (this.channels[channelName].lastClockValue < payloadArray[1][3]) {
        this.channels[channelName].lastClockValue = payloadArray[1][3];
      }

      cb(null, {
        payload: hexToAscii(data.payload),
        data,
        username
      });
    };

    if (this.isHttpProvider) {
      this.shh.newMessageFilter(filters).then(filterId => {
        this.channels[channelName].filterId = filterId;
        this.channels[channelName].interval = setInterval(() => {
          this.shh.getFilterMessages(filterId).then(data => {
            data.map(d => {
              messageHandler(d);
            });
          }).catch(err => {
            cb(err);
          });
        }, 1000 * 2);
      });
    } else {
      this.channels[channelName].subscription = this.shh.subscribe("messages", filters).on("data", messageHandler).on("error", err => {
        cb(err);
      });
    }
  }

  onUserMessage(cb) {
    const filters = {
      allowP2P: true,
      minPow: _constants.default.post.POW_TARGET,
      privateKeyID: sig.get(this),
      topics: [_constants.default.topics.CONTACT_DISCOVERY_TOPIC]
    };

    const messageHandler = data => {
      if (!this.contacts[data.sig]) {
        this.addContact(data.sig);
      }

      const payloadArray = JSON.parse(hexToAscii(data.payload));

      if (this.contacts[data.sig].lastClockValue < payloadArray[1][3]) {
        this.contacts[data.sig].lastClockValue = payloadArray[1][3];
      }

      if (payloadArray[0] === _constants.default.messageTags.message) {
        cb(null, {
          payload: hexToAscii(data.payload),
          data,
          username: this.contacts[data.sig].username
        });
      } else if (payloadArray[0] === _constants.default.messageTags.chatRequest) {
        this.contacts[data.sig].displayName = payloadArray[1][0];
        this.contacts[data.sig].profilePic = payloadArray[1][1];

        if (this.chatRequestCb) {
          this.chatRequestCb(null, {
            displayName: this.contacts[data.sig].displayName,
            profilePic: this.contacts[data.sig].profilePic,
            username: this.contacts[data.sig].username
          });
        }
      }
    };

    if (this.isHttpProvider) {
      this.shh.newMessageFilter(filters).then(filterId => {
        this.userMessagesSubscription = {};
        this.userMessagesSubscription.filterId = filterId;
        this.userMessagesSubscription.interval = setInterval(() => {
          this.shh.getFilterMessages(filterId).then(data => {
            data.map(d => {
              messageHandler(d);
            });
          }).catch(err => {
            cb(err);
          });
        }, 250);
      });
    } else {
      this.userMessagesSubscription = this.shh.subscribe("messages", filters).on("data", data => {
        messageHandler(data);
      }).on("error", err => {
        cb(err);
      });
    }
  }

  sendUserMessage(contactCode, msg, cb) {
    if (!this.contacts[contactCode]) {
      this.addContact(contactCode);
    }

    this.contacts[contactCode].lastClockValue++;
    this.shh.post({
      payload: createStatusPayload(msg, _constants.default.messageTypes.USER_MESSAGE, this.contacts[contactCode].lastClockValue),
      powTarget: _constants.default.post.POW_TARGET,
      powTime: _constants.default.post.POW_TIME,
      pubKey: contactCode,
      sig: sig.get(this),
      topic: _constants.default.topics.CONTACT_DISCOVERY_TOPIC,
      ttl: _constants.default.post.TTL
    }).then(() => {
      if (!cb) {
        return;
      }

      cb(null, true);
    }).catch(e => {
      if (!cb) {
        return;
      }

      cb(e, false);
    });
  }

  sendGroupMessage(channelName, msg, cb) {
    if (!this.channels[channelName]) {
      if (!cb) {
        return;
      }

      return cb("unknown channel: " + channelName);
    }

    this.channels[channelName].lastClockValue++;
    this.shh.post({
      payload: createStatusPayload(msg, _constants.default.messageTypes.GROUP_MESSAGE, this.channels[channelName].lastClockValue),
      powTarget: _constants.default.post.POW_TARGET,
      powTime: _constants.default.post.POW_TIME,
      sig: sig.get(this),
      symKeyID: this.channels[channelName].channelKey,
      topic: this.channels[channelName].channelCode,
      ttl: _constants.default.post.TTL
    }).then(() => {
      if (!cb) {
        return;
      }

      cb(null, true);
    }).catch(e => {
      if (!cb) {
        return;
      }

      cb(e, false);
    });
  }

  sendJsonMessage(destination, msg, cb) {
    if (_constants.default.regExp.CONTACT_CODE_REGEXP.test(destination)) {
      if (!this.contacts[destination]) {
        this.addContact(destination);
      }

      this.contacts[destination].lastClockValue++;
      this.shh.post({
        payload: createStatusPayload(msg, _constants.default.messageTypes.USER_MESSAGE, this.contacts[destination].lastClockValue, true),
        powTarget: _constants.default.post.POW_TARGET,
        powTime: _constants.default.post.POW_TIME,
        pubKey: destination,
        sig: sig.get(this),
        topic: _constants.default.topics.CONTACT_DISCOVERY_TOPIC,
        ttl: _constants.default.post.TTL
      }).then(() => {
        if (!cb) {
          return;
        }

        cb(null, true);
      }).catch(e => {
        if (!cb) {
          return;
        }

        cb(e, false);
      });
    } else {
      this.channels[destination].lastClockValue++;
      this.shh.post({
        payload: createStatusPayload((0, _stringify.default)(msg), _constants.default.messageTypes.GROUP_MESSAGE, this.channels[destination].lastClockValue, true),
        powTarget: _constants.default.post.POW_TARGET,
        powTime: _constants.default.post.POW_TIME,
        sig: sig.get(this),
        symKeyID: this.channels[destination].channelKey,
        topic: this.channels[destination].channelCode,
        ttl: _constants.default.post.TTL
      }).then(() => {
        if (!cb) {
          return;
        }

        cb(null, true);
      }).catch(e => {
        if (!cb) {
          return;
        }

        cb(e, false);
      });
    }
  }

  sendMessage(destination, msg, cb) {
    if (_constants.default.regExp.CONTACT_CODE_REGEXP.test(destination)) {
      this.sendUserMessage(destination, msg, cb);
    } else {
      this.sendGroupMessage(destination, msg, cb);
    }
  }

}

module.exports = StatusJS;
//# sourceMappingURL=index.js.map