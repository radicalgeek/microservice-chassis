const apm = require('elastic-apm-node').start({
    serviceName: process.env.SERVICE_NAME, 
    serverUrl: process.env.AMP_SERVER, //'http://apm-apm-http.gitlab-managed-apps.svc.cluster.local:8200',
    active: process.env.NODE_ENV === 'production',
  });
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const logger = require('./logging/logger');
const { formatError } = require('./logging/loggerUtils');
const { setupPublisher, setupSubscriber } = require('./mq');  


let server;
let rabbitMqConnection;  
let publishChannel;

const app = express();
const PORT = 80;

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', { promise, reason });
});

const corsOptions = {
    origin: process.env.CORS_ORIGIN,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Forwarded-User'],
    credentials: true,
    optionsSuccessStatus: 200 
  };
  
app.use(cors(corsOptions));
app.use(bodyParser.json());

app.use((req, res, next) => {
    const startHrTime = process.hrtime();

    res.on('finish', () => {
        const elapsedHrTime = process.hrtime(startHrTime);
        const elapsedTimeInMs = elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6;
        
        logger.debug(`Request details:`, {
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            responseTime: `${elapsedTimeInMs.toFixed(3)} ms`,
            userAgent: req.headers['user-agent'],
            ip: req.ip
        });
    });

    next();
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.get('/readiness', async (req, res) => {
    try {
        // For Sequelize, you can use the `authenticate` method to test the connection
        await db.sequelize.authenticate();
        if (!rabbitMqConnection) throw new Error('RabbitMQ connection not initialized');
        res.status(200).send('OK');
    } catch (err) {
        logger.error('Database connection failed:', formatError(err));
        res.status(500).send('Service not ready');
    }
});

app.use((req, res, next) => {
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
});

app.use((err, req, res, next) => {
    if (err.status === 404) {
        logger.warn('Client Error (Not Found):', formatError(err));
    } else {
        logger.error('Server Error:', formatError(err));
        apm.captureError(err);
    }
    
    res.status(err.status || 500);
    const errorResponse = {
        message: err.message,
        error: process.env.NODE_ENV === 'development' ? err.stack : {}
    };
    res.json(errorResponse);
});

function setupRoutes(routeConfig) {
    routeConfig.forEach(route => {
        app[route.method](route.path, route.handler);
    });
}

async function startService(serviceConfig) {
    try{
        setupRoutes(serviceConfig.routes);
        await setupSubscriber(publishChannel, serviceConfig.messageListeners);
        const result = await setupPublisher();
        rabbitMqConnection = result.connection;
        publishChannel = result.channel;  
    } catch (err) {
        logger.error('Error starting service:', formatError(err));
        apm.captureError(err);
        process.exit(1);
    }
}

module.exports.start = (serviceConfig, db) => {
    db.sequelize.sync().then(() => {
        startService(serviceConfig).then(() => {
            server = app.listen(PORT, () => {
                logger.info(`Server is running on http://localhost:${PORT}`);
            });
        }).catch(err => {
            logger.error('Error while starting the service after database sync:', formatError(err));
            apm.captureError(err);
        });
    }).catch(err => {
        logger.error('Error while syncing with the database:', formatError(err));
        apm.captureError(err);
    });
}

const shutdown = signal => async () => {
    logger.info(`Received ${signal}. Graceful shutdown initiated.`);
    
    server.close(() => {
        logger.info('Server closed.');
    });

    try {
        if (db.sequelize) await db.sequelize.close();
        logger.info('Database connection closed.');
    } catch(err) {
        logger.error('Error closing database connection:', formatError(err));
    }

    try {
        if (rabbitMqConnection) await rabbitMqConnection.close();
        logger.info('RabbitMQ connection closed.');
    } catch(err) {
        logger.error('Error closing RabbitMQ connection:', formatError(err));
    }

    process.exit(0);
};

process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));
