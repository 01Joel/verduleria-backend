const express = require("express");
const router = express.Router();

const { listPublicPromotions } = require("../controllers/promotionController");

// Público (sin auth): promos activas y no expiradas por sesión
router.get("/sessions/:sessionId/promotions", listPublicPromotions);

module.exports = router;
