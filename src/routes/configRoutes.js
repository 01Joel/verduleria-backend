const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const { setMargin, getMargin } = require("../controllers/configController");

router.get("/margin", auth, requireRole("ADMIN"), getMargin);
router.patch("/margin", auth, requireRole("ADMIN"), setMargin);

module.exports = router;
