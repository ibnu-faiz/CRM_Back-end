// src/controllers/activities.controller.ts
import { Request, Response } from 'express';
import prisma from '../config/database';

export const getAllActivities = async (req: Request, res: Response) => {
  try {
    // Ambil User ID dari token (jika ingin filter per user)
    // const userId = (req as any).user.userId; 

    // Ambil 20 aktivitas terakhir dari seluruh leads
    const activities = await prisma.leadActivity.findMany({
      take: 50, // Limit 20 saja biar ringan
      orderBy: {
        createdAt: 'desc' // Urutkan dari yang terbaru
      },
      include: {
        // Include data user pembuat activity untuk avatar/nama
        createdBy: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        },
        // Include data lead terkait (opsional, buat jaga-jaga)
        lead: {
          select: {
            id: true,
            company: true,
            contacts: true,
            isArchived: true,
            assignedUsers: {
              select: {
                id: true,
                name: true,
                role: true
              }
            }
          }
        }
      }
    });

    res.json(activities);
  } catch (error) {
    console.error("Error fetching activities:", error);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
};