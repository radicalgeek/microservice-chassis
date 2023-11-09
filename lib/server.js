const apm = require('elastic-apm-node').start({
    serviceName: process.env.SERVICE_NAME,
    secretToken: process.env.APM_TOKEN, 
    serverUrl: process.env.APM_SERVER, 
    active: process.env.NODE_ENV === 'production',
  });
const express = require('express');
const minioClient = require('./blob/minio');
const promClient = require('prom-client');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const logger = require('./logging/logger');
const util = require('util');
const { formatError } = require('./logging/loggerUtil');
const { setupPublisher, setupSubscriber, publishMessage } = require('./mq');  
const e = require('express');


let server;
let rabbitMqConnection;  
let channel;
const register = new promClient.Registry();

const app = express();
const PORT = 80;

promClient.collectDefaultMetrics({ register });

const httpRequestDurationMicroseconds = new promClient.Histogram({
    name: 'http_request_duration_ms',
    help: 'Duration of HTTP requests in ms',
    labelNames: ['method', 'route', 'code'],
    buckets: [0.1, 5, 15, 50, 100, 500, 1000, 2000, 5000]
  });

register.registerMetric(httpRequestDurationMicroseconds);

process.on('unhandledRejection', (reason, promise) => {
    if (reason instanceof Error) {
        logger.error('Unhandled Rejection at:', { error: reason.stack });
    } else {
        logger.error('Unhandled Rejection at:', {
            promise: util.inspect(promise, { depth: null }),
            reason: util.inspect(reason, { depth: null })
        });
    }
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', formatError(error));
    apm.captureError(error);
    process.exit(1); 
});

const corsOptions = {
    origin: process.env.CORS_ORIGIN,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Forwarded-User'],
    credentials: true,
    optionsSuccessStatus: 200 
  };
  
app.use(helmet());  
app.use(cors(corsOptions));
app.use(bodyParser.json());

