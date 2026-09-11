const express = require("express");

const {
    createApiKey,
    listApiKeys,
    revokeApiKey,
    rotateApiKey
} = require("../controllers/apiKey.controller");

const { protect } = require("../middleware/auth.middleware");

const router = express.Router();

router.get(
    "/",
    protect,
    listApiKeys
);

router.post(
    "/",
    protect,
    createApiKey
);

router.post(
    "/:id/revoke",
    protect,
    revokeApiKey
);

router.post(
    "/:id/rotate",
    protect,
    rotateApiKey
);

module.exports = router;
