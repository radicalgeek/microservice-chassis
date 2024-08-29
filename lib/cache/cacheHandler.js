const redisClient = require('./redisClient');
const logger = require('../logging/logger'); 
const { formatError } = require('../logging/loggerUtil');


const currentServiceName = `${process.env.SERVICE_NAME}-${process.env.SERVICE_VERSION}`;
const processedMessagesKey = `${currentServiceName}:processedMessages`;
const messageTTL = 86400; //24 hours 

const addProcessedMessage = async (correlationId) => {

    try {
        await redisClient.sadd(processedMessagesKey, correlationId);
        logger.debug(`Added message with correlation ID ${correlationId} to processedMessages`);
        
        await redisClient.expire(processedMessagesKey, messageTTL);
        logger.debug(`Set TTL for processedMessagesKey ${processedMessagesKey} to ${messageTTL} seconds`);

    
    } catch (error) {
        logger.error(`Error in addProcessedMessage: ${formatError(error)}`);

        throw error; 
    }
};

const hasProcessedMessage = async (correlationId) => {

    try {
        const exists = await redisClient.sismember(processedMessagesKey, correlationId);
        const result = !!exists;
    
        logger.debug(`Checked processedMessages for correlation ID ${correlationId}: ${result ? 'Exists' : 'Does not exist'}`);

        return result; 
    } catch (error) {
        logger.error(`Error in hasProcessedMessage: ${formatError(error)}`);

        throw error; 
    }
};

module.exports = { addProcessedMessage, hasProcessedMessage };