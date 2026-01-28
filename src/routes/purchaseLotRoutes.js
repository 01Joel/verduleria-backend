const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const { listLots, patchLotPayment  } = require("../controllers/purchaseLotController");

router.use(auth, requireRole("ADMIN"));
router.get("/", listLots);
router.patch("/:id/payment", patchLotPayment);

module.exports = router;
