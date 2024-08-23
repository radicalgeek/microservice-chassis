const winston = require('winston');
require('winston-cloudwatch');

const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
);

const cloudwatchTransport = new winston.transports.CloudWatch({
  logGroupName: process.env.CLOUDWATCH_LOG_GROUP,
  logStreamName: process.env.CLOUDWATCH_LOG_STREAM,
  awsRegion: process.env.AWS_REGION
});

cloudwatchTransport.on('error', (err) => {
  console.error('CloudWatch Transport Error:', err);
});

const logger = winston.createLogger({
  level: 'debug',
  format: logFormat,
  defaultMeta: { service: process.env.SERVICE_NAME },
  transports: [
    new winston.transports.Console({
      format: logFormat,
    }),
    cloudwatchTransport
  ],
});

module.exports = logger;
