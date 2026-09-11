const express = require("express");

const {
    getProviders,
    getProvider,
    activate,
    deactivate
} = require("../controllers/providerConfig.controller");

const {
    protect,
    authorize
} = require("../middleware/auth.middleware");

const router = express.Router();

router.get(
    "/",
    protect,
    authorize("admin"),
    getProviders
);

router.get(
    "/:provider",
    protect,
    authorize("admin"),
    getProvider
);

router.post(
    "/:provider/activate",
    protect,
    authorize("admin"),
    activate
);

router.post(
    "/:provider/deactivate",
    protect,
    authorize("admin"),
    deactivate
);

module.exports = router;
