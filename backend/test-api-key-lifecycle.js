require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ApiKey = require("./src/models/ApiKey");
const Business = require("./src/models/Business");

const {
    createApiKey,
    listApiKeys,
    revokeApiKey,
    rotateApiKey
} = require("./src/controllers/apiKey.controller");

const {
    authenticateApiKey
} = require("./src/middleware/apiKey.middleware");

const TEST_EMAIL =
    "api-key-lifecycle-test@primetask.test";

const makeRes = () => {
    const response = {
        statusCode: 200,
        body: null
    };

    return {
        response,

        status(code) {
            response.statusCode = code;
            return this;
        },

        json(body) {
            response.body = body;
            return this;
        }
    };
};

const makeReq = ({
    userId,
    body = {},
    params = {},
    headers = {}
}) => ({
    user: {
        _id: userId
    },
    body,
    params,
    headers
});

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const fakeNext = () => {
    throw new Error(
        "Authentication unexpectedly called next()."
    );
};

async function cleanup() {
    await ApiKey.deleteMany({
        keyId: /^pk_(test|live)_/
    });

    await Business.deleteMany({
        owner: {
            $in: []
        }
    });
}

async function run() {
    await mongoose.connect(
        process.env.MONGODB_URI
    );

    console.log("✓ MongoDB connected");

    let business = await Business.findOne({
        owner: {
            $exists: true
        }
    });

    if (!business) {
        throw new Error(
            "No business record exists. The lifecycle test requires an existing business."
        );
    }

    const ownerId = business.owner;

    await ApiKey.deleteMany({
        business: business._id
    });

    business.suspended = false;
    business.verificationStatus = "approved";
    business.liveApiEnabled = true;

    await business.save();

    let res = makeRes();

    await createApiKey(
        makeReq({
            userId: ownerId,
            body: {
                name: "Lifecycle Test",
                environment: "sandbox"
            }
        }),
        res
    );

    assert(
        res.response.statusCode === 201,
        "Sandbox API key creation failed."
    );

    const created = res.response.body.apiKey;

    assert(
        created.keyId.startsWith("pk_test_"),
        "Sandbox key does not use pk_test_ prefix."
    );

    assert(
        created.secret,
        "New API secret was not returned."
    );

    const originalSecret = created.secret;

    console.log("✓ API key creation");

    res = makeRes();

    await listApiKeys(
        makeReq({
            userId: ownerId
        }),
        res
    );

    assert(
        res.response.statusCode === 200,
        "API key listing failed."
    );

    assert(
        res.response.body.apiKeys.length === 1,
        "API key listing returned unexpected records."
    );

    assert(
        !Object.prototype.hasOwnProperty.call(
            res.response.body.apiKeys[0],
            "secret"
        ),
        "API key listing exposed the secret."
    );

    console.log("✓ API key listing does not expose secrets");

    const keyBeforeRotation =
        await ApiKey.findById(created.id)
            .select("+secretHash");

    assert(
        keyBeforeRotation,
        "Created API key was not found."
    );

    assert(
        await bcrypt.compare(
            originalSecret,
            keyBeforeRotation.secretHash
        ),
        "Original secret was not stored correctly."
    );

    res = makeRes();

    await rotateApiKey(
        makeReq({
            userId: ownerId,
            params: {
                id: created.id
            }
        }),
        res
    );

    assert(
        res.response.statusCode === 200,
        "API key rotation failed."
    );

    const rotated = res.response.body.apiKey;

    assert(
        rotated.keyId.startsWith("pk_test_"),
        "Rotated sandbox key has incorrect prefix."
    );

    assert(
        rotated.secret &&
        rotated.secret !== originalSecret,
        "Rotation did not issue a new secret."
    );

    assert(
        rotated.keyId !== created.keyId,
        "Rotation did not issue a new key ID."
    );

    console.log("✓ API key rotation");

    const rotatedRecord =
        await ApiKey.findById(created.id)
            .select("+secretHash");

    assert(
        !(await bcrypt.compare(
            originalSecret,
            rotatedRecord.secretHash
        )),
        "Old secret still authenticates against rotated key."
    );

    assert(
        await bcrypt.compare(
            rotated.secret,
            rotatedRecord.secretHash
        ),
        "New secret was not stored correctly."
    );

    console.log("✓ Old secret invalidated");

    res = makeRes();

    await revokeApiKey(
        makeReq({
            userId: ownerId,
            params: {
                id: created.id
            }
        }),
        res
    );

    assert(
        res.response.statusCode === 200,
        "API key revocation failed."
    );

    const revoked =
        await ApiKey.findById(created.id);

    assert(
        revoked.active === false,
        "API key was not marked inactive."
    );

    console.log("✓ API key revocation");

    let middlewareReq = {
        headers: {
            "x-api-key": rotated.keyId,
            "x-api-secret": rotated.secret
        }
    };

    let middlewareResponse = makeRes();

    await authenticateApiKey(
        middlewareReq,
        middlewareResponse,
        fakeNext
    );

    assert(
        middlewareResponse.response.statusCode === 401,
        "Revoked API key was still accepted."
    );

    console.log("✓ Revoked API key rejected");

    const liveKeyId =
        "pk_live_" + "a".repeat(48);

    const liveSecret =
        "live-test-secret";

    const liveHash =
        await bcrypt.hash(liveSecret, 12);

    const liveKey =
        await ApiKey.create({
            business: business._id,
            name: "Environment Test",
            environment: "sandbox",
            keyId: liveKeyId,
            secretHash: liveHash,
            active: true
        });

    middlewareReq = {
        headers: {
            "x-api-key": liveKeyId,
            "x-api-secret": liveSecret
        }
    };

    middlewareResponse = makeRes();

    await authenticateApiKey(
        middlewareReq,
        middlewareResponse,
        fakeNext
    );

    assert(
        middlewareResponse.response.statusCode === 401,
        "Environment mismatch was accepted."
    );

    await liveKey.deleteOne();

    console.log("✓ API key environment mismatch rejected");

    await ApiKey.deleteMany({
        business: business._id
    });

    await mongoose.disconnect();

    console.log("");
    console.log("✓ API key lifecycle tests passed");
}

run().catch(async error => {
    console.error("");
    console.error("✗ API key lifecycle test failed:");
    console.error(error.message);

    try {
        await mongoose.disconnect();
    } catch {}

    process.exit(1);
});
