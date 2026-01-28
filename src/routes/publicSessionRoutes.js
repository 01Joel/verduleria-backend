const express = require("express");
const router = express.Router();

const { getCurrentSession } = require("../controllers/publicSessionController");

router.get("/purchase-sessions/current", getCurrentSession);

module.exports = router;
