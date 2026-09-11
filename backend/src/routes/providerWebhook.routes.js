const express = require("express");

const {
    receiveProviderWebhook
} = require(
    "../controllers/providerWebhook.controller"
);

const router = express.Router();

router.post(
    "/:provider",
    express.raw({
        type: "application/json"
    }),
    receiveProviderWebhook
);

module.exports = router;
