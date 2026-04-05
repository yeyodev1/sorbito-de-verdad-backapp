import { Router } from 'express';
import multer from 'multer';
import { uploadImage, deleteImage } from '../controllers/upload.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const uploadRouter = Router();
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'));
    }
  },
});

uploadRouter.post('/', authMiddleware, upload.single('image'), uploadImage);
uploadRouter.delete('/:publicId', authMiddleware, deleteImage);

export default uploadRouter;
