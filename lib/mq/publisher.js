const mqUtils = require('./mqUtils');
const logger = require('../logging/logger');
const { formatError } = require('../logging/loggerUtil');

const currentServiceName = `${process.env.SERVICE_NAME}-${process.env.SERVICE_VERSION}`;

async function setupPublisher() {
  try {
    logger.info('Setting up publisher...');
    const connectionData = await mqUtils.retryConnect();
    logger.info('Publisher setup successful.');
    return connectionData;
  } catch (error) {
    logger.error('Failed to setup publisher:', formatError(error));
    throw error;
  }
}

function publishMessage(channel, message) {
  try {
    logger.info('Publishing message', {correlationId: message.correlationId, saga: message.saga});
    message.lastServiceDecoration = currentServiceName;
    message.lastDecorationTime = new Date().toISOString();
    if (!message.publishTime) {
      message.publishTime = new Date().toISOString();
    }
    mqUtils.publishMessage(channel, message);
    logger.info('Message published successfully.', {correlationId: message.correlationId, saga: message.saga});
  } catch (error) {
    logger.error('Failed to publish message:', formatError(error), {correlationId: message.correlationId, saga: message.saga});
  } 
}

module.exports = {
  setupPublisher,
  publishMessage,
};
