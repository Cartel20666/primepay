const axios = require("axios");

const {
    createHeaders,
    getBaseUrl
} = require("./dlocal.auth");

const normalizeCurrency = (currency) => {
    if (!currency || typeof currency !== "string") {
        throw new Error(
            "dLocal payment currency is required."
        );
    }

    return currency
        .trim()
        .toUpperCase();
};

const normalizeCountry = (country) => {
    if (!country || typeof country !== "string") {
        throw new Error(
            "dLocal payment country is required."
        );
    }

    return country
        .trim()
        .toUpperCase();
};

const formatAmount = (amount) => {
    const numericAmount =
        Number(amount);

    if (
        !Number.isFinite(numericAmount) ||
        numericAmount <= 0
    ) {
        throw new Error(
            "A valid dLocal payment amount is required."
        );
    }

    return numericAmount;
};

const createPayment = async ({
    amount,
    currency,
    country,
    reference,
    description,
    paymentMethodId,
    paymentMethodFlow,
    customerName,
    customerEmail,
    customerPhone,
    notificationUrl,
    callbackUrl
}) => {
    const body = {
        amount:
            formatAmount(amount),

        currency:
            normalizeCurrency(currency),

        country:
            normalizeCountry(country),

        order_id:
            reference,

        description:
            description ||
            "PrimePay Payment",

        payment_method_flow:
            paymentMethodFlow ||
            "REDIRECT",

        payer: {
            name:
                customerName ||
                "PrimePay Customer",

            email:
                customerEmail ||
                undefined,

            phone:
                customerPhone ||
                undefined
        }
    };

    if (paymentMethodId) {
        body.payment_method_id =
            paymentMethodId;
    }

    if (notificationUrl) {
        body.notification_url =
            notificationUrl;
    }

    if (callbackUrl) {
        body.callback_url =
            callbackUrl;
    }

    const bodyString =
        JSON.stringify(body);

    const headers =
        createHeaders(bodyString);

    const response =
        await axios.post(
            `${getBaseUrl()}/payments`,
            bodyString,
            {
                headers
            }
        );

    return response.data;
};

const getPayment = async (
    paymentId
) => {
    if (!paymentId) {
        throw new Error(
            "dLocal Payment ID is required."
        );
    }

    const headers =
        createHeaders("");

    const response =
        await axios.get(
            `${getBaseUrl()}/payments/${encodeURIComponent(paymentId)}`,
            {
                headers
            }
        );

    return response.data;
};

const getOrder = async (
    orderId
) => {
    if (!orderId) {
        throw new Error(
            "dLocal Order ID is required."
        );
    }

    const headers =
        createHeaders("");

    const response =
        await axios.get(
            `${getBaseUrl()}/orders/${encodeURIComponent(orderId)}`,
            {
                headers
            }
        );

    return response.data;
};

const createRefund = async ({
    paymentId,
    amount,
    currency,
    description,
    orderRefundId,
    notificationUrl
}) => {
    if (!paymentId) {
        throw new Error(
            "dLocal Payment ID is required for refund."
        );
    }

    const body = {
        payment_id:
            paymentId
    };

    if (
        amount !== undefined &&
        amount !== null
    ) {
        body.amount =
            formatAmount(amount);

        if (!currency) {
            throw new Error(
                "Currency is required when specifying a refund amount."
            );
        }

        body.currency =
            normalizeCurrency(currency);
    }

    if (description) {
        body.description =
            description;
    }

    if (orderRefundId) {
        body.order_refund_id =
            orderRefundId;
    }

    if (notificationUrl) {
        body.notification_url =
            notificationUrl;
    }

    const bodyString =
        JSON.stringify(body);

    const headers =
        createHeaders(bodyString);

    const response =
        await axios.post(
            `${getBaseUrl()}/refunds`,
            bodyString,
            {
                headers
            }
        );

    return response.data;
};

const getRefund = async (
    refundId
) => {
    if (!refundId) {
        throw new Error(
            "dLocal Refund ID is required."
        );
    }

    const headers =
        createHeaders("");

    const response =
        await axios.get(
            `${getBaseUrl()}/refunds/${encodeURIComponent(refundId)}/status`,
            {
                headers
            }
        );

    return response.data;
};
const findPaymentByOrderId = async (orderId) => {
    if (!orderId) {
        throw new Error(
            "dLocal order ID is required."
        );
    }

    const order = await getOrder(orderId);

    if (!order) {
        return null;
    }

    return order;
};
module.exports = {
    createPayment,
    getPayment,
   findPaymentByOrderId,  
  getOrder,
    createRefund,
    getRefund
};
