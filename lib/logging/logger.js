const winston = require('winston');
require('winston-cloudwatch');

const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
);

const transports = [
  new winston.transports.Console({
      format: logFormat,
  })
];

if (process.env.NODE_ENV !== 'development') {
  const cloudwatchTransport = new winston.transports.CloudWatch({
    logGroupName: process.env.CLOUDWATCH_LOG_GROUP,
    logStreamName: process.env.CLOUDWATCH_LOG_STREAM,
    awsRegion: process.env.AWS_REGION,
    level: 'debug', 
    jsonMessage: true,
    format: logFormat
  });

  cloudwatchTransport.on('error', (err) => {
    console.error('CloudWatch Transport Error:', err);
  });

  transports.push(cloudwatchTransport);
}

const logger = winston.createLogger({
  level: 'debug',
  format: logFormat,
  defaultMeta: { service: process.env.SERVICE_NAME },
  transports: transports
});

module.exports = logger;
