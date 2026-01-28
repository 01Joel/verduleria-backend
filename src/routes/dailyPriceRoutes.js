const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");

const {
  listDailyPrices,
  listDailyPriceBoard,
  getDailyPrice,
  listPendingPrices,
  setManualPrice,
  recalcSessionDailyPrices,
} = require("../controllers/dailyPriceController");

const {
  listAdminPurchased,
  updateConversionAndRecalc,
} = require("../controllers/dailyPriceAdminController");

// ADMIN y VENDEDOR
router.use(auth, requireRole("ADMIN", "VENDEDOR"));

// ✅ ADMIN (lista mínima + edición conversion)
router.get("/admin/purchased", requireRole("ADMIN"), listAdminPurchased);
router.patch("/admin/variants/:variantId/conversion", requireRole("ADMIN"), updateConversionAndRecalc);

// VENDEDOR/ADMIN (vista normal)
router.get("/", listDailyPrices);
router.get("/pending", listPendingPrices);
router.post("/recalc", requireRole("ADMIN"), recalcSessionDailyPrices);
router.get("/board", listDailyPriceBoard); 
router.get("/:id", getDailyPrice);

// manual solo admin
router.patch("/:id/manual", requireRole("ADMIN"), setManualPrice);

module.exports = router;
