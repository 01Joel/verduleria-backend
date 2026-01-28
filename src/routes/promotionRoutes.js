const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");

const {
  upsertPromotion,
  listPromotions,
  getPromotion,
  updatePromotion,
  activatePromotion,
  deactivatePromotion,
  setPromotionImage,
  removePromotionImage,
  listVendorPromotions,
} = require("../controllers/promotionController");

router.get("/vendor", auth, requireRole("ADMIN", "VENDEDOR"), listVendorPromotions);

router.use(auth, requireRole("ADMIN"));

// Crea o actualiza (upsert por sessionId+variantId)
router.post("/", upsertPromotion);

router.get("/", listPromotions);
router.get("/:id", getPromotion);
router.patch("/:id", updatePromotion);

router.patch("/:id/activate", activatePromotion);
router.patch("/:id/deactivate", deactivatePromotion);

router.patch("/:id/image", setPromotionImage);
router.delete("/:id/image", removePromotionImage);

module.exports = router;
