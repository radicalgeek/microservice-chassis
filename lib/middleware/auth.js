const { CognitoJwtVerifier } = require('aws-jwt-verify');
const logger = require('../logging/logger');



function createAuthMiddleware({ userPoolId, clientId, tokenUse = 'access' }) {
  logger.info("setting up auth middleware")
  const verifier = CognitoJwtVerifier.create({
    userPoolId: userPoolId,
    tokenUse: tokenUse,
    clientId: clientId,
  });

  return async function authMiddleware(req, res, next) {

    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.error('Authorization header missing or invalid')

        return res.status(401).json({ message: 'Authorization header missing or invalid' });
      }

      const token = authHeader.split(' ')[1];
      const payload = await verifier.verify(token);

      req.user = payload;

      next(); 
    } catch (err) {
      console.error('Token not valid!', err);
      return res.status(401).json({ message: 'Token not valid' });
    }
  };
}

module.exports = createAuthMiddleware;
