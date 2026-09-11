const crypto = require("crypto");

const createCredentialFingerprint = (values = []) => {
    const normalized =
        values.map(value =>
            value === undefined || value === null
                ? ""
                : String(value)
        );

    return crypto
        .createHash("sha256")
        .update(
            JSON.stringify(normalized),
            "utf8"
        )
        .digest("hex");
};

module.exports = {
    createCredentialFingerprint
};
