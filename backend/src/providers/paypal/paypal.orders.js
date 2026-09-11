const {
    CheckoutPaymentIntent
} = require("@paypal/paypal-server-sdk");

const {
    getOrdersController
} = require("./paypal.auth");

const formatAmount = (amount) => {
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error("A valid PayPal payment amount is required.");
    }

    return numericAmount.toFixed(2);
};

const normalizeCurrency = (currency) => {
    if (!currency || typeof currency !== "string") {
        throw new Error("PayPal payment currency is required.");
    }

    return currency.trim().toUpperCase();
};

const createOrder = async ({
    amount,
    currency,
    reference,
    description,
    returnUrl,
    cancelUrl
}) => {
    const ordersController = getOrdersController();

    const body = {
        intent: CheckoutPaymentIntent.Capture,

        purchaseUnits: [
            {
                referenceId: reference,

                description:
                    description || "PrimePay Payment",

                customId: reference,

                amount: {
                    currencyCode: normalizeCurrency(currency),
                    value: formatAmount(amount)
                }
            }
        ]
    };

    if (returnUrl || cancelUrl) {
        body.paymentSource = {
            paypal: {
                experienceContext: {
                    userAction: "PAY_NOW",

                    ...(returnUrl
                        ? { returnUrl }
                        : {}),

                    ...(cancelUrl
                        ? { cancelUrl }
                        : {})
                }
            }
        };
    }

    const response = await ordersController.createOrder({
        body,
        prefer: "return=representation"
    });

    return response.result;
};

const captureOrder = async (orderId) => {
    if (!orderId) {
        throw new Error("PayPal Order ID is required.");
    }

    const ordersController = getOrdersController();

    const response =
        await ordersController.captureOrder({
            id: orderId,

            prefer: "return=representation"
        });

    return response.result;
};

const getOrder = async (orderId) => {
    if (!orderId) {
        throw new Error("PayPal Order ID is required.");
    }

    const ordersController = getOrdersController();

    const response =
        await ordersController.getOrder({
            id: orderId
        });

    return response.result;
};

module.exports = {
    createOrder,
    captureOrder,
    getOrder
};
