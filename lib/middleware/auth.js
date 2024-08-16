const { CognitoJwtVerifier } = require('aws-jwt-verify');


function createAuthMiddleware({ userPoolId, clientId, tokenUse = 'access' }) {
  console.log("setting up auth middleware")
  const verifier = CognitoJwtVerifier.create({
    userPoolId: userPoolId,
    tokenUse: tokenUse,
    clientId: clientId,
  });

  return async function authMiddleware(req, res, next) {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
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
