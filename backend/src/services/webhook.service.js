const crypto = require("crypto");
const Webhook = require("../models/Webhook");
const WebhookDelivery = require("../models/WebhookDelivery");

const createEventId = () =>
    `evt_${crypto.randomBytes(16).toString("hex")}`;

const buildWebhookPayload = ({
    event,
    eventId,
    timestamp,
    data
}) =>
    JSON.stringify({
        id: eventId,
        event,
        timestamp,
        data
    });

const queueWebhookDeliveries = async ({
    businessId,
    event,
    data,
    session = null
}) => {
    if (!businessId) {
        throw new Error(
            "businessId is required to queue webhook"
        );
    }

    if (!event) {
        throw new Error(
            "event is required to queue webhook"
        );
    }

    const query = Webhook.find({
        business: businessId,
        active: true,
        events: event
    });

    if (session) {
        query.session(session);
    }

    const webhooks = await query;

    if (!webhooks.length) {
        return [];
    }

    const timestamp =
        Math.floor(Date.now() / 1000);

    const eventId = createEventId();

    const payload = buildWebhookPayload({
        event,
        eventId,
        timestamp,
        data
    });

    const deliveries = [];

    for (const webhook of webhooks) {
        const document = {
            business: businessId,
            webhook: webhook._id,
            event,
            eventId,
            payload,
            timestamp,
            status: "pending",
            attempts: 0,
            nextAttemptAt: new Date()
        };

        try {
            const [delivery] =
                await WebhookDelivery.create(
                    [document],
                    session
                        ? { session }
                        : undefined
                );

            deliveries.push(delivery);
        } catch (error) {
            if (error?.code === 11000) {
                const existingQuery =
                    WebhookDelivery.findOne({
                        webhook: webhook._id,
                        eventId
                    });

                if (session) {
                    existingQuery.session(session);
                }

                const existing =
                    await existingQuery;

                if (existing) {
                    deliveries.push(existing);
                    continue;
                }
            }

            throw error;
        }
    }

    return deliveries;
};

const triggerWebhook = async (
    businessId,
    event,
    data
) =>
    queueWebhookDeliveries({
        businessId,
        event,
        data
    });

module.exports = {
    queueWebhookDeliveries,
    triggerWebhook,
    createEventId,
    buildWebhookPayload
};
