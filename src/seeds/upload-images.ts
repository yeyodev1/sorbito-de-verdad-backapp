/**
 * Script para subir las imágenes reales de productos a Cloudinary
 * y actualizar el seed con las URLs reales.
 *
 * Uso: pnpm upload-images
 */
import dotenv from 'dotenv';
import path from 'path';
import { cloudinaryService } from '../services/cloudinary.service';

dotenv.config();

const IMAGES_DIR = '/Users/diegoreyes/Downloads/Sorbito de verdad imágenes';

const imagesToUpload = [
  { file: 'taza boscan ok.jpg', name: 'taza-boscan-ok', tags: ['boscan', 'white', 'product'] },
  { file: 'taza coleccion.jpg', name: 'taza-coleccion', tags: ['collection', 'all', 'product'] },
  { file: 'taza invisible.jpg', name: 'taza-invisible', tags: ['rustica', 'city', 'lifestyle'] },
  { file: 'taza moni.jpg', name: 'taza-moni', tags: ['moni', 'white', 'product'] },
  { file: 'taza relieve.jpg', name: 'taza-relieve', tags: ['rustica', 'relieve', 'lifestyle'] },
  { file: 'hf_20260328_182401_c2c7b61a-39a2-419c-a91f-25e7cd73cf58.png', name: 'stack-collection', tags: ['hero', 'collection', 'dramatic'] },
  { file: 'hf_20260328_183522_38832e7e-ad58-45da-a6d7-acaed18167c8.png', name: 'product-2', tags: ['product'] },
  { file: 'hf_20260328_183550_f4871027-b320-4921-bbaa-5726ad73a6ae.png', name: 'product-3', tags: ['product'] },
  { file: 'hf_20260328_183553_3c0b5def-a822-4d75-9d99-e60edb320610.png', name: 'splash-rustica', tags: ['rustica', 'dramatic', 'coffee'] },
  { file: 'hf_20260328_184043_5114c397-b7a3-476f-857c-1e69f7dc398c.png', name: 'product-5', tags: ['product'] },
  { file: 'hf_20260329_025420_20790aed-4678-40de-a822-92669c6beddc.png', name: 'product-6', tags: ['product'] },
  { file: 'hf_20260329_031457_f12e2423-0141-4fea-8b3f-235eeff814b0.png', name: 'boscan-signature-lifestyle', tags: ['boscan', 'lifestyle', 'elegant'] },
  { file: 'WhatsApp Image 2026-03-30 at 00.57.40.jpeg', name: 'family-steam-hero', tags: ['hero', 'family', 'steam', 'dramatic'] },
];

async function uploadImages() {
  console.log('🚀 Subiendo imágenes a Cloudinary...\n');

  const results: Record<string, string> = {};

  for (const img of imagesToUpload) {
    const filePath = path.join(IMAGES_DIR, img.file);
    try {
      process.stdout.write(`  Subiendo: ${img.file}...`);
      const result = await cloudinaryService.uploadFromPath(filePath, 'sorbito-de-verdad/products');
      results[img.name] = result.secure_url;
      console.log(` ✅`);
      console.log(`    URL: ${result.secure_url}`);
    } catch (err) {
      console.log(` ❌ Error: ${(err as Error).message}`);
    }
  }

  console.log('\n📋 URLs para el seed:\n');
  console.log(JSON.stringify(results, null, 2));
  console.log('\n✅ Proceso completado');
  process.exit(0);
}

uploadImages().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
