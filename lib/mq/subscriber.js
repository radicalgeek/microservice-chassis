const  mqUtils  = require('./mqUtils');
const apm = require('elastic-apm-node');
const logger = require('../logging/logger');
const { formatError } = require('../logging/loggerUtil');

async function setupSubscriber(publishChannel,messageHandlers) {
  logger.info('Setting up the subscriber...');

  try {
    const { channel } = await mqUtils.retryConnect();
    logger.info('Successfully connected to RabbitMQ.');

    await mqUtils.createAndBindQueue(channel);

    mqUtils.listenToQueue(channel, (message, ackCallback) => {
      const transaction = apm.startTransaction('Handle Message', 'consume');
      try{
        logger.info(`Received message:`,{correlationId: message.correlationId, saga: message.saga});
        for (let messageHandler of messageHandlers) {
          try {
            messageHandler(publishChannel, message);
          } catch (error) {
            logger.error('Error handling message:', formatError(error), {correlationId: message.correlationId, saga: message.saga});
            apm.captureError(error);
          }
        }
        ackCallback(); 
        logger.info(`Message acknowledged.`, {correlationId: message.correlationId, saga: message.saga});
      } catch (error) {
        logger.error('Error handling message:', formatError(error), {correlationId: message.correlationId, saga: message.saga});
        apm.captureError(error);
      } finally {
        transaction.end();
      }
    });

    logger.info('Subscriber setup complete.');

  } catch (error) {
    logger.error('Error setting up the subscriber:', formatError(error));
    apm.captureError(error);
    throw error; 
  }
}

module.exports = setupSubscriber;

