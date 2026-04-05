import dotenv from 'dotenv';
import { dbConnect } from '../config/mongo';
import { ShippingZone } from '../models/ShippingZone.model';

dotenv.config();

async function seedShippingZones() {
  await dbConnect();
  console.log('🚚 Seeding zonas de envío...');

  await ShippingZone.deleteMany({});

  await ShippingZone.insertMany([
    {
      name: 'Ecuador Continental',
      description: 'Envío gratuito a todo Ecuador continental',
      price: 0,
      countries: ['Ecuador'],
      estimatedDays: '3–5 días hábiles',
      isActive: true,
    },
    {
      name: 'Estados Unidos y Canadá',
      description: 'Envío internacional a USA y Canadá',
      price: 48,
      countries: ['Estados Unidos', 'Canadá'],
      estimatedDays: '7–14 días hábiles',
      isActive: true,
    },
    {
      name: 'Europa',
      description: 'Envío internacional a Europa',
      price: 58,
      countries: [
        'España', 'Francia', 'Alemania', 'Italia', 'Portugal',
        'Países Bajos', 'Bélgica', 'Suiza', 'Austria', 'Suecia',
        'Noruega', 'Dinamarca', 'Finlandia', 'Polonia', 'Grecia',
      ],
      estimatedDays: '10–20 días hábiles',
      isActive: true,
    },
  ]);

  console.log('✅ 3 zonas de envío creadas:');
  console.log('   🇪🇨 Ecuador Continental — Gratis');
  console.log('   🇺🇸 Estados Unidos y Canadá — $48');
  console.log('   🇪🇺 Europa — $58');
  process.exit(0);
}

seedShippingZones().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
