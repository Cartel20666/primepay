const crypto = require("crypto");
const Webhook = require("../models/Webhook");
const WebhookDelivery = require("../models/WebhookDelivery");

const POLL_INTERVAL_MS =
    Number(process.env.WEBHOOK_WORKER_INTERVAL_MS) || 1000;

const REQUEST_TIMEOUT_MS =
    Number(process.env.WEBHOOK_REQUEST_TIMEOUT_MS) || 10000;

const LOCK_DURATION_MS =
    Number(process.env.WEBHOOK_LOCK_DURATION_MS) || 30000;

const MAX_ATTEMPTS =
    Number(process.env.WEBHOOK_MAX_ATTEMPTS) || 6;

const RETRY_DELAYS_MS = [
    5000,
    30000,
    120000,
    600000,
    3600000
];

let workerTimer = null;
let processing = false;

const getRetryDelay = attempts => {
    const index = Math.min(
        Math.max(attempts - 1, 0),
        RETRY_DELAYS_MS.length - 1
    );

    return RETRY_DELAYS_MS[index];
};

const createLockToken = () =>
    crypto.randomUUID();

const claimNextDelivery = async (businessId = null) => {
    const now = new Date();

    const scope = businessId
        ? { business: businessId }
        : {};

    const lockedUntil = new Date(
        now.getTime() + LOCK_DURATION_MS
    );

    const lockToken =
        createLockToken();

    /*
     * Recover expired processing deliveries first.
     *
     * A delivery left in "processing" with an
     * expired lease represents a worker that
     * probably died while handling it.
     */
    let claimed =
        await WebhookDelivery.findOneAndUpdate(
            {
                ...scope,
                status: "processing",
                lockedUntil: {
                    $lte: now
                }
            },
            {
                $set: {
                    status: "processing",
                    lockedUntil,
                    lockToken,
                    lastAttemptAt: now
                },
                $inc: {
                    attempts: 1
                }
            },
            {
                sort: {
                    lockedUntil: 1,
                    createdAt: 1
                },
                returnDocument: "after"
            }
        );

    /*
     * If there is no expired processing delivery,
     * claim the next ordinary pending delivery.
     */
    if (!claimed) {
        claimed =
            await WebhookDelivery.findOneAndUpdate(
                {
                    ...scope,
                    status: "pending",
                    nextAttemptAt: {
                        $lte: now
                    }
                },
                {
                    $set: {
                        status: "processing",
                        lockedUntil,
                        lockToken,
                        lastAttemptAt: now
                    },
                    $inc: {
                        attempts: 1
                    }
                },
                {
                    sort: {
                        nextAttemptAt: 1,
                        createdAt: 1
                    },
                    returnDocument: "after"
                }
            );
    }

    return claimed;
};

const markDelivered = async (
    delivery,
    statusCode
) => {
    const now = new Date();

    const result =
        await WebhookDelivery.updateOne(
            {
                _id: delivery._id,
                status: "processing",
                lockToken:
                    delivery.lockToken
            },
            {
                $set: {
                    status: "delivered",
                    deliveredAt: now,
                    lastError: null,
                    responseStatusCode:
                        statusCode,
                    lockedUntil: null,
                    lockToken: null
                }
            }
        );

    if (result.modifiedCount !== 1) {
        throw new Error(
            "Webhook delivery lease was lost before completion"
        );
    }

    await Webhook.updateOne(
        {
            _id: delivery.webhook
        },
        {
            $set: {
                lastDeliveryAt: now,
                failureCount: 0
            }
        }
    );
};

