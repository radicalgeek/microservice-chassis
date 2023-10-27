const amqp = require('amqplib');
const logger = require('../logging/logger');

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const SERVICE_NAME = process.env.SERVICE_NAME;
const SERVICE_VERSION = process.env.SERVICE_VERSION;
const QUEUE_NAME = `${SERVICE_NAME}-${SERVICE_VERSION}`;

async function connect() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    connection.on('error', (error) => {
        logger.error('Error from RabbitMQ Connection:', { error });
    });
      const channel = await connection.createChannel();
      channel.on('error', (error) => {
        logger.error('Error from RabbitMQ Channel:', { error });
      });
      return { channel, connection };
  } catch (error) {
    logger.error('Failed to connect to RabbitMQ:', { error });
    throw error;
  }
}

async function createAndBindQueue(channel) {
  try {
    logger.info(`Using queue name: ${QUEUE_NAME}`);
    await channel.assertExchange('fanoutExchange', 'fanout'); 
    await channel.assertQueue(QUEUE_NAME); 
    await channel.bindQueue(QUEUE_NAME, 'fanoutExchange', ''); 
    logger.info(`Queue "${QUEUE_NAME}" created and bound successfully.`);
  } catch (error) {
    logger.error("Error interacting with RabbitMQ:", { error });
    // Depending on the nature of the error, decide on further actions.
    // You can either exit the application or try to reconnect, for instance.
    throw error;
  }
}


async function listenToQueue(channel, callback) {
  channel.consume(QUEUE_NAME, (message) => {
    const parsedMessage = JSON.parse(message.content.toString());
    callback(parsedMessage, () => {
      channel.ack(message); 
    });
  }, {
    noAck: false 
  });
}

async function publishMessage(channel, message) {
  channel.publish('fanoutExchange', '', Buffer.from(JSON.stringify(message)));
}

module.exports = {
  connect,
  createAndBindQueue,
  listenToQueue,
  publishMessage,
  QUEUE_NAME
};
