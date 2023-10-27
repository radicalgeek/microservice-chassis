//const mqUtils = require('@trigbagger/mq-utils');
const { mqUtils } = require('mq-utils');

async function setupPublisher() {
  const channel = await mqUtils.connect();
  return channel;
}

function publishMessage(channel, message) {
  message.publishTime = new Date().toISOString();
  mqUtils.publishMessage(channel, message);
}

module.exports = {
  setupPublisher,
  publishMessage,
};
