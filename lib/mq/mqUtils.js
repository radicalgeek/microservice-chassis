const amqp = require('amqplib');
const logger = require('../logging/logger');
const { formatError } = require('../logging/loggerUtil');
const AWSXRay = require('aws-xray-sdk');

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const SERVICE_NAME = process.env.SERVICE_NAME;
const SERVICE_VERSION = process.env.SERVICE_VERSION;
const QUEUE_NAME = `${SERVICE_NAME}-${SERVICE_VERSION}`;

class MockSegment {
  constructor(name) {
      this.name = name;
  }
  addError() { /* no-op */ }
  close() { /* no-op */ }
  addAnnotation() { /* no-op */ }
  addMetadata() { /* no-op */ }
}


async function connect() {
  const segment = new AWSXRay.Segment('RabbitMQ-Connect');
    AWSXRay.setSegment(segment)
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    connection.on('error', (error) => {
        logger.error('Error from RabbitMQ Connection:', formatError(error));
        if (segment) segment.addError(error);

    });
      const channel = await connection.createChannel();
      channel.on('error', (error) => {
        logger.error('Error from RabbitMQ Channel:', formatError(error));
        if (segment) segment.addError(error);

      });

      return { channel, connection };
  } catch (error) {
    logger.error('Failed to connect to RabbitMQ:', formatError(error));
    if (segment) segment.addError(error); 
    throw error;
  } finally {
    if (segment) segment.close(); 
  }
}

const retryConnect = async (maxRetries = 5, delay = 1000) => {
  const segment = new AWSXRay.Segment('RabbitMQ-RetryConnect');
    AWSXRay.setSegment(segment)
  for (let i = 0; i < maxRetries; i++) {
    try {
      const connectionData = await connect();
      if (segment) segment.close(); 
      return connectionData;
    } catch (error) {
      logger.error(`Retry ${i + 1}: Failed to connect to RabbitMQ`, formatError(error));
      if (segment) segment.addError(error);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  const error = new Error('Exceeded max retries for connecting to RabbitMQ');
  if (segment) segment.addError(error);
  if (segment) segment.close(); 
  throw error;
};

async function createAndBindQueue(channel) {
  const segment = new AWSXRay.Segment('RabbitMQ-CreateAndBindQueue');
  AWSXRay.setSegment(segment)
  try {
    logger.info(`Using queue name: ${QUEUE_NAME}`);
    await channel.assertExchange('fanoutExchange', 'fanout'); 
    await channel.assertQueue(QUEUE_NAME); 
    await channel.bindQueue(QUEUE_NAME, 'fanoutExchange', ''); 
    logger.info(`Queue "${QUEUE_NAME}" created and bound successfully.`);
    return true;
  } catch (error) {
    logger.error("Error interacting with RabbitMQ:", formatError(error));
    if (segment) segment.addError(error);
    return false;
  }finally {
    if (segment) segment.close();
  }
}

async function listenToQueue(channel, callback) {
  const segment =  new AWSXRay.Segment('RabbitMQ-ListenToQueue');
  AWSXRay.setSegment(segment)
  channel.consume(QUEUE_NAME, (message) => {
    const subsegment = segment.addNewSubsegment('Process-Message');
    try {
      const parsedMessage = JSON.parse(message.content.toString());
      callback(parsedMessage, () => {
        channel.ack(message);
      });
    } catch (processingError) {
      logger.error('Error processing message:', formatError(processingError));
      if (subsegment) subsegment.addError(processingError); 
      channel.nack(message);
    } finally {
      if (subsegment) subsegment.close();
    }
  }, { noAck: false });
  if (segment) segment.close();
}

async function publishMessage(channel, message) {
  const segment =  new AWSXRay.Segment('RabbitMQ-PublishMessage');
  AWSXRay.setSegment(segment)
  try {
    channel.publish('fanoutExchange', '', Buffer.from(JSON.stringify(message)));
  } catch (publishError) {
    logger.error('Error publishing message:', formatError(publishError));
    if (segment) segment.addError(publishError);
    throw publishError;
  } finally {
    if (segment) segment.close();
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
