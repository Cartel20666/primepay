const express = require("express");
const { handleStkCallback } = require("../controllers/mpesa.controller");

const router = express.Router();

router.post("/stk/callback", handleStkCallback);

module.exports = router;
