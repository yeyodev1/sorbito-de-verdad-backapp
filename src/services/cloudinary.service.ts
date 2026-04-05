import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

function getCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  return cloudinary;
}

export class CloudinaryService {
  async uploadBuffer(
    buffer: Buffer,
    folder = 'sorbito-de-verdad/products'
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = getCloudinary().uploader.upload_stream(
        {
          folder,
          transformation: [
            { width: 1200, height: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' },
          ],
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result as UploadApiResponse);
        }
      );
      stream.end(buffer);
    });
  }

  async uploadFromPath(
    filePath: string,
    folder = 'sorbito-de-verdad/products'
  ): Promise<UploadApiResponse> {
    return getCloudinary().uploader.upload(filePath, {
      folder,
      transformation: [
        { width: 1200, height: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' },
      ],
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    await getCloudinary().uploader.destroy(publicId);
  }

  getOptimizedUrl(publicId: string, width = 800, height = 800): string {
    return getCloudinary().url(publicId, {
      transformation: [
        { width, height, crop: 'fill', quality: 'auto', fetch_format: 'auto' },
      ],
    });
  }
}

export const cloudinaryService = new CloudinaryService();