app.use((req, res, next) => {
    const startHrTime = process.hrtime();

    res.on('finish', () => {
        const elapsedHrTime = process.hrtime(startHrTime);
        const elapsedTimeInMs = elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6;
        httpRequestDurationMicroseconds.labels(req.method, req.path, res.statusCode).observe(elapsedTimeInMs);
        
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

async function setupRoutes(routeConfig, db, rabbitMqConnection) {
       
    app.get('/health', (req, res) => {
        try {
            checkDatabase();
            //checkRabbitMQ();
            res.status(200).json({ status: 'OK', message: 'Service is healthy.' });
        } catch (error) {
            res.status(500).json({ status: 'Error', message: 'Service is unhealthy.', error: error.message });
        }
    });
    
    app.get('/readiness', async (req, res) => {
        try {
            await db.sequelize.authenticate();
        } catch (dbError) {
            logger.error('Database connection failed:', formatError(dbError));
            return res.status(500).send('Database connection failed. Service not ready.');
        }
    
        try {
            if (!rabbitMqConnection) {
                throw new Error('RabbitMQ connection not initialized');
            }
        } catch (rabbitError) {
            logger.error('RabbitMQ connection failed:', formatError(rabbitError));
            return res.status(500).send('RabbitMQ connection failed. Service not ready.');
        }
    
        res.status(200).send('OK');
    });

    app.get('/metrics', async (req, res) => {
        try {
            const metrics = await register.metrics();
            res.setHeader('Content-Type', register.contentType);
            res.send(metrics);
        } catch (err) {
            logger.debug('Failed to retrieve metrics:', formatError(err));
            apm.captureError(err);
            res.status(500).send('Failed to retrieve metrics');
        }
    });    

    routeConfig.forEach(route => {
        if (route.handler === 'static'){
            if (!route.directory) {
                throw new Error('A directory must be provided for static routes');
            }
            app.use(route.path, express.static(route.directory));
        } else {
            app[route.method](route.path, route.handler);
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

    async function checkDatabase() {
        try {
            await db.sequelize.authenticate();  
        } catch (error) {
            throw new Error('Database check failed: ' + error.message);
        }
    }

    // async function checkRabbitMQ() {
    //     if (!rabbitMqConnection || !rabbitMqConnection.isConnected()) { 
    //         throw new Error('RabbitMQ check failed: Connection is not established.');
    //     }
    // }  
}

async function setupMinio(bucketName) {
    try{

        const exists = await minioClient.bucketExists(bucketName,);
        if (!exists) {
            await minioClient.makeBucket(bucketName, 'eu-west-1');
            logger.info('Bucket created successfully');
        } else {
            logger.info('Bucket already exists');
        };
        
        const publicPolicy = {
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Principal: {
                    AWS: "*"
                },
                Action: "s3:GetObject",
                Resource: `arn:aws:s3:::${bucketName}/*`
            }]
        };

        minioClient.setBucketPolicy(bucketName, JSON.stringify(publicPolicy), (err) => {
            if (err) {
                console.error('Error setting bucket policy:', err);
                apm.captureError(err);
                return;
            }
        });
        logger.info('Bucket policy set to public');
    } catch (err) {
        logger.error('Error setting up Minio:', formatError(err));
        apm.captureError(err);
        throw err;  
    }
}

async function publishStartupMessages(startupMessages, publishChannel) {
    if (!startupMessages || !Array.isArray(startupMessages)) return;

    for (const messageConfig of startupMessages) {
        if (messageConfig.message && messageConfig.interval) {
            try {
                await publishMessage(publishChannel, messageConfig.message);
                logger.info('Publishing startup messages.');
                setInterval( async () => {
                    try {
                        await publishMessage(publishChannel, messageConfig.message);
                        logger.info('Re-publishing startup messages.');
                    } catch (err) {
                        logger.error('Error publishing startup message:', formatError(err));
                        apm.captureError(err);
                    }
                }, messageConfig.interval);
            } catch (err) {
                logger.error('Error publishing startup message:', formatError(err));
                apm.captureError(err);
            }
        }
    }
}

async function startService(serviceConfig, db) {
    try{
        const result = await setupPublisher();
        rabbitMqConnection = result.connection;
        channel = result.channel;  
        if (serviceConfig.messageListeners && serviceConfig.messageListeners.length > 0) {
            await setupSubscriber(channel, serviceConfig.messageListeners);
        } else {
            logger.info('No message listeners to setup');
        }
        await setupRoutes(serviceConfig.routes, db, rabbitMqConnection);
        if (serviceConfig.useMinio && serviceConfig.bucketName) {
            await setupMinio(serviceConfig.bucketName);
        } else {
            logger.info('Not buckets to setup');
        }
        if (serviceConfig.startupMessages && serviceConfig.startupMessages.length > 0) {
            await publishStartupMessages(serviceConfig.startupMessages, channel);
        } else {
            logger.info('No startup messages to publish');
        }
        process.on('SIGINT', shutdown('SIGINT', db, rabbitMqConnection));
        process.on('SIGTERM', shutdown('SIGTERM', db, rabbitMqConnection));
    } catch (err) {
        logger.error('Error starting service:', formatError(err));
        apm.captureError(err);
        process.exit(1);
    }
}

module.exports.start = (serviceConfig, db) => {
    db.sequelize.sync().then(() => {
        startService(serviceConfig, db).then(() => {
            server = app.listen(PORT, () => {
                logger.info(`Server is running on http://${process.env.SERVICE_NAME}:${PORT}`);
            });
            server.timeout = 30000;
        }).catch(err => {
            logger.error('Error while starting the service after database sync:', formatError(err));
            apm.captureError(err);
        });
    }).catch(err => {
        logger.error('Error while syncing with the database:', formatError(err));
        apm.captureError(err);
    });
}

const shutdown = (signal, db, rabbitMqConnection) => async () => {
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
