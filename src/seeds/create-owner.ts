import dotenv from 'dotenv';
import { dbConnect } from '../config/mongo';
import { User } from '../models/User.model';

dotenv.config();

async function createOwner() {
  await dbConnect();

  const email = 'admin@boscanymoni.com';
  const existing = await User.findOne({ email });

  if (existing) {
    console.log(`Usuario ya existe: ${email} (role: ${existing.role})`);
    if (existing.role !== 'owner') {
      existing.role = 'owner';
      await existing.save();
      console.log('Role actualizado a owner');
    }
    process.exit(0);
  }

  const owner = await User.create({
    name: 'Boscan Admin',
    email,
    password: '123456789',
    role: 'owner',
    isActive: true,
  });

  console.log(`Owner creado exitosamente:`);
  console.log(`  Email: ${owner.email}`);
  console.log(`  Role: ${owner.role}`);
  console.log(`  ID: ${owner._id}`);
  process.exit(0);
}

createOwner().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
