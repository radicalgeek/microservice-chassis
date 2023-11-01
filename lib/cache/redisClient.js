const Redis = require('ioredis');
const logger = require('../logging/logger');
const apm = require('elastic-apm-node');

const redisClient = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
});

redisClient.on('connect', () => {
  logger.info('Connected to Redis');
  apm.captureCustomContext({ message: 'Connected to Redis' });
});

redisClient.on('error', (err) => {
  logger.error('Redis error:', err);
  apm.captureError(err);
});

module.exports = redisClient;