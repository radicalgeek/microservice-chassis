const redisClient = require('./redisClient');
const logger = require('../logging/logger'); 
const { formatError } = require('../logging/loggerUtil');
const apm = require('elastic-apm-node')

const currentServiceName = `${process.env.SERVICE_NAME}-${process.env.SERVICE_VERSION}`;
const processedMessagesKey = `${currentServiceName}:processedMessages`;
const messageTTL = 86400; //24 hours 

const addProcessedMessage = async (correlationId) => {
    const transaction = apm.startTransaction('addProcessedMessage', 'custom');
    try {
        await redisClient.sadd(processedMessagesKey, correlationId);
        logger.debug(`Added message with correlation ID ${correlationId} to processedMessages`);
        
        await redisClient.expire(processedMessagesKey, messageTTL);
        logger.debug(`Set TTL for processedMessagesKey ${processedMessagesKey} to ${messageTTL} seconds`);

        transaction.end('success');
    
    } catch (error) {
        logger.error(`Error in addProcessedMessage: ${formatError(error)}`);
        transaction.end('error');
        throw error; 
    }
};

const hasProcessedMessage = async (correlationId) => {
    const transaction = apm.startTransaction('hasProcessedMessage', 'custom');
    try {
        const exists = await redisClient.sismember(processedMessagesKey, correlationId);
        const result = !!exists;
    
        logger.debug(`Checked processedMessages for correlation ID ${correlationId}: ${result ? 'Exists' : 'Does not exist'}`);
        transaction.end('success'); 
        return result; 
    } catch (error) {
        logger.error(`Error in hasProcessedMessage: ${formatError(error)}`);
        transaction.end('error');
        throw error; 
    }
};

module.exports = { addProcessedMessage, hasProcessedMessage };