const { mqUtils } = require('mq-utils');

async function setupSubscriber(publishChannel,handleMessage) {
  console.log('Setting up the subscriber...');

  try {
    const channel = await mqUtils.connect();
    console.log('Successfully connected to RabbitMQ.');

    await mqUtils.createAndBindQueue(channel);

    mqUtils.listenToQueue(channel, (message, ackCallback) => {
      console.log(`Received message:`, message);
      
      handleMessage(publishChannel, message);

      ackCallback(); 
      console.log(`Message acknowledged.`);
    });

    console.log('Subscriber setup complete.');

  } catch (error) {
    console.error('Error setting up the subscriber:', error);
    throw error; 
  }
}

module.exports = setupSubscriber;

