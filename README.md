# Microservice Service Chassis README

## Overview

This service chassis is a foundational codebase designed to accelerate the development of microservices by providing core functionalities such as server setup, logging, message queue interactions, caching, and blob storage access. It is built with Node.js and integrates several third-party services and libraries to ensure robust, scalable, and maintainable microservices.

## Features

- Server Configuration: Utilizes Express.js for setting up the server and handling HTTP requests with additional security measures through Helmet.js and CORS support.
- Logging: Implements logging using Winston, allowing structured and level-based logging.
- Messaging: Integrates RabbitMQ for message queuing, providing publisher and subscriber setups to facilitate event-driven architectures.
- Caching: Leverages Redis for caching, offering mechanisms to store and verify the processing of messages.
- Blob Storage: Includes Minio client setup for object storage, enabling services to store and retrieve large data objects.
- Validation: Features message validation logic to ensure the integrity and relevance of messages being processed.
- Environment-Based Configuration: Supports environment variable configuration to manage service-specific, logging, messaging, caching, and blob storage settings.

## Getting Started

First install the NPM package in your project:

```bash
npm install @radicalgeek/service-chassis
```

Then, create a new service by importing `service` and creating a `serviceConfig` object. The `serviceConfig` object should contain the http routes, message listeners, and any startup messages for the service. Finally, start the service by calling the `start` method with the `serviceConfig`  object and the database connection object:

```javascript
// entry.js
const { service } = require('@trigbagger/service-chassis');
const myApi = require('./routes/myApi');
const { messages, myFirstListener, mySecondListener } = require('./sagas');
const db = require('./models');

const serviceConfig = {
    routes: [
        { path: '/api/get', method: 'get', handler: myApi.fetch },
        { path: '/api/post', method: 'post', handler: myApi.create },
        { path: '/api/put', method: 'put', handler: myApi.update },
        { path: '/api/delete', method: 'delete', handler: myApi.delete },
    ],
    messageListeners: [userResponseListener, activityRequestListener],
    startupMessages: [
        {
            message: messages.createMyObjectRequestMessage(),
            interval: 5 * 60 * 1000 
        },
    ]
};

service.start(serviceConfig, db);
```

### Http Routes

Define the HTTP routes for your service by creating a ./routes/ directory in your project and adding route files. Each route file should export functions that handle the HTTP requests. For example:

```javascript
// ./routes/myApi.js
const { MyObject } = require('../models');

exports.fetch = async (req, res) => {
    const id = req.params.id;
    
    const myObject = await MyObject.findOne({ 
        where: {
                id: id
            }
     });

    res.json(myObject);
};

exports.post = async (req, res) => {
    const { name, description } = req.body;

    const myObject = await MyObject.create({ name, description });

    res.json(myObject);
};

exports.update = async (req, res) => {
    const id = req.params.id;
    const { name, description } = req.body;

    const myObject = await MyObject.update({ name, description }, { where: { id } });

    res.json(myObject);
};

exports.delete = async (req, res) => {
    const id = req.params.id;

    const myObject = await MyObject.destroy({ where: { id } });

    res.json(myObject);
};
```

### Database Models

Define the database models for your service by creating a ./models/ directory in your project and adding model files. Each model file should export a Sequelize model. For example:

```javascript
// ./models/MyObject.js
use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class MyObject extends Model {
    static associate(models) {
    }
  }
  MyObject.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    name: DataTypes.STRING,
    description: DataTypes.TEXT,
  }, {
    sequelize,
    modelName: 'MyObject',
  });
  return MyObject;
};
```

### Message Listeners

