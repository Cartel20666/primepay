const express = require("express");

const {
    validate
} = require("../controllers/providerValidation.controller");

const {
    protect,
    authorize
} = require("../middleware/auth.middleware");

const router = express.Router();

router.post(
    "/:provider/validate",
    protect,
    authorize("admin"),
    validate
);

module.exports = router;
