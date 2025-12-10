// src/routes/team.routes.ts
import { Router } from 'express';
import * as teamController from '../controllers/team.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { authorizeRole } from '../middleware/role.middleware';

const router = Router();

// Terapkan autentikasi ke semua rute tim
router.use(authenticateToken);

// GET /api/team
router.get('/', teamController.getAllTeamMembers);

// GET /api/team/:id
router.get('/:id', teamController.getTeamMemberById);

// POST /api/team (Hanya Admin)
router.post(
  '/', 
  authorizeRole('ADMIN'), 
  teamController.createTeamMember
);

// PATCH /api/team/:id (Hanya Admin)
router.patch(
  '/:id', 
  authorizeRole('ADMIN'), 
  teamController.updateTeamMember
);

// DELETE /api/team/:id (Hanya Admin)
router.delete(
  '/:id', 
  authorizeRole('ADMIN'), 
  teamController.deleteTeamMember
);

export default router;