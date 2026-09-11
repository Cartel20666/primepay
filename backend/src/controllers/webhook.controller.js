const crypto = require("crypto");

const Webhook = require("../models/Webhook");
const WebhookDelivery = require("../models/WebhookDelivery");
const Business = require("../models/Business");

const SUPPORTED_EVENTS = [
    "payment.created",
    "payment.pending",
    "payment.completed",
    "payment.failed",
    "payment.cancelled",
    "payment.refunded",
    "payout.created",
    "payout.completed",
    "payout.failed"
];

const getActiveBusiness = async userId => {
    return Business.findOne({
        owner: userId,
        suspended: false
    });
};

const findOwnedWebhook = async ({
    webhookId,
    businessId
}) => {
    return Webhook.findOne({
        _id: webhookId,
        business: businessId
    });
};

const validateWebhookUrl = url => {
    try {
        const parsed = new URL(url);

        if (
            parsed.protocol !== "https:" &&
            parsed.hostname !== "127.0.0.1" &&
            parsed.hostname !== "localhost"
        ) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
};

const validateEvents = events => {
    if (!Array.isArray(events)) {
        return {
            valid: false,
            message: "Events must be an array."
        };
    }

    const uniqueEvents = [
        ...new Set(events)
    ];

    const invalidEvents =
        uniqueEvents.filter(
            event =>
                !SUPPORTED_EVENTS.includes(event)
        );

    if (invalidEvents.length) {
        return {
            valid: false,
            message:
                "Unsupported webhook event.",
            invalidEvents
        };
    }

    return {
        valid: true,
        events: uniqueEvents
    };
};

const serializeWebhook = webhook => ({
    id: webhook._id,
    url: webhook.url,
    events: webhook.events,
    active: webhook.active,
    lastDeliveryAt:
        webhook.lastDeliveryAt,
    failureCount:
        webhook.failureCount,
    createdAt:
        webhook.createdAt,
    updatedAt:
        webhook.updatedAt
});

const createWebhook = async (req, res) => {
    try {
        const {
            url,
            events = []
        } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                message:
                    "Webhook URL is required."
            });
        }

        if (!validateWebhookUrl(url)) {
            return res.status(400).json({
                success: false,
                message:
                    "Webhook URL must use HTTPS."
            });
        }

        const eventValidation =
            validateEvents(events);

        if (!eventValidation.valid) {
            return res.status(400).json({
                success: false,
                message:
                    eventValidation.message,
                invalidEvents:
                    eventValidation.invalidEvents,
                supportedEvents:
                    SUPPORTED_EVENTS
            });
        }

        const business =
            await getActiveBusiness(
                req.user._id
            );

        if (!business) {
            return res.status(404).json({
                success: false,
                message:
                    "Active business profile not found."
            });
        }

        const secret =
            `whsec_${crypto
                .randomBytes(32)
                .toString("hex")}`;

        const webhook =
            await Webhook.create({
                business:
                    business._id,
                url: url.trim(),
                events:
                    eventValidation.events,
                secret
            });

        return res.status(201).json({
            success: true,
            message:
                "Webhook created. Store the secret securely; it will not be shown again.",
            webhook: {
                ...serializeWebhook(webhook),
                secret
            }
        });
    } catch (error) {
        console.error(
            "Create webhook error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to create webhook."
        });
    }
};

const listWebhooks = async (req, res) => {
    try {
        const business =
            await getActiveBusiness(
                req.user._id
            );

        if (!business) {
            return res.status(404).json({
                success: false,
                message:
                    "Active business profile not found."
            });
        }

        const webhooks =
            await Webhook.find({
                business:
                    business._id
            })
                .sort({
                    createdAt: -1
                });

        return res.json({
            success: true,
            webhooks:
                webhooks.map(
                    serializeWebhook
                )
        });
    } catch (error) {
        console.error(
            "List webhooks error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to list webhooks."
        });
    }
};

const getWebhook = async (req, res) => {
    try {
        const business =
            await getActiveBusiness(
                req.user._id
            );

        if (!business) {
            return res.status(404).json({
                success: false,
                message:
                    "Active business profile not found."
            });
        }

        const webhook =
            await findOwnedWebhook({
                webhookId:
                    req.params.id,
                businessId:
                    business._id
            });

        if (!webhook) {
            return res.status(404).json({
                success: false,
                message:
                    "Webhook not found."
            });
        }

        return res.json({
            success: true,
            webhook:
                serializeWebhook(webhook)
        });
    } catch (error) {
        console.error(
            "Get webhook error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to retrieve webhook."
        });
    }
};

