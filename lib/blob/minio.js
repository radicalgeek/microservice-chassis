const Minio = require('minio');

const minioClient = new Minio.Client({
    endPoint: 'minio',
    port: 9000,
    useSSL: false,
    accessKey: 'minio',
    secretKey: 'minio123',
    region: 'eu-west-1'
});

module.exports = minioClient;