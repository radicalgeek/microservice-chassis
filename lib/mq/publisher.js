const { mqUtils } = require('./mqUtils');
const apm = require('elastic-apm-node');
const logger = require('../logging/logger');
const { formatError } = require('../logging/loggerUtil');

async function setupPublisher() {
  try {
    logger.info('Setting up publisher...');
    const channel = await mqUtils.retryConnect();
    logger.info('Publisher setup successful.');
    return channel;
  } catch (error) {
    logger.error('Failed to setup publisher:', formatError(error));
    apm.captureError(error);
    throw error;
  }
}

function publishMessage(channel, message) {
  const transaction = apm.startTransaction('Publish Message', 'publish');
  try {
    logger.info('Publishing message...');
    message.publishTime = new Date().toISOString();
    mqUtils.publishMessage(channel, message);
    logger.info('Message published successfully.');
  } catch (error) {
    logger.error('Failed to publish message:', formatError(error));
    apm.captureError(error);
  } finally {
    transaction.end();
  }
}

module.exports = {
  setupPublisher,
  publishMessage,
};
