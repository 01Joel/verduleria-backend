const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");

const {
  createVariant,
  listVariants,
  getVariant,
  updateVariant,
  setVariantImage,
  removeVariantImage,
  bajaVariant,
  altaVariant,
} = require("../controllers/variantController");

router.use(auth, requireRole("ADMIN"));

router.post("/", createVariant);
router.get("/", listVariants);
router.get("/:id", getVariant);
router.patch("/:id", updateVariant);

router.patch("/:id/image", setVariantImage);
router.delete("/:id/image", removeVariantImage);

router.patch("/:id/baja", bajaVariant);
router.patch("/:id/alta", altaVariant);

module.exports = router;
