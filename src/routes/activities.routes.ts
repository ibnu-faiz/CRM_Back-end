// src/routes/activities.routes.ts
import { Router } from 'express';
import { getAllActivities } from '../controllers/activities.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// GET /api/activities
router.get('/', authenticateToken, getAllActivities);

export default router;