Service chassis messaging is based on the [decorated saga pattern](https://radicalgeek.co.uk/microservice-architecture/building-a-choreographed-microservice-architecture-with-the-decorated-saga-pattern/)

Define the message listeners for your service by creating a ./sagas/listeners directory in your project and adding listener files for the messages you are interested in. Each listener file should export a function that processes messages. For example:

```javascript
// ./sagas/listeners/objectRequestListener.js
const db = require('../.././models');
const { messages } = require('../sagas');
const apm = require('elastic-apm-node')
const { logger, publishMessage, validateMessage } = require('@radicalgeek/service-chassis');

const interestdInSaga = 'needObjects';
const listener = 'objectRequestListener'

module.exports = async (channel, message) => {
    // elastic apm is built in to the chassis and can be used to monitor transactions
    const transaction = apm.startTransaction('Process Message', 'messaging');
    try {
        // use built in message validation
        const validation = await validateMessage(message, interestdInSaga, [], [], () => {}, listener);
        if (!validation.isValid) {
            transaction.end('success');
            return;
        }

        //use built in chassis logger to log messages to the console where they can be easily picked up by tools like logstash
        logger.info("Attempting to fetch objects from the database...");
        const myObjects = await db.MyObject.findAll(); 

        message.decorations.push({ myObjects: myObjects });
        publishMessage(channel, message);
        logger.info(`Successfully fetched a total of ${myObjects.length} objects.`);
        transaction.end('success');
    } catch (error) {
        logger.error('Error processing the message:',{listener: listener}, error, { correlationId: message.correlationId });
        apm.captureError(error);
        transaction.end('failure');
        throw error; 
    }
};
```

### Message Publishers

Messages can be published from anywhere in your service by importing the `publishMessage` function from the service chassis. For example:

```javascript
// ./routes/myApi.js
const { MyObject } = require('../models');
const { setupPublisher, publishMessage } = require('@radicalgeek/service-chassis');

...

exports.post = async (req, res) => {
    const { name, description } = req.body;

    const myObject = await MyObject.create({ name, description });

    res.json(myObject);
    await publishSaga(myObject);
};

...

async function publishSaga(newActivity) {
    const channel = await setupPublisher();
    const message = messages.createNewMyObjectMessage(myObject);
    publishMessage(channel, message);
}
```

And defining the message in a message file:

```javascript
// ./sagas/messages/createNewMyObjectMessage.js
const { v4: uuidv4 } = require('uuid');

module.exports.createMyObjectMessage = function(myObjectDetails, user) {
    return {
      correlationId: uuidv4(),
      sourceService: process.env.SERVICE_NAME + '-' + process.env.SERVICE_VERSION,
      publishTime: new Date().toISOString(),
      lastServiceDecoration: process.env.SERVICE_NAME + '-' + process.env.SERVICE_VERSION,
      lastDecorationTime: new Date().toISOString(),
      saga: 'newActivity',
      context: { object: myObjectDetails },
      decorations: [],
    };
  };
  ```

### Startup Messages

You can define the startup messages for your service by adding messages to the `startupMessages` array in the `serviceConfig` object. Each startup message will be sent at the interval frequency specified. For example:

```javascript
const { v4: uuidv4 } = require('uuid');

module.exports.createMyObjectRequestMessage = function() {
    return {
      correlationId: uuidv4(),
      sourceService: process.env.SERVICE_NAME + '-' + process.env.SERVICE_VERSION,
      publishTime: new Date().toISOString(),
      lastServiceDecoration: process.env.SERVICE_NAME + '-' + process.env.SERVICE_VERSION,
      lastDecorationTime: new Date().toISOString(),
      saga: 'needObjects',
      context: {},
      decorations: [],
    };
  };
  ```

  Other services can implement the `objectRequestListener` to respond to the `needObjects` saga. You would then want to add the `objectResponseListener` to handle the response from the `objectRequestListener` to either this service or another service that needs the information.

### Configuration

The service chassis supports environment-based configuration to manage service-specific, messaging, caching, and blob storage settings etc. The configuration is loaded from the container environment variables The following environment variables are supported:  

- `SERVICE_NAME`: The name of the service.
- `SERVICE_VERSION`: The version of the service.
- `POSTGRES_USERNAME`: The username for the PostgreSQL database.
- `POSTGRES_PASSWORD`: The password for the PostgreSQL database.
- `DATABASE_URL`: The URL for the PostgreSQL database.
- `RABBITMQ_URL`: The URL for the RabbitMQ server.
- `RABBMITMQ_USERNAME`: The username for the RabbitMQ server.
- `RABBITMQ_PASSWORD`: The password for the RabbitMQ server.
- `REDIS_HOST`: The URL for the Redis server.
- `REDIS_PORT`: The port for the Redis server.
- `REDIS_PASSWORD`: The password for the Redis server.
- `AMP_SERVER`: The URL for the Elastic APM server.
- `CORS_ORIGIN`: The origin for CORS requests.
- `MINIO_EXTERNAL_HOST`: The URL for the Minio server.

### Start the Service
```bash
node entry.js
```

## Contributing

If you would like to contribute to the service chassis, please send a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.



```
