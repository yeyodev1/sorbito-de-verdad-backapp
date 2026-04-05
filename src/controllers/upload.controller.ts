import { HttpStatusCode } from 'axios';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types/AuthRequest';
import { cloudinaryService } from '../services/cloudinary.service';

export const uploadImage = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'No se proporcionó ningún archivo' });
      return;
    }
    const result = await cloudinaryService.uploadBuffer(req.file.buffer);
    res.send({
      success: true,
      data: { url: result.secure_url, publicId: result.public_id },
    });
  } catch (error) {
    next(error);
  }
};

export const deleteImage = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // publicId comes URL-encoded, e.g. "sorbito-de-verdad%2Fproducts%2Fabc123"
    const publicId = decodeURIComponent(req.params['publicId'] as string);
    await cloudinaryService.deleteImage(publicId);
    res.send({ success: true, message: 'Imagen eliminada de Cloudinary' });
  } catch (error) {
    next(error);
  }
};
