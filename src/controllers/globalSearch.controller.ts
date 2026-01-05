import { Request, Response } from 'express';
import prisma from '../config/database';

export const search = async (req: Request, res: Response) => {
  // 1. Ambil query dari URL parameter (?q=...)
  const query = req.query.q as string;

  if (!query || query.length < 2) {
    return res.status(200).json({ team: [], leads: [] });
  }

  try {
    // 2. Query Database secara Parallel
    const [teamResults, leadResults] = await Promise.all([
      // A. Cari Team Member
      prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: query } },
            { email: { contains: query } },
          ],
        },
        take: 3,
        select: { id: true, name: true, role: true, avatar: true },
      }),

      // B. Cari Leads
      prisma.lead.findMany({
        where: {
          OR: [
            { title: { contains: query } },
            { company: { contains: query } },
          ],
        },
        take: 3,
        select: { id: true, title: true, company: true, status: true },
      }),
    ]);

    // 3. Kirim Response
    res.status(200).json({
      team: teamResults,
      leads: leadResults,
    });

  } catch (error) {
    console.error("Global Search Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};