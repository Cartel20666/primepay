const express = require("express");

const {
    createPayment,
    getPayment,
    getPaymentStatus
} = require("../controllers/payment.controller");

const { protect } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/", protect, createPayment);
router.get("/:reference/status", protect, getPaymentStatus);
router.get("/:reference", protect, getPayment);

module.exports = router;
