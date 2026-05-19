import dotenv from 'dotenv';
import { dbConnect } from '../config/mongo';
import { Product } from '../models/Product.model';
import { ShippingZone } from '../models/ShippingZone.model';
import { User } from '../models/User.model';
import { Order } from '../models/Order.model';

dotenv.config();

async function seedTestData() {
  await dbConnect();
  console.log('🌱 Sembrando datos de prueba...\n');

  // ── Limpiar datos previos ──────────────────────────────────────────────
  await Product.deleteMany({});
  await ShippingZone.deleteMany({});
  await User.deleteMany({ email: /test.*@example\.com/i });
  await Order.deleteMany({});

  // ── Productos ──────────────────────────────────────────────────────────
  const CDN = 'https://res.cloudinary.com/dpjzfua3n/image/upload/q_auto,f_auto';

  await Product.insertMany([
    {
      name: 'Taza Boscán',
      slug: 'taza-boscan',
      shortDescription: 'Las gafas icónicas, el bigote y la firma de Andersson.',
      description: 'Taza artesanal de Andersson Boscán — cerámica blanca Doga Designs.',
      price: 25,
      sizes: [
        { name: 'Estándar', price: 25 },
        { name: 'XXL', price: 49 },
      ],
      mainImage: `${CDN}/sorbito-de-verdad/products/djmvzzcmmpvzv9x5rixy.jpg`,
      stock: 50,
      allowBackorder: false,
      isActive: true,
      isFeatured: true,
      sku: 'SDV-BOSCAN-TEST',
    },
    {
      name: 'Taza La Moni',
      slug: 'taza-la-moni',
      shortDescription: 'Los ojos, pestañas y labios rojos de La Moni.',
      description: 'Taza artesanal de La Moni Velásquez.',
      price: 25,
      sizes: [
        { name: 'Estándar', price: 25 },
        { name: 'XXL', price: 49 },
      ],
      mainImage: `${CDN}/sorbito-de-verdad/products/nwj7zdnkoqssgovcgu0h.jpg`,
      stock: 50,
      allowBackorder: false,
      isActive: true,
      isFeatured: true,
      sku: 'SDV-MONI-TEST',
    },
    {
      name: 'Colección Completa',
      slug: 'coleccion-completa',
      shortDescription: 'Los 4 modelos en un solo empaque.',
      description: 'Taza Boscán + Taza La Moni + Taza Logo Invisible + Taza Logo Color.',
      price: 80,
      sizes: [{ name: 'Estándar', price: 80 }],
      mainImage: `${CDN}/sorbito-de-verdad/products/grd5lufomvoc0ferp6j2.jpg`,
      stock: 20,
      allowBackorder: false,
      isActive: true,
      isFeatured: true,
      sku: 'SDV-SET-TEST',
    },
  ]);
  console.log('✅ 3 productos de prueba');

  // ── Zonas de envío (precios ajustados para test) ───────────────────────
  await ShippingZone.insertMany([
    {
      name: 'Ecuador Continental',
      description: 'Envío gratuito a Ecuador',
      price: 0,
      countries: ['Ecuador'],
      estimatedDays: '3–5 días hábiles',
      isActive: true,
    },
    {
      name: 'Estados Unidos y Canadá',
      description: 'Envío a USA y Canadá',
      price: 20,
      countries: ['Estados Unidos', 'Canadá'],
      estimatedDays: '7–14 días hábiles',
      isActive: true,
    },
    {
      name: 'Europa',
      description: 'Envío a Europa',
      price: 20,
      countries: ['España', 'Francia', 'Alemania', 'Italia', 'Portugal', 'Reino Unido'],
      estimatedDays: '10–20 días hábiles',
      isActive: true,
    },
  ]);
  console.log('✅ 3 zonas de envío:');
  console.log('   🇪🇨 Ecuador — $0');
  console.log('   🇺🇸 USA/Canadá — $20');
  console.log('   🇪🇺 Europa — $20');

  // ── Resumen ───────────────────────────────────────────────────────────
  const products = await Product.find({ isActive: true });
  const zones = await ShippingZone.find({ isActive: true });

  console.log(`\n📦 ${products.length} productos activos:`);
  for (const p of products) {
    const sizes = (p as any).sizes?.map((s: any) => `$${s.price} ${s.name}`).join(' / ') || `$${p.price}`;
    console.log(`   • ${p.name} — ${sizes}`);
  }

  console.log(`\n🚚 ${zones.length} zonas de envío:`);
  for (const z of zones) {
    console.log(`   • ${z.name} — $${z.price} (${(z as any).countries?.join(', ')})`);
  }

  console.log('\n🎉 Listo para probar el flujo WhatsApp');
  console.log('   Envía "quiero comprar" al bot y sigue la conversación ☕');
  process.exit(0);
}

seedTestData().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
