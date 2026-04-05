import express, { Application } from 'express';
import authRouter from './auth.routes';
import productRouter from './product.routes';
import categoryRouter from './category.routes';
import orderRouter from './order.routes';
import uploadRouter from './upload.routes';
import adminRouter from './admin.routes';
import shippingZoneRouter from './shippingZone.routes';
import { payphoneWebhook } from '../controllers/order.controller';

function routerApi(app: Application) {
  const router = express.Router();
  app.use('/api', router);

  router.use('/auth', authRouter);
  router.use('/products', productRouter);
  router.use('/categories', categoryRouter);
  router.use('/orders', orderRouter);
  router.use('/upload', uploadRouter);
  router.use('/admin', adminRouter);
  router.use('/shipping-zones', shippingZoneRouter);

  // Public webhook — no auth middleware
  router.get('/webhook/payphone', payphoneWebhook);
}

export default routerApi;
