//const mqUtils = require('@trigbagger/mq-utils');
const { mqUtils } = require('mq-utils');

async function setupSubscriber(publishChannel,handleMessage) {
  console.log('Setting up the subscriber...');

  try {
    // Connect to RabbitMQ
    const channel = await mqUtils.connect();
    console.log('Successfully connected to RabbitMQ.');

    // Create and bind the queue
    await mqUtils.createAndBindQueue(channel);

    // Start listening to the queue
    mqUtils.listenToQueue(channel, (message, ackCallback) => {
      console.log(`Received message:`, message);
      
      handleMessage(publishChannel, message);

      ackCallback();  // Acknowledge the message after processing
      console.log(`Message acknowledged.`);
    });

    console.log('Subscriber setup complete.');

  } catch (error) {
    console.error('Error setting up the subscriber:', error);
    throw error;  // Re-throw the error so the caller knows something went wrong
  }
}

module.exports = setupSubscriber;

