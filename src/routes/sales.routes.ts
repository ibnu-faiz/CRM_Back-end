// src/routes/sales.routes.ts
import { Router } from 'express';
import * as salesController from '../controllers/sales.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateToken);

// GET /api/sales
router.get('/', salesController.getAllSalesTeam);

export default router;