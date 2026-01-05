import { Router } from 'express';
import * as globalSearchController from '../controllers/globalSearch.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Pasang middleware auth jika search ini butuh login
router.use(authenticateToken);

// GET /api/global-search?q=keyword
router.get('/', globalSearchController.search);

export default router;