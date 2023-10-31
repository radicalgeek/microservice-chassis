const Minio = require('minio');

const minioClient = new Minio.Client({
    endPoint: 'minio',
    port: 9000,
    useSSL: false,
    accessKey: 'minio',
    secretKey: 'minio123',
    region: 'uk'
});

module.exports = minioClient;