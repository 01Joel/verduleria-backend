const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const { weighLot } = require("../controllers/purchaseLotWeighController");

router.use(auth, requireRole("ADMIN"));
router.post("/:lotId/weigh", weighLot);

module.exports = router;
