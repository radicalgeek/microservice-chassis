const  mqUtils  = require('./mqUtils');
const logger = require('../logging/logger');
const { formatError } = require('../logging/loggerUtil');

async function setupSubscriber(subscriberChannel,messageHandlers) {
  logger.info('Setting up the subscriber...');

  try {
    const { channel } = await mqUtils.retryConnect();
    logger.info('Successfully connected to RabbitMQ.');

    await mqUtils.createAndBindQueue(channel);

    mqUtils.listenToQueue(channel, (message, ackCallback) => {
      try{
        logger.info(`Received message:`,{correlationId: message.correlationId, saga: message.saga});
        for (let messageHandler of messageHandlers) {
          try {
            messageHandler(subscriberChannel, message);
          } catch (error) {
            logger.error('Error handling message:', formatError(error), {correlationId: message.correlationId, saga: message.saga});
          }
        }
        ackCallback(); 
        logger.info(`Message acknowledged.`, {correlationId: message.correlationId, saga: message.saga});
      } catch (error) {
        logger.error('Error handling message:', formatError(error), {correlationId: message.correlationId, saga: message.saga});
      } 
    });

    logger.info('Subscriber setup complete.');

  } catch (error) {
    logger.error('Error setting up the subscriber:', formatError(error));
    throw error; 
  }
}

module.exports = setupSubscriber;

