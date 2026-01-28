const mongoose = require("mongoose");

const configSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    valueNumber: { type: Number, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Config", configSchema);
