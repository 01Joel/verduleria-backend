const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");

const {
  createProduct,
  listProducts,
  getProduct,
  updateProduct,
  setProductImage,
  removeProductImage,
  bajaProduct,
  altaProduct,
} = require("../controllers/productController");

router.use(auth, requireRole("ADMIN"));

router.post("/", createProduct);
router.get("/", listProducts);
router.get("/:id", getProduct);
router.patch("/:id", updateProduct);

router.patch("/:id/image", setProductImage);
router.delete("/:id/image", removeProductImage);

router.patch("/:id/baja", bajaProduct);
router.patch("/:id/alta", altaProduct);

module.exports = router;
