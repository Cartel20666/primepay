require("dotenv").config();

const assert = require("assert");

const jwt = require("jsonwebtoken");

const {
    protect,
    authorize
} = require("./src/middleware/auth.middleware");

const {
    authenticateApiKey
} = require("./src/middleware/apiKey.middleware");

const test = async (name, fn) => {
    try {
        await fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        console.error(`✗ ${name}`);
        throw error;
    }
};

const createResponse = () => {
    const response = {
        statusCode: null,
        body: null
    };

    response.status = code => {
        response.statusCode = code;
        return response;
    };

    response.json = body => {
        response.body = body;
        return response;
    };

    return response;
};

const createNext = () => {
    let called = false;

    const next = () => {
        called = true;
    };

    next.wasCalled = () => called;

    return next;
};

const run = async () => {
    assert(
        process.env.JWT_SECRET,
        "JWT_SECRET must be configured."
    );

    await test(
        "Missing JWT is rejected",
        async () => {
            const req = {
                headers: {}
            };

            const res = createResponse();
            const next = createNext();

            await protect(req, res, next);

            assert.strictEqual(
                res.statusCode,
                401
            );

            assert.strictEqual(
                next.wasCalled(),
                false
            );
        }
    );

    await test(
        "Malformed JWT is rejected",
        async () => {
            const req = {
                headers: {
                    authorization:
                        "Bearer definitely-not-a-jwt"
                }
            };

            const res = createResponse();
            const next = createNext();

            await protect(req, res, next);

            assert.strictEqual(
                res.statusCode,
                401
            );

            assert.strictEqual(
                next.wasCalled(),
                false
            );
        }
    );

    await test(
        "Wrong JWT algorithm is rejected",
        async () => {
            const token = jwt.sign(
                {
                    id: "507f1f77bcf86cd799439011"
                },
                process.env.JWT_SECRET,
                {
                    algorithm: "HS384",
                    expiresIn: "5m"
                }
            );

            const req = {
                headers: {
                    authorization:
                        `Bearer ${token}`
                }
            };

            const res = createResponse();
            const next = createNext();

            await protect(req, res, next);

            assert.strictEqual(
                res.statusCode,
                401
            );

            assert.strictEqual(
                next.wasCalled(),
                false
            );
        }
    );

    await test(
        "Malformed API-key credentials are rejected",
        async () => {
            const req = {
                headers: {
                    "x-api-key": "not-a-valid-key",
                    "x-api-secret": "invalid"
                }
            };

            const res = createResponse();
            const next = createNext();

            await authenticateApiKey(
                req,
                res,
                next
            );

            assert.strictEqual(
                res.statusCode,
                401
            );

            assert.strictEqual(
                next.wasCalled(),
                false
            );
        }
    );

    await test(
        "Missing API-key credentials are rejected",
        async () => {
            const req = {
                headers: {}
            };

            const res = createResponse();
            const next = createNext();

            await authenticateApiKey(
                req,
                res,
                next
            );

            assert.strictEqual(
                res.statusCode,
                401
            );

            assert.strictEqual(
                next.wasCalled(),
                false
            );
        }
    );

    await test(
        "Authorization middleware rejects unauthorized roles",
        async () => {
            const req = {
                user: {
                    role: "merchant"
                }
            };

            const res = createResponse();
            const next = createNext();

            authorize("admin")(
                req,
                res,
                next
            );

            assert.strictEqual(
                res.statusCode,
                403
            );

            assert.strictEqual(
                next.wasCalled(),
                false
            );
        }
    );

    await test(
        "Authorization middleware accepts authorized roles",
        async () => {
            const req = {
                user: {
                    role: "admin"
                }
            };

            const res = createResponse();
            const next = createNext();

            authorize("admin")(
                req,
                res,
                next
            );

            assert.strictEqual(
                res.statusCode,
                null
            );

            assert.strictEqual(
                next.wasCalled(),
                true
            );
        }
    );

    console.log("");
    console.log("==============================================");
    console.log("API SECURITY TEST PASSED ✓");
    console.log("==============================================");
};

run().catch(error => {
    console.error("");
    console.error("API SECURITY TEST FAILED:");
    console.error(error);
    process.exitCode = 1;
});
