const amqp = require('amqplib');
const logger = require('../logging/logger');
const { formatError } = require('../logging/loggerUtil');
const AWSXRay = require('aws-xray-sdk');

const amqpWithXRay = AWSXRay.captureAWSClient(require('amqplib'));

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const SERVICE_NAME = process.env.SERVICE_NAME;
const SERVICE_VERSION = process.env.SERVICE_VERSION;
const QUEUE_NAME = `${SERVICE_NAME}-${SERVICE_VERSION}`;


async function connect() {

  const segment = AWSXRay.getSegment() || new AWSXRay.Segment('RabbitMQ-Connect');
  try {
    const connection = await amqpWithXRay.connect(RABBITMQ_URL);
    connection.on('error', (error) => {
        logger.error('Error from RabbitMQ Connection:', formatError(error));
        segment.addError(error);

    });
      const channel = await connection.createChannel();
      channel.on('error', (error) => {
        logger.error('Error from RabbitMQ Channel:', formatError(error));
        segment.addError(error);

      });

      return { channel, connection };
  } catch (error) {
    logger.error('Failed to connect to RabbitMQ:', formatError(error));
    segment.addError(error); 
    throw error;
  } finally {
    segment.close(); 
  }
}

const retryConnect = async (maxRetries = 5, delay = 1000) => {
  const segment = AWSXRay.getSegment() || new AWSXRay.Segment('RabbitMQ-RetryConnect');
  for (let i = 0; i < maxRetries; i++) {
    try {
      const connectionData = await connect();
      segment.close(); 
      return connectionData;
    } catch (error) {
      logger.error(`Retry ${i + 1}: Failed to connect to RabbitMQ`, formatError(error));
      segment.addError(error);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  const error = new Error('Exceeded max retries for connecting to RabbitMQ');
  segment.addError(error);
  segment.close(); 
  throw error;
};

async function createAndBindQueue(channel) {
  const segment = AWSXRay.getSegment() || new AWSXRay.Segment('RabbitMQ-CreateAndBindQueue');
  try {
    logger.info(`Using queue name: ${QUEUE_NAME}`);
    await channel.assertExchange('fanoutExchange', 'fanout'); 
    await channel.assertQueue(QUEUE_NAME); 
    await channel.bindQueue(QUEUE_NAME, 'fanoutExchange', ''); 
    logger.info(`Queue "${QUEUE_NAME}" created and bound successfully.`);
    return true;
  } catch (error) {
    logger.error("Error interacting with RabbitMQ:", formatError(error));
    segment.addError(error);
    return false;
  }finally {
    segment.close();
  }
}

async function listenToQueue(channel, callback) {
  const segment = AWSXRay.getSegment() || new AWSXRay.Segment('RabbitMQ-ListenToQueue');
  channel.consume(QUEUE_NAME, (message) => {
    const subsegment = segment.addNewSubsegment('Process-Message');
    try {
      const parsedMessage = JSON.parse(message.content.toString());
      callback(parsedMessage, () => {
        channel.ack(message);
      });
    } catch (processingError) {
      logger.error('Error processing message:', formatError(processingError));
      subsegment.addError(processingError); 
      channel.nack(message);
    } finally {
      subsegment.close();
    }
  }, { noAck: false });
  segment.close();
}

async function publishMessage(channel, message) {
  const segment = AWSXRay.getSegment() || new AWSXRay.Segment('RabbitMQ-PublishMessage');
  try {
    channel.publish('fanoutExchange', '', Buffer.from(JSON.stringify(message)));
  } catch (publishError) {
    logger.error('Error publishing message:', formatError(publishError));
    segment.addError(publishError);
    throw publishError;
  } finally {
    segment.close();
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
