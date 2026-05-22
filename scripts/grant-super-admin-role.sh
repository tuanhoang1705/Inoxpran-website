#!/usr/bin/env bash
set -euo pipefail

EMAIL="${1:-}"
COMPOSE_FILE_PATH="${COMPOSE_FILE:-docker-compose.local.yml}"

if [[ -z "$EMAIL" ]]; then
  echo "Usage: bash scripts/grant-super-admin-role.sh <admin-email>" >&2
  echo "Optional: COMPOSE_FILE=docker-compose.yml bash scripts/grant-super-admin-role.sh <admin-email>" >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE_PATH" exec -T backend node - "$EMAIL" <<'NODE'
const mongoose = require('mongoose');
const Admin = require('./src/models/admin.model');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Admin email is required');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const admin = await Admin.findOneAndUpdate(
    { email },
    { 
      $set: { status: 'active' },
      $addToSet: { roles: { $each: ['ADMIN', 'SUPER_ADMIN'] } }
    },
    { new: true }
  ).select({ name: 1, email: 1, roles: 1, status: 1 });

  if (!admin) {
    throw new Error(`Admin not found: ${email}`);
  }

  console.log(JSON.stringify({
    ok: true,
    admin: {
      id: String(admin._id),
      name: admin.name,
      email: admin.email,
      status: admin.status,
      roles: admin.roles
    }
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message || error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
NODE
