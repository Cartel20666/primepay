require("dotenv").config();

const assert = require("assert");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const {
    authenticateApiKey
} = require("./src/middleware/apiKey.middleware");

const User = require("./src/models/User");
const Business = require("./src/models/Business");
const ApiKey = require("./src/models/ApiKey");

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
        process.env.MONGODB_URI,
        "MONGODB_URI must be configured."
    );

    await mongoose.connect(process.env.MONGODB_URI);

    console.log("PrimePay test database connected.");

    const suffix = Date.now().toString();

    const user = await User.create({
        name: `Isolation Test User ${suffix}`,
        email: `isolation-${suffix}@example.com`,
        password: "IsolationTestPassword123!",
        role: "merchant",
        emailVerified: true,
        status: "active"
    });

    const approvedBusiness = await Business.create({
        owner: user._id,
        businessName: `Isolation Approved ${suffix}`,
        businessType: "sole_proprietorship",
        country: "Kenya",
        currency: "KES",
        verificationStatus: "approved",
        liveApiEnabled: true,
        suspended: false
    });

    const suspendedBusiness = await Business.create({
        owner: user._id,
        businessName: `Isolation Suspended ${suffix}`,
        businessType: "sole_proprietorship",
        country: "Kenya",
        currency: "KES",
        verificationStatus: "approved",
        liveApiEnabled: true,
        suspended: true
    });

    const sandboxSecret = "sandbox-test-secret";
    const liveSecret = "live-test-secret";
    const inactiveSecret = "inactive-test-secret";

    const keySuffix = () =>
        crypto.randomBytes(24).toString("hex");

    const sandboxKey = await ApiKey.create({
        business: approvedBusiness._id,
        name: "Isolation Sandbox",
        environment: "sandbox",
        keyId: `pk_test_${keySuffix()}`,
        secretHash: await bcrypt.hash(
            sandboxSecret,
            12
        ),
        active: true
    });

    const liveKey = await ApiKey.create({
        business: approvedBusiness._id,
        name: "Isolation Live",
        environment: "live",
        keyId: `pk_live_${keySuffix()}`,
        secretHash: await bcrypt.hash(
            liveSecret,
            12
        ),
        active: true
    });

    const inactiveKey = await ApiKey.create({
        business: approvedBusiness._id,
        name: "Isolation Inactive",
        environment: "sandbox",
        keyId: `pk_test_${keySuffix()}`,
        secretHash: await bcrypt.hash(
            inactiveSecret,
            12
        ),
        active: false
    });

    const suspendedKey = await ApiKey.create({
        business: suspendedBusiness._id,
        name: "Isolation Suspended",
        environment: "sandbox",
        keyId: `pk_test_${keySuffix()}`,
        secretHash: await bcrypt.hash(
            "suspended-test-secret",
            12
        ),
        active: true
    });

    await test(
        "Valid sandbox API key authenticates",
        async () => {
            const req = {
                headers: {
                    "x-api-key": sandboxKey.keyId,
                    "x-api-secret": sandboxSecret
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
                null
            );

            assert.strictEqual(
                next.wasCalled(),
                true
            );

            assert.strictEqual(
                req.business._id.toString(),
                approvedBusiness._id.toString()
            );
        }
    );

    await test(
        "Wrong API secret is rejected",
        async () => {
            const req = {
                headers: {
                    "x-api-key": sandboxKey.keyId,
                    "x-api-secret":
                        "definitely-wrong-secret"
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
        "Inactive API key is rejected",
        async () => {
            const req = {
                headers: {
                    "x-api-key": inactiveKey.keyId,
                    "x-api-secret": inactiveSecret
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
        "Suspended business API key is rejected",
        async () => {
            const req = {
                headers: {
                    "x-api-key": suspendedKey.keyId,
                    "x-api-secret":
                        "suspended-test-secret"
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
                403
            );

            assert.strictEqual(
                next.wasCalled(),
                false
            );
        }
    );

    await test(
        "Live API key authenticates approved live-enabled business",
        async () => {
            const req = {
                headers: {
                    "x-api-key": liveKey.keyId,
                    "x-api-secret": liveSecret
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
                null
            );

            assert.strictEqual(
                next.wasCalled(),
                true
            );

            assert.strictEqual(
                req.apiKey.environment,
                "live"
            );

            assert.strictEqual(
                req.business._id.toString(),
                approvedBusiness._id.toString()
            );
        }
    );

    await Business.findByIdAndUpdate(
        approvedBusiness._id,
        {
            verificationStatus: "pending",
            liveApiEnabled: false
        }
    );

    await test(
        "Live API key is rejected when business is not approved",
        async () => {
            const req = {
                headers: {
                    "x-api-key": liveKey.keyId,
                    "x-api-secret": liveSecret
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
                403
            );

            assert.strictEqual(
                next.wasCalled(),
                false
            );
        }
    );

    await Business.findByIdAndUpdate(
        approvedBusiness._id,
        {
            verificationStatus: "approved",
            liveApiEnabled: false
        }
    );

    await test(
        "Live API key is rejected when live API is disabled",
        async () => {
            const req = {
                headers: {
                    "x-api-key": liveKey.keyId,
                    "x-api-secret": liveSecret
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
                403
            );

            assert.strictEqual(
                next.wasCalled(),
                false
            );
        }
    );

    await ApiKey.deleteMany({
        _id: {
            $in: [
                sandboxKey._id,
                liveKey._id,
                inactiveKey._id,
                suspendedKey._id
            ]
        }
    });

    await Business.deleteMany({
        _id: {
            $in: [
                approvedBusiness._id,
                suspendedBusiness._id
            ]
        }
    });

    await User.deleteOne({
        _id: user._id
    });

    await mongoose.disconnect();

    console.log("");
    console.log("==============================================");
    console.log("API ISOLATION TEST PASSED ✓");
    console.log("==============================================");
};

run().catch(async error => {
    console.error("");
    console.error("API ISOLATION TEST FAILED:");
    console.error(error);

    try {
        await mongoose.disconnect();
    } catch (_) {}

    process.exitCode = 1;
});
