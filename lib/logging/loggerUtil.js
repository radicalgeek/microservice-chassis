function formatError(err) {
    return {
        error: err.message,
        stack: err.stack
    };
}

module.exports = {
    formatError
};