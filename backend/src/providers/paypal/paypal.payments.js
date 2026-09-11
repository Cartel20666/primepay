const {
    getPaymentsController
} = require("./paypal.auth");

const refundCapture = async ({
    captureId,
    amount,
    currency
}) => {
    if (!captureId) {
        throw new Error("PayPal Capture ID is required.");
    }

    const paymentsController = getPaymentsController();

    const body = {};

    if (amount !== undefined && amount !== null) {
        if (!currency) {
            throw new Error(
                "Currency is required when specifying a refund amount."
            );
        }

        const numericAmount = Number(amount);

        if (
            !Number.isFinite(numericAmount) ||
            numericAmount <= 0
        ) {
            throw new Error("A valid refund amount is required.");
        }

        body.amount = {
            currencyCode: currency.toUpperCase(),
            value: numericAmount.toFixed(2)
        };
    }

    const response =
        await paymentsController.refundCapturedPayment({
            captureId,
            body,
            prefer: "return=representation"
        });

    return response.result;
};

const getCapture = async (captureId) => {
    if (!captureId) {
        throw new Error("PayPal Capture ID is required.");
    }

    const paymentsController = getPaymentsController();

    const response =
        await paymentsController.getCapturedPayment({
            captureId
        });

    return response.result;
};

module.exports = {
    refundCapture,
    getCapture
};
