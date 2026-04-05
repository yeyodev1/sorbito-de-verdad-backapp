import dotenv from 'dotenv';
import { dbConnect } from '../config/mongo';
import { Category } from '../models/Category.model';
import { Product } from '../models/Product.model';

dotenv.config();

const CDN = 'https://res.cloudinary.com/dpjzfua3n/image/upload/q_auto,f_auto';

// Uploaded via upload-images.ts
const IMG_BOSCAN    = `${CDN}/sorbito-de-verdad/products/taza-boscan-ok.jpg`;
const IMG_MONI      = `${CDN}/sorbito-de-verdad/products/taza-moni.jpg`;
const IMG_INVISIBLE = `${CDN}/sorbito-de-verdad/products/taza-invisible.jpg`;
const IMG_COLOR     = `${CDN}/sorbito-de-verdad/products/taza-relieve.jpg`;
const IMG_COLECCION = `${CDN}/sorbito-de-verdad/products/taza-coleccion.jpg`;

async function seed() {
  await dbConnect();
  console.log('🌱 Iniciando seed...');

  await Category.deleteMany({});
  await Product.deleteMany({});
  console.log('🗑️  Collections limpiadas');

  const categories = await Category.insertMany([
    {
      name: 'Colección Boscan',
      slug: 'coleccion-boscan',
      description: 'Taza blanca con las gafas icónicas, el bigote y la firma de Andersson Boscán',
    },
    {
      name: 'Colección La Moni',
      slug: 'coleccion-moni',
      description: 'Taza blanca con los ojos, las pestañas y los labios rojos de La Moni Velásquez',
    },
    {
      name: 'Artesanal Rústica',
      slug: 'artesanal-rustica',
      description: 'Cerámica artesanal en barro natural con diseños en relieve únicos e irrepetibles',
    },
    {
      name: 'Colección Completa',
      slug: 'coleccion-completa',
      description: 'Los 4 modelos en un solo empaque — el regalo perfecto para los fans de Sorbito de Verdad',
    },
  ]);

  const [catBoscan, catMoni, catRustica, catSet] = categories;
  console.log('✅ 4 categorías creadas');

  await Product.insertMany([
    // ── 01 Taza Boscán ──────────────────────────────────────
    {
      name: 'Taza Boscán',
      slug: 'taza-boscan',
      shortDescription: 'Las gafas icónicas, el bigote y la firma de Andersson en el reverso.',
      description:
        'El periodista que cuenta historias que otros no — ahora en tu taza. La Taza Boscán lleva en su frente las inconfundibles gafas y bigote de Andersson Boscán, obra del artista Franz Del Castillo, y su firma personal grabada en el reverso. Cerámica blanca de alta calidad fabricada a mano por Doga Designs en Ecuador. IVA y envío incluidos.',
      price: 25,
      sizes: [
        { name: 'Estándar', price: 25 },
        { name: 'XXL', price: 49 },
      ],
      mainImage: IMG_BOSCAN,
      images: [IMG_BOSCAN],
      category: catBoscan._id,
      productCollection: 'boscan',
      stock: 50,
      allowBackorder: false,
      isActive: true,
      isFeatured: true,
      tags: ['boscan', 'gafas', 'bigote', 'blanca', 'artesanal'],
      sku: 'SDV-BOSCAN-001',
    },

    // ── 02 Taza La Moni ──────────────────────────────────────
    {
      name: 'Taza La Moni',
      slug: 'taza-la-moni',
      shortDescription: 'Los ojos, las pestañas y los labios rojos de La Moni, firma en el reverso.',
      description:
        'La periodista más valiente para acompañar el café más caliente. La Taza La Moni captura la esencia de Moni Velásquez: sus pestañas largas, ojos expresivos y labios rojos, diseñados por Franz Del Castillo. Firma personal de La Moni en el reverso. Cerámica blanca fabricada a mano por Doga Designs. IVA y envío incluidos.',
      price: 25,
      sizes: [
        { name: 'Estándar', price: 25 },
        { name: 'XXL', price: 49 },
      ],
      mainImage: IMG_MONI,
      images: [IMG_MONI],
      category: catMoni._id,
      productCollection: 'moni',
      stock: 50,
      allowBackorder: false,
      isActive: true,
      isFeatured: true,
      tags: ['moni', 'pestañas', 'labios', 'blanca', 'artesanal'],
      sku: 'SDV-MONI-001',
    },

    // ── 03 Taza Logo Invisible ────────────────────────────────
    {
      name: 'Taza Logo Invisible',
      slug: 'taza-logo-invisible',
      shortDescription: '"Sorbito de verdad" grabado en relieve sobre cerámica artesanal.',
      description:
        'Sorbito de verdad grabado en relieve sobre cerámica artesanal. En el reverso el logo más famoso del periodismo matutino. Cada pieza es única, con pequeñas variaciones que la hacen irrepetible. Cerámica en tono crema natural fabricada a mano por Doga Designs en Ecuador. IVA y envío incluidos.',
      price: 25,
      sizes: [
        { name: 'Estándar', price: 25 },
        { name: 'XXL', price: 49 },
      ],
      mainImage: IMG_INVISIBLE,
      images: [IMG_INVISIBLE],
      category: catRustica._id,
      productCollection: 'rustica',
      stock: 30,
      allowBackorder: false,
      isActive: true,
      isFeatured: false,
      tags: ['rústica', 'relieve', 'cerámica', 'artesanal', 'invisible'],
      sku: 'SDV-RUST-001',
    },

    // ── 04 Taza Logo Color ────────────────────────────────────
    {
      name: 'Taza Logo Color',
      slug: 'taza-logo-color',
      shortDescription: 'El logo del canal en cerámica artesanal. La taza oficial del Team Boscán.',
      description:
        'El logo del canal Sorbito de Verdad pintado en color sobre cerámica artesanal crema. La taza oficial del Team Boscán — para quienes ven el noticiero con el café en la mano. Fabricada a mano por Doga Designs en Ecuador, cada pieza es única. IVA y envío incluidos.',
      price: 25,
      sizes: [
        { name: 'Estándar', price: 25 },
        { name: 'XXL', price: 49 },
      ],
      mainImage: IMG_COLOR,
      images: [IMG_COLOR],
      category: catRustica._id,
      productCollection: 'rustica',
      stock: 30,
      allowBackorder: false,
      isActive: true,
      isFeatured: false,
      tags: ['rústica', 'logo', 'color', 'cerámica', 'team-boscan'],
      sku: 'SDV-RUST-002',
    },

    // ── 05 Colección Completa ──────────────────────────────────
    {
      name: 'Colección Completa',
      slug: 'coleccion-completa',
      shortDescription: 'Los 4 modelos en un solo empaque. Solo tazas estándar.',
      description:
        'Los 4 modelos. Un solo empaque. La Colección Completa incluye: Taza Boscán, Taza La Moni, Taza Logo Invisible y Taza Logo Color — todas en tamaño estándar, presentadas en un empaque de lujo diseñado por Senefelder. $20 por taza. El regalo definitivo para los fans de Sorbito de Verdad. IVA y envío incluidos.',
      price: 80,
      sizes: [
        { name: 'Estándar', price: 80 },
      ],
      mainImage: IMG_COLECCION,
      images: [IMG_COLECCION],
      category: catSet._id,
      productCollection: 'set',
      stock: 20,
      allowBackorder: false,
      isActive: true,
      isFeatured: true,
      tags: ['colección', 'completa', 'set', 'pack', 'regalo', 'premium'],
      sku: 'SDV-SET-001',
    },
  ]);

  console.log('✅ 5 productos creados (catálogo oficial del PDF)');
  console.log('🎉 Seed completado exitosamente');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Error en seed:', err);
  process.exit(1);
});
