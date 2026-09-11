const { getStripeClient } = require("./stripe.auth");

const constructWebhookEvent = (payload, signature) => {
    if (!payload) {
        throw new Error("Stripe webhook payload is required.");
    }

    if (!signature) {
        throw new Error("Stripe webhook signature is required.");
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        throw new Error("Stripe webhook secret is not configured.");
    }

    const stripe = getStripeClient();

    return stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret
    );
};

module.exports = {
    constructWebhookEvent
};
