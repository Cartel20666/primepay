const {
    validateProviderCredentials
} = require("../services/providerValidation.service");

const validate = async (req, res) => {
    try {
        const result = await validateProviderCredentials(
            req.params.provider
        );

        return res.status(200).json({
            success: true,
            message: "Provider credentials validated successfully.",
            data: result
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    validate
};
