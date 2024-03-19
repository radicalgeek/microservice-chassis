const service = require('./lib/service');
const logger = require('./lib/logging/logger');
const formatError = require('./lib/logging/loggerUtil');
const mq = require('./lib/mq');
const cacheHandler = require('./lib/cache/cacheHandler');
const messageValidator = require('./lib/validation/messageValidator');

module.exports = {
  service,
  logger,
  formatError,
  mq, 
  cacheHandler,
  messageValidator,
  publishMessage: mq.publishMessage,
  setupPublisher: mq.setupPublisher,
};