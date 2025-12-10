// src/controllers/sales.controller.ts
import { Request, Response } from 'express';
import prisma from '../config/database';
import { UserRole } from '@prisma/client';

// GET /api/sales - Mendapatkan semua user dengan role SALES
export const getAllSalesTeam = async (req: Request, res: Response) => {
  try {
    const salesMembers = await prisma.user.findMany({
      where: {
        role: UserRole.SALES, // Hanya ambil SALES
        status: 'ACTIVE',   // Hanya ambil yang aktif (opsional, tapi bagus)
      },
      select: {
        id: true,
        name: true,
        role: true,
      },
      orderBy: { name: 'asc' },
    });
    res.status(200).json(salesMembers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sales team' });
  }
};