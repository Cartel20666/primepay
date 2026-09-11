require("dotenv").config();

const http = require("http");
const assert = require("assert");

const mongoose = require("mongoose");

const connectDatabase =
    require("./src/config.database");

const Business =
    require("./src/models/Business");

const User =
    require("./src/models/User");

const Webhook =
    require("./src/models/Webhook");

const WebhookDelivery =
    require("./src/models/WebhookDelivery");

const {
    queueWebhookDeliveries
} = require("./src/services/webhook.service");

const {
    processOneDelivery
} = require("./src/workers/webhook.worker");

const PORT = 58921;

let received = [];

const server = http.createServer(
    (req, res) => {
        let body = "";

        req.on(
            "data",
            chunk => {
                body += chunk.toString();
            }
        );

        req.on(
            "end",
            () => {
                received.push({
                    body,
                    headers: req.headers
                });

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "application/json"
                    }
                );

                res.end(
                    JSON.stringify({
                        received: true
                    })
                );
            }
        );
    }
);

const cleanup = async () => {
    await WebhookDelivery.deleteMany({
        business:
            process.env.TEST_BUSINESS_ID
    });

    await Webhook.deleteMany({
        business:
            process.env.TEST_BUSINESS_ID
    });

    await Business.deleteMany({
        _id:
            process.env.TEST_BUSINESS_ID
    });
};

const run = async () => {
    console.log(
        "\nPrimePay webhook outbox tests\n"
    );

    await connectDatabase();

    server.listen(
        PORT,
        "127.0.0.1",
        async () => {
            try {
                const user =
                    await User.findOne();

                if (!user) {
                    throw new Error(
                        "No User exists in the database. Create a test user first."
                    );
                }

                const business =
                    await Business.create({
                        owner: user._id,
                        businessName:
                            `Webhook Test ${Date.now()}`,
                        businessType:
                            "other",
                        country: "Kenya",
                        currency: "KES"
                    });

                process.env.TEST_BUSINESS_ID =
                    business._id.toString();

                const webhook =
                    await Webhook.create({
                        business:
                            business._id,

                        url:
                            `http://127.0.0.1:${PORT}`,

                        events: [
                            "payment.completed"
                        ],

                        secret:
                            "test-webhook-secret",

                        active: true
                    });

                console.log(
                    "✓ Test business and webhook created"
                );

                /*
                 * TEST 1
                 * Queue a delivery.
                 */
                const queued =
                    await queueWebhookDeliveries({
                        businessId:
                            business._id,

                        event:
                            "payment.completed",

                        data: {
                            payment: {
                                reference:
                                    "TEST-PAY-001",
                                amount: 100
                            }
                        }
                    });

                assert.strictEqual(
                    queued.length,
                    1
                );

                assert.strictEqual(
                    queued[0].status,
                    "pending"
                );

                assert.strictEqual(
                    queued[0].attempts,
                    0
                );

                console.log(
                    "✓ Webhook delivery queued"
                );

                /*
                 * TEST 2
                 * Worker delivers it.
                 */
                received = [];

                await processOneDelivery(business._id);

                const delivered =
                    await WebhookDelivery.findOne({
                        _id:
                            queued[0]._id
                    });

                assert.ok(delivered);

                assert.strictEqual(
                    delivered.status,
                    "delivered"
                );

                assert.strictEqual(
                    delivered.attempts,
                    1
                );

                assert.strictEqual(
                    received.length,
                    1
                );

                console.log(
                    "✓ Worker delivered webhook"
                );

                /*
                 * TEST 3
                 * Event ID and payload were
                 * persisted.
                 */
                const parsed =
                    JSON.parse(
                        received[0].body
                    );

                assert.strictEqual(
                    parsed.id,
                    queued[0].eventId
                );

                assert.strictEqual(
                    parsed.event,
                    "payment.completed"
                );

                assert.strictEqual(
                    delivered.eventId,
                    parsed.id
                );

                assert.strictEqual(
                    delivered.payload,
                    received[0].body
                );

                console.log(
                    "✓ Event ID and payload persisted correctly"
                );

                /*
                 * TEST 4
                 * HMAC signature exists.
                 */
                const signature =
                    received[0]
                        .headers[
                            "x-primepay-signature"
                        ];

                assert.ok(
                    signature
                );

                assert.match(
                    signature,
                    /^t=\d+,v1=[a-f0-9]{64}$/
                );

                console.log(
                    "✓ Webhook HMAC signature generated"
                );

                /*
                 * TEST 5
                 * Duplicate worker calls cannot
                 * deliver an already completed event.
                 */
                received = [];

                await Promise.all([
                    processOneDelivery(),
                    processOneDelivery()
                ]);

                assert.strictEqual(
                    received.length,
                    0
                );

                const stillDelivered =
                    await WebhookDelivery.findOne({
                        _id:
                            queued[0]._id
                    });

                assert.strictEqual(
                    stillDelivered.status,
                    "delivered"
                );

                assert.strictEqual(
                    stillDelivered.attempts,
                    1
                );

                console.log(
                    "✓ Duplicate worker protection passed"
                );

                /*
                 * TEST 6
                 * Transaction rollback must remove
                 * the webhook outbox record.
                 */
                const session =
                    await mongoose.startSession();

                let rollbackEventId = null;

                try {
                    await session.withTransaction(
                        async () => {
                            const rollbackQueue =
                                await queueWebhookDeliveries({
                                    businessId:
                                        business._id,

                                    event:
                                        "payment.completed",

                                    data: {
                                        payment: {
                                            reference:
                                                "ROLLBACK-001"
                                        }
                                    },

                                    session
                                });

                            rollbackEventId =
                                rollbackQueue[0]
                                    .eventId;

                            throw new Error(
                                "Intentional rollback"
                            );
                        }
                    );
                } catch (error) {
                    assert.strictEqual(
                        error.message,
                        "Intentional rollback"
                    );
                } finally {
                    await session.endSession();
                }

                const rollbackDelivery =
                    await WebhookDelivery.findOne({
                        eventId:
                            rollbackEventId
                    });

                assert.strictEqual(
                    rollbackDelivery,
                    null
                );

                console.log(
                    "✓ Transaction rollback removes outbox event"
                );

                console.log(
                    "\nALL WEBHOOK OUTBOX TESTS PASSED ✓\n"
                );

                await cleanup();

                server.close(
                    async () => {
                        await mongoose.connection.close();
                        process.exit(0);
                    }
                );
            } catch (error) {
                console.error(
                    "\nTEST FAILED:"
                );

                console.error(
                    error.stack ||
                    error.message
                );

                await cleanup();

                server.close(
                    async () => {
                        await mongoose.connection.close();
                        process.exit(1);
                    }
                );
            }
        }
    );
};

run().catch(async error => {
    console.error(
        "\nTEST FAILED:"
    );

    console.error(
        error.stack ||
        error.message
    );

    try {
        server.close();
        await mongoose.connection.close();
    } catch {}

    process.exit(1);
});
