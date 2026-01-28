const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");

const {
  createPurchaseSession,
  listPurchaseSessions,
  getPurchaseSession,
  updatePurchaseSession,
  openPurchaseSession,
  closePurchaseSession,
  updateBudget,
} = require("../controllers/purchaseSessionController");
const purchaseSessionItemRoutes = require("./purchaseSessionItemRoutes");


router.use(auth);

router.post("/", requireRole("ADMIN"), createPurchaseSession);
router.get("/", requireRole("ADMIN", "VENDEDOR"), listPurchaseSessions);
router.get("/:id", requireRole("ADMIN", "VENDEDOR"), getPurchaseSession);
router.patch("/:id", requireRole("ADMIN"), updatePurchaseSession);

router.post("/:id/open", requireRole("ADMIN"), openPurchaseSession);
router.post("/:id/close", requireRole("ADMIN"), closePurchaseSession);
router.patch("/:id/budget", requireRole("ADMIN"), updateBudget);

router.use("/:id/items", requireRole("ADMIN"), purchaseSessionItemRoutes);

module.exports = router;
