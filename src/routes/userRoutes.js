const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");

const {
  listUsers,
  createVendor,
  updateUser,
  bajaUser,
  altaUser,
  resetPassword,
} = require("../controllers/userController");

router.use(auth, requireRole("ADMIN"));

// Listar usuarios (filtro por role/active/q)
router.get("/", listUsers);

// Crear vendedor
router.post("/vendors", createVendor);

// Editar username/active
router.patch("/:id", updateUser);

// Baja / alta lógica
router.patch("/:id/baja", bajaUser);
router.patch("/:id/alta", altaUser);

// Reset password
router.patch("/:id/password", resetPassword);

module.exports = router;
