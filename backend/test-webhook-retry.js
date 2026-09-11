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
    processOneDelivery,
    claimNextDelivery
} = require("./src/workers/webhook.worker");

const PORT = 58922;

let requestCount = 0;
let receivedBodies = [];

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
                requestCount++;

                receivedBodies.push(body);

                res.writeHead(
                    500,
                    {
                        "Content-Type":
                            "application/json"
                    }
                );

                res.end(
                    JSON.stringify({
                        error:
                            "intentional test failure"
                    })
                );
            }
        );
    }
);

const cleanup = async businessId => {
    if (!businessId) {
        return;
    }

    await WebhookDelivery.deleteMany({
        business: businessId
    });

    await Webhook.deleteMany({
        business: businessId
    });

    await Business.deleteOne({
        _id: businessId
    });
};

const run = async () => {
    console.log(
        "\nPrimePay webhook retry tests\n"
    );

    await connectDatabase();

    server.listen(
        PORT,
        "127.0.0.1",
        async () => {
            let businessId = null;

            try {
                const user =
                    await User.findOne();

                if (!user) {
                    throw new Error(
                        "No User exists in the database."
                    );
                }

                const business =
                    await Business.create({
                        owner: user._id,
                        businessName:
                            `Retry Test ${Date.now()}`,
                        businessType:
                            "other",
                        country: "Kenya",
                        currency: "KES"
                    });

                businessId =
                    business._id;

                const webhook =
                    await Webhook.create({
                        business:
                            business._id,

                        url:
                            `http://127.0.0.1:${PORT}`,

                        events: [
                            "payment.failed"
                        ],

                        secret:
                            "retry-test-secret",

                        active: true
                    });

                console.log(
                    "✓ Test webhook created"
                );

                /*
                 * Create delivery.
                 */
                const queued =
                    await queueWebhookDeliveries({
                        businessId:
                            business._id,

                        event:
                            "payment.failed",

                        data: {
                            payment: {
                                reference:
                                    "RETRY-001",
                                amount: 500
                            }
                        }
                    });

                assert.strictEqual(
                    queued.length,
                    1
                );

                const original =
                    queued[0];

                const originalEventId =
                    original.eventId;

                const originalPayload =
                    original.payload;

                console.log(
                    "✓ Retry delivery queued"
                );

                /*
                 * Attempt 1.
                 *
                 * Endpoint deliberately returns HTTP 500.
                 */
                requestCount = 0;
                receivedBodies = [];

                await processOneDelivery(business._id);

                let delivery =
                    await WebhookDelivery.findById(
                        original._id
                    );

                assert.strictEqual(
                    delivery.status,
                    "pending"
                );

                assert.strictEqual(
                    delivery.attempts,
                    1
                );

                assert.strictEqual(
                    delivery.responseStatusCode,
                    500
                );

                assert.ok(
                    delivery.nextAttemptAt
                );

                console.log(
                    "✓ HTTP 500 schedules a retry"
                );

                /*
                 * The next retry must be approximately
                 * 5 seconds after attempt 1.
                 */
                const retryDelay =
                    delivery.nextAttemptAt.getTime() -
                    delivery.lastAttemptAt.getTime();

                assert.ok(
                    retryDelay >= 4500 &&
                    retryDelay <= 7000,
                    `Unexpected retry delay: ${retryDelay}ms`
                );

                console.log(
                    "✓ First retry uses ~5 second backoff"
                );

                /*
                 * Force the record due immediately so
                 * we don't actually sleep 5 seconds.
                 */
                await WebhookDelivery.updateOne(
                    {
                        _id:
                            original._id
                    },
                    {
                        $set: {
                            nextAttemptAt:
                                new Date(
                                    Date.now() - 1000
                                )
                        }
                    }
                );

                /*
                 * Attempt 2.
                 */
                await processOneDelivery(business._id);

                delivery =
                    await WebhookDelivery.findById(
                        original._id
                    );

                assert.strictEqual(
                    delivery.status,
                    "pending"
                );

                assert.strictEqual(
                    delivery.attempts,
                    2
                );

                console.log(
                    "✓ Second failed attempt increments attempts correctly"
                );

                /*
                 * Same event ID and payload.
                 */
                assert.strictEqual(
                    delivery.eventId,
                    originalEventId
                );

                assert.strictEqual(
                    delivery.payload,
                    originalPayload
                );

                assert.strictEqual(
                    receivedBodies[0],
                    receivedBodies[1]
                );

                console.log(
                    "✓ Retries reuse the same event ID and payload"
                );

                /*
                 * Force attempts to 5 and make it due.
                 * The next failure should be attempt 6,
                 * which becomes terminal.
                 */
                await WebhookDelivery.updateOne(
                    {
                        _id:
                            original._id
                    },
                    {
                        $set: {
                            attempts: 5,
                            nextAttemptAt:
                                new Date(
                                    Date.now() - 1000
                                ),
                            status: "pending",
                            lockedUntil: null,
                            lockToken: null
                        }
                    }
                );

                await processOneDelivery(business._id);

                delivery =
                    await WebhookDelivery.findById(
                        original._id
                    );

                assert.strictEqual(
                    delivery.attempts,
                    6
                );

                assert.strictEqual(
                    delivery.status,
                    "failed"
                );

                assert.strictEqual(
                    delivery.nextAttemptAt,
                    null
                );

                console.log(
                    "✓ Sixth failed attempt becomes terminal"
                );

                /*
                 * LOCK RECOVERY TEST
                 *
                 * Create a second delivery and manually
                 * simulate a dead worker.
                 */
                const lockedQueue =
                    await queueWebhookDeliveries({
                        businessId:
                            business._id,

                        event:
                            "payment.failed",

                        data: {
                            payment: {
                                reference:
                                    "LOCK-001"
                            }
                        }
                    });

                const locked =
                    lockedQueue[0];

                const oldToken =
                    "dead-worker-token";

                await WebhookDelivery.updateOne(
                    {
                        _id:
                            locked._id
                    },
                    {
                        $set: {
                            status:
                                "processing",

                            lockedUntil:
                                new Date(
                                    Date.now() - 1000
                                ),

                            lockToken:
                                oldToken
                        }
                    }
                );


    const reclaimed =
        await claimNextDelivery();

    assert(
        reclaimed,
        "Expired processing delivery was not reclaimed"
    );

    assert.strictEqual(
        reclaimed._id.toString(),
        locked._id.toString()
    );

    assert.strictEqual(
        reclaimed.status,
        "processing"
    );

    assert(
        reclaimed.lockToken,
        "Reclaimed delivery must receive a lock token"
    );

    assert.notStrictEqual(
        reclaimed.lockToken,
        oldToken,
        "Reclaimed delivery must receive a new lock token"
    );

    console.log(
        "✓ Expired processing lock is recoverable"
    );

    const oldWorkerUpdate =
        await WebhookDelivery.updateOne(
            {
                _id:
                    locked._id,

                status:
                    "processing",

                lockToken:
                    oldToken
            },
            {
                $set: {
                    status:
                        "delivered"
                }
            }
        );

    assert.strictEqual(
        oldWorkerUpdate.modifiedCount,
        0,
        "Old worker must not overwrite newer lease"
    );

    console.log(
        "✓ Old worker cannot overwrite a newer lease"
    );

      await WebhookDelivery.deleteMany({
          business:
              business._id
      });

      await Webhook.deleteMany({
          business:
              business._id
      });

      await Business.deleteOne({
          _id:
              business._id
      });

      console.log(
          "\nALL WEBHOOK RETRY/LOCK TESTS PASSED ✓"
      );

  } catch (error) {
      console.error(
          "\nWEBHOOK RETRY TEST FAILED:"
      );

      console.error(error);

      await cleanup(
          businessId
      );

      throw error;

  } finally {
      server.close();

      try {
          await mongoose.disconnect();
      } catch (_) {}
  }
        }
    );
};

run().catch(() => {
    process.exit(1);
});