const updateWebhook = async (req, res) => {
    try {
        const business =
            await getActiveBusiness(
                req.user._id
            );

        if (!business) {
            return res.status(404).json({
                success: false,
                message:
                    "Active business profile not found."
            });
        }

        const webhook =
            await findOwnedWebhook({
                webhookId:
                    req.params.id,
                businessId:
                    business._id
            });

        if (!webhook) {
            return res.status(404).json({
                success: false,
                message:
                    "Webhook not found."
            });
        }

        const {
            url,
            events,
            active
        } = req.body;

        if (
            url === undefined &&
            events === undefined &&
            active === undefined
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "At least one webhook field must be provided."
            });
        }

        if (url !== undefined) {
            if (
                typeof url !== "string" ||
                !validateWebhookUrl(url)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Webhook URL must use HTTPS."
                });
            }

            webhook.url =
                url.trim();
        }

        if (events !== undefined) {
            const eventValidation =
                validateEvents(events);

            if (!eventValidation.valid) {
                return res.status(400).json({
                    success: false,
                    message:
                        eventValidation.message,
                    invalidEvents:
                        eventValidation.invalidEvents,
                    supportedEvents:
                        SUPPORTED_EVENTS
                });
            }

            webhook.events =
                eventValidation.events;
        }

        if (active !== undefined) {
            if (
                typeof active !== "boolean"
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Active must be a boolean."
                });
            }

            webhook.active = active;
        }

        await webhook.save();

        return res.json({
            success: true,
            message:
                "Webhook updated successfully.",
            webhook:
                serializeWebhook(webhook)
        });
    } catch (error) {
        console.error(
            "Update webhook error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to update webhook."
        });
    }
};

const deleteWebhook = async (req, res) => {
    try {
        const business =
            await getActiveBusiness(
                req.user._id
            );

        if (!business) {
            return res.status(404).json({
                success: false,
                message:
                    "Active business profile not found."
            });
        }

        const webhook =
            await findOwnedWebhook({
                webhookId:
                    req.params.id,
                businessId:
                    business._id
            });

        if (!webhook) {
            return res.status(404).json({
                success: false,
                message:
                    "Webhook not found."
            });
        }

        await WebhookDelivery.deleteMany({
            webhook:
                webhook._id
        });

        await webhook.deleteOne();

        return res.json({
            success: true,
            message:
                "Webhook deleted successfully."
        });
    } catch (error) {
        console.error(
            "Delete webhook error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to delete webhook."
        });
    }
};

const listWebhookDeliveries =
    async (req, res) => {
        try {
            const business =
                await getActiveBusiness(
                    req.user._id
                );

            if (!business) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Active business profile not found."
                });
            }

            const webhook =
                await findOwnedWebhook({
                    webhookId:
                        req.params.id,
                    businessId:
                        business._id
                });

            if (!webhook) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Webhook not found."
                });
            }

            const page =
                Math.max(
                    Number(req.query.page) || 1,
                    1
                );

            const limit =
                Math.min(
                    Math.max(
                        Number(
                            req.query.limit
                        ) || 25,
                        1
                    ),
                    100
                );

            const skip =
                (page - 1) * limit;

            const filter = {
                business:
                    business._id,
                webhook:
                    webhook._id
            };

            if (req.query.status) {
                const statuses = [
                    "pending",
                    "processing",
                    "delivered",
                    "failed"
                ];

                if (
                    !statuses.includes(
                        req.query.status
                    )
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Invalid delivery status."
                    });
                }

                filter.status =
                    req.query.status;
            }

            const [
                deliveries,
                total
            ] = await Promise.all([
                WebhookDelivery.find(
                    filter
                )
                    .select(
                        "-payload"
                    )
                    .sort({
                        createdAt: -1
                    })
                    .skip(skip)
                    .limit(limit),

                WebhookDelivery.countDocuments(
                    filter
                )
            ]);

            return res.json({
                success: true,
                deliveries,
                pagination: {
                    page,
                    limit,
                    total,
                    pages:
                        Math.ceil(
                            total / limit
                        )
                }
            });
        } catch (error) {
            console.error(
                "List webhook deliveries error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to retrieve webhook deliveries."
            });
        }
    };

const retryWebhookDelivery =
    async (req, res) => {
        try {
            const business =
                await getActiveBusiness(
                    req.user._id
                );

            if (!business) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Active business profile not found."
                });
            }

            const webhook =
                await findOwnedWebhook({
                    webhookId:
                        req.params.id,
                    businessId:
                        business._id
                });

            if (!webhook) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Webhook not found."
                });
            }

            const delivery =
                await WebhookDelivery.findOne({
                    _id:
                        req.params.deliveryId,
                    webhook:
                        webhook._id,
                    business:
                        business._id
                });

            if (!delivery) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Webhook delivery not found."
                });
            }

            if (
                delivery.status !==
                    "failed" &&
                delivery.status !==
                    "pending"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Only failed or pending deliveries can be retried."
                });
            }

            delivery.status =
                "pending";

            delivery.attempts = 0;

            delivery.nextAttemptAt =
                new Date();

            delivery.lockedUntil =
                null;

            delivery.lockToken =
                null;

            delivery.lastError =
                null;

            delivery.responseStatusCode =
                null;

            await delivery.save();

            return res.json({
                success: true,
                message:
                    "Webhook delivery queued for retry.",
                delivery: {
                    id:
                        delivery._id,
                    status:
                        delivery.status,
                    attempts:
                        delivery.attempts,
                    nextAttemptAt:
                        delivery.nextAttemptAt
                }
            });
        } catch (error) {
            console.error(
                "Retry webhook delivery error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to retry webhook delivery."
            });
        }
    };

module.exports = {
    createWebhook,
    listWebhooks,
    getWebhook,
    updateWebhook,
    deleteWebhook,
    listWebhookDeliveries,
    retryWebhookDelivery,
    SUPPORTED_EVENTS
};
