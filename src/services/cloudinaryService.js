const cloudinary = require("cloudinary").v2;

async function destroyImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch (err) {
    // No rompemos el flujo por un fallo al borrar en cloud; se registra y listo
    console.warn("⚠️ No se pudo borrar imagen en Cloudinary:", publicId, err.message);
  }
}

module.exports = { destroyImage };
