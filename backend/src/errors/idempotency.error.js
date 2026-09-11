class IdempotencyConflictError extends Error {
    constructor(
        message = "Idempotency-Key has already been used for a different payment request."
    ) {
        super(message);

        this.name = "IdempotencyConflictError";
        this.code = "IDEMPOTENCY_CONFLICT";
        this.statusCode = 409;
    }
}

module.exports = {
    IdempotencyConflictError
};
