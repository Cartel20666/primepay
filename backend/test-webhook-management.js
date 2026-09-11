require("dotenv").config();

const http = require("http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = require("./src/app");

const User = require("./src/models/User");
const Business = require("./src/models/Business");
const Webhook = require("./src/models/Webhook");
const WebhookDelivery = require("./src/models/WebhookDelivery");

const PORT = 58923;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;
let user;
let business;
let token;
let webhookId;
let deliveryId;

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(`ASSERTION FAILED: ${message}`);
    }

    console.log(`✓ ${message}`);
};

const request = async (
    method,
    path,
    body = null,
    authToken = token
) => {
    const response = await fetch(
        `${BASE_URL}${path}`,
        {
            method,
            headers: {
                "Content-Type": "application/json",
                ...(authToken
                    ? {
                        Authorization:
                            `Bearer ${authToken}`
                    }
                    : {})
            },
            body: body
                ? JSON.stringify(body)
                : undefined
        }
    );

    let data = null;

    try {
        data = await response.json();
    } catch {
        data = null;
    }

    return {
        status: response.status,
        data
    };
};

const createTestUser = async () => {
    const email =
        `webhook-management-${Date.now()}@primetask.test`;

    user = await User.create({
        name: "PrimePay Webhook Test",
        email,
        password: "TestPassword123!",
        role: "merchant"
    });

    business = await Business.create({
        owner: user._id,
        businessName:
            `Webhook Test Business ${Date.now()}`,
        businessType: "sole_proprietorship",
        country: "Kenya",
        currency: "KES",
        verificationStatus: "approved",
        liveApiEnabled: true
    });

    token = jwt.sign(
        {
            id: user._id.toString(),
            userId: user._id.toString(),
            role: user.role
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "1h"
        }
    );
};

const cleanup = async () => {
    if (webhookId) {
        await WebhookDelivery.deleteMany({
            webhook: webhookId
        });

        await Webhook.deleteOne({
            _id: webhookId
        });
    }

    if (business) {
        await Business.deleteOne({
            _id: business._id
        });
    }

    if (user) {
        await User.deleteOne({
            _id: user._id
        });
    }
};

