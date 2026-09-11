const express = require("express");

const {
    getMyCustomers
} = require("../controllers/customer.controller");

const { protect } = require("../middleware/auth.middleware");

const router = express.Router();

router.get("/", protect, getMyCustomers);

module.exports = router;
