const AWS = require('aws-sdk');
const cloudwatch = new AWS.CloudWatch({ region: process.env.AWS_REGION });
const AWSXRay = require('aws-xray-sdk');
const express = require('express');
const minioClient = require('./blob/minio');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const logger = require('./logging/logger');
const util = require('util');
const { formatError } = require('./logging/loggerUtil');
const { setupPublisher, setupSubscriber, publishMessage } = require('./mq');  
const createAuthMiddleware = require('./middleware/auth'); 
const e = require('express');


let server;
let rabbitMqConnection;  
let channel;

const app = express();
const PORT = 80;

const recordHttpRequestDuration = (method, route, statusCode, durationMs) => {
    const params = {
        MetricData: [{
            MetricName: 'HttpRequestDurationMs',
            Dimensions: [
                { Name: 'Method', Value: method },
                { Name: 'Route', Value: route },
                { Name: 'StatusCode', Value: statusCode.toString() }
            ],
            Unit: 'Milliseconds',
            Value: durationMs
        }],
        Namespace: process.env.SERVICE_NAME
    };

    cloudwatch.putMetricData(params, (err, data) => {
        if (err) {
            logger.error('Error sending metric to CloudWatch:', err);
        } else {
            logger.debug('Metric sent to CloudWatch:', data);
        }
    });
};

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
    AWSXRay.captureException(error);
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
  
AWSXRay.config([AWSXRay.plugins.EKSPlugin]);
app.use(AWSXRay.express.openSegment(process.env.SERVICE_NAME));

app.use(helmet());  
app.use(cors(corsOptions));
app.use(bodyParser.json());

app.use((req, res, next) => {
    const startHrTime = process.hrtime();

    res.on('finish', () => {
        const elapsedHrTime = process.hrtime(startHrTime);
        const elapsedTimeInMs = elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6;

        recordHttpRequestDuration(req.method, req.path, res.statusCode, elapsedTimeInMs);
        
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

async function setupRoutes(routeConfig, db, rabbitMqConnection, authConfig) {

    const authMiddleware = authConfig ? createAuthMiddleware(authConfig) : null;
       
    app.get('/health', (req, res) => {
        const segment = AWSXRay.getSegment();
        try {
            checkDatabase();
            res.status(200).json({ status: 'OK', message: 'Service is healthy.' });
        } catch (error) {
            if (segment) segment.addError(error);
            res.status(500).json({ status: 'Error', message: 'Service is unhealthy.', error: error.message });
        }
    });
    
    app.get('/readiness', async (req, res) => {
        const segment = AWSXRay.getSegment();
        try {
            await db.sequelize.authenticate();
        } catch (dbError) {
            logger.error('Database connection failed:', formatError(dbError));
            if (segment) segment.addError(dbError);
            return res.status(500).send('Database connection failed. Service not ready.');
        }
    
        try {
            if (!rabbitMqConnection) {
                throw new Error('RabbitMQ connection not initialized');
            }
        } catch (rabbitError) {
            logger.error('RabbitMQ connection failed:', formatError(rabbitError));
            if (segment) segment.addError(rabbitError);
            return res.status(500).send('RabbitMQ connection failed. Service not ready.');
        }
    
        res.status(200).send('OK');
    });

    app.get('/metrics', async (req, res) => {
        const segment = AWSXRay.getSegment();
        try {
            const metrics = await register.metrics();
            res.setHeader('Content-Type', register.contentType);
            res.send(metrics);
        } catch (err) {
            logger.debug('Failed to retrieve metrics:', formatError(err));
            if (segment) segment.addError(err);
            res.status(500).send('Failed to retrieve metrics');
        }
    });
    
    app.use((req, res, next) => {
        req.db = db; 
        next();
    });

    routeConfig.forEach(route => {
        const middlewares = [];

        if (authMiddleware && route.requireAuth) {
            middlewares.push(authMiddleware);
        }

        if (route.handler === 'static'){
            if (!route.directory) {
                throw new Error('A directory must be provided for static routes');
            }
            app.use(route.path, express.static(route.directory));
        } else {
            app[route.method](route.path, ...middlewares, route.handler);
        }
        
    });

    app.use((req, res, next) => {
        const err = new Error('Not Found');
        err.status = 404;
        next(err);
    });
    
    app.use((err, req, res, next) => {
        const segment = AWSXRay.getSegment();

        if (err.status === 404) {
            logger.warn('Client Error (Not Found):', formatError(err));
        } else {
            logger.error('Server Error:', formatError(err));
            if (segment) segment.addError(err);
        }
        
        res.status(err.status || 500);
        const errorResponse = {
            message: err.message,
            error: process.env.NODE_ENV === 'development' ? err.stack : {}
        };
        res.json(errorResponse);
    });

    app.use(AWSXRay.express.closeSegment());

    async function checkDatabase() {
        try {
            await db.sequelize.authenticate();  
        } catch (error) {
            throw new Error('Database check failed: ' + error.message);
        }
    }
}

async function setupMinio(bucketName) {
    const segment = new AWSXRay.Segment('SetupMinio');

    try {
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
                logger.error('Error setting bucket policy:', err);
                segment.addError(err);
                return;
            }
        });
        logger.info('Bucket policy set to public');
    } catch (err) {
        logger.error('Error setting up Minio:', formatError(err));
        segment.addError(err);
        throw err;  
    } finally {
        segment.close(); 
    }
}

async function publishStartupMessages(startupMessages, publishChannel) {
    if (!startupMessages || !Array.isArray(startupMessages)) return;

    for (const messageConfig of startupMessages) {    
        if (messageConfig.message && messageConfig.interval) {
            const segment = new AWSXRay.Segment('PublishStartupMessage');
            try {
                await publishMessage(publishChannel, messageConfig.message);
                logger.info('Publishing startup messages.');
                setInterval( async () => {
                    try {
                        await publishMessage(publishChannel, messageConfig.message);
                        logger.info('Re-publishing startup messages.');
                    } catch (err) {
                        logger.error('Error publishing startup message:', formatError(err));
                        segment.addError(err);
                    }
                }, messageConfig.interval);
            } catch (err) {
                logger.error('Error publishing startup message:', formatError(err));
                segment.addError(err);
            } finally {
                segment.close();
            }
        }
    }
}

async function startService(serviceConfig, db, authConfig) {
    const segment = new AWSXRay.Segment('StartService');

    try{
        const result = await setupPublisher();
        rabbitMqConnection = result.connection;
        channel = result.channel;  
        if (serviceConfig.messageListeners && serviceConfig.messageListeners.length > 0) {
            await setupSubscriber(channel, serviceConfig.messageListeners);
        } else {
            logger.info('No message listeners to setup');
        }
        await setupRoutes(serviceConfig.routes, db, rabbitMqConnection, authConfig);
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
        segment.addError(err);
        process.exit(1);
    } finally {
        segment.close(); 
    }
}

module.exports.start = (serviceConfig, db, authConfig) => {
    const segment = new AWSXRay.Segment('ServiceStart');

    db.sequelize.sync().then(() => {
        startService(serviceConfig, db, authConfig).then(() => {
            server = app.listen(PORT, () => {
                logger.info(`Server is running on http://${process.env.SERVICE_NAME}:${PORT}`);
            });
            server.timeout = 30000;
        }).catch(err => {
            logger.error('Error while starting the service after database sync:', formatError(err));
            segment.addError(err); 
        });
    }).catch(err => {
        logger.error('Error while syncing with the database:', formatError(err));
        segment.addError(err); 
    }).finally(() => {
        segment.close(); 
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
