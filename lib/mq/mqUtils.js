const amqp = require('amqplib');
const logger = require('../logging/logger');
const { formatError } = require('../logging/loggerUtil');
//const apm = require('elastic-apm-node');

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const SERVICE_NAME = process.env.SERVICE_NAME;
const SERVICE_VERSION = process.env.SERVICE_VERSION;
const QUEUE_NAME = `${SERVICE_NAME}-${SERVICE_VERSION}`;


async function connect() {
  //const transaction = apm.startTransaction('Connect to RabbitMQ', 'rabbitmq');
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    connection.on('error', (error) => {
        logger.error('Error from RabbitMQ Connection:', formatError(error));
        //apm.captureError(error);
    });
      const channel = await connection.createChannel();
      channel.on('error', (error) => {
        logger.error('Error from RabbitMQ Channel:', formatError(error));
        //apm.captureError(error);
      });
      //transaction.end();
      return { channel, connection };
  } catch (error) {
    logger.error('Failed to connect to RabbitMQ:', formatError(error));
    //apm.captureError(error);
    //transaction.end();
    throw error;
  }
}

const retryConnect = async (maxRetries = 5, delay = 1000) => {
  const transaction = apm.startTransaction('Retry Connect to RabbitMQ', 'rabbitmq');
  for (let i = 0; i < maxRetries; i++) {
    try {
      const connectionData = await connect();
      transaction.end();
      return connectionData;
    } catch (error) {
      logger.error(`Retry ${i + 1}: Failed to connect to RabbitMQ`, formatError(error));
      apm.captureError(error);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  const error = new Error('Exceeded max retries for connecting to RabbitMQ');
  apm.captureError(error);
  transaction.end();
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
  }
}

async function listenToQueue(channel, callback) {
  const transaction = apm.startTransaction('Listen to RabbitMQ Queue', 'rabbitmq');
  channel.consume(QUEUE_NAME, (message) => {
    try {
      const parsedMessage = JSON.parse(message.content.toString());
      callback(parsedMessage, () => {
        channel.ack(message);
      });
    } catch (processingError) {
      logger.error('Error processing message:', formatError(processingError));
      apm.captureError(processingError);
      channel.nack(message);
    } finally {
      transaction.end();
    }
  }, { noAck: false });
}

async function publishMessage(channel, message) {
  const transaction = apm.startTransaction('Publish RabbitMQ Message', 'rabbitmq');
  try {
    channel.publish('fanoutExchange', '', Buffer.from(JSON.stringify(message)));
  } catch (publishError) {
    logger.error('Error publishing message:', formatError(publishError));
    apm.captureError(publishError);
    throw publishError;
  } finally {
    transaction.end();
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
