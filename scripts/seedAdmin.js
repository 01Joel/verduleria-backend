require("dotenv").config();
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const User = require("../src/models/User");

async function run() {
  if (!process.env.MONGO_URI) throw new Error("Falta MONGO_URI");
  await mongoose.connect(process.env.MONGO_URI);

  const username = (process.argv[2] || "admin").toLowerCase().trim();
  const password = process.argv[3] || "Admin12345";

  const existing = await User.findOne({ username });
  if (existing) {
    console.log("⚠️ Ya existe el usuario:", username);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ username, passwordHash, role: "ADMIN", active: true });

  console.log("✅ Admin creado:", { username, password });
  process.exit(0);
}

run().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
