const Stripe = require("stripe");

const getStripeClient = () => {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
        throw new Error("Stripe secret key is not configured.");
    }

    return new Stripe(secretKey);
};

module.exports = {
    getStripeClient
};
