const express = require("express");
const router = express.Router({ mergeParams: true });

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");

const {
  addItem,
  listItems,
  reserveItem,
  releaseItem,
  cancelItem,
  confirmItem,
  removeItem,
  updatePlanFields,
  updatePlannedQty,
  updateItem,
} = require("../controllers/purchaseSessionItemController");

router.use(auth, requireRole("ADMIN"));

router.post("/", addItem);
router.get("/", listItems);
router.patch("/:itemId", updateItem);
router.delete("/:itemId", removeItem);
router.patch("/:itemId/plan", updatePlanFields);
router.post("/:itemId/reserve", reserveItem);
router.post("/:itemId/release", releaseItem);
router.post("/:itemId/cancel", cancelItem);
router.post("/:itemId/confirm", confirmItem);
router.patch("/:itemId/plannedQty", updatePlannedQty);

module.exports = router;
