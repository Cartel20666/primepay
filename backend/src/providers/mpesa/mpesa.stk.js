const axios = require("axios");
const { getMpesaAccessToken } = require("./mpesa.auth");
const { normalizeKenyanPhone } = require("../../utils/phone");

const getBaseUrl = () => {
    return process.env.MPESA_ENVIRONMENT === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";
};

const generatePassword = () => {
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;

    const timestamp = new Date()
        .toISOString()
        .replace(/[-:TZ.]/g, "")
        .slice(0, 14);

    if (!shortcode || !passkey) {
        throw new Error(
            "M-Pesa shortcode and passkey are not configured."
        );
    }

    const password = Buffer
        .from(`${shortcode}${passkey}${timestamp}`)
        .toString("base64");

    return {
        password,
        timestamp
    };
};

const initiateStkPush = async ({
    amount,
    phone,
    accountReference,
    transactionDesc
}) => {
    if (!amount || amount < 1) {
        throw new Error(
            "A valid STK Push amount is required."
        );
    }

    if (!phone) {
        throw new Error(
            "Customer phone number is required."
        );
    }

    const normalizedPhone =
        normalizeKenyanPhone(phone);

    if (!process.env.MPESA_CALLBACK_URL) {
        throw new Error(
            "M-Pesa callback URL is not configured."
        );
    }

    const token =
        await getMpesaAccessToken();

    const {
        password,
        timestamp
    } = generatePassword();

    try {
        const response = await axios.post(
            `${getBaseUrl()}/mpesa/stkpush/v1/processrequest`,
            {
                BusinessShortCode:
                    process.env.MPESA_SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                TransactionType:
                    "CustomerPayBillOnline",
                Amount: Math.round(amount),
                PartyA: normalizedPhone,
                PartyB:
                    process.env.MPESA_SHORTCODE,
                PhoneNumber:
                    normalizedPhone,
                CallBackURL:
                    process.env.MPESA_CALLBACK_URL,
                AccountReference:
                    accountReference,
                TransactionDesc:
                    transactionDesc ||
                    "PrimePay Payment"
            },
            {
                headers: {
                    Authorization:
                        `Bearer ${token}`,
                    "Content-Type":
                        "application/json"
                }
            }
        );

        return {
            ...response.data,
            checkoutRequestId:
                response.data.CheckoutRequestID ||
                null,
            merchantRequestId:
                response.data.MerchantRequestID ||
                null
        };
    } catch (error) {
        const hasProviderResponse =
            Boolean(error.response);

        const providerResponse =
            error.response?.data || null;

        const statusCode =
            error.response?.status || null;

        const message =
            providerResponse?.errorMessage ||
            providerResponse?.errorCode ||
            providerResponse?.ResultDesc ||
            error.message ||
            "M-Pesa STK Push failed.";

        const normalizedError =
            new Error(message);

        normalizedError.provider =
            "mpesa";

        normalizedError.providerResponse =
            providerResponse;

        normalizedError.statusCode =
            statusCode;

        normalizedError.providerResponded =
            hasProviderResponse;

        normalizedError.uncertainOutcome =
            !hasProviderResponse;

        throw normalizedError;
    }
};

const queryStkStatus = async ({
    checkoutRequestId
}) => {
    if (!checkoutRequestId) {
        throw new Error(
            "Checkout Request ID is required."
        );
    }

    if (
        !process.env.MPESA_SHORTCODE ||
        !process.env.MPESA_PASSKEY
    ) {
        throw new Error(
            "M-Pesa shortcode and passkey are not configured."
        );
    }

    const token =
        await getMpesaAccessToken();

    const {
        password,
        timestamp
    } = generatePassword();

    const response = await axios.post(
        `${getBaseUrl()}/mpesa/stkpushquery/v1/query`,
        {
            BusinessShortCode:
                process.env.MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID:
                checkoutRequestId
        },
        {
            headers: {
                Authorization:
                    `Bearer ${token}`,
                "Content-Type":
                    "application/json"
            }
        }
    );

    return {
        ...response.data,
        checkoutRequestId
    };
};

module.exports = {
    initiateStkPush,
    queryStkStatus
};
