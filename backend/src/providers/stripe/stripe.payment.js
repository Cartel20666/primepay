const { getStripeClient } = require("./stripe.auth");

const createPaymentIntent = async ({
    amount,
    currency,
    reference,
    description,
    customerEmail,
    metadata
}) => {
    if (!amount || amount < 1) {
        throw new Error("A valid Stripe payment amount is required.");
    }

    if (!currency) {
        throw new Error("Payment currency is required.");
    }

    const stripe = getStripeClient();

    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount),
        currency: currency.toLowerCase(),
        description: description || "PrimePay Payment",
        receipt_email: customerEmail || undefined,
        metadata: {
            primepayReference: reference,
            ...(metadata || {})
        },
        automatic_payment_methods: {
            enabled: true
        }
    });

    return paymentIntent;
};

const retrievePaymentIntent = async (paymentIntentId) => {
    if (!paymentIntentId) {
        throw new Error("Stripe PaymentIntent ID is required.");
    }

    const stripe = getStripeClient();

    return stripe.paymentIntents.retrieve(paymentIntentId);
};

const refundPaymentIntent = async ({
    paymentIntentId,
    amount
}) => {
    if (!paymentIntentId) {
        throw new Error("Stripe PaymentIntent ID is required.");
    }

    const stripe = getStripeClient();

    const refundData = {
        payment_intent: paymentIntentId
    };

    if (amount !== undefined && amount !== null) {
        refundData.amount = Math.round(amount);
    }

    return stripe.refunds.create(refundData);
};

module.exports = {
    createPaymentIntent,
    retrievePaymentIntent,
    refundPaymentIntent
};
