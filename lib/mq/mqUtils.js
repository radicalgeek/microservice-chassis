const amqp = require('amqplib');
const logger = require('../logging/logger');
const { formatError } = require('../logging/loggerUtil');
//const AWSXRay = require('aws-xray-sdk');

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const SERVICE_NAME = process.env.SERVICE_NAME;
const SERVICE_VERSION = process.env.SERVICE_VERSION;
const QUEUE_NAME = `${SERVICE_NAME}-${SERVICE_VERSION}`;




async function connect() {

  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    connection.on('error', (error) => {
        logger.error('Error from RabbitMQ Connection:', formatError(error));


    });
      const channel = await connection.createChannel();
      channel.on('error', (error) => {
        logger.error('Error from RabbitMQ Channel:', formatError(error));

      });

      return { channel, connection };
  } catch (error) {
    logger.error('Failed to connect to RabbitMQ:', formatError(error));

    throw error;
  } 
}

const retryConnect = async (maxRetries = 5, delay = 1000) => {

  for (let i = 0; i < maxRetries; i++) {
    try {
      const connectionData = await connect();

      return connectionData;
    } catch (error) {
      logger.error(`Retry ${i + 1}: Failed to connect to RabbitMQ`, formatError(error));

      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  const error = new Error('Exceeded max retries for connecting to RabbitMQ');

  throw error;
};

async function createAndBindQueue(channel) {

  try {
    logger.info(`Using queue name: ${QUEUE_NAME}`);
    await channel.assertExchange('fanoutExchange', 'fanout'); 
    await channel.assertQueue(QUEUE_NAME); 
    await channel.bindQueue(QUEUE_NAME, 'fanoutExchange', ''); 
    logger.info(`Queue "${QUEUE_NAME}" created and bound successfully.`);
    return true;
  } catch (error) {
    logger.error("Error interacting with RabbitMQ:", formatError(error));

    return false;
  }finally {

  }
}

async function listenToQueue(channel, callback) {

  channel.consume(QUEUE_NAME, (message) => {

    try {
      const parsedMessage = JSON.parse(message.content.toString());
      callback(parsedMessage, () => {
        channel.ack(message);
      });
    } catch (processingError) {
      logger.error('Error processing message:', formatError(processingError));

      channel.nack(message);
    } finally {

    }
  }, { noAck: false });

}

async function publishMessage(channel, message) {

  try {
    channel.publish('fanoutExchange', '', Buffer.from(JSON.stringify(message)));
  } catch (publishError) {
    logger.error('Error publishing message:', formatError(publishError));

    throw publishError;
  } finally {

  }
}

module.exports = {
  connect,
  retryConnect,
  createAndBindQueue,
  listenToQueue,
  publishMessage,
  QUEUE_NAME
};