const markFailed = async (
    delivery,
    errorMessage,
    responseStatusCode = null
) => {
    const attempts =
        Number(delivery.attempts) || 0;

    const terminal =
        attempts >= MAX_ATTEMPTS;

    const nextAttemptAt = terminal
        ? null
        : new Date(
            Date.now() +
            getRetryDelay(attempts)
        );

    const result =
        await WebhookDelivery.updateOne(
            {
                _id: delivery._id,
                status: "processing",
                lockToken:
                    delivery.lockToken
            },
            {
                $set: {
                    status: terminal
                        ? "failed"
                        : "pending",

                    nextAttemptAt,

                    lastError:
                        String(errorMessage)
                            .slice(0, 2000),

                    responseStatusCode,

                    lockedUntil: null,
                    lockToken: null
                }
            }
        );

    if (result.modifiedCount !== 1) {
        console.error(
            "Webhook markFailed lease mismatch:",
            {
                deliveryId:
                    String(delivery._id),
                deliveryStatus:
                    delivery.status,
                deliveryAttempts:
                    delivery.attempts,
                deliveryLockToken:
                    delivery.lockToken,
                terminal,
                modifiedCount:
                    result.modifiedCount,
                matchedCount:
                    result.matchedCount
            }
        );

        throw new Error(
            "Webhook delivery lease was lost before failure state update"
        );
    }

    await Webhook.updateOne(
        {
            _id: delivery.webhook
        },
        {
            $inc: {
                failureCount: 1
            }
        }
    );
};

const deliver = async delivery => {
    const webhook =
        await Webhook.findById(
            delivery.webhook
        ).select("+secret");

    if (!webhook) {
        throw new Error(
            "Webhook endpoint no longer exists"
        );
    }

    const controller =
        new AbortController();

    const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
    );

    try {
        const signaturePayload =
            `${delivery.timestamp}.${delivery.payload}`;

        const signature =
            crypto
                .createHmac(
                    "sha256",
                    webhook.secret
                )
                .update(signaturePayload)
                .digest("hex");

        const response = await fetch(
            webhook.url,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json",

                    "User-Agent":
                        "PrimePay-Webhooks/1.0",

                    "X-PrimePay-Signature":
                        `t=${delivery.timestamp},v1=${signature}`
                },

                body:
                    delivery.payload,

                signal:
                    controller.signal
            }
        );

        return {
            ok:
                response.status >= 200 &&
                response.status < 300,

            statusCode:
                response.status
        };
    } finally {
        clearTimeout(timeout);
    }
};

const processOneDelivery = async (businessId = null) => {
    const delivery =
        await claimNextDelivery(businessId);

    if (!delivery) {
        return false;
    }

    try {
        const result =
            await deliver(delivery);

        if (result.ok) {
            await markDelivered(
                delivery,
                result.statusCode
            );
        } else {
            await markFailed(
                delivery,
                `Webhook returned HTTP ${result.statusCode}`,
                result.statusCode
            );
        }
    } catch (error) {
        await markFailed(
            delivery,
            error?.name === "AbortError"
                ? "Webhook request timed out"
                : error?.message ||
                  "Webhook delivery failed"
        );
    }

    return true;
};

const processWebhookQueue = async () => {
    if (processing) {
        return;
    }

    processing = true;

    try {
        while (true) {
            const processed =
                await processOneDelivery();

            if (!processed) {
                break;
            }
        }
    } catch (error) {
        console.error(
            "Webhook worker error:",
            error.message
        );
    } finally {
        processing = false;
    }
};

const startWebhookWorker = () => {
    if (workerTimer) {
        return;
    }

    console.log(
        "PrimePay webhook worker started"
    );

    processWebhookQueue();

    workerTimer = setInterval(
        processWebhookQueue,
        POLL_INTERVAL_MS
    );
};

const stopWebhookWorker = () => {
    if (!workerTimer) {
        return;
    }

    clearInterval(workerTimer);
    workerTimer = null;

    console.log(
        "PrimePay webhook worker stopped"
    );
};

module.exports = {
    processWebhookQueue,
    processOneDelivery,
    startWebhookWorker,
    stopWebhookWorker,
    claimNextDelivery,
    deliver
};
