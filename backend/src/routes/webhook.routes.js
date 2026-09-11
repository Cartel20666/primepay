const express = require("express");

const {
    createWebhook,
    listWebhooks,
    getWebhook,
    updateWebhook,
    deleteWebhook,
    listWebhookDeliveries,
    retryWebhookDelivery
} = require("../controllers/webhook.controller");

const {
    protect
} = require("../middleware/auth.middleware");

const router =
    express.Router();

router.use(protect);

router.post(
    "/",
    createWebhook
);

router.get(
    "/",
    listWebhooks
);

router.get(
    "/:id",
    getWebhook
);

router.patch(
    "/:id",
    updateWebhook
);

router.delete(
    "/:id",
    deleteWebhook
);

router.get(
    "/:id/deliveries",
    listWebhookDeliveries
);

router.post(
    "/:id/deliveries/:deliveryId/retry",
    retryWebhookDelivery
);

module.exports = router;
