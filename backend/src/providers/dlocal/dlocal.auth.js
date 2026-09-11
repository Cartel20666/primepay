const crypto = require("crypto");

const getDlocalBaseUrl = () => {
    return process.env.DLOCAL_ENVIRONMENT === "production"
        ? "https://api.dlocal.com"
        : "https://sandbox.dlocal.com";
};

const getDlocalCredentials = () => {
    const login = process.env.DLOCAL_X_LOGIN;
    const transKey = process.env.DLOCAL_X_TRANS_KEY;
    const secretKey = process.env.DLOCAL_SECRET_KEY;

    if (!login || !transKey || !secretKey) {
        throw new Error(
            "dLocal credentials are not configured."
        );
    }

    return {
        login,
        transKey,
        secretKey
    };
};

const createSignature = ({
    login,
    secretKey,
    date,
    body
}) => {
    const payload =
        `${login}${date}${body}`;

    return crypto
        .createHmac(
            "sha256",
            secretKey
        )
        .update(payload)
        .digest("hex");
};

const createHeaders = (body = "") => {
    const {
        login,
        transKey,
        secretKey
    } = getDlocalCredentials();

    const date =
        new Date().toISOString();

    const signature =
        createSignature({
            login,
            secretKey,
            date,
            body
        });

    return {
        "X-Date": date,
        "X-Login": login,
        "X-Trans-Key": transKey,
        "X-Version": "2.1",
        "Content-Type": "application/json",
        "User-Agent": "PrimePay/1.0",
        "Authorization":
            `V2-HMAC-SHA256, Signature: ${signature}`
    };
};

const getBaseUrl = () => {
    return getDlocalBaseUrl();
};

module.exports = {
    getDlocalBaseUrl,
    getDlocalCredentials,
    createSignature,
    createHeaders,
    getBaseUrl
};
