const redisClient = require('./redisClient');
const logger = require('../logging/logger'); 
const { formatError } = require('../logging/loggerUtil');
const AWSXRay = require('aws-xray-sdk');

const currentServiceName = `${process.env.SERVICE_NAME}-${process.env.SERVICE_VERSION}`;
const processedMessagesKey = `${currentServiceName}:processedMessages`;
const messageTTL = 86400; //24 hours 

const addProcessedMessage = async (correlationId) => {
    const segment = AWSXRay.getSegment() || new AWSXRay.Segment('addProcessedMessage');
    try {
        await redisClient.sadd(processedMessagesKey, correlationId);
        logger.debug(`Added message with correlation ID ${correlationId} to processedMessages`);
        
        await redisClient.expire(processedMessagesKey, messageTTL);
        logger.debug(`Set TTL for processedMessagesKey ${processedMessagesKey} to ${messageTTL} seconds`);

        segment.close();
    
    } catch (error) {
        logger.error(`Error in addProcessedMessage: ${formatError(error)}`);
        segment.addError(error); 
        segment.close();
        throw error; 
    }
};

const hasProcessedMessage = async (correlationId) => {
    const segment = AWSXRay.getSegment() || new AWSXRay.Segment('hasProcessedMessage');
    try {
        const exists = await redisClient.sismember(processedMessagesKey, correlationId);
        const result = !!exists;
    
        logger.debug(`Checked processedMessages for correlation ID ${correlationId}: ${result ? 'Exists' : 'Does not exist'}`);
        segment.close(); 
        return result; 
    } catch (error) {
        logger.error(`Error in hasProcessedMessage: ${formatError(error)}`);
        segment.addError(error); 
        segment.close();
        throw error; 
    }
};

module.exports = { addProcessedMessage, hasProcessedMessage };