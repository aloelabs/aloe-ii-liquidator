"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_transport_1 = __importDefault(require("winston-transport"));
class SlackHook extends winston_transport_1.default {
    constructor(webhookURL, opts = undefined) {
        super(opts);
        this.webhookURL = webhookURL;
    }
    log(info, callback) {
        const payload = { mrkdwn: true, text: info.message };
        // axios.post(this.webhookURL, payload).then(() => callback());
    }
}
exports.default = SlackHook;
module.exports = SlackHook;
