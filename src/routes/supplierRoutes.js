const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");

const {
  createSupplier,
  listSuppliers,
  getSupplier,
  updateSupplier,
  bajaSupplier,
  altaSupplier,
} = require("../controllers/supplierController");

router.use(auth, requireRole("ADMIN"));

router.post("/", createSupplier);
router.get("/", listSuppliers);
router.get("/:id", getSupplier);
router.patch("/:id", updateSupplier);

router.patch("/:id/baja", bajaSupplier);
router.patch("/:id/alta", altaSupplier);

module.exports = router;
