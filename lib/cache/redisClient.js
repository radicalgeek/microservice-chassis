const Redis = require('ioredis');
const AWS = require('aws-sdk');
const logger = require('../logging/logger');
const AWSXRay = require('aws-xray-sdk');
const fs = require('fs');

AWSXRay.captureAWS(AWS);

const region = process.env.AWS_REGION;
const secretId = process.env.REDIS_SECRET_ID;
const roleArn = process.env.AWS_ROLE_ARN;
const tokenFile = process.env.AWS_WEB_IDENTITY_TOKEN_FILE;

const sts = new AWS.STS({
  region: region
});


async function assumeRole() {
  const segment = AWSXRay.getSegment() || new AWSXRay.Segment('assumeRole');
  try{
    const token = fs.readFileSync(tokenFile, 'utf8');

    const params = {
      RoleArn: roleArn,
      RoleSessionName: 'web-identity-session',
      WebIdentityToken: token
    };

    const data = await sts.assumeRoleWithWebIdentity(params).promise();
    return {
      accessKeyId: data.Credentials.AccessKeyId,
      secretAccessKey: data.Credentials.SecretAccessKey,
      sessionToken: data.Credentials.SessionToken
    };
  } catch (error) {
    segment.addError(error);
    segment.close();
    throw error;
  }
  
}

async function getRedisCredentials() {
  const segment = AWSXRay.getSegment() || new AWSXRay.Segment('getRedisCredentials');
  try {
    const credentials = await assumeRole();
    const secretsManager = new AWS.SecretsManager({
      region: region,
      credentials: credentials,
    });

    const data = await secretsManager.getSecretValue({ SecretId: secretId }).promise();
    segment.close();
    if ('SecretString' in data) {
      return JSON.parse(data.SecretString);
    } else {
      const buff = Buffer.from(data.SecretBinary, 'base64');
      return JSON.parse(buff.toString('ascii'));
    }
  } catch (err) {
    logger.error('Error retrieving Redis credentials:', err);
    segment.addError(error);
    segment.close();
    throw err;
  }
}

(async function initializeRedis() {
  const segment = AWSXRay.getSegment() || new AWSXRay.Segment('initializeRedis');
  try {
    let redisConfig;

    if (process.env.NODE_ENV === 'development') {
      logger.info('Running in development mode, using environment variables for Redis connection');
      
      redisConfig = {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD,
      };
    } else {
      logger.info('Running in hosted mode, using AWS Secrets Manager for Redis connection');
      const redisCredentials = await getRedisCredentials();

      redisConfig = {
        host: redisCredentials.endpoint,
        port: redisCredentials.port
      };
    }

    const redisClient = new Redis(redisConfig);

    redisClient.on('connect', () => {
      logger.info('Connected to Redis');
      const connectSegment = segment.addNewSubsegment('RedisConnect');
      connectSegment.addAnnotation('message', 'Connected to Redis');
      connectSegment.close();
    });

    redisClient.on('error', (err) => {
      logger.error('Redis error:', err);
      const errorSegment = segment.addNewSubsegment('RedisError');
      errorSegment.addError(err);
      errorSegment.close();
    });

    module.exports = redisClient;

  } catch (err) {
    logger.error('Failed to initialize Redis client:', err);
    segment.addError(err);
    segment.close();
    process.exit(1);
  } finally {
    segment.close();
  }
})();
