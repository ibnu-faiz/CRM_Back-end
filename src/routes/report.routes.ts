import { Router } from 'express';
import { getSalesReport } from '../controllers/report.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();



router.use(authenticateToken);

router.post('/sales', getSalesReport); 

export default router;
