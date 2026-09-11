const {
    Client,
    Environment,
    OrdersController,
    PaymentsController
} = require("@paypal/paypal-server-sdk");

const getPayPalEnvironment = () => {
    const environment =
        process.env.PAYPAL_ENVIRONMENT || "sandbox";

    if (environment === "production") {
        return Environment.Production;
    }

    return Environment.Sandbox;
};

const getPayPalClient = () => {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error(
            "PayPal client credentials are not configured."
        );
    }

    return new Client({
        clientCredentialsAuthCredentials: {
            oAuthClientId: clientId,
            oAuthClientSecret: clientSecret
        },
        environment: getPayPalEnvironment()
    });
};

const getOrdersController = () => {
    const client = getPayPalClient();

    return new OrdersController(client);
};

const getPaymentsController = () => {
    const client = getPayPalClient();

    return new PaymentsController(client);
};

module.exports = {
    getPayPalClient,
    getOrdersController,
    getPaymentsController
};