const run = async () => {
    console.log("\nPrimePay Webhook Management API Tests\n");

    server = app.listen(
        PORT,
        async () => {
            try {
                await createTestUser();

                console.log(
                    "✓ Test merchant and business created"
                );

                /*
                 * CREATE
                 */
                const create =
                    await request(
                        "POST",
                        "/api/v1/webhooks",
                        {
                            url:
                                "http://127.0.0.1:58924/webhook",
                            events: [
                                "payment.completed",
                                "payment.failed"
                            ]
                        }
                    );

                assert(
                    create.status === 201,
                    "Webhook creation returns 201"
                );

                assert(
                    create.data?.success === true,
                    "Webhook creation succeeds"
                );

                assert(
                    create.data?.webhook?.secret,
                    "Webhook secret returned on creation"
                );

                assert(
                    create.data.webhook.secret.startsWith(
                        "whsec_"
                    ),
                    "Webhook secret uses whsec_ format"
                );

                webhookId =
                    create.data.webhook.id;

                /*
                 * GET
                 */
                const get =
                    await request(
                        "GET",
                        `/api/v1/webhooks/${webhookId}`
                    );

                assert(
                    get.status === 200,
                    "Webhook retrieval returns 200"
                );

                assert(
                    get.data?.success === true,
                    "Webhook retrieval succeeds"
                );

                assert(
                    !Object.prototype.hasOwnProperty.call(
                        get.data.webhook,
                        "secret"
                    ),
                    "Webhook secret is hidden from GET"
                );

                /*
                 * LIST
                 */
                const list =
                    await request(
                        "GET",
                        "/api/v1/webhooks"
                    );

                assert(
                    list.status === 200,
                    "Webhook list returns 200"
                );

                assert(
                    list.data?.success === true,
                    "Webhook list succeeds"
                );

                assert(
                    Array.isArray(
                        list.data.webhooks
                    ),
                    "Webhook list returns an array"
                );

                assert(
                    list.data.webhooks.some(
                        item =>
                            String(item.id) ===
                            String(webhookId)
                    ),
                    "Created webhook appears in list"
                );

                const listed =
                    list.data.webhooks.find(
                        item =>
                            String(item.id) ===
                            String(webhookId)
                    );

                assert(
                    !Object.prototype.hasOwnProperty.call(
                        listed,
                        "secret"
                    ),
                    "Webhook secret is hidden from list"
                );

                /*
                 * UPDATE
                 */
                const update =
                    await request(
                        "PATCH",
                        `/api/v1/webhooks/${webhookId}`,
                        {
                            url:
                                "http://127.0.0.1:58924/updated",
                            events: [
                                "payment.completed",
                                "payment.refunded"
                            ],
                            active: false
                        }
                    );

                assert(
                    update.status === 200,
                    "Webhook update returns 200"
                );

                assert(
                    update.data?.success === true,
                    "Webhook update succeeds"
                );

                assert(
                    update.data.webhook.url.endsWith(
                        "/updated"
                    ),
                    "Webhook URL updated"
                );

                assert(
                    update.data.webhook.active === false,
                    "Webhook active state updated"
                );

                assert(
                    update.data.webhook.events.includes(
                        "payment.refunded"
                    ),
                    "Webhook events updated"
                );

                /*
                 * INVALID EVENT
                 */
                const invalidEvent =
                    await request(
                        "POST",
                        "/api/v1/webhooks",
                        {
                            url:
                                "https://example.com/webhook",
                            events: [
                                "payment.completed",
                                "totally.invalid.event"
                            ]
                        }
                    );

                assert(
                    invalidEvent.status === 400,
                    "Invalid webhook event is rejected"
                );

                /*
                 * INVALID URL
                 */
                const invalidUrl =
                    await request(
                        "POST",
                        "/api/v1/webhooks",
                        {
                            url:
                                "http://example.com/webhook",
                            events: [
                                "payment.completed"
                            ]
                        }
                    );

                assert(
                    invalidUrl.status === 400,
                    "Non-HTTPS public webhook URL is rejected"
                );

                /*
                 * DELIVERY HISTORY
                 *
                 * Insert a delivery directly so the management
                 * endpoint can be tested independently of payment flow.
                 */
                const delivery =
                    await WebhookDelivery.create({
                        business: business._id,
                        webhook: webhookId,
                        event:
                            "payment.completed",
                        eventId:
                            `evt_management_${Date.now()}`,
                        payload:
                            JSON.stringify({
                                test: true
                            }),
                        timestamp:
                            Math.floor(
                                Date.now() / 1000
                            ),
                        status: "failed",
                        attempts: 2,
                        nextAttemptAt: null,
                        lastError:
                            "Test failure",
                        responseStatusCode: 500
                    });

                deliveryId =
                    delivery._id;

                const deliveries =
                    await request(
                        "GET",
                        `/api/v1/webhooks/${webhookId}/deliveries`
                    );

                assert(
                    deliveries.status === 200,
                    "Delivery history returns 200"
                );

                assert(
                    deliveries.data?.success === true,
                    "Delivery history succeeds"
                );

                assert(
                    Array.isArray(
                        deliveries.data.deliveries
                    ),
                    "Delivery history returns an array"
                );

                console.log("\nDELIVERY HISTORY RESPONSE:");
                console.log(JSON.stringify(deliveries.data, null, 2));

                const historyItem =
                    deliveries.data.deliveries.find(
                        item =>
                            String(item._id || item.id) ===
                            String(deliveryId)
                    );

                assert(
                    historyItem,
                    "Created delivery appears in history"
                );

                assert(
                    !Object.prototype.hasOwnProperty.call(
                        historyItem,
                        "payload"
                    ),
                    "Delivery list does not expose raw payload"
                );

                /*
                 * MANUAL RETRY
                 */
                const retry =
                    await request(
                        "POST",
                        `/api/v1/webhooks/${webhookId}/deliveries/${deliveryId}/retry`
                    );

                assert(
                    retry.status === 200,
                    "Manual retry returns 200"
                );

                assert(
                    retry.data?.success === true,
                    "Manual retry succeeds"
                );

                assert(
                    retry.data.delivery.status ===
                        "pending",
                    "Manual retry resets delivery to pending"
                );

                const retried =
                    await WebhookDelivery.findById(
                        deliveryId
                    );

                assert(
                    retried.attempts === 0,
                    "Manual retry resets attempts"
                );

                assert(
                    retried.lockToken === null,
                    "Manual retry clears lock token"
                );

                /*
                 * DELETE
                 */
                const remove =
                    await request(
                        "DELETE",
                        `/api/v1/webhooks/${webhookId}`
                    );

                assert(
                    remove.status === 200,
                    "Webhook deletion returns 200"
                );

                assert(
                    remove.data?.success === true,
                    "Webhook deletion succeeds"
                );

                const deletedWebhook =
                    await Webhook.findById(
                        webhookId
                    );

                assert(
                    !deletedWebhook,
                    "Webhook removed from database"
                );

                const deletedDeliveries =
                    await WebhookDelivery.find({
                        webhook: webhookId
                    });

                assert(
                    deletedDeliveries.length === 0,
                    "Webhook delivery history removed with webhook"
                );

                console.log(
                    "\nALL WEBHOOK MANAGEMENT TESTS PASSED ✓\n"
                );
            } catch (error) {
                console.error(
                    "\nWEBHOOK MANAGEMENT TEST FAILED:\n"
                );

                console.error(
                    error.stack ||
                    error.message ||
                    error
                );

                process.exitCode = 1;
            } finally {
                try {
                    await cleanup();
                } catch (cleanupError) {
                    console.error(
                        "Cleanup error:",
                        cleanupError.message
                    );

                    process.exitCode = 1;
                }

                if (server) {
                    await new Promise(resolve => {
                        server.close(resolve);
                    });
                }

                if (
                    mongoose.connection.readyState !== 0
                ) {
                    await mongoose.disconnect();
                }
            }
        }
    );
};

mongoose.connection.once(
    "connected",
    () => {
        console.log(
            "✓ MongoDB connected"
        );
    }
);

const start = async () => {
    try {
        await mongoose.connect(
            process.env.MONGODB_URI
        );

        await run();
    } catch (error) {
        console.error(
            "\nWEBHOOK MANAGEMENT TEST STARTUP FAILED:\n"
        );

        console.error(
            error.stack ||
            error.message ||
            error
        );

        try {
            await mongoose.disconnect();
        } catch {}

        process.exit(1);
    }
};

start();
